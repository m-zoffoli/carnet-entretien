import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, addDays, applyDone, applyClaudeUpdate, applyHistory, buildAlertPrompt, buildCheckPrompt, buildDueIcs, buildInterventionsCsv, invoiceRead, parseClaudeUpdate, buildIcs, calendarFeedUrl, claudeChatUrl, createCarnet, forecast, kmStats, nextDue, parseDashboard, parseInvoice, spendPlan, spentByYear, upgradeCarnet } from '../js/domain.js';
import { GUIDE } from '../js/guide.js';

const today = '2026-11-08';
const carnet = () => createCarnet({ miseEnCirculation: '2022-03-15', km: 140000, serviceDays: 16, today });
const op = (c, id) => c.operations.find((o) => o.id === id);

test('addMonths garde une date valide en fin de mois', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2022-03-15', 48), '2026-03-15');
});

test('le rythme vient de la mise en circulation avec un seul relevé', () => {
  const s = kmStats(carnet(), today);
  assert.equal(s.km, 140000);
  assert.ok(Math.abs(s.perYear - 30077) < 5);
});

test('le kilométrage estimé avance d’un pas par mois écoulé, pas au jour le jour', () => {
  const c = carnet();
  const { perMonth } = kmStats(c, today);
  assert.equal(kmStats(c, '2026-12-07').km, 140000, 'moins d’un mois : pas encore de pas');
  assert.equal(kmStats(c, '2026-12-08').km, 140000 + perMonth);
  assert.equal(kmStats(c, '2026-12-08').monthsEstimated, 1);
  const three = kmStats(c, '2027-02-10');
  assert.equal(three.monthsEstimated, 3);
  assert.ok(Math.abs(three.km - (140000 + 3 * perMonth)) <= 2);
  assert.equal(three.lastKm, 140000, 'le dernier relevé reste le vrai chiffre');
});

test('un nouveau relevé remet l’estimation à zéro', () => {
  const c = carnet();
  c.readings.push({ id: 'r2', date: '2027-02-10', km: 150000, photo: null, note: '' });
  const s = kmStats(c, '2027-02-10');
  assert.equal(s.km, 150000);
  assert.equal(s.monthsEstimated, 0);
});

test('le calendrier des échéances garde ce qui est à venir, avec deux rappels', () => {
  const unfold = (text) => text.replace(/\r\n /g, '');
  const items = [
    { op: { id: 'a', title: 'Service' }, due: { date: '2026-11-24', status: 'bientot', estimated: false } },
    { op: { id: 'b', title: 'Courroie' }, due: { date: '2028-07-09', status: 'ok', estimated: true, km: 210000 } },
    { op: { id: 'c', title: 'En retard' }, due: { date: '2026-07-27', status: 'retard' } },
    { op: { id: 'd', title: 'Sans date' }, due: { date: null, status: 'inconnu' } },
  ];
  const ics = unfold(buildDueIcs(items, today));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 4);
  assert.match(ics, /DTSTART;VALUE=DATE:20261124\r\nDTEND;VALUE=DATE:20261125/);
  assert.match(ics, /UID:echeance-a@carnet-entretien/);
  assert.match(ics, /TRIGGER:-P13DT15H/);
  assert.match(ics, /210000 km/);
  assert.doesNotMatch(ics, /En retard/);
  assert.equal(buildDueIcs(items.slice(2), today), null);
});

const HISTORY = {
  version: 1,
  vehicle: { miseEnCirculation: '2022-07-26' },
  readings: [{ date: '2025-11-25', km: 125000 }],
  operations: [
    { id: 'frein', done: [{ date: '2024-06-18', km: 85000, note: 'Vidange' }] },
    { id: 'service', done: [{ date: '2025-11-25', km: 125000 }], due: { date: '2026-11-24', km: 155000 } },
    { id: 'depollution', historyOnly: true, done: [{ date: '2025-02-11', km: 108000, note: 'AdBlue' }] },
    { id: 'inconnue', done: [{ date: '2025-02-11' }] },
  ],
};

test('un historique date les opérations et ajoute les relevés', () => {
  const c = carnet();
  assert.deepEqual(applyHistory(c, HISTORY), { readings: 1, entries: 3 });
  assert.equal(c.vehicle.miseEnCirculation, '2022-07-26');
  assert.equal(nextDue(op(c, 'frein'), c, today).date, '2026-06-18');
  assert.equal(nextDue(op(c, 'frein'), c, today).status, 'retard');
});

test('un historique peut fixer l’échéance affichée par la voiture après la dernière intervention', () => {
  const c = carnet();
  applyHistory(c, HISTORY);
  assert.equal(op(c, 'service').lastDoneKm, 125000);
  assert.equal(op(c, 'service').dueDate, '2026-11-24');
  assert.equal(op(c, 'service').dueKm, 155000);
});

test('un geste partiel reste dans l’historique sans déplacer l’échéance', () => {
  const c = carnet();
  applyHistory(c, HISTORY);
  assert.equal(op(c, 'depollution').dueKm, 150000);
  assert.equal(op(c, 'depollution').lastDoneDate, null);
  assert.equal(op(c, 'depollution').history.length, 1);
});

test('rejouer un historique ne crée aucun doublon', () => {
  const c = carnet();
  applyHistory(c, HISTORY);
  assert.deepEqual(applyHistory(c, HISTORY), { readings: 0, entries: 0 });
  assert.equal(op(c, 'frein').history.length, 1);
});

test('un calendrier abonné reste publié même sans échéance', () => {
  assert.equal(buildDueIcs([], today), null);
  const ics = buildDueIcs([], today, { allowEmpty: true });
  assert.match(ics, /X-WR-CALNAME:Entretien voiture/);
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test('le lien Dropbox devient une adresse d’abonnement', () => {
  assert.equal(
    calendarFeedUrl('https://www.dropbox.com/scl/fi/abc/echeances.ics?rlkey=xyz&dl=0'),
    'webcal://www.dropbox.com/scl/fi/abc/echeances.ics?rlkey=xyz&dl=1',
  );
});

test('la question pour Claude donne le contexte sans identifiant personnel', () => {
  const c = carnet();
  c.vehicle.immatriculation = 'AB-123-CD';
  c.vehicle.vin = 'VIN12345678901234';
  applyHistory(c, HISTORY);
  const prompt = buildAlertPrompt(c, { title: 'Service d’entretien', days: 16, km: 12900 }, today);
  assert.match(prompt, /« Service d’entretien », dans 16 jours ou 12900 km/);
  assert.match(prompt, /18\/06\/2024, 85000 km : Liquide de frein \(Vidange\)/);
  assert.doesNotMatch(prompt, /AB-123-CD|VIN1234/);
});

test('la question ne mentionne que le délai renseigné', () => {
  assert.match(buildAlertPrompt(carnet(), { title: 'Pneus', days: 5, km: null }, today), /« Pneus », dans 5 jours\./);
});

test('le lien vers Claude encode la question', () => {
  assert.equal(claudeChatUrl('a b & c'), 'https://claude.ai/new?q=a%20b%20%26%20c');
});

test('une facture lue garde seulement les lignes utiles à l’entretien', () => {
  const read = invoiceRead('M. Dupont\n06 12 34 56 78\nVidange moteur 80,00\nFiltre à huile 12,00\nTVA 20 %');
  assert.deepEqual(read.lines, ['Vidange moteur 80,00', 'Filtre à huile 12,00']);
  assert.match(read.text, /Dupont/);
});

test('le CSV réunit les interventions sans compter deux fois une facture', () => {
  const c = carnet();
  applyHistory(c, HISTORY);
  applyDone(op(c, 'freins'), { date: '2026-03-01', km: 130000, note: 'Facture : Freins' });
  c.invoices.push({ date: '2026-03-01', km: 130000, title: 'Freins', ops: ['freins'], garage: 'Garage; Centre', amount: 240.5, read: { lines: ['Plaquettes avant'] } });
  const lines = buildInterventionsCsv(c).split('\n');
  assert.equal(lines[0], 'date;kilometrage;intervention;detail;garage;montant_eur;source');
  assert.equal(lines.filter((l) => l.startsWith('2026-03-01')).length, 1);
  assert.match(lines.find((l) => l.startsWith('2026-03-01')), /Plaquettes avant;"Garage; Centre";240,5;facture/);
  assert.equal(lines[1].slice(0, 10), '2024-06-18');
});

test('la question de vérification contient le CSV, les identifiants et le format de réponse', () => {
  const c = carnet();
  const prompt = buildCheckPrompt(c, 'date;km', today);
  assert.match(prompt, /```csv\ndate;km\n```/);
  assert.match(prompt, /^frein \| Liquide de frein/m);
  assert.match(prompt, /"version":1/);
});

test('une réponse de Claude ne produit que des échéances valides sur des entretiens connus', () => {
  const c = carnet();
  const fence = '`'.repeat(3);
  const reply = [
    'Voici mon analyse, avec un exemple {pas du json}.',
    `${fence}json`,
    '{"version":1,"operations":[',
    '  {"id":"frein","due":{"date":"2026-12-01","km":null},"note":"En retard."},',
    '  {"id":"inconnue","due":{"date":"2026-12-01"}},',
    '  {"id":"air","due":{"date":"2026-02-31","km":-5}},',
    '  {"id":"pneus","due":{"date":null,"km":null}}',
    ']}',
    fence,
  ].join('\n');
  const changes = parseClaudeUpdate(reply, c);
  assert.deepEqual(changes, [{ id: 'frein', title: 'Liquide de frein', date: '2026-12-01', km: null, note: 'En retard.' }]);
  applyClaudeUpdate(c, changes);
  assert.equal(op(c, 'frein').dueDate, '2026-12-01');
  assert.equal(op(c, 'frein').note, 'En retard.');
  assert.equal(nextDue(op(c, 'frein'), c, today).date, '2026-12-01');
});

test('une réponse sans bloc de mise à jour est refusée', () => {
  assert.throws(() => parseClaudeUpdate('Tout va bien.', carnet()), /Aucun bloc/);
  assert.throws(() => parseClaudeUpdate('{"version":2,"operations":[]}', carnet()), /Aucun bloc/);
});

test('le service suit la date affichée par le tableau de bord', () => {
  const due = nextDue(op(carnet(), 'service'), carnet(), today);
  assert.equal(due.date, '2026-11-24');
  assert.equal(due.status, 'bientot');
});

test('le premier contrôle technique dépassé est en retard', () => {
  const due = nextDue(op(carnet(), 'ct'), carnet(), today);
  assert.equal(due.date, '2026-03-15');
  assert.equal(due.status, 'retard');
});

test('un contrôle technique fait repousse l’échéance de deux ans', () => {
  const c = carnet();
  applyDone(op(c, 'ct'), { date: '2026-06-15', km: 130000 });
  const due = nextDue(op(c, 'ct'), c, today);
  assert.equal(due.date, '2028-06-15');
  assert.equal(due.status, 'ok');
});

test('la courroie est atteinte d’abord par le kilométrage', () => {
  const c = carnet();
  const due = nextDue(op(c, 'courroie'), c, today);
  assert.equal(due.km, 210000);
  assert.equal(due.estimated, true);
  assert.ok(due.date.startsWith('2029-'));
});

test('une opération sans intervalle reste inconnue, puis faite', () => {
  const c = carnet();
  assert.equal(nextDue(op(c, 'habitacle'), c, today).status, 'inconnu');
  applyDone(op(c, 'habitacle'), { date: today, km: 140000 });
  assert.equal(nextDue(op(c, 'habitacle'), c, today).status, 'fait');
});

test('le liquide de frein attend sa dernière date avant de calculer', () => {
  const c = carnet();
  const before = nextDue(op(c, 'frein'), c, today);
  assert.equal(before.status, 'inconnu');
  assert.equal(before.needsLast, true);
  applyDone(op(c, 'frein'), { date: '2026-01-10', km: 120000 });
  assert.equal(nextDue(op(c, 'frein'), c, today).date, '2028-01-10');
});

test('le filtre à particules se contrôle à 150 000 km puis tous les 30 000 km', () => {
  const c = carnet();
  assert.equal(nextDue(op(c, 'depollution'), c, today).km, 150000);
  applyDone(op(c, 'depollution'), { date: today, km: 150000 });
  assert.equal(nextDue(op(c, 'depollution'), c, today).km, 180000);
});

test('un ancien carnet est mis à niveau sans perdre les saisies', () => {
  const c = carnet();
  delete c.templateVersion;
  c.operations = c.operations.filter((o) => !['clim', 'batterie'].includes(o.id));
  Object.assign(op(c, 'frein'), { intervalMonths: null, needsLastDone: undefined, lastDoneDate: '2025-05-01', lastDoneKm: 100000 });
  Object.assign(op(c, 'depollution'), { intervalKm: null, dueKm: null });
  assert.equal(upgradeCarnet(c), true);
  assert.equal(upgradeCarnet(c), false);
  assert.ok(op(c, 'clim') && op(c, 'batterie'));
  assert.equal(nextDue(op(c, 'frein'), c, today).date, '2027-05-01');
  assert.equal(op(c, 'depollution').dueKm, 150000);
});

test('chaque bloc du guide cite une source, sauf les conseils', () => {
  const c = carnet();
  for (const o of c.operations) assert.ok(GUIDE[o.id], o.id);
  for (const entry of Object.values(GUIDE)) {
    for (const s of entry.sections) {
      assert.ok(s.items.length > 0);
      if (s.level !== 'conseil') assert.ok(s.source?.url, s.title);
    }
  }
});

test('le budget prend le coût saisi, sinon le prix de référence, et signale les autres', () => {
  const c = carnet();
  op(c, 'service').costMin = 200;
  op(c, 'service').costMax = 400;
  const f = forecast(c, today, 12);
  assert.equal(f.min, 278);
  assert.equal(f.max, 478);
  assert.equal(f.unpriced, 1);
});

test('la projection compte les retards à aujourd’hui et répète les opérations à leur rythme', () => {
  const plan = spendPlan(carnet(), today, 2027);
  const items = (year) => plan.years.find((y) => y.year === year).items;
  assert.equal(items('2026').find((x) => x.op.id === 'ct').date, today);
  assert.ok(items('2026').some((x) => x.op.id === 'service'));
  assert.ok(items('2027').some((x) => x.op.id === 'service'), 'la révision revient l’année suivante');
  assert.ok(!items('2027').some((x) => x.op.id === 'ct'), 'le contrôle technique revient dans deux ans');
});

test('la projection met à part les opérations sans date', () => {
  const plan = spendPlan(carnet(), today, 2027);
  assert.ok(plan.undated.count > 0);
  assert.ok(plan.undated.max >= plan.undated.min);
  assert.ok(plan.years.every((y) => y.items.every((x) => x.op.id !== 'pneus')));
});

test('la photo du message de service donne les jours et les kilomètres restants', () => {
  assert.deepEqual(parseDashboard('Service entretien\ndans 16 jours ou 12900 km', 142457),
    { km: null, serviceDays: 16, serviceKm: 12900 });
  assert.deepEqual(parseDashboard('Service dans 16 jours\nou 12 900 km', 142457),
    { km: null, serviceDays: 16, serviceKm: 12900 });
});

test('la photo du compteur donne le kilométrage, sans confondre les autres chiffres', () => {
  assert.equal(parseDashboard('142 457 km\n12.5 °C 850 km', 140000).km, 142457);
  assert.equal(parseDashboard('14300 km 142458', 140000).km, 142458);
  assert.equal(parseDashboard('O 142457', 140000).km, 142457);
  assert.equal(parseDashboard('999 999 km', 140000).km, null, 'saut impossible depuis le dernier relevé');
});

test('une distance sans message de service n’est pas prise pour une échéance', () => {
  assert.equal(parseDashboard('Autonomie 850 km', 140000).serviceKm, null);
  assert.deepEqual(parseDashboard('', 140000), { km: null, serviceDays: null, serviceKm: null });
});

test('une facture donne son objet, sa date, son total, son kilométrage et son garage', () => {
  const text = `GARAGE DU CENTRE
12 rue des Lilas
Facture n° 2026-118 du 14/10/2026
Véhicule : VW Touran  Mise en circulation 27/07/2022
Kilométrage : 142 457
Révision complète       180,00
Filtre à huile           24,50
Total HT                340,40
TVA 20 %                 68,08
Total TTC               408,48 €
Prochaine révision à 172 000 km`;
  assert.deepEqual(parseInvoice(text, 142457, today), {
    title: 'Révision', date: '2026-10-14', amount: 408.48, km: 142457, garage: 'GARAGE DU CENTRE',
  });
});

test('le kilométrage d’une facture peut être séparé de son libellé par un mot', () => {
  assert.equal(parseInvoice('Dernier kilométrage constaté : 139509', 142457, today).km, 139509);
});

test('le montant vient du net à payer, y compris sur la ligne suivante', () => {
  assert.equal(parseInvoice('Total TTC 500,00\nNet à payer\n1 250,50 €', 0, today).amount, 1250.5);
});

test('une date impossible ou future n’est pas retenue', () => {
  assert.equal(parseInvoice('Date 31/02/2026', 0, today).date, null);
  assert.equal(parseInvoice('Facture du 14/10/2030', 0, today).date, null);
  assert.equal(parseInvoice('Facture du 3 août 2026', 0, today).date, '2026-08-03');
});

test('une facture illisible laisse tous les champs vides', () => {
  assert.deepEqual(parseInvoice('xx yy', 142457, today), { title: null, date: null, amount: null, km: null, garage: null });
});

test('les dépenses sont totalisées par année', () => {
  const c = carnet();
  c.invoices.push({ date: '2026-01-02', amount: 100 }, { date: '2026-03-02', amount: 50 }, { date: '2025-03-02', amount: 10 });
  assert.deepEqual(spentByYear(c), [['2026', 150], ['2025', 10]]);
});

test('le fichier calendrier est valide, échappé et replié', () => {
  const ics = buildIcs({
    id: 'rdv-1', date: '2026-11-20', time: '23:30', durationMin: 60,
    title: 'Révision, garage; test', location: 'Rue X',
    notes: 'ligne 1\nligne 2 ' + 'é'.repeat(80),
  }, new Date('2026-11-08T10:00:00Z'));
  assert.match(ics, /DTSTART:20261120T233000\r\n/);
  assert.match(ics, /DTEND:20261121T003000\r\n/);
  assert.match(ics, /SUMMARY:Révision\\, garage\\; test\r\n/);
  assert.match(ics, /DTSTAMP:20261108T100000Z\r\n/);
  const encoder = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(encoder.encode(line).length <= 75, line);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});
