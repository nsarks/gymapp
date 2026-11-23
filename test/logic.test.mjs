import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, preselect, restSeconds, maxNum, describeDay, buildHistory, improvements, sessionStats, weekCells, applyOp, e1rm, toCsv } from '../src/logic.js';

const planDays = ['Mon', 'Tue', 'Wed', 'Fri', 'Sat'].map((Day) => ({ Day, SessionName: Day + ' session', Location: 'Gym', Focus: '', Summary: '' }));
const done = (Day, Date) => ({ SessionID: Day + Date, Day, Date, Mode: 'as planned', End: 'x', Start: 'x' });

test('Thursday preselects the nearest planned day, tie goes to the upcoming one', () => {
  const c = candidates('2026-11-12', planDays, []); // a Thursday
  assert.deepEqual(c.map((x) => x.Day), ['Fri', 'Wed', 'Sat', 'Tue', 'Mon']);
  assert.equal(preselect(c).Day, 'Fri');
});
test('Sunday prefers Monday over Saturday', () => {
  assert.equal(preselect(candidates('2026-11-15', planDays, [])).Day, 'Mon');
});
test('today is preselected, and a finished session moves on to the next unlogged one', () => {
  assert.equal(preselect(candidates('2026-11-16', planDays, [])).Day, 'Mon');
  const c = candidates('2026-11-16', planDays, [done('Mon', '2026-11-16')]);
  assert.equal(c[0].done, true);
  assert.equal(preselect(c).Day, 'Tue');
});
test('rest and rep parsing', () => {
  assert.equal(restSeconds('2min'), 120);
  assert.equal(restSeconds('1-2mins'), 120);
  assert.equal(restSeconds('20-30s'), 30);
  assert.equal(restSeconds(''), 60);
  assert.equal(maxNum('8-10/side'), 10);
  assert.equal(maxNum('2-3'), 3);
});
test('day card summary and duration', () => {
  const plan = ['A', 'B', 'C', 'D', 'E'].map((x, i) => ({ Day: 'Mon', Order: i + 1, Block: 'Main', Exercise: x, Sets: '3', Rest: '2min' }));
  const d = describeDay(planDays[0], plan);
  assert.equal(d.summary, 'A, B, C and 2 more');
  assert.equal(d.minutes, 40); // 15 sets x 160 s = 40 min
});
test('history, improvements and stats', () => {
  const row = (id, s, date, kg, reps, extra = {}) => ({ ClientID: id, SessionID: s, Date: date, LoggedAt: date + id, Exercise: 'Bench', Status: 'done', SetNo: 1, Kg: kg, Reps: reps, ...extra });
  const rows = [row('a', 's1', '2026-11-02', 25, 10), row('b', 's2', '2026-11-09', 27.5, 9), row('c', 's2', '2026-11-09', '', '', { Status: 'skipped', SetNo: '', Exercise: 'Curl' })];
  const h = buildHistory(rows);
  assert.equal(h.get('Bench').length, 2);
  assert.deepEqual(improvements(h, 's2'), ['Bench: 27.5 x 9 (was 25 x 10)']);
  assert.deepEqual(improvements(h, 's1'), []);
  assert.deepEqual(sessionStats(rows.filter((r) => r.SessionID === 's2')), { volume: 248, sets: 1, skipped: 1, swapped: 0, added: 0 });
  assert.ok(Math.abs(e1rm(100, 10) - 133.33) < 0.01);
});
test('week cells', () => {
  const cells = weekCells('2026-11-09', '2026-11-12', planDays, [done('Mon', '2026-11-09'), { ...done('Tue', '2026-11-10'), _skips: 2 }]);
  assert.deepEqual(cells.map((c) => c.state), ['done', 'partly', 'skipped', 'none', 'upcoming', 'upcoming', 'none']);
});
test('the week strip shows the days trained, not which planned sessions are done', () => {
  // Wednesday's session done on Thursday ticks Thursday (off plan) and leaves Wednesday skipped.
  let cells = weekCells('2026-11-09', '2026-11-13', planDays, [done('Wed', '2026-11-12')]);
  assert.deepEqual(cells.map((c) => c.state), ['skipped', 'skipped', 'skipped', 'off', 'upcoming', 'upcoming', 'none']);
  // Another day's session on a planned day, and freestyle on a planned day or a rest day, are all off plan.
  const free = (Date) => ({ ...done('Fri', Date), Mode: 'freestyle' });
  cells = weekCells('2026-11-09', '2026-11-16', planDays, [done('Mon', '2026-11-10'), free('2026-11-13'), free('2026-11-15')]);
  assert.deepEqual(cells.map((c) => c.state), ['skipped', 'off', 'skipped', 'none', 'off', 'skipped', 'off']);
  // A day's own session wins over a second, off plan one on the same date.
  cells = weekCells('2026-11-09', '2026-11-16', planDays, [done('Mon', '2026-11-09'), done('Tue', '2026-11-09')]);
  assert.equal(cells[0].state, 'done');
  assert.equal(cells[1].state, 'skipped');
});
test('the Change session sheet still counts a moved session as done for its plan day', () => {
  const c = candidates('2026-11-13', planDays, [done('Wed', '2026-11-12')]); // Friday, after doing Wednesday's on Thursday
  assert.equal(c.find((x) => x.Day === 'Wed').doneThisWeek, true);
  assert.equal(preselect(c).Day, 'Fri');
});
test('queued ops and csv', () => {
  const log = {}, ses = {}, lib = [];
  applyOp({ op: 'log.append', row: { ClientID: 'a', Kg: 1 } }, log, ses, lib);
  applyOp({ op: 'log.append', row: { ClientID: 'a', Kg: 2 } }, log, ses, lib);
  assert.equal(log.a.Kg, 1);
  applyOp({ op: 'log.update', row: { ClientID: 'a', Kg: 3 } }, log, ses, lib);
  assert.equal(log.a.Kg, 3);
  applyOp({ op: 'log.delete', row: { ClientID: 'a' } }, log, ses, lib);
  assert.deepEqual(log, {});
  assert.equal(toCsv([{ a: 'x,y', b: 'q"' }], ['a', 'b']), 'a,b\n"x,y","q"""');
});
