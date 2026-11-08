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
  if (!latest) return { km: 0, lastKm: 0, lastDate: null, perDay: 0, perYear: 0 };

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
  const elapsed = Math.max(diffDays(latest.date, today), 0);
  return {
    km: Math.round(latest.km + perDay * elapsed),
    lastKm: latest.km,
    lastDate: latest.date,
    perDay,
    perYear: Math.round(perDay * 365),
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

export function forecast(carnet, today, months = 12) {
  const horizon = addMonths(today, months);
  const items = sortedOperations(carnet, today).filter((x) => x.due.date && x.due.date <= horizon);
  const priced = items.filter((x) => x.op.costMin != null || x.op.costMax != null);
  return {
    items,
    min: priced.reduce((sum, x) => sum + (x.op.costMin ?? x.op.costMax), 0),
    max: priced.reduce((sum, x) => sum + (x.op.costMax ?? x.op.costMin), 0),
    unpriced: items.length - priced.length,
  };
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
};

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

export function createCarnet({ miseEnCirculation, km, serviceDays, today }) {
  const operations = [
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
      oneOff: true,
      source: SOURCES.rappel,
    }),
    operation('courroie', 'Kit de distribution et pompe à eau', 'Opération lourde à anticiper dans le budget. L’intervalle affiché vient d’un guide non officiel et doit être confirmé pour ton moteur.', {
      intervalKm: 210000,
      intervalMonths: 96,
      source: SOURCES.ad,
    }),
    operation('boite', 'Vidange de boîte automatique', 'Seulement si la voiture a une boîte automatique DSG. Demande si elle est due à ce kilométrage et si elle a déjà été faite.'),
    operation('depollution', 'Contrôle AdBlue et filtre à particules', 'Points souvent signalés par des usagers sur ce moteur. À faire contrôler si un message antipollution apparaît ou lors d’une révision.', {
      source: SOURCES.fiches,
    }),
    operation('frein', 'Liquide de frein', 'À remplacer périodiquement. Relève l’intervalle sur le plan d’entretien de la voiture.'),
    operation('habitacle', 'Filtre d’habitacle', 'Renseigne son intervalle à partir du plan d’entretien ou d’une facture.'),
    operation('air', 'Filtre à air', 'Renseigne son intervalle à partir du plan d’entretien ou d’une facture.'),
    operation('gazole', 'Filtre à gazole', 'Renseigne son intervalle à partir du plan d’entretien ou d’une facture.'),
    operation('freins', 'Plaquettes et disques de frein', 'Remplacement selon l’usure. Note ce que le garage a mesuré lors du dernier contrôle.'),
    operation('pneus', 'Pneus', 'Remplacement selon l’usure et l’âge. Note la date de montage et le kilométrage.'),
  ];

  return {
    version: 1,
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
