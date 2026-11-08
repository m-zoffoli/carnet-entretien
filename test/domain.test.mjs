import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, addDays, applyDone, buildIcs, createCarnet, forecast, kmStats, nextDue, spentByYear } from '../js/domain.js';

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
  assert.equal(nextDue(op(c, 'frein'), c, today).status, 'inconnu');
  applyDone(op(c, 'frein'), { date: today, km: 140000 });
  assert.equal(nextDue(op(c, 'frein'), c, today).status, 'fait');
});

test('le budget ne compte que les montants renseignés et signale les autres', () => {
  const c = carnet();
  op(c, 'service').costMin = 200;
  op(c, 'service').costMax = 400;
  const f = forecast(c, today, 12);
  assert.equal(f.min, 200);
  assert.equal(f.max, 400);
  assert.equal(f.unpriced, 1);
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
