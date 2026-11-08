// Logique métier pure : dates, échéances, budget, fichiers calendrier.
// Toutes les dates sont des chaînes AAAA-MM-JJ.

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(s, n) {
  const d = fromISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export function diffDays(from, to) {
  const utc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86400000);
}

export function uid(prefix = 'id') {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + '-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Dernier relevé, kilométrage estimé aujourd'hui et rythme annuel. */
export function kmStats(carnet, today) {
  const readings = [...carnet.readings].sort((a, b) => a.date.localeCompare(b.date));
  const latest = readings[readings.length - 1];
  if (!latest) return { km: 0, lastKm: 0, lastDate: null, perDay: 0, perYear: 0, perMonth: 0, monthsEstimated: 0 };

  const windowStart = addMonths(latest.date, -18);
  const first = readings.find((r) => r.date >= windowStart);
  let perDay = 0;
  if (first && diffDays(first.date, latest.date) >= 90) {
    perDay = (latest.km - first.km) / diffDays(first.date, latest.date);
  } else if (carnet.vehicle.miseEnCirculation) {
    const age = diffDays(carnet.vehicle.miseEnCirculation, latest.date);
    if (age > 0) perDay = latest.km / age;
  }
  perDay = Math.max(perDay, 0);
  // L'estimation avance d'un pas par mois écoulé depuis le dernier relevé. Elle reste un calcul :
  // l'enregistrer comme relevé fausserait le rythme, qui ne doit venir que de vrais relevés.
  const perMonth = (perDay * 365.25) / 12;
  let monthsEstimated = 0;
  while (addMonths(latest.date, monthsEstimated + 1) <= today) monthsEstimated += 1;
  return {
    km: Math.round(latest.km + perMonth * monthsEstimated),
    lastKm: latest.km,
    lastDate: latest.date,
    perDay,
    perYear: Math.round(perDay * 365),
    perMonth: Math.round(perMonth),
    monthsEstimated,
  };
}

const SOON_DAYS = 45;
const SOON_KM = 3000;

/** Prochaine échéance d'une opération : la première atteinte, en date ou en kilomètres. */
export function nextDue(op, carnet, today) {
  const stats = kmStats(carnet, today);
  const mec = carnet.vehicle.miseEnCirculation;

  let dateAxis = op.dueDate || null;
  if (!dateAxis && op.intervalMonths) {
    if (op.lastDoneDate) dateAxis = addMonths(op.lastDoneDate, op.intervalMonths);
    else if (mec) dateAxis = addMonths(mec, op.firstMonths || op.intervalMonths);
  }

  let kmAxis = op.dueKm ?? null;
  if (kmAxis === null && op.intervalKm) {
    if (op.lastDoneKm != null) kmAxis = op.lastDoneKm + op.intervalKm;
    else if (!op.lastDoneDate) kmAxis = op.intervalKm;
  }

  // Tant que la dernière date est inconnue, un retard affiché serait sans fondement.
  if (op.needsLastDone && !op.lastDoneDate && !op.dueDate && op.dueKm == null) {
    return { status: 'inconnu', date: null, km: null, estimated: false, needsLast: true };
  }

  if (!dateAxis && kmAxis === null) {
    return { status: op.lastDoneDate ? 'fait' : 'inconnu', date: null, km: null, estimated: false, oneOff: Boolean(op.oneOff) };
  }

  let kmDate = null;
  if (kmAxis !== null && stats.perDay > 0) {
    kmDate = kmAxis <= stats.km ? today : addDays(today, Math.ceil((kmAxis - stats.km) / stats.perDay));
  }

  const useKm = kmDate && (!dateAxis || kmDate < dateAxis);
  const date = useKm ? kmDate : dateAxis;
  const kmLeft = kmAxis === null ? null : kmAxis - stats.km;
  const daysLeft = date ? diffDays(today, date) : null;

  let status = 'ok';
  if ((daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft <= 0)) status = 'retard';
  else if ((daysLeft !== null && daysLeft <= SOON_DAYS) || (kmLeft !== null && kmLeft <= SOON_KM)) status = 'bientot';

  return { status, date, km: kmAxis, estimated: Boolean(useKm), daysLeft, kmLeft };
}

/**
 * Ajoute un historique venu de documents passés. Rejouer le même import ne crée pas de doublon :
 * un relevé ou une intervention est reconnu à sa date. historyOnly garde l'entrée sans déplacer
 * l'échéance, pour un geste partiel (un plein d'AdBlue ne vaut pas contrôle du filtre à particules).
 */
export function applyHistory(carnet, history) {
  const summary = { readings: 0, entries: 0, invoices: 0 };
  if (history.vehicle) Object.assign(carnet.vehicle, history.vehicle);

  for (const { date, km } of history.readings ?? []) {
    if (carnet.readings.some((r) => r.date === date)) continue;
    carnet.readings.push({ id: `hist-${date}`, date, km, photo: null, note: 'Historique' });
    summary.readings += 1;
  }

  for (const spec of history.operations ?? []) {
    const op = carnet.operations.find((o) => o.id === spec.id);
    if (!op) continue;
    op.history = op.history || [];
    for (const { date, km, note } of spec.done ?? []) {
      if (op.history.some((entry) => entry.date === date)) continue;
      op.history.push({ date, km: km ?? null, note: note || '' });
      summary.entries += 1;
    }
    op.history.sort((a, b) => a.date.localeCompare(b.date));

    const last = op.history[op.history.length - 1];
    if (!spec.historyOnly && last && (!op.lastDoneDate || last.date >= op.lastDoneDate)) {
      op.lastDoneDate = last.date;
      op.lastDoneKm = last.km;
      op.dueDate = null;
      op.dueKm = null;
    }
    if (spec.due) {
      op.dueDate = spec.due.date ?? null;
      op.dueKm = spec.due.km ?? null;
    }
    if (spec.note && !op.note) op.note = spec.note;
  }

  // Une facture déjà saisie (même date, même montant) reçoit seulement ce qui a été lu.
  for (const inv of history.invoices ?? []) {
    const amount = inv.amount ?? null;
    const known = carnet.invoices.find((x) => x.date === inv.date && (x.amount ?? null) === amount);
    if (known) {
      if (!known.read && inv.read) {
        known.read = inv.read;
        summary.invoices += 1;
      }
      continue;
    }
    carnet.invoices.push({
      id: `hist-fac-${inv.date}`, title: inv.title, date: inv.date, amount, km: inv.km ?? null,
      garage: inv.garage || '', notes: inv.notes || '', ops: inv.ops || [], file: null, fileType: null, read: inv.read,
    });
    summary.invoices += 1;
  }
  return summary;
}

const frenchDate = (iso) => iso.split('-').reverse().join('/');
const ALERT_HISTORY_LINES = 8;

/** La question préparée pour Claude. Ni plaque ni numéro de série : seulement ce qui aide à répondre. */
function vehicleLine(v) {
  return [
    [v.marque, v.modele].filter(Boolean).join(' '),
    v.cylindree && `${v.cylindree} cm3`,
    v.energie,
    v.puissance && `${v.puissance} kW`,
    v.boite && `boîte ${v.boite}`,
    v.miseEnCirculation && `mise en circulation le ${frenchDate(v.miseEnCirculation)}`,
  ].filter(Boolean).join(', ');
}

export function buildAlertPrompt(carnet, { title, days, km }, today) {
  const stats = kmStats(carnet, today);
  const delay = [days != null ? `${days} jours` : null, km != null ? `${km} km` : null].filter(Boolean).join(' ou ');
  const history = carnet.operations
    .flatMap((op) => (op.history || []).map((entry) => ({ ...entry, title: op.title })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, ALERT_HISTORY_LINES)
    .map((e) => `- ${frenchDate(e.date)}${e.km != null ? `, ${e.km} km` : ''} : ${e.title}${e.note ? ` (${e.note})` : ''}`);

  return [
    `Ma voiture affiche cette alerte : « ${title} »${delay ? `, dans ${delay}` : ''}.`,
    `Véhicule : ${vehicleLine(carnet.vehicle)}.`,
    `Kilométrage : environ ${stats.km} km, à environ ${stats.perMonth} km par mois.`,
    ...(history.length ? ['Derniers entretiens connus :', ...history] : []),
    'Explique-moi ce que signifie cette alerte, son degré d’urgence, ce que je dois demander au garage et un ordre de prix en France. Précise ce dont tu n’es pas sûr.',
  ].join('\n');
}

const MAINTENANCE_LINE = /vidange|huile|filtre|plaquette|disque|frein|pneu|courroie|distribution|pompe|batterie|liquide|revision|entretien|clim|adblue|boite|embrayage|amortisseur|balai/i;
const MAX_READ_LINES = 25;
const MAX_READ_TEXT = 8000;

/** Ce qu'on garde d'une facture lue : le texte, et les seules lignes utiles aux questions d'entretien. */
export function invoiceRead(text) {
  const lines = text.split('\n').map((line) => line.trim())
    .filter((line) => line && line.length <= 120 && MAINTENANCE_LINE.test(plain(line)))
    .slice(0, MAX_READ_LINES);
  return { text: text.slice(0, MAX_READ_TEXT), lines };
}

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Toutes les interventions connues, des entretiens et des factures, de la plus ancienne à la plus récente. */
export function buildInterventionsCsv(carnet) {
  const titleOf = (id) => carnet.operations.find((o) => o.id === id)?.title;
  const fromInvoice = (date, opId) => carnet.invoices.some((inv) => inv.date === date && (inv.ops || []).includes(opId));
  const rows = [];
  for (const op of carnet.operations) {
    for (const entry of op.history || []) {
      if (fromInvoice(entry.date, op.id)) continue;
      rows.push([entry.date, entry.km, op.title, entry.note, '', '', 'carnet']);
    }
  }
  for (const inv of carnet.invoices) {
    const done = (inv.ops || []).map(titleOf).filter(Boolean).join(', ');
    const detail = [inv.notes, ...(inv.read?.lines || [])].filter(Boolean).join(' / ');
    const amount = inv.amount == null ? '' : String(inv.amount).replace('.', ',');
    rows.push([inv.date, inv.km, done || inv.title, detail, inv.garage, amount, 'facture']);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const header = ['date', 'kilometrage', 'intervention', 'detail', 'garage', 'montant_eur', 'source'];
  return [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
}

/** La question de vérification : l'historique, l'état du carnet et le format de réponse attendu. */
export function buildCheckPrompt(carnet, csv, today) {
  const stats = kmStats(carnet, today);
  const followed = sortedOperations(carnet, today).map(({ op, due }) => [
    op.id,
    op.title,
    `dernier : ${op.lastDoneDate || 'inconnu'}${op.lastDoneKm != null ? ` à ${op.lastDoneKm} km` : ''}`,
    `échéance actuelle : ${due.date || 'aucune'}${due.km != null ? ` ou ${due.km} km` : ''}`,
  ].join(' | '));
  return [
    `Nous sommes le ${frenchDate(today)}. Voici le carnet d’entretien de ma voiture.`,
    `Véhicule : ${vehicleLine(carnet.vehicle)}.`,
    `Kilométrage : environ ${stats.km} km, à environ ${stats.perMonth} km par mois.`,
    '', 'Historique des interventions (CSV) :', '```csv', csv, '```',
    '', 'Entretiens suivis (identifiant | titre | dernier | échéance) :', ...followed,
    '', 'Vérifie ce qui a bien été fait et ce qui manque, puis recalcule les prochaines échéances d’après le plan du constructeur pour ce moteur. N’invente aucune intervention et précise ce dont tu n’es pas sûr.',
    'Réponds d’abord en clair. Termine par un seul bloc json, sans rien après, listant uniquement les entretiens dont l’échéance doit changer, avec les identifiants ci-dessus :',
    '```json', '{"version":1,"operations":[{"id":"service","due":{"date":"AAAA-MM-JJ ou null","km":155000},"note":"une phrase"}]}', '```',
  ].join('\n');
}

const isRealDate = (iso) => typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && toISO(fromISO(iso)) === iso;
const isKm = (km) => Number.isInteger(km) && km >= 0 && km <= 2000000;

/**
 * Lit la réponse collée depuis Claude. Seule une échéance ou une remarque sur un entretien
 * existant peut en sortir : le reste du texte n'a aucun effet sur le carnet.
 */
export function parseClaudeUpdate(reply, carnet) {
  const fence = [...reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes('"operations"')).pop();
  const candidate = fence ?? reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  let data;
  try {
    data = JSON.parse(candidate);
  } catch {
    throw new Error('Aucun bloc de mise à jour lisible dans cette réponse.');
  }
  if (data?.version !== 1 || !Array.isArray(data.operations)) throw new Error('Aucun bloc de mise à jour lisible dans cette réponse.');

  const changes = [];
  for (const item of data.operations) {
    const op = carnet.operations.find((o) => o.id === item?.id);
    if (!op) continue;
    const date = isRealDate(item.due?.date) ? item.due.date : null;
    const km = isKm(item.due?.km) ? item.due.km : null;
    if (date === null && km === null) continue;
    if (date === (op.dueDate ?? null) && km === (op.dueKm ?? null)) continue;
    changes.push({ id: op.id, title: op.title, date, km, note: typeof item.note === 'string' ? item.note.slice(0, 300) : '' });
  }
  return changes;
}

export function applyClaudeUpdate(carnet, changes) {
  for (const { id, date, km, note } of changes) {
    const op = carnet.operations.find((o) => o.id === id);
    if (!op) continue;
    op.dueDate = date;
    op.dueKm = km;
    if (note) op.note = note;
  }
}

export const claudeChatUrl = (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

export function applyDone(op, { date, km, note }) {
  op.history = op.history || [];
  op.history.push({ date, km: km ?? null, note: note || '' });
  op.lastDoneDate = date;
  op.lastDoneKm = km ?? null;
  op.dueDate = null;
  op.dueKm = null;
}

/** Les opérations classées : d'abord celles qui ont une échéance, de la plus proche à la plus lointaine. */
export function sortedOperations(carnet, today) {
  return carnet.operations
    .map((op) => ({ op, due: nextDue(op, carnet, today) }))
    .sort((a, b) => (a.due.date || '9999').localeCompare(b.due.date || '9999'));
}

// Prix de référence en France, pièces et main-d'œuvre, pour un Touran 2.0 TDI. Ce sont des
// ordres de grandeur, remplacés dès qu'un coût est saisi. Sans source fiable, pas d'entrée.
// planKm : rythme supposé pour projeter une opération dont le carnet ne donne pas l'intervalle.
export const REFERENCE_PRICES = {
  service: { min: 200, max: 350, planKm: 30000 }, // iDGarages
  ct: { min: 78, max: 78 }, // Groupama, moyenne voiture légère
  rappels: { min: 0, max: 0 }, // à la charge du constructeur
  courroie: { min: 670, max: 960 }, // Mecazen, 2.0 TDI 150 ch
  boite: { min: 250, max: 400 }, // Odopass
  habitacle: { min: 62, max: 62 }, // Mecazen, plafond
  gazole: { min: 31, max: 54 }, // Mecazen, 2.0 TDI 150 ch
  freins: { min: 140, max: 420 }, // iDGarages : plaquettes seules, jusqu'à plaquettes et disques avant
  pneus: { min: 320, max: 1000 }, // Groupama, 80 à 250 € par pneu
  clim: { min: 58, max: 367 }, // Mecazen
  batterie: { min: 60, max: 300 }, // Groupama
};

const NUMBER = String.raw`\d{1,3}(?:[ .,]\d{3})+|\d+`;
const toNumber = (text) => Number(text.replace(/[ .,]/g, ''));
const MAX_ODOMETER_JUMP = 100000; // au-delà d'un tel saut depuis le dernier relevé, c'est une erreur de lecture
const MAX_SERVICE_KM = 60000; // aucun intervalle d'entretien n'atteint cette distance

/**
 * Extrait d'un texte lu sur le tableau de bord le kilométrage et l'échéance du service.
 * Chaque valeur vaut null si elle n'est pas trouvée : mieux vaut un champ vide qu'une valeur douteuse.
 */
export function parseDashboard(text, lastKm = 0) {
  const clean = text.replace(/\u00a0/g, ' ').replace(/(?<=\d)[oO](?=[\d ])/g, '0');
  const days = clean.match(/(\d{1,3})\s*(?:jours?|j)\b/i);
  const hasService = Boolean(days) || /servi|entretien|inspection|vidange/i.test(clean);

  const tagged = [...clean.matchAll(new RegExp(`(${NUMBER})\\s*km\\b`, 'gi'))]
    .map((m) => ({ value: toNumber(m[1]), index: m.index }));
  const bare = [...clean.matchAll(/\b\d{1,3}(?:[ .]\d{3})+\b|\b\d{5,7}\b/g)].map((m) => toNumber(m[0]));

  const plausible = [...tagged.map((t) => t.value), ...bare]
    .filter((v) => v >= Math.max(lastKm, 1000) && v <= lastKm + MAX_ODOMETER_JUMP);
  const km = plausible.length ? Math.max(...plausible) : null;

  const afterDays = days ? days.index + days[0].length : 0;
  const service = hasService
    ? tagged.find((t) => t.index >= afterDays && t.value < MAX_SERVICE_KM && t.value !== km)
    : null;

  return {
    km,
    serviceDays: days ? Number(days[1]) : null,
    serviceKm: service ? service.value : null,
  };
}

const plain = (text) => text.normalize('NFD').replace(/\p{M}/gu, '');
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const OTHER_DATE_LINE = /circulation|m\.?e\.?c\b|echeance|prochain|naissance|valid/i;
const OTHER_KM_LINE = /prochain|tous les|garantie|avant|intervalle/i;
const TOTAL_LABELS = [/net\s*a\s*payer/i, /total\s*t\.?\s*t\.?\s*c/i, /(?:montant|total)\s*a\s*payer/i, /t\.?\s*t\.?\s*c/i];
const AMOUNT = /\d{1,3}(?:[ .]\d{3})*[.,]\d{2}(?!\d)/g;
const GARAGE_LINE = /garage|carrosserie|automobiles|norauto|feu vert|speedy|midas|euromaster/i;
const INVOICE_TITLES = [
  [/revision|entretien/i, 'Révision'],
  [/distribution/i, 'Kit de distribution'],
  [/vidange/i, 'Vidange'],
  [/plaquette|disque|frein/i, 'Freins'],
  [/pneu/i, 'Pneus'],
  [/controle technique/i, 'Contrôle technique'],
  [/batterie/i, 'Batterie'],
  [/climatisation/i, 'Climatisation'],
];

function dateInLine(line, today) {
  const digits = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
  const words = line.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'i'));
  let parts = null;
  if (digits) parts = [Number(digits[1]), Number(digits[2]), digits[3]];
  else if (words) parts = [Number(words[1]), MONTHS.indexOf(words[2].toLowerCase()) + 1, words[3]];
  if (!parts) return null;
  const [day, month, year] = parts;
  const iso = `${year.length === 2 ? `20${year}` : year}-${pad(month)}-${pad(day)}`;
  const isReal = !Number.isNaN(fromISO(iso).getTime()) && toISO(fromISO(iso)) === iso;
  return isReal && iso >= '2000-01-01' && iso <= today ? iso : null;
}

function invoiceDate(lines, today) {
  const usable = lines.filter((line) => !OTHER_DATE_LINE.test(line));
  const labelled = usable.filter((line) => /factur|date/i.test(line));
  for (const line of [...labelled, ...usable]) {
    const date = dateInLine(line, today);
    if (date) return date;
  }
  return null;
}

/** Le montant du total : du libellé le plus sûr au moins sûr, sur sa ligne ou la suivante. */
function invoiceAmount(lines) {
  for (const label of TOTAL_LABELS) {
    for (const [i, line] of lines.entries()) {
      if (!label.test(line)) continue;
      const amounts = line.match(AMOUNT) ?? lines[i + 1]?.match(AMOUNT);
      if (amounts) return Number(amounts[amounts.length - 1].replace(/[ .](?=\d{3})/g, '').replace(',', '.'));
    }
  }
  return null;
}

function invoiceKm(lines, lastKm) {
  const isPlausible = (value) => value >= 1000 && value <= lastKm + MAX_ODOMETER_JUMP;
  const usable = lines.filter((line) => !OTHER_KM_LINE.test(line));
  const patterns = [
    /(?:kilometrage|compteur|\bkm)[^\d\n]{0,25}(\d{1,3}(?:[ .]\d{3})+|\d{4,7})/i,
    new RegExp(`(${NUMBER})\\s*km\\b`, 'i'),
  ];
  for (const pattern of patterns) {
    for (const line of usable) {
      const match = line.match(pattern);
      if (match && isPlausible(toNumber(match[1]))) return toNumber(match[1]);
    }
  }
  return null;
}

/**
 * Extrait d'un texte lu sur une facture ce qui remplit le formulaire. Chaque valeur vaut null
 * si elle n'est pas trouvée : mieux vaut un champ vide qu'une valeur douteuse.
 */
export function parseInvoice(text, lastKm, today) {
  const lines = plain(text).replace(/ /g, ' ').split('\n').map((line) => line.trim()).filter(Boolean);
  const all = lines.join('\n');
  return {
    title: INVOICE_TITLES.find(([pattern]) => pattern.test(all))?.[1] ?? null,
    date: invoiceDate(lines, today),
    amount: invoiceAmount(lines),
    km: invoiceKm(lines, lastKm),
    garage: lines.slice(0, 8).find((line) => GARAGE_LINE.test(line) && line.length <= 40) ?? null,
  };
}

/** Le coût saisi, sinon le prix de référence, sinon null. */
export function priceOf(op) {
  if (op.costMin != null || op.costMax != null) {
    return { min: op.costMin ?? op.costMax, max: op.costMax ?? op.costMin, reference: false };
  }
  const ref = REFERENCE_PRICES[op.id];
  return ref ? { min: ref.min, max: ref.max, reference: true } : null;
}

export function forecast(carnet, today, months = 12) {
  const horizon = addMonths(today, months);
  const items = sortedOperations(carnet, today).filter((x) => x.due.date && x.due.date <= horizon);
  const prices = items.map((x) => priceOf(x.op)).filter(Boolean);
  return {
    items,
    min: prices.reduce((sum, p) => sum + p.min, 0),
    max: prices.reduce((sum, p) => sum + p.max, 0),
    unpriced: items.length - prices.length,
  };
}

/**
 * Les dépenses à venir, année par année jusqu'à lastYear. Une opération en retard compte à
 * aujourd'hui, puis chaque opération se répète à son rythme, au kilométrage moyen constaté.
 */
export function spendPlan(carnet, today, lastYear) {
  const { perDay } = kmStats(carnet, today);
  const years = new Map();
  const undated = { count: 0, min: 0, max: 0 };
  let unpriced = 0;

  for (const { op, due } of sortedOperations(carnet, today)) {
    const price = priceOf(op);
    if (!due.date) {
      if (due.status === 'inconnu' && price?.max > 0) {
        undated.count += 1;
        undated.min += price.min;
        undated.max += price.max;
      }
      continue;
    }
    if (!price) { unpriced += 1; continue; }
    if (price.max === 0) continue;

    const stepKm = op.intervalKm ?? REFERENCE_PRICES[op.id]?.planKm ?? null;
    let date = due.date < today ? today : due.date;
    while (date && Number(date.slice(0, 4)) <= lastYear) {
      const year = date.slice(0, 4);
      if (!years.has(year)) years.set(year, { year, items: [], min: 0, max: 0 });
      const entry = years.get(year);
      entry.items.push({ op, date, min: price.min, max: price.max });
      entry.min += price.min;
      entry.max += price.max;

      const byMonths = op.intervalMonths ? addMonths(date, op.intervalMonths) : null;
      const byKm = stepKm && perDay > 0 ? addDays(date, Math.ceil(stepKm / perDay)) : null;
      date = [byMonths, byKm].filter(Boolean).sort()[0] ?? null;
    }
  }
  return { years: [...years.values()], unpriced, undated };
}

export function spentByYear(carnet) {
  const totals = {};
  for (const inv of carnet.invoices) {
    const year = inv.date.slice(0, 4);
    totals[year] = (totals[year] || 0) + (Number(inv.amount) || 0);
  }
  return Object.entries(totals).sort((a, b) => b[0].localeCompare(a[0]));
}

function icsText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (size + width > 73) {
      parts.push(current);
      current = ' ';
      size = 1;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join('\r\n');
}

function icsLocal(date, time) {
  return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';
}

/**
 * Un calendrier des échéances à venir, avec deux rappels à 9 h : 14 jours avant et la veille.
 * Le DTSTART sans heure vaut minuit, d'où les décalages de 15 h. L'UID stable identifie
 * l'échéance d'un export à l'autre. Renvoie null s'il n'y a rien à venir, sauf avec allowEmpty :
 * un calendrier abonné doit rester publié, même vide, pour que ses anciens événements disparaissent.
 */
export function buildDueIcs(items, today, { now = new Date(), allowEmpty = false } = {}) {
  const upcoming = items.filter(({ due }) => due.date && due.date >= today && due.status !== 'fait');
  if (!upcoming.length && !allowEmpty) return null;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const day = (date) => date.replace(/-/g, '');
  const alarm = (trigger, text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(text)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Carnet entretien//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Entretien voiture', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
  ];
  for (const { op, due } of upcoming) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:echeance-${op.id}@carnet-entretien`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(due.date)}`,
      `DTEND;VALUE=DATE:${day(addDays(due.date, 1))}`,
      `SUMMARY:${icsText(`Entretien : ${op.title}`)}`,
      `DESCRIPTION:${icsText(due.estimated ? `Date estimée d'après ton kilométrage moyen (échéance à ${due.km} km).` : 'Échéance du carnet d’entretien.')}`,
      ...alarm('-P13DT15H', `${op.title} dans 14 jours`),
      ...alarm('-PT15H', `${op.title} demain`),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** L'adresse d'abonnement d'un lien Dropbox : téléchargement direct, protocole des calendriers. */
export function calendarFeedUrl(sharedLink) {
  const url = new URL(sharedLink);
  url.searchParams.set('dl', '1');
  return url.href.replace(/^https:/, 'webcal:');
}

export function buildIcs(appt, now = new Date()) {
  const startDate = fromISO(appt.date);
  const [h, m] = appt.time.split(':').map(Number);
  startDate.setHours(h, m + (appt.durationMin || 60));
  const endDate = toISO(startDate);
  const endTime = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Carnet entretien//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appt.id}@carnet-entretien`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsLocal(appt.date, appt.time)}`,
    `DTEND:${icsLocal(endDate, endTime)}`,
    `SUMMARY:${icsText(appt.title)}`,
  ];
  if (appt.location) lines.push(`LOCATION:${icsText(appt.location)}`);
  if (appt.notes) lines.push(`DESCRIPTION:${icsText(appt.notes)}`);
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Rendez-vous voiture',
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

const SOURCES = {
  ad: {
    level: 'tiers',
    label: 'Guide AD, Touran 2.0 TDI 140 et 150 ch',
    url: 'https://www.ad.fr/guides/guide-conseil/distribution/courroie-de-distribution-touran',
  },
  plan: {
    level: 'a-confirmer',
    label: 'Intervalle à relever sur le plan d’entretien Volkswagen',
    url: 'https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/entretien-et-pieces/plan-entretien.html',
  },
  fiches: {
    level: 'tiers',
    label: 'Retours d’usagers, Fiches-Auto',
    url: 'https://www.fiches-auto.fr/fiabilite-volkswagen/fiabilite-527-pannes-volkswagen-touran.php',
  },
  ct: {
    level: 'legal',
    label: 'Réglementation française du contrôle technique',
    url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2878',
  },
  rappel: {
    level: 'officiel',
    label: 'Volkswagen France, vérification par numéro de série',
    url: 'https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/action-de-rappel/campagne-rappel-airbag-takata.html',
  },
  tableau: { level: 'constat', label: 'Affiché par le tableau de bord', url: null },
  planOfficiel: {
    level: 'officiel',
    label: 'Volkswagen France, plan d’entretien',
    url: 'https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/entretien-et-pieces/plan-entretien.html',
  },
  freinOfficiel: {
    level: 'officiel',
    label: 'Volkswagen France, freins',
    url: 'https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/entretien-et-pieces/reparations-controles/freins.html',
  },
  climOfficiel: {
    level: 'officiel',
    label: 'Volkswagen France, climatisation et filtres',
    url: 'https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/entretien-et-pieces/reparations-controles/climatisation-et-filtre.html',
  },
  batterieOfficiel: {
    level: 'officiel',
    label: 'Volkswagen France, batteries',
    url: 'https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/entretien-et-pieces/reparations-controles/batteries.html',
  },
};

const TEMPLATE_VERSION = 3;
const RECALL_CHECK_MONTHS = 6;

function operation(id, title, description, extra = {}) {
  return {
    id,
    title,
    description,
    intervalKm: null,
    intervalMonths: null,
    firstMonths: null,
    dueDate: null,
    dueKm: null,
    lastDoneDate: null,
    lastDoneKm: null,
    costMin: null,
    costMax: null,
    note: '',
    history: [],
    source: SOURCES.plan,
    ...extra,
  };
}

function templateOperations(today, serviceDays) {
  return [
    operation('service', 'Service d’entretien', 'Révision demandée par le tableau de bord. Demande au garage si la voiture est en service fixe ou LongLife, et le détail des opérations prévues.', {
      dueDate: serviceDays != null ? addDays(today, serviceDays) : null,
      source: SOURCES.tableau,
    }),
    operation('ct', 'Contrôle technique', 'Le premier est à passer dans les 6 mois précédant les 4 ans de la voiture, puis tous les 2 ans. S’il a déjà été fait, indique sa date avec « Marquer comme fait ».', {
      intervalMonths: 24,
      firstMonths: 48,
      source: SOURCES.ct,
    }),
    operation('rappels', 'Vérifier les rappels constructeur', 'Saisis ton numéro de série (case E de la carte grise) sur le site Volkswagen, et demande au garage de contrôler les autres campagnes.', {
      intervalMonths: RECALL_CHECK_MONTHS,
      dueDate: today,
      source: SOURCES.rappel,
    }),
    operation('courroie', 'Kit de distribution et pompe à eau', 'Opération lourde à anticiper dans le budget. L’intervalle affiché vient d’un guide non officiel et doit être confirmé pour ton moteur.', {
      intervalKm: 210000,
      intervalMonths: 96,
      source: SOURCES.ad,
    }),
    operation('boite', 'Vidange de boîte automatique', 'Seulement si la voiture a une boîte automatique DSG. Demande si elle est due à ce kilométrage et si elle a déjà été faite.'),
    operation('depollution', 'Contrôle AdBlue et filtre à particules', 'Volkswagen prévoit un contrôle du filtre à particules à partir de 150 000 km, puis tous les 30 000 km. À faire voir aussi si un message antipollution apparaît.', {
      dueKm: 150000,
      intervalKm: 30000,
      source: SOURCES.planOfficiel,
    }),
    operation('frein', 'Liquide de frein', 'Volkswagen recommande un remplacement tous les deux ans. Indique la date du dernier remplacement pour calculer l’échéance.', {
      intervalMonths: 24,
      needsLastDone: true,
      source: SOURCES.freinOfficiel,
    }),
    operation('habitacle', 'Filtre d’habitacle', 'Renseigne son intervalle à partir du plan d’entretien ou d’une facture.'),
    operation('air', 'Filtre à air', 'Renseigne son intervalle à partir du plan d’entretien ou d’une facture.'),
    operation('gazole', 'Filtre à gazole', 'Renseigne son intervalle à partir du plan d’entretien ou d’une facture.'),
    operation('freins', 'Plaquettes et disques de frein', 'Remplacement selon l’usure. Note ce que le garage a mesuré lors du dernier contrôle.'),
    operation('pneus', 'Pneus', 'Remplacement selon l’usure et l’âge. Note la date de montage et le kilométrage.'),
    operation('clim', 'Contrôle de la climatisation', 'Volkswagen conseille une révision de la climatisation une fois par an. Indique la date de la dernière pour calculer l’échéance.', {
      intervalMonths: 12,
      needsLastDone: true,
      source: SOURCES.climOfficiel,
    }),
    operation('batterie', 'Contrôle de la batterie', 'Contrôle annuel inclus dans la révision périodique. Indique la date du dernier pour calculer l’échéance.', {
      intervalMonths: 12,
      needsLastDone: true,
      source: SOURCES.batterieOfficiel,
    }),
  ];
}

/** Met à niveau un carnet créé avec un ancien modèle, sans écraser ce que l'utilisateur a renseigné. */
export function upgradeCarnet(carnet, today = toISO(new Date())) {
  if ((carnet.templateVersion || 1) >= TEMPLATE_VERSION) return false;
  const template = templateOperations(null, null);
  const find = (id) => carnet.operations.find((o) => o.id === id);
  const model = (id) => template.find((o) => o.id === id);

  for (const op of template) {
    if (!find(op.id) && ['clim', 'batterie'].includes(op.id)) carnet.operations.push(op);
  }

  const frein = find('frein');
  if (frein && frein.intervalMonths == null) {
    Object.assign(frein, { intervalMonths: 24, needsLastDone: true, source: model('frein').source, description: model('frein').description });
  }

  const depollution = find('depollution');
  if (depollution && depollution.intervalKm == null && depollution.dueKm == null) {
    Object.assign(depollution, { intervalKm: 30000, source: model('depollution').source, description: model('depollution').description });
    if (depollution.lastDoneKm == null) depollution.dueKm = 150000;
  }

  // Les rappels ne sont plus une vérification unique : la première est due maintenant si elle n'a jamais été faite.
  const rappels = find('rappels');
  if (rappels && rappels.intervalMonths == null) {
    rappels.oneOff = false;
    rappels.intervalMonths = RECALL_CHECK_MONTHS;
    if (!rappels.lastDoneDate) rappels.dueDate = today;
  }

  carnet.templateVersion = TEMPLATE_VERSION;
  return true;
}

export function createCarnet({ miseEnCirculation, km, serviceDays, today }) {
  const operations = templateOperations(today, serviceDays);

  return {
    version: 1,
    templateVersion: TEMPLATE_VERSION,
    vehicle: {
      marque: 'Volkswagen',
      modele: 'Touran',
      miseEnCirculation,
      typeMine: '',
      cylindree: '1968',
      energie: 'Gazole',
      puissance: '',
      boite: '',
      immatriculation: '',
      vin: '',
    },
    readings: [{ id: uid('km'), date: today, km, photo: null, note: '' }],
    operations,
    appointments: [],
    invoices: [],
  };
}
