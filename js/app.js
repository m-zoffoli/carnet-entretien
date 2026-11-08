import {
  addDays, applyDone, buildIcs, createCarnet, diffDays, forecast, fromISO, kmStats, nextDue,
  sortedOperations, spentByYear, toISO, uid,
} from './domain.js';
import {
  ConflictError, DropboxStore, LocalStore, beginDropboxAuth, completeDropboxAuth, disconnectDropbox,
  dropboxConfigured, getFolder, getMode, isConnected, setFolder, setMode,
} from './store.js';

const root = document.getElementById('app');
const tabs = document.getElementById('tabs');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const toastEl = document.getElementById('toast');

const S = { store: null, carnet: null, rev: null, view: 'home', month: null, busy: false };
let objectUrls = [];

const today = () => toISO(new Date());

// --- Formats -----------------------------------------------------------------

const h = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (s) => (s ? fromISO(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const fmtShort = (s) => fromISO(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const fmtKm = (n) => `${Number(n).toLocaleString('fr-FR')} km`;
const fmtEur = (n) => Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2 });
const num = (value) => (value === '' || value == null ? null : Number(value));

function dueText(due) {
  if (due.status === 'inconnu') return due.oneOff ? 'Vérification à faire' : 'Intervalle à confirmer';
  if (due.status === 'fait') return 'Fait';
  const prefix = due.estimated ? 'Vers ' : '';
  if (due.km != null && due.estimated) return `${prefix}${fmtDate(due.date)} (${fmtKm(due.km)})`;
  return `${prefix}${fmtDate(due.date)}`;
}

const STATUS = { retard: 'En retard', bientot: 'Bientôt', ok: 'Planifié', fait: 'Fait', inconnu: 'À confirmer' };
const LEVEL = {
  constat: 'Relevé sur ta voiture',
  legal: 'Règle légale',
  officiel: 'Source officielle',
  tiers: 'Source non officielle',
  'a-confirmer': 'À confirmer',
};

const statusBadge = (due) =>
  `<span class="badge ${due.status}">${due.oneOff && due.status === 'inconnu' ? 'À faire' : STATUS[due.status]}</span>`;

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, 4500);
}

function field(label, name, value = '', type = 'text', attrs = '') {
  return `<label>${h(label)}<input name="${name}" type="${type}" value="${h(value)}" ${attrs}></label>`;
}

function textarea(label, name, value = '') {
  return `<label>${h(label)}<textarea name="${name}">${h(value)}</textarea></label>`;
}

const closeButton = '<button type="button" class="close" data-action="close" aria-label="Fermer">×</button>';

function revokeUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

function openModal(html) {
  revokeUrls();
  modalBody.innerHTML = closeButton + html;
  if (!modal.open) modal.showModal();
}

function closeModal() {
  if (modal.open) modal.close();
  revokeUrls();
}

// --- Vues --------------------------------------------------------------------

const opRow = ({ op, due }) => `
  <button class="row" data-action="op" data-id="${h(op.id)}">
    <span class="row-main">
      <span class="row-title">${h(op.title)}</span><br>
      <span class="muted small">${h(dueText(due))}</span>
    </span>
    <span class="row-side">${statusBadge(due)}</span>
  </button>`;

const apptRow = (a) => `
  <button class="row" data-action="appt" data-id="${h(a.id)}">
    <span class="row-main">
      <span class="row-title">${h(a.title)}</span><br>
      <span class="muted small">${h(fmtDate(a.date))} à ${h(a.time)}${a.location ? ' · ' + h(a.location) : ''}</span>
    </span>
  </button>`;

const upcomingAppts = (c) =>
  c.appointments.filter((a) => a.date >= today()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

function viewHome() {
  const c = S.carnet;
  const t = today();
  const stats = kmStats(c, t);
  const ops = sortedOperations(c, t);
  const urgent = ops.filter((x) => x.due.status === 'retard' || x.due.status === 'bientot');
  const next = ops.filter((x) => x.due.status === 'ok').slice(0, 3);
  const appts = upcomingAppts(c).slice(0, 3);
  const f = forecast(c, t);
  const spent = spentByYear(c).find(([y]) => y === t.slice(0, 4))?.[1] || 0;
  return `
    <div class="topbar">
      <div>
        <p class="muted small">${h(c.vehicle.marque)}</p>
        <h1>${h(c.vehicle.modele)}</h1>
      </div>
      <button class="icon" data-action="go" data-view="vehicle" aria-label="Véhicule et réglages">⚙︎</button>
    </div>
    <div class="card">
      <div class="stat">${fmtKm(stats.km)}</div>
      <p class="muted small">Relevé du ${h(fmtDate(stats.lastDate))}${stats.perYear ? ` · environ ${fmtKm(stats.perYear)} par an` : ''}</p>
      <div class="actions"><button class="primary" data-action="km">Mettre à jour le kilométrage</button></div>
    </div>
    ${urgent.length ? `<h2>À traiter</h2><div class="list">${urgent.map(opRow).join('')}</div>` : ''}
    ${appts.length ? `<h2>Rendez-vous</h2><div class="list">${appts.map(apptRow).join('')}</div>` : ''}
    ${next.length ? `<h2>Ensuite</h2><div class="list">${next.map(opRow).join('')}</div>` : ''}
    <h2>Budget</h2>
    <div class="card stat-pair">
      <div><div class="stat">${fmtEur(spent)}</div><p class="muted small">Dépensé en ${t.slice(0, 4)}</p></div>
      <div><div class="stat">${f.max ? budgetRange(f) : 'À chiffrer'}</div><p class="muted small">Prévu sur 12 mois</p></div>
    </div>`;
}

const budgetRange = (f) => (f.min === f.max ? fmtEur(f.max) : `${fmtEur(f.min)} à ${fmtEur(f.max)}`);

function dayMarks(c, t) {
  const marks = {};
  const add = (date, kind) => { (marks[date] ||= []).push(kind); };
  c.appointments.forEach((a) => add(a.date, 'appt'));
  sortedOperations(c, t).forEach(({ due }) => { if (due.date && due.status !== 'fait') add(due.date, 'due'); });
  return marks;
}

function viewCalendar() {
  const c = S.carnet;
  const t = today();
  S.month ||= t.slice(0, 7);
  const [year, month] = S.month.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const total = new Date(year, month, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const marks = dayMarks(c, t);

  let cells = '<span class="day pad"></span>'.repeat(lead);
  for (let d = 1; d <= total; d++) {
    const date = `${S.month}-${String(d).padStart(2, '0')}`;
    const dayMarksHtml = (marks[date] || []).slice(0, 3).map((k) => `<i class="mark ${k === 'due' ? 'due' : ''}"></i>`).join('');
    cells += `<button class="day ${date === t ? 'today' : ''}" data-action="new-appt" data-date="${date}" aria-label="${h(fmtDate(date))}">${d}<span class="marks">${dayMarksHtml}</span></button>`;
  }

  const appts = c.appointments.filter((a) => a.date.startsWith(S.month)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const dues = sortedOperations(c, t).filter((x) => x.due.date?.startsWith(S.month) && x.due.status !== 'fait');
  const title = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  return `
    <h1>Agenda</h1>
    <div class="month-nav">
      <button class="icon" data-action="month" data-delta="-1" aria-label="Mois précédent">‹</button>
      <strong>${h(title)}</strong>
      <button class="icon" data-action="month" data-delta="1" aria-label="Mois suivant">›</button>
    </div>
    <div class="grid">
      ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span class="dow">${d}</span>`).join('')}
      ${cells}
    </div>
    <div class="legend small muted">
      <span><i class="mark"></i> Rendez-vous</span>
      <span><i class="mark due"></i> Échéance</span>
    </div>
    <div class="actions"><button class="primary" data-action="new-appt" data-date="${t}">Nouveau rendez-vous</button></div>
    ${appts.length ? `<h2>Rendez-vous du mois</h2><div class="list">${appts.map(apptRow).join('')}</div>` : ''}
    ${dues.length ? `<h2>Échéances du mois</h2><div class="list">${dues.map(opRow).join('')}</div>` : ''}
    ${!appts.length && !dues.length ? '<p class="muted">Rien de prévu ce mois-ci. Touche un jour pour créer un rendez-vous.</p>' : ''}`;
}

function viewMaintenance() {
  const ops = sortedOperations(S.carnet, today());
  const dated = ops.filter((x) => x.due.date);
  const unknown = ops.filter((x) => !x.due.date && x.due.status === 'inconnu');
  const done = ops.filter((x) => x.due.status === 'fait');
  return `
    <h1>Entretien</h1>
    <h2>Échéances</h2>
    <div class="list">${dated.map(opRow).join('') || '<p class="card">Aucune échéance.</p>'}</div>
    ${unknown.length ? `<h2>À confirmer</h2><p class="muted small">Renseigne leur intervalle depuis le plan d’entretien, une facture ou le garage.</p><div class="list">${unknown.map(opRow).join('')}</div>` : ''}
    ${done.length ? `<h2>Faits</h2><div class="list">${done.map(opRow).join('')}</div>` : ''}
    <div class="actions"><button data-action="edit-op">Ajouter une opération</button></div>`;
}

function viewInvoices() {
  const list = [...S.carnet.invoices].sort((a, b) => b.date.localeCompare(a.date));
  const rows = list.map((inv) => `
    <button class="row" data-action="invoice" data-id="${h(inv.id)}">
      <span class="row-main">
        <span class="row-title">${h(inv.title)}</span><br>
        <span class="muted small">${h(fmtDate(inv.date))}${inv.garage ? ' · ' + h(inv.garage) : ''}</span>
      </span>
      <span class="row-side"><strong>${inv.amount != null ? fmtEur(inv.amount) : ''}</strong></span>
    </button>`).join('');
  return `
    <h1>Factures</h1>
    <div class="actions"><button class="primary" data-action="new-invoice">Ajouter une facture</button></div>
    ${rows ? `<h2>${list.length} facture${list.length > 1 ? 's' : ''}</h2><div class="list">${rows}</div>` : '<p class="muted">Aucune facture pour l’instant. Ajoute une photo ou un PDF.</p>'}`;
}

function viewBudget() {
  const c = S.carnet;
  const f = forecast(c, today());
  const years = spentByYear(c);
  const rows = f.items.map(({ op, due }) => `
    <button class="row" data-action="op" data-id="${h(op.id)}">
      <span class="row-main"><span class="row-title">${h(op.title)}</span><br><span class="muted small">${h(dueText(due))}</span></span>
      <span class="row-side">${op.costMin != null || op.costMax != null ? `<strong>${h(costText(op))}</strong>` : '<span class="badge">À chiffrer</span>'}</span>
    </button>`).join('');
  return `
    <h1>Budget</h1>
    <div class="card">
      <div class="stat">${f.max ? budgetRange(f) : 'À chiffrer'}</div>
      <p class="muted small">Prévu sur les 12 prochains mois${f.unpriced ? `, sans compter ${f.unpriced} opération${f.unpriced > 1 ? 's' : ''} à chiffrer` : ''}. Ces montants sont les estimations que tu as saisies.</p>
    </div>
    <h2>Prévisions à 12 mois</h2>
    <div class="list">${rows || '<p class="card">Aucune échéance à 12 mois.</p>'}</div>
    <h2>Dépenses par année</h2>
    ${years.length ? `<div class="list">${years.map(([y, v]) => `<div class="row"><span>${h(y)}</span><strong>${fmtEur(v)}</strong></div>`).join('')}</div>` : '<p class="muted">Les totaux apparaîtront avec tes factures.</p>'}`;
}

function costText(op) {
  if (op.costMin != null && op.costMax != null && op.costMin !== op.costMax) return `${fmtEur(op.costMin)} à ${fmtEur(op.costMax)}`;
  return fmtEur(op.costMax ?? op.costMin);
}

function viewVehicle() {
  const v = S.carnet.vehicle;
  const readings = [...S.carnet.readings].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const isDropbox = S.store instanceof DropboxStore;
  return `
    <div class="topbar">
      <h1>Véhicule</h1>
      <button class="icon" data-action="go" data-view="home" aria-label="Retour">×</button>
    </div>
    <form class="card" data-form="vehicle">
      <div class="two">
        ${field('Marque (D.1)', 'marque', v.marque)}
        ${field('Modèle (D.3)', 'modele', v.modele)}
        ${field('1re mise en circulation (B)', 'miseEnCirculation', v.miseEnCirculation, 'date', 'required')}
        ${field('Cylindrée (P.1)', 'cylindree', v.cylindree)}
        ${field('Énergie (P.3)', 'energie', v.energie)}
        ${field('Puissance (P.2, kW)', 'puissance', v.puissance)}
      </div>
      <label>Boîte de vitesses
        <select name="boite">
          ${[['', 'Non renseignée'], ['manuelle', 'Manuelle'], ['automatique', 'Automatique']].map(([value, text]) => `<option value="${value}" ${v.boite === value ? 'selected' : ''}>${text}</option>`).join('')}
        </select>
      </label>
      ${field('Type (D.2)', 'typeMine', v.typeMine)}
      ${field('Immatriculation', 'immatriculation', v.immatriculation, 'text', 'autocapitalize="characters"')}
      ${field('Numéro de série (E)', 'vin', v.vin, 'text', 'autocapitalize="characters" maxlength="17"')}
      <div class="actions"><button class="primary">Enregistrer</button></div>
    </form>
    <h2>Relevés kilométriques</h2>
    <div class="list">${readings.map((r) => `
      <${r.photo ? 'button data-action="reading-photo" data-id="' + h(r.id) + '"' : 'div'} class="row">
        <span>${h(fmtDate(r.date))}</span><strong>${fmtKm(r.km)}</strong>
      </${r.photo ? 'button' : 'div'}>`).join('')}</div>
    <h2>Stockage</h2>
    <div class="card">
      <p><strong>${isDropbox ? 'Dropbox' : 'Sur cet appareil uniquement'}</strong>${isDropbox ? `<br><span class="muted small">Dossier ${h(S.store.folder)}</span>` : ''}</p>
      ${isDropbox ? `<form data-form="folder">${field('Dossier partagé', 'folder', S.store.folder, 'text', 'required pattern="/.+"')}<div class="actions"><button>Changer de dossier</button></div></form>` : '<p class="muted small">Ces données ne sont pas partagées avec un autre téléphone.</p>'}
      <div class="actions">
        <button data-action="export">Exporter le carnet</button>
        ${isDropbox ? '<button class="danger" data-action="disconnect">Déconnecter</button>' : `<button class="primary" data-action="connect" ${dropboxConfigured() ? '' : 'disabled'}>Connecter Dropbox</button>`}
      </div>
    </div>`;
}

function viewWelcome(message = '') {
  tabs.hidden = true;
  root.innerHTML = `
    <h1>Carnet d’entretien</h1>
    <p class="muted">Échéances, rendez-vous, factures et budget de ta voiture.</p>
    ${message ? `<div class="card notice">${h(message)}</div>` : ''}
    <div class="card">
      <p><strong>Partagé entre vos téléphones</strong></p>
      <p class="muted small">Le carnet et les factures sont gardés dans ton Dropbox.</p>
      <div class="actions"><button class="primary" data-action="connect" ${dropboxConfigured() ? '' : 'disabled'}>Connecter Dropbox</button></div>
      ${dropboxConfigured() ? '' : '<p class="muted small">La connexion Dropbox reste à configurer sur cette version.</p>'}
    </div>
    <div class="card">
      <p><strong>Essayer sur cet appareil</strong></p>
      <p class="muted small">Rien n’est envoyé. Les données ne sont pas partagées.</p>
      <div class="actions"><button data-action="local">Continuer sans Dropbox</button></div>
    </div>`;
}

function viewOnboarding() {
  tabs.hidden = true;
  const t = today();
  root.innerHTML = `
    <h1>Ta voiture</h1>
    <p class="muted">Trois informations suffisent pour démarrer. Tu compléteras le reste plus tard.</p>
    <form class="card" data-form="onboarding">
      ${field('Date de 1re mise en circulation (case B)', 'miseEnCirculation', '', 'date', `required max="${t}"`)}
      ${field('Kilométrage actuel', 'km', '', 'number', 'required min="0" inputmode="numeric"')}
      ${field('Service d’entretien dans combien de jours ? (facultatif)', 'serviceDays', '', 'number', 'min="0" inputmode="numeric"')}
      <div class="actions"><button class="primary">Créer le carnet</button></div>
    </form>`;
}

const VIEWS = { home: viewHome, calendar: viewCalendar, maintenance: viewMaintenance, invoices: viewInvoices, budget: viewBudget, vehicle: viewVehicle };
const TABS = [['home', 'Accueil'], ['calendar', 'Agenda'], ['maintenance', 'Entretien'], ['invoices', 'Factures'], ['budget', 'Budget']];

function render() {
  if (!S.carnet) return;
  root.innerHTML = VIEWS[S.view]();
  tabs.hidden = false;
  tabs.innerHTML = TABS.map(([view, label]) => `<button data-action="go" data-view="${view}" ${S.view === view ? 'aria-current="page"' : ''}>${label}</button>`).join('');
}

// --- Fenêtres ----------------------------------------------------------------

function opModal(id) {
  const op = S.carnet.operations.find((o) => o.id === id);
  const due = nextDue(op, S.carnet, today());
  const source = op.source;
  const history = [...(op.history || [])].reverse();
  openModal(`
    <h3>${h(op.title)}</h3>
    ${statusBadge(due)}
    <p><strong>${h(dueText(due))}</strong></p>
    <p>${h(op.description)}</p>
    ${op.note ? `<p class="muted">${h(op.note)}</p>` : ''}
    ${op.costMin != null || op.costMax != null ? `<p>Estimation : <strong>${h(costText(op))}</strong></p>` : ''}
    ${source ? `<p class="small"><span class="badge">${h(LEVEL[source.level])}</span><br>${source.url ? `<a href="${h(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.label)}</a>` : h(source.label)}</p>` : ''}
    ${history.length ? `<p class="small"><strong>Historique</strong><br>${history.map((e) => `${h(fmtDate(e.date))}${e.km != null ? ' · ' + fmtKm(e.km) : ''}${e.note ? ' · ' + h(e.note) : ''}`).join('<br>')}</p>` : ''}
    <div class="actions">
      <button class="primary" data-action="new-appt" data-date="${today()}" data-op="${h(op.id)}">Prendre rendez-vous</button>
      <button data-action="done" data-id="${h(op.id)}">Marquer comme fait</button>
      <button data-action="edit-op" data-id="${h(op.id)}">Modifier</button>
    </div>`);
}

function doneModal(id) {
  const op = S.carnet.operations.find((o) => o.id === id);
  const stats = kmStats(S.carnet, today());
  openModal(`
    <h3>${h(op.title)} fait</h3>
    <form data-form="done" data-id="${h(id)}">
      ${field('Date', 'date', today(), 'date', `required max="${today()}"`)}
      ${field('Kilométrage', 'km', stats.km, 'number', 'min="0" inputmode="numeric"')}
      ${textarea('Remarque', 'note')}
      <div class="actions"><button class="primary">Enregistrer</button></div>
    </form>`);
}

function opFormModal(id) {
  const op = id ? S.carnet.operations.find((o) => o.id === id) : {};
  openModal(`
    <h3>${id ? 'Modifier' : 'Nouvelle opération'}</h3>
    <form data-form="op" data-id="${h(id || '')}">
      ${field('Nom', 'title', op.title, 'text', 'required')}
      ${textarea('Description', 'description', op.description)}
      <div class="two">
        ${field('Tous les (km)', 'intervalKm', op.intervalKm, 'number', 'min="0" inputmode="numeric"')}
        ${field('Tous les (mois)', 'intervalMonths', op.intervalMonths, 'number', 'min="0" inputmode="numeric"')}
        ${field('Échéance fixée', 'dueDate', op.dueDate, 'date')}
        ${field('Ou à (km)', 'dueKm', op.dueKm, 'number', 'min="0" inputmode="numeric"')}
        ${field('Coût minimum (€)', 'costMin', op.costMin, 'number', 'min="0" step="any" inputmode="decimal"')}
        ${field('Coût maximum (€)', 'costMax', op.costMax, 'number', 'min="0" step="any" inputmode="decimal"')}
      </div>
      ${textarea('Remarque', 'note', op.note)}
      <div class="actions">
        <button class="primary">Enregistrer</button>
        ${id ? `<button type="button" class="danger" data-action="delete-op" data-id="${h(id)}">Supprimer</button>` : ''}
      </div>
    </form>`);
}

function kmModal() {
  const stats = kmStats(S.carnet, today());
  openModal(`
    <h3>Relevé du tableau de bord</h3>
    <form data-form="km">
      ${field('Date', 'date', today(), 'date', `required max="${today()}"`)}
      ${field('Kilométrage', 'km', '', 'number', `required min="0" inputmode="numeric" placeholder="${stats.km}"`)}
      ${field('Service d’entretien dans (jours)', 'serviceDays', '', 'number', 'min="0" inputmode="numeric"')}
      <label>Photo du tableau de bord (facultatif)<input name="photo" type="file" accept="image/*"></label>
      <div class="actions"><button class="primary">Enregistrer</button></div>
    </form>`);
}

function apptFormModal({ id, date, opId }) {
  const existing = id ? S.carnet.appointments.find((a) => a.id === id) : null;
  const op = opId ? S.carnet.operations.find((o) => o.id === opId) : null;
  const a = existing || { title: op?.title || '', date, time: '09:00', durationMin: 60, location: '', notes: op?.description || '' };
  openModal(`
    <h3>${id ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}</h3>
    <form data-form="appt" data-id="${h(id || '')}" data-op="${h(opId || existing?.opId || '')}">
      ${field('Objet', 'title', a.title, 'text', 'required')}
      <div class="two">
        ${field('Date', 'date', a.date, 'date', 'required')}
        ${field('Heure', 'time', a.time, 'time', 'required')}
      </div>
      ${field('Durée (minutes)', 'durationMin', a.durationMin, 'number', 'min="5" step="5" inputmode="numeric" required')}
      ${field('Lieu', 'location', a.location)}
      ${textarea('Notes', 'notes', a.notes)}
      <div class="actions"><button class="primary">Enregistrer</button></div>
    </form>`);
}

function apptModal(id) {
  const a = S.carnet.appointments.find((x) => x.id === id);
  const canShare = Boolean(navigator.canShare?.({ files: [new File(['x'], 'rdv.ics', { type: 'text/calendar' })] }));
  openModal(`
    <h3>${h(a.title)}</h3>
    <p><strong>${h(fmtDate(a.date))} à ${h(a.time)}</strong> · ${h(a.durationMin)} min</p>
    ${a.location ? `<p>${h(a.location)}</p>` : ''}
    ${a.notes ? `<p class="muted">${h(a.notes)}</p>` : ''}
    <p class="small muted">Place l’événement dans votre calendrier partagé « Voiture » pour qu’il apparaisse sur vos deux téléphones.</p>
    <div class="actions">
      <button class="primary" data-action="ics" data-id="${h(a.id)}">Ajouter au calendrier</button>
      ${canShare ? `<button data-action="ics-share" data-id="${h(a.id)}">Partager le fichier</button>` : ''}
      <button data-action="edit-appt" data-id="${h(a.id)}">Modifier</button>
      <button class="danger" data-action="delete-appt" data-id="${h(a.id)}">Supprimer</button>
    </div>`);
}

function invoiceFormModal() {
  const checks = S.carnet.operations.map((op) => `
    <label class="check"><input type="checkbox" name="ops" value="${h(op.id)}"> ${h(op.title)}</label>`).join('');
  openModal(`
    <h3>Nouvelle facture</h3>
    <form data-form="invoice">
      <label>Photo ou PDF<input name="file" type="file" accept="image/*,application/pdf" required></label>
      ${field('Objet', 'title', '', 'text', 'required placeholder="Révision, pneus…"')}
      <div class="two">
        ${field('Date', 'date', today(), 'date', `required max="${today()}"`)}
        ${field('Montant TTC (€)', 'amount', '', 'number', 'min="0" step="any" inputmode="decimal"')}
        ${field('Kilométrage', 'km', '', 'number', 'min="0" inputmode="numeric"')}
        ${field('Garage', 'garage')}
      </div>
      ${textarea('Remarques', 'notes')}
      <fieldset><legend>Opérations réalisées</legend>${checks}</fieldset>
      <div class="actions"><button class="primary">Enregistrer</button></div>
    </form>`);
}

async function showFile(path, type, target) {
  try {
    const blob = await S.store.getFile(path);
    if (!blob) throw new Error('Fichier introuvable.');
    if (!modal.open) return;
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    target.innerHTML = type === 'application/pdf'
      ? `<iframe class="frame" src="${url}" title="Facture"></iframe><a class="button" href="${url}" target="_blank" rel="noopener">Ouvrir le PDF</a>`
      : `<img class="preview" src="${url}" alt="Document enregistré">`;
  } catch (error) {
    target.textContent = error.message;
  }
}

function invoiceModal(id) {
  const inv = S.carnet.invoices.find((x) => x.id === id);
  const opTitles = (inv.ops || []).map((opId) => S.carnet.operations.find((o) => o.id === opId)?.title).filter(Boolean);
  openModal(`
    <h3>${h(inv.title)}</h3>
    <p><strong>${h(fmtDate(inv.date))}</strong>${inv.amount != null ? ' · ' + fmtEur(inv.amount) : ''}${inv.km != null ? ' · ' + fmtKm(inv.km) : ''}</p>
    ${inv.garage ? `<p>${h(inv.garage)}</p>` : ''}
    ${inv.notes ? `<p class="muted">${h(inv.notes)}</p>` : ''}
    ${opTitles.length ? `<p class="small">Opérations : ${h(opTitles.join(', '))}</p>` : ''}
    <div id="file-view" class="muted small">Chargement du document…</div>
    <div class="actions"><button class="danger" data-action="delete-invoice" data-id="${h(inv.id)}">Supprimer</button></div>`);
  showFile(inv.file, inv.fileType, document.getElementById('file-view'));
}

// --- Enregistrement ----------------------------------------------------------

async function commit(mutate) {
  if (S.busy) return false;
  S.busy = true;
  try {
    const next = structuredClone(S.carnet);
    mutate(next);
    S.rev = await S.store.save(next, S.rev);
    S.carnet = next;
    render();
    return true;
  } catch (error) {
    if (error instanceof ConflictError) {
      toast('Le carnet vient de changer sur l’autre téléphone. Ta saisie n’est pas enregistrée, recommence après le rechargement.');
      closeModal();
      await reload();
    } else {
      toast(error.message || 'Enregistrement impossible.');
    }
    return false;
  } finally {
    S.busy = false;
  }
}

async function reload() {
  const { data, rev } = await S.store.load();
  S.carnet = data;
  S.rev = rev;
  if (data) render();
  else viewOnboarding();
}

/** Réduit les photos avant envoi. Un fichier illisible est conservé tel quel. */
async function prepareImage(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob || file;
  } catch {
    return file;
  }
}

const extension = (blob) => ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' })[blob.type] || 'bin';

function downloadIcs(appt) {
  const url = URL.createObjectURL(new Blob([buildIcs(appt)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rendez-vous-voiture.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const FORMS = {
  async onboarding(values) {
    const carnet = createCarnet({
      miseEnCirculation: values.miseEnCirculation,
      km: Number(values.km),
      serviceDays: num(values.serviceDays),
      today: today(),
    });
    S.rev = await S.store.save(carnet, S.rev);
    S.carnet = carnet;
    S.view = 'home';
    render();
  },

  async vehicle(values) {
    if (await commit((c) => { Object.assign(c.vehicle, values); })) toast('Véhicule enregistré.');
  },

  async folder(values) {
    setFolder(values.folder);
    S.store = new DropboxStore(getFolder());
    await reload();
  },

  async km(values, form) {
    const photo = form.elements.photo.files[0];
    const id = uid('km');
    let path = null;
    if (photo) {
      const blob = await prepareImage(photo);
      path = `releves/${id}.${extension(blob)}`;
      await S.store.putFile(path, blob);
    }
    const saved = await commit((c) => {
      c.readings.push({ id, date: values.date, km: Number(values.km), photo: path, note: '' });
      if (values.serviceDays !== '') {
        c.operations.find((o) => o.id === 'service').dueDate = addDays(values.date, Number(values.serviceDays));
      }
    });
    if (saved) closeModal();
  },

  async done(values, form) {
    const id = form.dataset.id;
    const saved = await commit((c) => {
      applyDone(c.operations.find((o) => o.id === id), { date: values.date, km: num(values.km), note: values.note });
    });
    if (saved) opModal(id);
  },

  async op(values, form) {
    const id = form.dataset.id;
    const fields = {
      title: values.title,
      description: values.description,
      intervalKm: num(values.intervalKm),
      intervalMonths: num(values.intervalMonths),
      dueDate: values.dueDate || null,
      dueKm: num(values.dueKm),
      costMin: num(values.costMin),
      costMax: num(values.costMax),
      note: values.note,
    };
    const newId = id || uid('op');
    const saved = await commit((c) => {
      if (id) Object.assign(c.operations.find((o) => o.id === id), fields);
      else c.operations.push({ id: newId, firstMonths: null, lastDoneDate: null, lastDoneKm: null, history: [], source: null, ...fields });
    });
    if (saved) opModal(newId);
  },

  async appt(values, form) {
    const id = form.dataset.id;
    const newId = id || uid('rdv');
    const record = {
      id: newId,
      opId: form.dataset.op || null,
      title: values.title,
      date: values.date,
      time: values.time,
      durationMin: Number(values.durationMin),
      location: values.location,
      notes: values.notes,
    };
    const saved = await commit((c) => {
      if (id) Object.assign(c.appointments.find((a) => a.id === id), record);
      else c.appointments.push(record);
    });
    if (saved) apptModal(newId);
  },

  async invoice(values, form) {
    const id = uid('fac');
    const blob = await prepareImage(form.elements.file.files[0]);
    const path = `factures/${id}.${extension(blob)}`;
    await S.store.putFile(path, blob);
    const ops = new FormData(form).getAll('ops');
    const km = num(values.km);
    const saved = await commit((c) => {
      c.invoices.push({
        id, title: values.title, date: values.date, amount: num(values.amount), km,
        garage: values.garage, notes: values.notes, ops, file: path, fileType: blob.type,
      });
      for (const opId of ops) {
        const op = c.operations.find((o) => o.id === opId);
        if (!op.lastDoneDate || values.date >= op.lastDoneDate) applyDone(op, { date: values.date, km, note: `Facture : ${values.title}` });
      }
      if (km != null) c.readings.push({ id: uid('km'), date: values.date, km, photo: null, note: 'Facture' });
    });
    if (saved) closeModal();
    else await S.store.deleteFile(path).catch(() => {});
  },
};

const ACTIONS = {
  go: ({ view }) => { S.view = view; render(); scrollTo(0, 0); },
  close: closeModal,
  km: kmModal,
  op: ({ id }) => opModal(id),
  done: ({ id }) => doneModal(id),
  'edit-op': ({ id }) => opFormModal(id),
  async 'delete-op'({ id }) {
    if (!confirm('Supprimer cette opération ?')) return;
    if (await commit((c) => { c.operations = c.operations.filter((o) => o.id !== id); })) closeModal();
  },
  month: ({ delta }) => {
    const [y, m] = S.month.split('-').map(Number);
    S.month = toISO(new Date(y, m - 1 + Number(delta), 1)).slice(0, 7);
    render();
  },
  'new-appt': ({ date, op }) => apptFormModal({ date, opId: op }),
  appt: ({ id }) => apptModal(id),
  'edit-appt': ({ id }) => apptFormModal({ id }),
  async 'delete-appt'({ id }) {
    if (!confirm('Supprimer ce rendez-vous du carnet ?')) return;
    if (await commit((c) => { c.appointments = c.appointments.filter((a) => a.id !== id); })) closeModal();
  },
  ics: ({ id }) => downloadIcs(S.carnet.appointments.find((a) => a.id === id)),
  async 'ics-share'({ id }) {
    const file = new File([buildIcs(S.carnet.appointments.find((a) => a.id === id))], 'rendez-vous-voiture.ics', { type: 'text/calendar' });
    await navigator.share({ files: [file] }).catch(() => {});
  },
  'new-invoice': invoiceFormModal,
  invoice: ({ id }) => invoiceModal(id),
  async 'delete-invoice'({ id }) {
    if (!confirm('Supprimer cette facture et son document ?')) return;
    const inv = S.carnet.invoices.find((x) => x.id === id);
    if (await commit((c) => { c.invoices = c.invoices.filter((x) => x.id !== id); })) {
      closeModal();
      await S.store.deleteFile(inv.file).catch(() => toast('Le document n’a pas pu être supprimé.'));
    }
  },
  'reading-photo': ({ id }) => {
    const r = S.carnet.readings.find((x) => x.id === id);
    openModal(`<h3>${h(fmtDate(r.date))}</h3><p>${fmtKm(r.km)}</p><div id="file-view" class="muted small">Chargement…</div>`);
    showFile(r.photo, 'image/jpeg', document.getElementById('file-view'));
  },
  connect: () => beginDropboxAuth(),
  async local() {
    setMode('local');
    await start();
  },
  export: () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(S.carnet, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `carnet-${today()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  disconnect: () => {
    if (!confirm('Déconnecter Dropbox de ce téléphone ? Les données restent dans Dropbox.')) return;
    disconnectDropbox();
    S.store = null;
    S.carnet = null;
    viewWelcome();
  },
};

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  try {
    await ACTIONS[target.dataset.action]?.(target.dataset);
  } catch (error) {
    toast(error.message || 'Action impossible.');
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const submit = form.querySelector('button:not([type="button"])');
  if (submit) submit.disabled = true;
  try {
    await FORMS[form.dataset.form](Object.fromEntries(new FormData(form)), form);
  } catch (error) {
    toast(error.message || 'Enregistrement impossible.');
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

// Recharge au retour sur l'application, pour voir ce que l'autre téléphone a saisi.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.store instanceof DropboxStore && S.carnet && !modal.open && !S.busy) {
    reload().catch(() => {});
  }
});

async function start() {
  const mode = getMode();
  if (mode === 'local') S.store = new LocalStore();
  else if (mode === 'dropbox' && isConnected()) S.store = new DropboxStore(getFolder());
  else return viewWelcome();

  try {
    await reload();
  } catch (error) {
    viewWelcome(error.message || 'Chargement impossible.');
  }
}

(async () => {
  try {
    await completeDropboxAuth();
  } catch (error) {
    return viewWelcome(error.message);
  }
  await start();
})();
