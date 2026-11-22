import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureBook, loadScript } from './mock-gas.mjs';

const snapshot = (book) => JSON.stringify(book.sheets.filter((s) => /PLAN$|WARM|\(/.test(s.name)).map((s) => [s.name, s.grid, s.merges, s.writes]));
const table = (book, name) => book.sheets.find((s) => s.name === name).grid;

function fresh() {
  const book = fixtureBook();
  const before = snapshot(book);
  const g = loadScript(book);
  g.api.setup();
  const key = g.logs.find((l) => /SECRET KEY/.test(l)).split(': ')[1];
  return { ...g, key, before };
}

const set = (id, extra = {}) => ({
  id, op: 'log.append',
  row: { ClientID: id, LoggedAt: '2026-11-16T18:00:00.000Z', SessionID: 's1', Date: '2026-11-16', Day: 'Mon', Exercise: 'DB Bench Press', PlannedExercise: '', Status: 'done', SetNo: 1, Kg: 25, Reps: 10, RPE: '', Note: '', ...extra },
});

test('setup leaves the original tabs untouched and seeds the plan', () => {
  const g = fresh();
  assert.equal(snapshot(g.book), g.before);
  const days = table(g.book, 'PlanDays').slice(1);
  assert.equal(days.length, 5);
  assert.deepEqual(days.map((d) => d[0]), ['Mon', 'Tue', 'Wed', 'Fri', 'Sat']);
  assert.deepEqual(days.map((d) => d[1]), ['Gym day 1', 'Home workout A', 'Gym day 2', 'Gym day 3', 'Home workout B']);
  assert.equal(days[0][3], 'Upper body');
  const plan = table(g.book, 'AppPlan').slice(1);
  const mon = plan.filter((r) => r[1] === 'Mon');
  assert.equal(mon.length, 11); // 5 warm-up + 6 main, from the LAST block only
  assert.equal(mon[0][3], 'Warm-up');
  assert.equal(mon[1][5], '2-3'); // merged SETS cell filled down
  assert.ok(!plan.some((r) => /^(bar bench press|hammer)$/i.test(r[4])), 'logged rows from older blocks are not plan exercises');
  const row = (day, ex) => plan.find((r) => r[1] === day && r[4] === ex);
  assert.equal(row('Mon', 'Incline Bench press')[6], '8-12'); // latest block wins
  assert.equal(row('Mon', 'Hammer curl')[6], '10-12'); // date cell read as shown, not as a date
  assert.equal(row('Mon', 'Facepulls')[5], '2-3');
  assert.equal(row('Mon', 'Hammer curl')[9], 'Squeeze at the top 8kgx12'); // note carried from an older block
  assert.equal(row('Fri', 'Cable - Bicep curl')[6], '10-12');
  assert.equal(row('Fri', 'Cable - Bicep curl')[9], '12kg x12x3'); // "done" is not a note
  assert.equal(row('Fri', 'Lat Pull down')[9], 'lighter next time');
  assert.ok(!plan.some((r) => /\b20\d\d\b|GMT/.test(r.join(' '))), 'no date text anywhere in the plan');
  assert.equal(plan.find((r) => r[4] === 'Side plank')[6], '30s'); // duration used when reps is "/"
  assert.ok(!plan.some((r) => /stretch/i.test(r[4]))); // a note row is not an exercise
  assert.equal(plan.filter((r) => r[4] === 'Lat Pull down').length, 2); // one spelling across days
  const lib = table(g.book, 'Library').slice(1);
  assert.equal(new Set(lib.map((r) => r[0].toLowerCase())).size, lib.length);
  assert.equal(lib.find((r) => r[0] === 'Clamshell')[1], 'Glutes');
  const grp = (n) => lib.find((r) => r[0] === n)[1];
  assert.equal(grp('Chest press - Fixed machine'), 'Chest');
  assert.equal(grp('SL Balance'), 'Core');
  assert.equal(grp('Single-leg balance'), 'Core');
  assert.equal(grp('Cable - Bicep curl'), 'Arms');
});

test('setup is safe to run twice and shows the key once', () => {
  const g = fresh();
  const rows = table(g.book, 'AppPlan').length;
  g.api.setup();
  assert.equal(table(g.book, 'AppPlan').length, rows);
  assert.equal(g.logs.filter((l) => /SECRET KEY/.test(l)).length, 1);
  assert.equal(snapshot(g.book), g.before);
});

test('wrong or missing key returns an error and writes nothing', () => {
  const g = fresh();
  for (const key of ['nope', '', undefined, g.key + 'x']) {
    const res = g.post({ key, action: 'sync', ops: [set('a1')] });
    assert.deepEqual(res, { ok: false, error: 'Request refused' });
  }
  assert.deepEqual(g.post('not json'), { ok: false, error: 'Request refused' });
  assert.equal(table(g.book, 'Log').length, 1);
});

test('sync is idempotent on ClientID', () => {
  const g = fresh();
  const ops = [set('a1'), set('a2', { SetNo: 2 }), set('a1')];
  assert.deepEqual(g.post({ key: g.key, action: 'sync', ops }).applied, ['a1', 'a2', 'a1']);
  g.post({ key: g.key, action: 'sync', ops });
  assert.equal(table(g.book, 'Log').length, 3);
});

test('swap, skip, update, delete and session upsert', () => {
  const g = fresh();
  g.post({ key: g.key, action: 'sync', ops: [
    { id: 'o1', op: 'session.upsert', row: { SessionID: 's1', Date: '2026-11-16', Day: 'Mon', Mode: 'as planned', Injury: false, Note: '', Start: '2026-11-16T18:00:00.000Z', End: '' } },
    set('a1'),
    set('a2', { Exercise: 'Machine row', PlannedExercise: 'Chest supported - DB row', Status: 'swapped' }),
    set('a3', { Exercise: 'Hammer curl', PlannedExercise: 'Hammer curl', Status: 'skipped', SetNo: '', Kg: '', Reps: '', Note: '=HYPERLINK("x")' }),
    set('a4', { SetNo: 2 }),
    { id: 'o2', op: 'log.update', row: { ...set('a1').row, Kg: 27.5 } },
    { id: 'o3', op: 'log.delete', row: { ClientID: 'a4' } },
    { id: 'o4', op: 'session.upsert', row: { SessionID: 's1', Date: '2026-11-16', Day: 'Mon', Mode: 'modified', Injury: true, Note: 'Knee: sore', Start: '2026-11-16T18:00:00.000Z', End: '2026-11-16T19:00:00.000Z' } },
    { id: 'o5', op: 'library.add', row: { Exercise: 'Machine row', Group: 'Back', Equipment: 'Machine' } },
    { id: 'o6', op: 'library.add', row: { Exercise: 'machine ROW', Group: 'Back' } },
  ] });
  const boot = g.post({ key: g.key, action: 'bootstrap' });
  assert.equal(boot.ok, true);
  assert.equal(boot.log.length, 3);
  assert.equal(boot.log.find((r) => r.ClientID === 'a1').Kg, 27.5);
  const sw = boot.log.find((r) => r.ClientID === 'a2');
  assert.equal(sw.Status, 'swapped');
  assert.equal(sw.PlannedExercise, 'Chest supported - DB row');
  assert.equal(sw.Date, '2026-11-16');
  const sk = boot.log.find((r) => r.ClientID === 'a3');
  assert.deepEqual([sk.SetNo, sk.Kg, sk.Reps], ['', '', '']);
  assert.equal(boot.sessions.length, 1);
  assert.equal(boot.sessions[0].Mode, 'modified');
  assert.equal(boot.sessions[0].Injury, true);
  assert.equal(boot.library.filter((l) => /machine row/i.test(l.Exercise)).length, 1);
  assert.deepEqual(boot.lastPerformance['DB Bench Press'], { date: '2026-11-16', sets: [{ kg: 27.5, reps: 10, rpe: '' }] });
  assert.equal(boot.plan.length, table(g.book, 'AppPlan').length - 1);
  assert.equal(snapshot(g.book), g.before);
});

test('reseedPlan rebuilds the plan and keeps logged exercises in Library', () => {
  const g = fresh();
  g.post({ key: g.key, action: 'sync', ops: [set('a1', { Exercise: 'Machine row' }), { id: 'l1', op: 'library.add', row: { Exercise: 'Machine row', Group: 'Back' } }, { id: 'l2', op: 'library.add', row: { Exercise: 'Never used', Group: 'Back' } }] });
  const planRows = table(g.book, 'AppPlan').filter((r) => r[0]).length;
  g.api.reseedPlan();
  assert.equal(table(g.book, 'AppPlan').filter((r) => r[0]).length, planRows);
  assert.equal(table(g.book, 'PlanDays').filter((r) => r[0]).length, 6);
  const lib = table(g.book, 'Library').filter((r) => r[0]).map((r) => r[0]);
  assert.ok(lib.includes('Machine row'));
  assert.ok(!lib.includes('Never used'));
  assert.equal(new Set(lib.map((x) => x.toLowerCase())).size, lib.length);
  assert.equal(table(g.book, 'Log').filter((r) => r[0]).length, 2);
  assert.equal(snapshot(g.book), g.before);
});

test('session.delete removes the session row', () => {
  const g = fresh();
  const ses = { SessionID: 's9', Date: '2026-11-16', Day: 'Mon', Mode: 'as planned', Injury: '', Note: '', Start: 'x', End: '' };
  g.post({ key: g.key, action: 'sync', ops: [{ id: 'u', op: 'session.upsert', row: ses }] });
  const res = g.post({ key: g.key, action: 'sync', ops: [{ id: 'd', op: 'session.delete', row: { SessionID: 's9' } }] });
  assert.deepEqual(res.applied, ['d']);
  assert.equal(g.post({ key: g.key, action: 'bootstrap' }).sessions.length, 0);
});

test('the guard refuses any tab that is not an app tab', () => {
  const g = fresh();
  assert.throws(() => g.api.appSheet_(g.book, 'Monday (Gym)'), /Refusing/);
  assert.throws(() => g.api.appSheet_(g.book, 'PLAN'), /Refusing/);
  assert.throws(() => g.api.appSheet_(g.book, 'Plan'), /Refusing/);
});
