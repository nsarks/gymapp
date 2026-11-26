// End to end run in headless Chrome against the mock backend. Usage: npm run build && node test/e2e.mjs
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { start } from './server.mjs';

const shots = process.env.SHOTS || '';
const { server, g, key, url } = await start();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET/.test(m.text()) && errors.push(m.text()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (text, sel = 'button') => {
  const ok = await page.evaluate((text, sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => !e.disabled && e.offsetParent !== null);
    const top = els.filter((e) => e.closest('.overlay'));
    const pool = document.querySelector('.overlay') ? top : els;
    const el = pool.find((e) => e.textContent.trim() === text) || pool.find((e) => (e.getAttribute('aria-label') || '') === text) || pool.find((e) => e.textContent.trim().startsWith(text));
    if (el) el.click();
    return !!el;
  }, text, sel);
  assert.ok(ok, `could not find "${text}"`);
  await sleep(60);
};
const text = () => page.evaluate(() => document.body.innerText);
const shot = async (name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/${name}.png` }); } };
const log = () => g.post({ key, action: 'bootstrap' });

await page.goto(url, { waitUntil: 'networkidle0' });
assert.match(await text(), /Connect your sheet/);
await click('Settings');
await page.type('input[type=url]', `${url}/api`);
await page.type('input[type=password]', 'wrong-key');
await click('Save and connect');
await sleep(300);
assert.match(await text(), /Key not accepted/);
await page.evaluate(() => { document.querySelector('input[type=password]').value = ''; });
await page.type('input[type=password]', key);
await click('Save and connect');
await sleep(300);
assert.match(await text(), /Connected/);

await click('Today');
await shot('01-start');
// Any day can be tapped. A rest day (Thursday in the fixture) offers a session rather than suggesting one.
await page.click('button.weekday[aria-label="Thursday, rest day"]');
await sleep(60);
assert.match(await text(), /Thursday is a rest day in the plan/);
assert.doesNotMatch(await text(), /Start session/);
await shot('01b-rest-day');
await click('Pick a session');
assert.match(await text(), /Freestyle session/);
assert.equal((await text()).match(/Not done this week/g).length, 5);
await shot('02-change');
await click('Gym day 1');
assert.match(await text(), /Monday, Gym, Upper body/);
const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
const moved = todayName !== 'Monday';
if (moved) assert.match(await text(), /Monday's session, logged today/);
else assert.doesNotMatch(await text(), /logged today/);
assert.match(await text(), /6 exercises, about 40 min/);
await click('Skip warm-up');
await click('Start session');
assert.match(await text(), /DB Bench Press/);
assert.match(await text(), /3 x 8-10/);
assert.match(await text(), /Lie on a flat bench with a dumbbell/); // description shown
assert.match(await text(), /Show more/);
await click('Show more');
assert.match(await text(), /Show less/);
await shot('03-card');

// Delete an exercise (and undo), then finish one early.
await click('Exercise options');
await click('Delete exercise');
assert.match(await text(), /Removed DB Bench Press\./);
assert.match(await text(), /Chest supported - DB row/);
await click('Undo');
assert.match(await text(), /DB Bench Press/);

// Exercise 1: three sets, typed weight, same as last set, edit.
await click('kg: 0. Tap to type');
await page.keyboard.type('25');
await page.keyboard.press('Enter');
await click('Log set 1');
assert.match(await text(), /Rest/);
await shot('04-timer');
await click('More kg');
await click('Log set 2');
await click('Same as last set');
assert.match(await text(), /Next exercise/);
await click('Dismiss');

// Go offline for the rest of the session.
await page.setOfflineMode(true);
await click('Next exercise');
assert.match(await text(), /Chest supported - DB row/);
assert.match(await text(), /Exercise 2 of 6/);
await click('Exercise options');
await click('Swap');
await shot('05-swap');
await page.type('.overlay input[type=search]', 'Machine row');
await click("Add 'Machine row' as a new exercise");
await click('Back');
assert.match(await text(), /Swapped for Machine row\./);
assert.match(await text(), /Swapped from Chest supported - DB row/);
await click('Log set 1');
await click('Next');

assert.match(await text(), /Incline Bench press/);
await click('Exercise options');
await click('Skip');
await click('Machine busy');
assert.match(await text(), /Skipped\./);
await click('Undo');
assert.doesNotMatch(await text(), /Skipped: Machine busy/);
await click('Exercise options');
await click('Skip');
await click('Machine busy');
await sleep(100);
assert.match(await text(), /Lat Pull down/);
await click('Log set 1');
await click('Exercise options');
await click('Finish exercise');
assert.match(await text(), /Exercise finished\./);
assert.match(await text(), /Facepulls/);
await click('Exercise options');
await click('Delete exercise');
assert.match(await text(), /Hammer curl/);

// Add a leg exercise, then skip legs in one tap.
await click('Session menu');
await click('Add an exercise');
await page.type('.overlay input[type=search]', 'Bulgarian');
await click('Bulgarian SS');
assert.match(await text(), /Bulgarian SS/);
await click('Session menu');
await click('Anything niggling?');
await click('Knee');
await page.type('.overlay input.text', 'felt sharp on step up');
await click('Save');
await click('Session menu');
await click('Finish session');
assert.match(await text(), /2 exercises not logged/);
await shot('06-finish');
await click('Short on time');
await sleep(200);
assert.match(await text(), /Session finished/);
assert.match(await text(), /Offline, pending/);
await shot('07-summary');
assert.match(await text(), /Workout summary/);
await click('Show the text');
await sleep(100);
const summary = await page.evaluate(() => document.querySelector('.summarytext').innerText);
assert.match(summary, /^Strength session: /);
assert.match(summary, /Warm-up: skipped\./);
assert.match(summary, /Machine row \(instead of Chest supported - DB row/);
assert.match(summary, /Notes: Knee: felt sharp on step up\./);
assert.ok(log().log.length <= 3, 'nothing logged offline has reached the sheet yet');

await page.setOfflineMode(false);
await click('Sync now');
await sleep(500);
assert.match(await text(), /Sync status: Synced/);
await click('Done');

// The strip marks the day trained, not the plan day: Monday's session done on another day leaves Monday unticked.
const cellLabel = (day) => page.$eval(`button.weekday[aria-label^="${day},"]`, (e) => e.getAttribute('aria-label'));
assert.equal(await cellLabel(todayName), `${todayName}, ${moved ? 'trained, not on plan' : 'partly done'}`);
if (moved) assert.equal(await cellLabel('Monday'), 'Monday, skipped');
await shot('07b-strip');

const b = log();
const ids = b.log.map((r) => r.ClientID);
assert.equal(new Set(ids).size, ids.length, 'no duplicate rows');
assert.equal(b.log.filter((r) => r.Exercise === 'DB Bench Press').length, 3);
assert.deepEqual(b.log.filter((r) => r.Exercise === 'DB Bench Press').map((r) => r.Kg), [25, 27.5, 27.5]);
const sw = b.log.find((r) => r.Exercise === 'Machine row');
assert.deepEqual([sw.Status, sw.PlannedExercise], ['swapped', 'Chest supported - DB row']);
assert.equal(b.log.filter((r) => r.Status === 'skipped').length, 3);
assert.equal(b.log.filter((r) => r.Exercise === 'Lat Pull down').length, 1);
assert.equal(b.log.filter((r) => r.Exercise === 'Facepulls').length, 0, 'deleted exercise left nothing behind');
assert.equal(b.log.find((r) => r.Exercise === 'Incline Bench press').Note, 'Machine busy');
assert.equal(b.sessions.length, 1);
assert.deepEqual([b.sessions[0].Mode, b.sessions[0].Injury, b.sessions[0].Note], ['modified', true, 'Warm-up skipped | Knee: felt sharp on step up']);
assert.ok(b.sessions[0].End);
assert.ok(b.library.some((l) => l.Exercise === 'Machine row' && l.Group === 'Back'));

// Replaying every request the phone sent changes nothing (idempotent).
const before = JSON.stringify(log().log);
g.posts.slice().forEach((p) => g.post(p));
assert.equal(JSON.stringify(log().log), before);

// History.
await click('History');
await sleep(200);
assert.match(await text(), /Modified/);
await shot('08-history');
await click('Gym day 1');
assert.match(await text(), /Instead of Chest supported - DB row/);
await shot('09-detail');
assert.match(await text(), /Workout summary/);
// Correct a past session: warm-up was done, and the bench press was really a barbell bench press.
await click('Mark as done');
await sleep(100);
assert.match(await text(), /Warm-up: done/);
await click('Wrong exercise? Change it');
await sleep(100);
const inputs = await page.$$('.overlay input[type=search]');
await inputs[inputs.length - 1].type('Barbell bench press');
await click("Add 'Barbell bench press' as a new exercise");
await click('Barbell');
await click('Chest');
await sleep(100);
assert.match(await text(), /Instead of DB Bench Press/);
await click('Show the text');
assert.match(await page.evaluate(() => document.querySelector('.summarytext').innerText), /Warm-up: done\.[\s\S]*- Barbell bench press \(instead of DB Bench Press\): 1 x 10 at 25 kg, then 2 x 10 at 27.5 kg/);

await click('Close');
const before2 = log().sessions.length;
// make a throwaway session, then delete it from history
await click('Today');
await click('Change session');
await click('Freestyle session');
await click('Add an exercise');
await click('DB Bench Press');
await click('Log set 1');
await click('Finish');
await click('Done');
await click('History');
await click('Freestyle');
await click('Delete this session');
assert.match(await text(), /Session deleted\./);
await sleep(6500);
await click('Settings');
await click('Force sync');
await sleep(600);
assert.equal(log().sessions.length, before2, 'deleted session is gone from the sheet');
assert.equal(log().log.filter((r) => r.Exercise === 'Barbell bench press').length, 3);
await click('History');
await click('Exercise');
assert.match(await text(), /One session in this range/);
await shot('10-exercise');
await click('Week');
await shot('11-week');

// Freestyle, skip legs and reload-resume.
await click('Today');
await click('Change session');
await click('Gym day 2');
await click('Start session');
await click('Session menu');
await click('Skip legs');
assert.match(await text(), /This skips 3 exercises\./);
await click('Cycled in');
assert.match(await text(), /Skipped 3 exercises\./);
await shot('12-legs');
await page.reload({ waitUntil: 'networkidle0' });
assert.match(await text(), /Resume/);
await shot('13-resume');
await click('Resume');
await click('Session menu');
await click('Finish session');
await click('Leave them');
await click('Done');
await click('Settings');
await click('Force sync');
await sleep(500);

// Freestyle session.
await click('Today');
await click('Change session');
await click('Freestyle session');
assert.match(await text(), /Build your own/);
await click('Add an exercise');
await click('Barbell bench press');
assert.match(await text(), /25kg/); // first set prefills from last time
assert.doesNotMatch(await text(), /3 x 8-10/); // no plan targets in freestyle
await click('Log set 1');
await click('Finish session');
await click('Done');

// Suggest a session. The test scripts the Groq stand-in's replies.
const groq = (code, content) => () => ({ getResponseCode: () => code, getContentText: () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) });
g.groq = groq(500, {});
await click('Today');
await click('Change session');
await click('Suggest a session');
assert.match(await text(), /heaviest set last time/);
await page.type('.overlay textarea', 'Chest, 20 minutes');
await click('Suggest');
await sleep(400);
assert.match(await text(), /Could not get a suggestion\. Try again\./);
g.groq = groq(200, { name: 'Chest in 20', exercises: [
  { exercise: 'barbell bench press', group: 'Chest', sets: 3, reps: '8-10', rest: '90s', kg: 40, cue: 'Feet flat on the floor' },
  { exercise: 'Cable fly', group: 'Chest', sets: 2, reps: '12', rest: '60s', kg: 15, cue: '' },
] });
await click('Try again');
await sleep(400);
const sent = JSON.stringify(g.groqRequests[g.groqRequests.length - 1].messages);
assert.match(sent, /Request: Chest, 20 minutes/);
assert.match(sent, /- Barbell bench press \| Chest \| last time 25 kg x 10/);
assert.ok(!sent.includes(key) && !/Knee|Cycled in/.test(sent.replace(/Knee to wall ankle rocks/g, '')), 'no key, injury or notes sent');
assert.match(await text(), /Chest in 20/);
assert.match(await text(), /Barbell bench press[\s\S]*3 x 8-10, rest 90s[\s\S]*Last time: 25 kg x 10/);
assert.match(await text(), /Cable fly[\s\S]*New[\s\S]*Suggested start: 15 kg[\s\S]*Added to your library when you start/);
await shot('16-suggest');
await click('Start session');
assert.match(await text(), /Chest in 20/);
assert.match(await text(), /3 x 8-10/);
assert.match(await text(), /25kg/); // history wins over the suggested 40 kg
await click('Cue and last time');
assert.match(await text(), /Suggested tip\s+Feet flat on the floor/i);
assert.doesNotMatch(await text(), /Suggested start/i);
await click('2. Cable fly, to do');
assert.match(await text(), /15kg/); // never done: the suggested weight
await click('Cue and last time');
assert.match(await text(), /No record yet\s*Suggested start\s+15 kg, a guess from similar exercises/i);
await click('Log set 1');
await click('Session menu');
await click('Finish session');
await click('Leave them');
await click('Done');
await click('Settings');
await click('Force sync');
await sleep(600);
const sg = log();
assert.ok(sg.library.some((l) => l.Exercise === 'Cable fly' && l.Group === 'Chest'), 'new exercise added on start');
const fly = sg.log.filter((r) => r.Exercise === 'Cable fly');
assert.deepEqual(fly.map((r) => [r.Kg, r.Reps, r.Status]), [[15, 12, 'done']]);
assert.equal(sg.sessions.find((x) => x.SessionID === fly[0].SessionID).Mode, 'freestyle');

// Chart needs two or more sessions. Add two older ones straight into the sheet, then refresh.
const old = (id, s, date, kg) => ({ id, op: 'log.append', row: { ClientID: id, LoggedAt: date + 'T10:00:00Z', SessionID: s, Date: date, Day: 'Mon', Exercise: 'Barbell bench press', PlannedExercise: '', Status: 'done', SetNo: 1, Kg: kg, Reps: 10, RPE: '', Note: '' } });
g.post({ key, action: 'sync', ops: [old('h1', 'old1', '2026-10-05', 20), old('h2', 'old2', '2026-11-02', 22.5)] });
await click('Settings');
await click('Force sync');
await sleep(600);
await click('History');
await click('Exercise');
await click('Barbell bench press');
assert.ok(await page.$('svg.chart'), 'chart drawn');
assert.equal(await page.$$eval('svg.chart circle', (c) => c.length), 4);
await click('Estimated 1RM');
assert.match(await page.$eval('svg.chart .bestlabel', (e) => e.textContent), /Best 36.7/);
await click('4 weeks');
assert.equal(await page.$$eval('svg.chart circle', (c) => c.length), 3);
await shot('14-chart');

// A session left for over 12 hours asks to be finished or discarded.
await click('Today');
await click('Start session');
await click('Log set 1');
await page.evaluate(() => new Promise((res) => {
  const rq = indexedDB.open('gymlog', 1);
  rq.onsuccess = () => {
    const tx = rq.result.transaction('kv', 'readwrite'); const st = tx.objectStore('kv'); const get = st.get('active');
    get.onsuccess = () => { const a = get.result; a.start = new Date(Date.now() - 13 * 3600e3).toISOString(); st.put(a, 'active'); };
    tx.oncomplete = () => { rq.result.close(); res(); };
  };
}));
// Opens with no signal (service worker shell) and offers Finish or Discard.
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(500);
try { await page.waitForFunction(() => document.body.innerText.length > 20, { timeout: 8000, polling: 200 }); }
catch (e) { console.log('DIAG', JSON.stringify(errors), JSON.stringify(await page.evaluate(async () => ({ sw: !!navigator.serviceWorker.controller, scripts: [...document.scripts].map((x) => x.src), app: document.getElementById('app').innerHTML.length, idb: await new Promise((r) => { const t = setTimeout(() => r('open hung'), 3000); const q = indexedDB.open('gymlog', 1); q.onblocked = () => r('blocked'); q.onsuccess = () => { clearTimeout(t); const g = q.result.transaction('kv').objectStore('kv').get('settings'); g.onsuccess = () => { r('ok ' + !!g.result); q.result.close(); }; }; q.onerror = () => r('err'); }), perf: performance.getEntriesByType('resource').map((r) => r.name.replace(location.origin, '') + ' ' + Math.round(r.duration)) })))); throw e; }
assert.match(await text(), /Finish yesterday's session\?/);
await shot('15-stale-offline');
await click('Discard');
assert.doesNotMatch(await text(), /Finish yesterday/);
await page.setOfflineMode(false);
await click('Settings');
await click('Force sync');
// The discard may still be in the sync backoff from the offline spell, so wait for it rather than a fixed time.
for (let i = 0; i < 25 && log().sessions.some((x) => !x.End); i++) { await sleep(200); if (i === 10) await click('Force sync'); }
const end = log();
assert.equal(end.log.filter((r) => r.Note === 'Cycled in').length, 3);
assert.equal(end.sessions.length, 4, JSON.stringify(end.sessions.map((s) => [s.SessionID.slice(0, 6), s.Mode, s.Day, s.Start, s.End, s.Note])));
assert.equal(end.sessions.filter((x) => x.Mode === 'freestyle').length, 2);
assert.ok(!end.sessions.some((x) => !x.End), 'discarded session is gone');
assert.equal(end.log.filter((r) => r.Exercise === 'Barbell bench press' && r.Status === 'swapped' && r.PlannedExercise === 'DB Bench Press').length, 3);
assert.match(end.sessions.find((x) => x.Mode === 'modified').Note, /^Warm-up done \| Knee/);
assert.ok(end.library.some((l) => l.Exercise === 'Barbell bench press' && l.Equipment === 'Barbell'));

assert.deepEqual(errors, []);
console.log('e2e passed:', end.log.length, 'log rows,', end.sessions.length, 'sessions');
await browser.close();
server.close();
