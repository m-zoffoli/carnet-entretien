import {
  addDays, applyDone, applyHistory, buildAlertPrompt, buildDueIcs, buildIcs, calendarFeedUrl, claudeChatUrl, createCarnet, diffDays, forecast, fromISO, kmStats, nextDue,
  parseDashboard, parseInvoice, priceOf, sortedOperations, spendPlan, spentByYear, toISO, uid, upgradeCarnet,
} from './domain.js';
import { GUIDE } from './guide.js';
import { readPhotoText } from './ocr.js';
import {
  CALENDAR_SCOPE, ConflictError, DropboxStore, LocalStore, MissingScopeError, beginDropboxAuth, completeDropboxAuth, disconnectDropbox,
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
// Apfel Grotezk n'a pas d'espace fine insécable : on la remplace par une espace insécable.
const wide = (s) => s.replace(/\u202f/g, '\u00a0');
const fmtNum = (n) => wide(Number(n).toLocaleString('fr-FR'));
const fmtKm = (n) => `${fmtNum(n)} km`;
const fmtEur = (n) => wide(Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2 }));
const num = (value) => (value === '' || value == null ? null : Number(value));

function dueText(due) {
  if (due.status === 'inconnu') {
    if (due.needsLast) return 'Dernière date à renseigner';
    return due.oneOff ? 'Vérification à faire' : 'Intervalle à confirmer';
  }
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
  conseil: 'Pour t’aider',
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

const ARROW = '<svg class="arrow" viewBox="0 0 56 40" aria-hidden="true"><path d="M2 20h50M34 3l18 17-18 17"/></svg>';
const pill = (text, kind = '') => `<span class="pill ${kind}">${h(text)}</span>`;

/** Le délai restant, en jours ou en kilomètres selon l'axe qui décide l'échéance. */
function delay(due) {
  const byKm = due.kmLeft != null && (due.estimated || due.daysLeft == null);
  if (byKm) return due.kmLeft < 0 ? `−${fmtNum(-due.kmLeft)} km` : `${fmtNum(due.kmLeft)} km`;
  if (due.daysLeft == null) return '—';
  const sign = due.daysLeft < 0 ? '−' : '';
  const days = Math.abs(due.daysLeft);
  if (days < 100) return `${sign}${days} j`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${sign}${months} mois`;
  return `${sign}${Math.round(days / 365.25)} ans`;
}

function opPills(due) {
  const out = [];
  if (due.status !== 'ok') out.push(statusBadge(due));
  if (due.status === 'fait' || due.status === 'inconnu') return out.join('');
  if (due.status !== 'retard') out.push(pill(`dans ${delay(due)}`));
  out.push(pill(dueText(due)));
  return out.join('');
}

const opRow = ({ op, due }) => `
  <button class="line ${due.status === 'fait' ? 'is-done' : ''}" data-action="op" data-id="${h(op.id)}">
    <span class="line-head"><span class="line-title">${h(op.title)}</span>${ARROW}</span>
    <span class="pills">${opPills(due)}</span>
  </button>`;

const opBlock = ({ op, due }) => `
  <button class="block ${due.status}" data-action="op" data-id="${h(op.id)}">
    <span class="block-head"><span>${h(op.title)}</span>${due.status === 'retard' ? pill('En retard') : ''}</span>
    <span class="block-value ${delay(due).length > 5 ? 'long' : ''}">${h(delay(due))}</span>
    <span class="block-sub">${h(dueText(due))}</span>
  </button>`;

const apptWhen = (a) => `${fromISO(a.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${a.time}`;

const apptRow = (a) => `
  <button class="line" data-action="appt" data-id="${h(a.id)}">
    <span class="line-head"><span class="line-title">${h(a.title)}</span>${ARROW}</span>
    <span class="pills">${pill(apptWhen(a), 'rdv')}${a.location ? pill(a.location) : ''}</span>
  </button>`;

const apptBlock = (a) => `
  <button class="block rdv" data-action="appt" data-id="${h(a.id)}">
    <span class="block-head"><span>${h(a.title)}</span></span>
    <span class="block-value">${h(a.date.slice(8, 10) + '.' + a.date.slice(5, 7))}</span>
    <span class="block-sub">${h(apptWhen(a))}${a.location ? ' · ' + h(a.location) : ''}</span>
  </button>`;

const upcomingAppts = (c) =>
  c.appointments.filter((a) => a.date >= today()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

// Estimation généreuse pour un 2.0 TDI bien entretenu, pas une donnée constructeur.
const LIFE_KM = 300000;

const roundKm = (n) => Math.ceil(n / 100) * 100;
const MARK_REACH = 6.5; // portée tactile d'un repère de chaque côté, en % de la jauge

/** La vie de la voiture en une jauge. items : les entretiens au kilométrage, triés. */
function kmGauge(items, km) {
  const end = Math.max(LIFE_KM, km, ...items.map((x) => x.due.km));
  const at = (n) => Math.round((n / end) * 10000) / 100;
  const next = items.find((x) => x.due.km > km);
  const positions = items.map((x) => at(x.due.km));

  // Chaque repère touche jusqu'à mi-chemin de ses voisins : deux repères proches restent sélectionnables.
  const marks = items.map(({ op, due }, i) => {
    const x = positions[i];
    const from = Math.max(i ? (positions[i - 1] + x) / 2 : 0, x - MARK_REACH, 0);
    const to = Math.min(i < items.length - 1 ? (x + positions[i + 1]) / 2 : 100, x + MARK_REACH, 100);
    const line = to > from ? ((x - from) / (to - from)) * 100 : 50;
    return `<button class="gauge-mark ${due.status}" data-action="op" data-id="${h(op.id)}" data-at="${from}" data-w="${to - from}" data-line="${line}" aria-label="${h(op.title)}, à ${fmtKm(due.km)}"></button>`;
  });

  return `
    <div class="gauge">
      <div class="gauge-bar">
        <span class="gauge-fill" data-at="${at(km)}"></span>
        ${marks.join('')}
      </div>
      <div class="gauge-ends"><span>0</span><span>${fmtNum(end)}</span></div>
      <p class="gauge-next">${next ? `Prochain repère : ${h(next.op.title)} à ${fmtKm(next.due.km)}` : 'Aucun repère à venir'}</p>
    </div>`;
}

function viewHome() {
  const c = S.carnet;
  const t = today();
  const stats = kmStats(c, t);
  const ops = sortedOperations(c, t);
  const late = ops.filter((x) => x.due.status === 'retard');
  const soon = ops.filter((x) => x.due.status === 'bientot');
  const next = ops.filter((x) => x.due.status === 'ok').slice(0, 3);
  const kmItems = ops.filter((x) => x.due.km != null).sort((a, b) => a.due.km - b.due.km);
  const appts = upcomingAppts(c).slice(0, 3);
  const f = forecast(c, t);
  const spent = spentByYear(c).find(([y]) => y === t.slice(0, 4))?.[1] || 0;
  const name = [c.vehicle.marque, c.vehicle.modele].filter(Boolean).join(' ') || 'Ma voiture';

  // Les retards d'abord, puis les urgences, les rendez-vous et les prochains entretiens.
  const cards = [
    ...late.map(opBlock),
    ...soon.map(opBlock),
    ...appts.slice(0, 1).map(apptBlock),
    ...appts.slice(1).map(apptRow),
    ...next.map(opRow),
  ];

  return `
    <div class="topbar">
      ${pill(name)}
      <button class="icon emoji" data-action="go" data-view="vehicle" aria-label="Véhicule et réglages"><span aria-hidden="true">🚗</span></button>
    </div>
    <div class="hero">
      <p class="hero-label">Kilométrage</p>
      <div class="hero-figure">
        <p class="hero-value">${fmtNum(roundKm(stats.km))}</p>
        <div class="hero-unit">
          <button class="icon emoji" data-action="km" aria-label="Noter le kilométrage"><span aria-hidden="true">🖋️</span></button>
          <span>km</span>
        </div>
      </div>
      <p class="hero-label">Dernier relevé : ${fmtKm(stats.lastKm)}${stats.lastDate ? ` le ${h(fmtShort(stats.lastDate))}` : ''}</p>
      ${stats.monthsEstimated ? `<p class="hero-label">Estimé depuis ${stats.monthsEstimated} mois : +${fmtKm(stats.km - stats.lastKm)}</p>` : ''}
      ${stats.perYear ? `<p class="hero-label">Environ ${fmtKm(stats.perMonth)} par mois</p>` : ''}
    </div>
    ${kmGauge(kmItems, stats.km)}
    <button class="agenda-band" data-action="go" data-view="calendar">Agenda</button>
    <div class="stack">
      ${cards.join('')}
      <button class="line" data-action="go" data-view="budget">
        <span class="line-head"><span class="line-title">${fmtEur(spent)} en ${t.slice(0, 4)}</span>${ARROW}</span>
        <span class="pills">${pill(f.max ? `${budgetRange(f)} prévus sur 12 mois` : 'Prévisions à chiffrer')}</span>
      </button>
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
  const urgent = dated.filter((x) => x.due.status === 'retard' || x.due.status === 'bientot').slice(0, 3);
  const later = dated.filter((x) => !urgent.includes(x));
  const unknown = ops.filter((x) => !x.due.date && x.due.status === 'inconnu');
  const done = ops.filter((x) => x.due.status === 'fait');
  return `
    <h1>Entretien</h1>
    ${dated.length ? `<div class="stack">${urgent.map(opBlock).join('')}${later.map(opRow).join('')}</div>` : '<p class="muted">Aucune échéance.</p>'}
    ${unknown.length ? `<h2>À confirmer</h2><p class="muted small">Renseigne leur intervalle depuis le plan d’entretien, une facture ou le garage.</p><div class="stack">${unknown.map(opRow).join('')}</div>` : ''}
    ${done.length ? `<h2>Faits</h2><div class="stack">${done.map(opRow).join('')}</div>` : ''}
    <div class="bar">
      <button class="primary" data-action="edit-op">Ajouter une opération <span aria-hidden="true">+</span></button>
      <button data-action="reminders">Recevoir des rappels</button>
    </div>`;
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

const PAST_YEARS = 2;
const FUTURE_YEARS = 3;
// La plus haute barre s'arrête à 80 % : le montant tient au-dessus.
const BAR_MAX = 80;
const roundTen = (n) => Math.round(n / 10) * 10;

/** Par année : ce qui est payé (factures) et ce qui reste à faire (milieu de la fourchette estimée). */
function spendChart(c, t) {
  const thisYear = Number(t.slice(0, 4));
  const plan = spendPlan(c, t, thisYear + FUTURE_YEARS);
  const spent = new Map(spentByYear(c));
  const first = Math.max(thisYear - PAST_YEARS, Math.min(thisYear, ...[...spent.keys()].map(Number)));

  const rows = [];
  for (let y = first; y <= thisYear + FUTURE_YEARS; y += 1) {
    const year = String(y);
    const planned = plan.years.find((p) => p.year === year);
    rows.push({ year, planned, done: spent.get(year) || 0, todo: planned ? roundTen((planned.min + planned.max) / 2) : 0 });
  }
  const top = Math.max(1, ...rows.map((r) => r.done + r.todo));
  const height = (v) => Math.max(1, Math.round((v / top) * BAR_MAX));
  const seg = (kind, v) => (v ? `<span class="spend-seg ${kind}" data-h="${height(v)}"></span>` : '');

  const selected = rows.find((r) => r.year === S.budgetYear) || rows.find((r) => r.year === String(thisYear));
  const invoices = c.invoices.filter((inv) => inv.date.startsWith(selected.year) && inv.amount != null);

  return `
    <h2>Dépenses faites et à faire</h2>
    <div class="spend">
      <div class="spend-legend">
        <span><i class="spend-key done"></i>Faites</span>
        <span><i class="spend-key todo"></i>À faire (estimation)</span>
      </div>
      <div class="spend-bars">
        ${rows.map((r) => `
          <button class="spend-col" data-action="budget-year" data-year="${r.year}" aria-pressed="${r === selected}" aria-label="${r.year} : ${fmtEur(r.done)} faites, environ ${fmtEur(r.todo)} à faire">
            <span class="spend-plot">
              <span class="spend-value">${fmtEur(r.done + r.todo)}</span>
              ${seg('todo', r.todo)}${seg('done', r.done)}
            </span>
            <span class="spend-year">${r.year}</span>
          </button>`).join('')}
      </div>
      ${plan.undated.count ? `<p class="muted small">Non comptés : ${plan.undated.count} entretiens sans date, environ ${budgetRange(plan.undated)} en tout. Renseigne leur dernière date dans Entretien pour les ajouter.</p>` : ''}
      ${plan.unpriced ? `<p class="muted small">${plan.unpriced} opération${plan.unpriced > 1 ? 's' : ''} datée${plan.unpriced > 1 ? 's' : ''} sans prix de référence, à chiffrer.</p>` : ''}
    </div>
    <h2>Détail ${selected.year}</h2>
    <div class="list">
      ${invoices.map((inv) => `<div class="row"><span class="row-main"><span class="row-title">${h(inv.title)}</span><br><span class="muted small">Facture du ${h(fmtDate(inv.date))}</span></span><span class="row-side"><strong>${fmtEur(inv.amount)}</strong></span></div>`).join('')}
      ${(selected.planned?.items || []).map(({ op, date, min, max }) => `
        <button class="row" data-action="op" data-id="${h(op.id)}">
          <span class="row-main"><span class="row-title">${h(op.title)}</span><br><span class="muted small">Vers ${h(fmtDate(date))}</span></span>
          <span class="row-side"><strong>${budgetRange({ min, max })}</strong></span>
        </button>`).join('')}
      ${invoices.length || selected.planned ? '' : '<p class="card">Rien de prévu cette année.</p>'}
    </div>`;
}

function viewBudget() {
  const c = S.carnet;
  const f = forecast(c, today());
  const years = spentByYear(c);
  const rows = f.items.map(({ op, due }) => `
    <button class="row" data-action="op" data-id="${h(op.id)}">
      <span class="row-main"><span class="row-title">${h(op.title)}</span><br><span class="muted small">${h(dueText(due))}</span></span>
      <span class="row-side">${priceOf(op) ? `<strong>${h(costText(op))}</strong>` : '<span class="badge">À chiffrer</span>'}</span>
    </button>`).join('');
  return `
    <h1>Budget</h1>
    <div class="card">
      <div class="stat">${f.max ? budgetRange(f) : 'À chiffrer'}</div>
      <p class="muted small">Prévu sur les 12 prochains mois${f.unpriced ? `, sans compter ${f.unpriced} opération${f.unpriced > 1 ? 's' : ''} à chiffrer` : ''}. Estimations sur des prix de référence, remplacés par les coûts que tu saisis.</p>
    </div>
    ${spendChart(c, today())}
    <h2>Prévisions à 12 mois</h2>
    <div class="list">${rows || '<p class="card">Aucune échéance à 12 mois.</p>'}</div>
    <h2>Dépenses par année</h2>
    ${years.length ? `<div class="list">${years.map(([y, v]) => `<div class="row"><span>${h(y)}</span><strong>${fmtEur(v)}</strong></div>`).join('')}</div>` : '<p class="muted">Les totaux apparaîtront avec tes factures.</p>'}`;
}

const costText = (op) => budgetRange(priceOf(op));

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
    ${isDropbox ? calendarSection() : ''}
    <h2>Stockage</h2>
    <div class="card">
      <p><strong>${isDropbox ? 'Dropbox' : 'Sur cet appareil uniquement'}</strong>${isDropbox ? `<br><span class="muted small">Dossier ${h(S.store.folder)}</span>` : ''}</p>
      ${isDropbox ? `<form data-form="folder">${field('Dossier partagé', 'folder', S.store.folder, 'text', 'required pattern="/.+"')}<div class="actions"><button>Changer de dossier</button></div></form>` : '<p class="muted small">Ces données ne sont pas partagées avec un autre téléphone.</p>'}
      <div class="actions">
        <button data-action="export">Exporter le carnet</button>
        <label class="button">Importer un historique<input class="visually-hidden" name="history" type="file" accept="application/json,.json"></label>
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
const TABS = [['home', 'Accueil'], ['maintenance', 'Entretien'], ['invoices', 'Factures'], ['budget', 'Budget']];
const BURGER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const tabButton = ([view, label]) => `<button data-action="go" data-view="${view}" ${S.view === view ? 'aria-current="page"' : ''}>${label}</button>`;

function render() {
  if (!S.carnet) return;
  root.innerHTML = VIEWS[S.view]();
  // La politique de sécurité interdit les attributs style : les positions passent par le CSSOM.
  root.querySelectorAll('[data-at]').forEach((el) => el.style.setProperty('--at', `${el.dataset.at}%`));
  root.querySelectorAll('[data-w]').forEach((el) => {
    el.style.setProperty('--w', `${el.dataset.w}%`);
    el.style.setProperty('--line', `${el.dataset.line}%`);
  });
  root.querySelectorAll('[data-h]').forEach((el) => el.style.setProperty('--h', `${el.dataset.h}%`));
  tabs.hidden = false;
  S.menuOpen = false;
  renderMenu();
}

function renderMenu() {
  tabs.innerHTML = `
    <button class="burger" data-action="menu" aria-label="Menu" aria-expanded="${Boolean(S.menuOpen)}">${BURGER_ICON}</button>
    ${S.menuOpen ? `<div class="menu">${TABS.map(tabButton).join('')}</div>` : ''}
    <button class="alert-fab" data-action="alert" aria-label="Ajouter un message d’alerte"><span aria-hidden="true">+</span></button>`;
}

function closeMenu() {
  if (!S.menuOpen) return;
  S.menuOpen = false;
  renderMenu();
}

// --- Fenêtres ----------------------------------------------------------------

function guideHtml(op) {
  const guide = GUIDE[op.id];
  if (!guide) return '';
  const perYear = kmStats(S.carnet, today()).perYear;
  const rhythm = guide.rhythmKm && perYear
    ? `<p class="small">À ton rythme d’environ ${fmtKm(perYear)} par an, ${fmtKm(guide.rhythmKm)} représentent environ ${Math.round((guide.rhythmKm / perYear) * 12)} mois.</p>`
    : '';
  const sections = guide.sections.map((s, index) => `
    <details class="guide" ${index === 0 ? 'open' : ''}>
      <summary>${h(s.title)}</summary>
      <span class="badge">${h(LEVEL[s.level])}</span>
      <ul>${s.items.map((item) => `<li>${h(item)}</li>`).join('')}</ul>
      ${s.source ? `<p class="small"><a href="${h(s.source.url)}" target="_blank" rel="noopener noreferrer">${h(s.source.label)}</a></p>` : ''}
    </details>`).join('');
  return `<h4>Pour en savoir plus</h4>${rhythm}${sections}`;
}

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
    ${priceOf(op) ? `<p>Estimation : <strong>${h(costText(op))}</strong>${priceOf(op).reference ? ' (prix de référence)' : ''}</p>` : ''}
    ${source ? `<p class="small"><span class="badge">${h(LEVEL[source.level])}</span><br>${source.url ? `<a href="${h(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.label)}</a>` : h(source.label)}</p>` : ''}
    ${history.length ? `<p class="small"><strong>Historique</strong><br>${history.map((e) => `${h(fmtDate(e.date))}${e.km != null ? ' · ' + fmtKm(e.km) : ''}${e.note ? ' · ' + h(e.note) : ''}`).join('<br>')}</p>` : ''}
    <div class="actions">
      <button class="primary" data-action="new-appt" data-date="${today()}" data-op="${h(op.id)}">Prendre rendez-vous</button>
      <button data-action="done" data-id="${h(op.id)}">Marquer comme fait</button>
      <button data-action="edit-op" data-id="${h(op.id)}">Modifier</button>
    </div>
    ${guideHtml(op)}`);
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
      <label>Photo du compteur (facultatif, remplit le kilométrage)<input name="photo" type="file" accept="image/*"></label>
      <p class="small muted" id="ocr-status" role="status" hidden></p>
      ${field('Date', 'date', today(), 'date', `required max="${today()}"`)}
      ${field('Kilométrage', 'km', '', 'number', `required min="0" inputmode="numeric" placeholder="${stats.km}"`)}
      <div class="actions"><button class="primary">Enregistrer</button></div>
    </form>`);
}

/** Le choix de départ : la photo ouvre directement l'appareil photo grâce à capture. */
function alertChoiceModal() {
  openModal(`
    <h3>Message d’alerte</h3>
    <p class="muted small">Recopie le message affiché par la voiture.</p>
    <div class="actions">
      <label class="button primary">Prendre une photo<input class="visually-hidden" name="alert-photo" type="file" accept="image/*" capture="environment"></label>
      <button data-action="alert-form">Saisir à la main</button>
    </div>`);
}

function alertFormModal(photo) {
  const options = S.carnet.operations.map((op) => `<option value="${h(op.id)}">${h(op.title)}</option>`).join('');
  openModal(`
    <h3>Message d’alerte</h3>
    <form data-form="alert">
      <p class="small muted" id="ocr-status" role="status" hidden></p>
      <label>Concerne<select name="opId">${options}<option value="new">Autre message</option></select></label>
      <div id="alert-title" hidden>${field('Message affiché', 'title', '', 'text')}</div>
      <div class="two">
        ${field('Dans (jours)', 'serviceDays', '', 'number', 'min="0" inputmode="numeric"')}
        ${field('Ou dans (km)', 'serviceKm', '', 'number', 'min="0" inputmode="numeric"')}
      </div>
      <div class="actions"><button class="primary">Enregistrer</button></div>
    </form>`);
  if (photo) fillFromPhoto(photo, modalBody.querySelector('form'));
}

let claudePrompt = '';

/** Après une alerte : un toucher ouvre Claude, car un iPhone bloque une ouverture sans geste. */
function alertSavedModal(prompt) {
  claudePrompt = prompt;
  openModal(`
    <h3>Alerte enregistrée</h3>
    <p>Claude peut t’expliquer ce message et te dire quoi demander au garage.</p>
    <p class="muted small">La question est aussi copiée : si elle n’apparaît pas dans Claude, il suffit de la coller.</p>
    <div class="actions">
      <a class="button primary" href="${h(claudeChatUrl(prompt))}" target="_blank" rel="noopener" data-action="ask-claude">Demander à Claude</a>
      <button data-action="close">Plus tard</button>
    </div>`);
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
      <p class="small muted" id="ocr-status" role="status" hidden></p>
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
    publishCalendar();
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
  if (data) upgradeCarnet(data);
  S.carnet = data;
  S.rev = rev;
  if (data) render();
  else viewOnboarding();
}

/** Réduit les photos avant envoi. Un fichier illisible est conservé tel quel. */
let ocrRun = 0;

/** Lit la photo et préremplit le formulaire ; la saisie à la main reste toujours possible. */
/** Un fichier d'historique préparé à part : les données réelles n'entrent jamais dans le dépôt. */
async function importHistory(file) {
  let history;
  try {
    history = JSON.parse(await file.text());
  } catch {
    toast('Ce fichier n’est pas un historique lisible.');
    return;
  }
  if (history?.version !== 1) { toast('Ce fichier n’est pas un historique lisible.'); return; }
  if (!confirm('Ajouter cet historique au carnet ? Les dates d’entretien et les échéances seront mises à jour.')) return;
  let summary;
  const saved = await commit((c) => { summary = applyHistory(c, history); });
  if (saved) toast(`Historique ajouté : ${summary.entries} interventions, ${summary.readings} relevés.`);
}

async function fillFromPhoto(file, form, parse = parseDashboard) {
  const status = form.querySelector('#ocr-status');
  const say = (message) => { status.hidden = false; status.textContent = message; };
  ocrRun += 1;
  const run = ocrRun;
  if (!file) { status.hidden = true; return; }
  if (!file.type.startsWith('image/')) { say('Seules les photos sont lues : complète le formulaire à la main.'); return; }

  say('Lecture de la photo… La première fois peut prendre une minute.');
  try {
    const found = parse(await readPhotoText(file), kmStats(S.carnet, today()).lastKm);
    if (run !== ocrRun) return; // une autre photo a été choisie entre-temps
    const filled = Object.entries(found).filter(([name, value]) => value != null && form.elements[name]);
    filled.forEach(([name, value]) => { form.elements[name].value = value; });
    say(filled.length ? 'Valeurs lues sur la photo. Vérifie-les avant d’enregistrer.' : 'Rien de lisible sur cette photo : saisis les valeurs à la main.');
  } catch {
    if (run === ocrRun) say('La lecture a échoué : saisis les valeurs à la main.');
  }
}

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

function saveCalendar(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const DUES_FILE = 'echeances-voiture.ics';
const duesCalendar = () => buildDueIcs(sortedOperations(S.carnet, today()), today());

const CALENDAR_FILE = 'echeances.ics';
const calendarText = () => buildDueIcs(sortedOperations(S.carnet, today()), today(), { allowEmpty: true });
const calendarBlob = () => new Blob([calendarText()], { type: 'text/calendar' });

let calendarSent = null;

/** Republie le calendrier abonné s'il a changé. Un échec ne doit jamais gêner la saisie. */
async function publishCalendar() {
  if (!(S.store instanceof DropboxStore) || !S.carnet?.calendarUrl) return;
  const content = calendarText().replace(/DTSTAMP:[^\r]*\r\n/g, '');
  if (content === calendarSent) return;
  try {
    await S.store.putFile(CALENDAR_FILE, calendarBlob());
    calendarSent = content;
  } catch (error) {
    console.warn('Publication du calendrier impossible', error);
  }
}

function calendarSection() {
  const { calendarUrl } = S.carnet;
  return `
    <h2>Calendrier automatique</h2>
    <div class="card">
      ${calendarUrl ? `
        <p class="muted small">Le calendrier suit chaque mise à jour du carnet. Abonne-toi une seule fois sur chaque téléphone. Toute personne ayant ce lien voit les titres et dates des entretiens.</p>
        <div class="actions">
          <a class="button primary" href="${h(calendarFeedUrl(calendarUrl))}">S’abonner</a>
          <button data-action="calendar-copy">Copier le lien</button>
        </div>` : `
        <p class="muted small">Un calendrier auquel ton iPhone s’abonne une fois, et qui suit ensuite tes échéances.</p>
        <div class="actions"><button class="primary" data-action="calendar-enable">Activer</button></div>`}
    </div>`;
}

function calendarAuthorizeModal() {
  openModal(`
    <h3>Autoriser le lien</h3>
    <p>Dropbox doit autoriser l’app à créer un lien. C’est à faire une seule fois, sur un seul téléphone.</p>
    <p class="small">1. Dans l’onglet Permissions de <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener">ton app Dropbox</a>, coche <strong>sharing.read</strong> et <strong>sharing.write</strong>, puis valide avec Submit.</p>
    <p class="small">2. Reviens ici, touche Autoriser, puis Activer une dernière fois.</p>
    <div class="actions"><button class="primary" data-action="calendar-authorize">Autoriser</button></div>`);
}

function remindersModal() {
  const text = duesCalendar();
  if (!text) { toast('Aucune échéance à venir pour le moment.'); return; }
  const count = text.match(/BEGIN:VEVENT/g).length;
  const canShare = navigator.canShare?.({ files: [new File([text], DUES_FILE, { type: 'text/calendar' })] });
  openModal(`
    <h3>Rappels</h3>
    <p>${count} échéance${count > 1 ? 's' : ''} à ajouter à ton calendrier, avec un rappel 14 jours avant et la veille à 9 h.</p>
    <p class="muted small">Les dates changent avec ton kilométrage : refais cet ajout après un nouveau relevé. Les entretiens en retard ou sans date n’y figurent pas.</p>
    <div class="actions">
      <button class="primary" data-action="reminders-save">Ajouter au calendrier</button>
      ${canShare ? '<button data-action="reminders-share">Partager</button>' : ''}
    </div>`);
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
    });
    if (saved) closeModal();
  },

  async alert(values) {
    if (values.serviceDays === '' && values.serviceKm === '') throw new Error('Indique un délai en jours ou en kilomètres.');
    const t = today();
    // Le message de la voiture remplace entièrement l'échéance précédente.
    const due = {
      dueDate: values.serviceDays !== '' ? addDays(t, Number(values.serviceDays)) : null,
      dueKm: values.serviceKm !== '' ? kmStats(S.carnet, t).km + Number(values.serviceKm) : null,
    };
    const saved = await commit((c) => {
      if (values.opId === 'new') {
        c.operations.push({
          id: uid('op'), title: values.title, description: '', intervalKm: null, intervalMonths: null, firstMonths: null,
          lastDoneDate: null, lastDoneKm: null, costMin: null, costMax: null, note: '', history: [], source: null, ...due,
        });
      } else {
        Object.assign(c.operations.find((o) => o.id === values.opId), due);
      }
    });
    if (saved) {
      const title = values.opId === 'new' ? values.title : S.carnet.operations.find((o) => o.id === values.opId).title;
      alertSavedModal(buildAlertPrompt(S.carnet, { title, days: num(values.serviceDays), km: num(values.serviceKm) }, t));
    }
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
  alert: alertChoiceModal,
  menu: () => { S.menuOpen = !S.menuOpen; renderMenu(); },
  'ask-claude': () => navigator.clipboard?.writeText(claudePrompt).catch(() => {}),
  'alert-form': () => alertFormModal(),
  'budget-year': ({ year }) => { S.budgetYear = year; render(); },
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
  ics: ({ id }) => saveCalendar(buildIcs(S.carnet.appointments.find((a) => a.id === id)), 'rendez-vous-voiture.ics'),
  reminders: remindersModal,
  async 'calendar-enable'() {
    await S.store.putFile(CALENDAR_FILE, calendarBlob());
    let url;
    try {
      url = await S.store.sharedLink(CALENDAR_FILE);
    } catch (error) {
      if (error instanceof MissingScopeError) return calendarAuthorizeModal();
      throw error;
    }
    if (await commit((c) => { c.calendarUrl = url; })) toast('Calendrier activé.');
  },
  'calendar-authorize': () => beginDropboxAuth(CALENDAR_SCOPE),
  async 'calendar-copy'() {
    await navigator.clipboard.writeText(calendarFeedUrl(S.carnet.calendarUrl));
    toast('Lien copié.');
  },
  'reminders-save': () => saveCalendar(duesCalendar(), DUES_FILE),
  async 'reminders-share'() {
    await navigator.share({ files: [new File([duesCalendar()], DUES_FILE, { type: 'text/calendar' })] }).catch(() => {});
  },
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

document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

document.addEventListener('click', async (event) => {
  if (!event.target.closest('.burger, .menu')) closeMenu();
  const target = event.target.closest('[data-action]');
  if (!target) return;
  try {
    await ACTIONS[target.dataset.action]?.(target.dataset);
  } catch (error) {
    toast(error.message || 'Action impossible.');
  }
});

document.addEventListener('change', ({ target }) => {
  if (target.matches('form[data-form="km"] input[name="photo"]')) fillFromPhoto(target.files[0], target.form);
  if (target.matches('form[data-form="invoice"] input[name="file"]')) {
    fillFromPhoto(target.files[0], target.form, (text, lastKm) => parseInvoice(text, lastKm, today()));
  }
  if (target.matches('input[name="history"]') && target.files[0]) importHistory(target.files[0]);
  if (target.matches('input[name="alert-photo"]') && target.files[0]) alertFormModal(target.files[0]);
  if (target.matches('form[data-form="alert"] select[name="opId"]')) {
    const isNew = target.value === 'new';
    target.form.querySelector('#alert-title').hidden = !isNew;
    target.form.elements.title.required = isNew;
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
    publishCalendar();
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
