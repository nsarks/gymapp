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
await click('Change session');
assert.match(await text(), /Freestyle session/);
assert.equal((await text()).match(/Not done this week/g).length, 5);
await shot('02-change');
await click('Gym day 1');
assert.match(await text(), /Monday, Gym, Upper body/);
assert.match(await text(), /6 exercises, about 40 min/);
await click('Skip warm-up');
await click('Start session');
assert.match(await text(), /DB Bench Press/);
assert.match(await text(), /3 x 8-10/);
await shot('03-card');

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
assert.match(await text(), /4 exercises not logged/);
await shot('06-finish');
await click('Short on time');
await sleep(200);
assert.match(await text(), /Session finished/);
assert.match(await text(), /Offline, pending/);
await shot('07-summary');
assert.ok(log().log.length <= 3, 'nothing logged offline has reached the sheet yet');

await page.setOfflineMode(false);
await click('Sync now');
await sleep(500);
assert.match(await text(), /Sync status: Synced/);
await click('Done');

const b = log();
const ids = b.log.map((r) => r.ClientID);
assert.equal(new Set(ids).size, ids.length, 'no duplicate rows');
assert.equal(b.log.filter((r) => r.Exercise === 'DB Bench Press').length, 3);
assert.deepEqual(b.log.filter((r) => r.Exercise === 'DB Bench Press').map((r) => r.Kg), [25, 27.5, 27.5]);
const sw = b.log.find((r) => r.Exercise === 'Machine row');
assert.deepEqual([sw.Status, sw.PlannedExercise], ['swapped', 'Chest supported - DB row']);
assert.equal(b.log.filter((r) => r.Status === 'skipped').length, 5);
assert.equal(b.log.find((r) => r.Exercise === 'Incline Bench press').Note, 'Machine busy');
assert.equal(b.sessions.length, 1);
assert.deepEqual([b.sessions[0].Mode, b.sessions[0].Injury, b.sessions[0].Note], ['modified', true, 'Knee: felt sharp on step up']);
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
await click('Close');
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
await click('DB Bench Press');
assert.match(await text(), /25kg/); // first set prefills from last time
assert.doesNotMatch(await text(), /3 x 8-10/); // no plan targets in freestyle
await click('Log set 1');
await click('Finish session');
await click('Done');

// Chart needs two or more sessions. Add two older ones straight into the sheet, then refresh.
const old = (id, s, date, kg) => ({ id, op: 'log.append', row: { ClientID: id, LoggedAt: date + 'T10:00:00Z', SessionID: s, Date: date, Day: 'Mon', Exercise: 'DB Bench Press', PlannedExercise: '', Status: 'done', SetNo: 1, Kg: kg, Reps: 10, RPE: '', Note: '' } });
g.post({ key, action: 'sync', ops: [old('h1', 'old1', '2026-10-05', 20), old('h2', 'old2', '2026-11-02', 22.5)] });
await click('Settings');
await click('Force sync');
await sleep(600);
await click('History');
await click('Exercise');
await click('DB Bench Press');
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
    tx.oncomplete = res;
  };
}));
// Opens with no signal (service worker shell) and offers Finish or Discard.
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(500);
assert.match(await text(), /Finish yesterday's session\?/);
await shot('15-stale-offline');
await click('Discard');
assert.doesNotMatch(await text(), /Finish yesterday/);
await page.setOfflineMode(false);
await click('Settings');
await click('Force sync');
await sleep(600);
const end = log();
assert.equal(end.log.filter((r) => r.Note === 'Cycled in').length, 3);
assert.equal(end.sessions.length, 3);
assert.equal(end.sessions.filter((x) => x.Mode === 'freestyle').length, 1);
assert.ok(!end.sessions.some((x) => !x.End), 'discarded session is gone');

assert.deepEqual(errors, []);
console.log('e2e passed:', end.log.length, 'log rows,', end.sessions.length, 'sessions');
await browser.close();
server.close();
