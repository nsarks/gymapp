// The test site's invented history and saved mock sheet, run through the real Code.gs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureBook, loadScript } from './mock-gas.mjs';
import { dumpBook, loadBook } from '../src/preview/sheet.js';
import { seedOps } from '../src/preview/seed.js';
import { addDays, buildHistory, weekCells, mondayOf, sessionSummaryText } from '../src/logic.js';

const TODAY = '2026-11-25'; // a Wednesday
const seeded = () => {
  const g = loadScript(fixtureBook());
  g.api.setup();
  const key = g.props.KEY;
  const boot = g.post({ key, action: 'bootstrap' });
  const ops = seedOps(boot, TODAY);
  const res = g.post({ key, action: 'sync', ops });
  return { g, key, ops, res, after: g.post({ key, action: 'bootstrap' }) };
};

test('the seed gives about three weeks of varied history before today', () => {
  const { ops, res, after } = seeded();
  assert.equal(res.ok, true);
  assert.equal(res.applied.length, ops.length);
  const { sessions, log } = after;
  assert.ok(sessions.length >= 8, `only ${sessions.length} sessions`);
  assert.ok(sessions.every((s) => s.Date < TODAY && s.Date >= addDays(TODAY, -21)));
  assert.ok(sessions.every((s) => s.End), 'every session is finished');
  const modes = new Set(sessions.map((s) => s.Mode));
  ['as planned', 'modified', 'freestyle'].forEach((m) => assert.ok(modes.has(m), `no ${m} session`));
  assert.ok(sessions.some((s) => s.Injury === true || s.Injury === 'TRUE'));
  assert.ok(sessions.some((s) => /^Warm-up done/.test(s.Note)) && sessions.some((s) => /^Warm-up skipped/.test(s.Note)));
  ['skipped', 'swapped', 'added', 'done'].forEach((st) => assert.ok(log.some((r) => r.Status === st), `no ${st} row`));
  assert.ok(log.every((r) => sessions.some((s) => s.SessionID === r.SessionID)), 'no orphan rows');
  assert.ok(after.library.some((l) => l.Exercise === 'Plank'));
});

test('weights rise over the weeks and the week strip has something to show', () => {
  const { after } = seeded();
  const hist = buildHistory(after.log);
  const rising = [...hist.values()].filter((list) => list.length >= 3 && list[list.length - 1].sets[0].kg > list[0].sets[0].kg);
  assert.ok(rising.length >= 2);
  const lastWeek = weekCells(mondayOf(addDays(TODAY, -7)), TODAY, after.planDays, after.sessions.map((s) => ({ ...s, _skips: 0 })));
  assert.ok(lastWeek.some((c) => c.state === 'done'));
  assert.ok(lastWeek.some((c) => c.state === 'skipped'), 'a missed day shows');
  const s = after.sessions.find((x) => x.Mode === 'modified');
  const text = sessionSummaryText({ session: s, rows: after.log.filter((r) => r.SessionID === s.SessionID), planDay: after.planDays.find((p) => p.Day === s.Day), plan: after.plan, library: after.library, hist });
  assert.match(text, /^Strength session: /);
});

test('the saved mock sheet comes back the same, dates included', () => {
  const { g, key, after } = seeded();
  const again = loadScript(loadBook(JSON.parse(JSON.stringify(dumpBook(g.book)))));
  Object.assign(again.props, g.props);
  assert.deepEqual(again.post({ key, action: 'bootstrap' }), { ...after, today: again.post({ key, action: 'bootstrap' }).today });
});
