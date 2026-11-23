// The test site and the real app side by side on one origin, as on GitHub Pages (/ and /preview/).
// Checks both ways that they never share data, that the real service worker leaves /preview/ alone,
// and that the test site never calls a backend. Usage: npm run build && npm run build:test && node test/e2e-preview.mjs
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { start } from './server.mjs';

for (const f of ['dist/index.html', 'dist-preview/index.html']) assert.ok(fs.existsSync(f), `${f} missing: run npm run build and npm run build:test`);
// The real build must not contain the fake backend or the test data.
const realJs = fs.readdirSync('dist/assets').filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(`dist/assets/${f}`, 'utf8')).join('');
for (const s of ['PASTE_SHEET_ID_HERE', 'gymlog-preview', 'Test version', 'Equipment busy']) assert.ok(!realJs.includes(s), `real build contains "${s}"`);
assert.ok(!fs.existsSync('dist-preview/sw.js') && !fs.existsSync('dist-preview/manifest.webmanifest'), 'test site ships no worker or manifest');

const { server, g, key, url } = await start();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(ctx = browser) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('request', (r) => { if (r.method() === 'POST' || /script\.google/.test(r.url())) page.posts.push([page.url(), r.url()]); });
  page.posts = [];
  const click = async (text) => {
    const ok = await page.evaluate((text) => {
      const els = [...document.querySelectorAll('button')].filter((e) => !e.disabled && e.offsetParent !== null);
      const pool = document.querySelector('.overlay') ? els.filter((e) => e.closest('.overlay')) : els;
      const el = pool.find((e) => e.textContent.trim() === text) || pool.find((e) => (e.getAttribute('aria-label') || '') === text) || pool.find((e) => e.textContent.trim().startsWith(text));
      if (el) el.click();
      return !!el;
    }, text);
    assert.ok(ok, `could not find "${text}"`);
    await sleep(80);
  };
  const text = () => page.evaluate(() => document.body.innerText);
  const kv = (db, k) => page.evaluate((db, k) => new Promise((res) => {
    const rq = indexedDB.open(db, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => { const q = rq.result.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => { rq.result.close(); res(q.result ?? null); }; };
  }), db, k);
  const dbs = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
  return Object.assign(page, { click, text, kv, dbs });
}

// 1. The real app, connected, with its service worker in control.
const real = await newPage();
await real.goto(`${url}/`, { waitUntil: 'networkidle0' });
await real.click('Settings');
await real.type('input[type=url]', `${url}/api`);
await real.type('input[type=password]', key);
await real.click('Save and connect');
await sleep(300);
assert.match(await real.text(), /Connected/);
await real.evaluate(() => navigator.serviceWorker.ready);
await real.reload({ waitUntil: 'networkidle0' });
assert.ok(await real.evaluate(() => !!navigator.serviceWorker.controller), 'real worker controls the real app');
const realSettings = await real.kv('gymlog', 'settings');
assert.equal(realSettings.key, key);
await real.close();

// 2. The test site in the same browser: the real worker must pass it through to the network.
const apiPosts = g.posts.length;
const t = await newPage();
g.requests.length = 0;
await t.goto(`${url}/preview`, { waitUntil: 'networkidle0' }); // no trailing slash, as someone might type it
assert.equal(new URL(t.url()).pathname, '/preview/');
assert.equal(await t.title(), 'Gym log (test)', 'the test build, not the real app shell from the cache');
assert.ok(g.requests.includes('/preview/'), 'page came from the network');
assert.match(await t.text(), /Test version\. Invented data, not your sheet\./);
assert.doesNotMatch(await t.text(), /Connect your sheet/);
assert.match(await t.text(), /Synced/);
assert.equal(await t.$eval('meta[name=theme-color]', (m) => m.content), '#FACC15');
assert.equal(await t.$('link[rel=manifest]'), null);

// It keeps its own database and never sees the real one's settings.
assert.equal((await t.kv('gymlog-preview', 'settings')), null);
assert.ok(await t.kv('gymlog-preview', 'testSheet'), 'the fake sheet is saved');
await t.click('Settings');
assert.match(await t.text(), /Reset test data/);
assert.doesNotMatch(await t.text(), /Secret key|Script URL/);

// Invented history: sessions, weeks and summaries have something to show.
await t.click('History');
const sessionCount = await t.$$eval('.card.pick', (c) => c.length);
assert.ok(sessionCount >= 8, `${sessionCount} sessions`);
assert.match(await t.text(), /Freestyle/);
assert.match(await t.text(), /Modified/);
await t.click('Week');
assert.ok(await t.$$eval('.weekday.done', (c) => c.length) >= 3);
assert.ok(await t.$$eval('.weekday.skipped', (c) => c.length) >= 1);
await t.click('Sessions');
await t.click(await t.$eval('.card.pick h2', (e) => e.textContent));
await t.click('Show the text');
await sleep(100);
assert.match(await t.$eval('.summarytext', (e) => e.innerText), /^Strength session: /);
await t.click('Close').catch(() => {});

// Log a session in the test site.
await t.goto(`${url}/preview/`, { waitUntil: 'networkidle0' });
await t.click('Change session');
await t.click('Gym day 1');
await t.click('Start session');
await t.click('Log set 1');
await t.click('Session menu');
await t.click('Finish session');
await t.click('Leave them');
await t.click('Done');
await sleep(500);
await t.click('History');
assert.equal(await t.$$eval('.card.pick', (c) => c.length), sessionCount + 1);
assert.equal((await t.kv('gymlog-preview', 'queue')).length, 0, 'synced to the fake backend');
// Survives a reload (the fake sheet is kept in the browser).
await t.reload({ waitUntil: 'networkidle0' });
await t.click('History');
await sleep(300);
assert.equal(await t.$$eval('.card.pick', (c) => c.length), sessionCount + 1);

assert.deepEqual(t.posts, [], 'the test site sent no requests');
assert.equal(g.posts.length, apiPosts, 'the real backend heard nothing from the test site');
assert.deepEqual(await t.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname)), ['/'], 'only the real worker');

// Reset goes back to the invented data.
await t.click('Settings');
await t.click('Reset test data');
await t.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
await sleep(500);
await t.click('History');
await sleep(300);
assert.equal(await t.$$eval('.card.pick', (c) => c.length), sessionCount);
await t.close();

// 3. Back in the real app: nothing from the test site, settings intact.
const back = await newPage();
await back.goto(`${url}/`, { waitUntil: 'networkidle0' });
assert.equal(await back.title(), 'Gym log');
assert.doesNotMatch(await back.text(), /Test version/);
assert.deepEqual(await back.kv('gymlog', 'settings'), realSettings);
assert.equal((await back.kv('gymlog', 'queue') || []).length, 0);
assert.equal(Object.keys((await back.kv('gymlog', 'base')).sessions).length, 0, 'no test sessions in the real app');
assert.equal(g.post({ key, action: 'bootstrap' }).sessions.length, 0, 'no test sessions in the real sheet');
await back.click('History');
assert.match(await back.text(), /No sessions yet/);
await back.close();

// 4. The other way round, in a fresh profile: test site first, then the real app.
const ctx = await browser.createBrowserContext();
const t2 = await newPage(ctx);
await t2.goto(`${url}/preview/`, { waitUntil: 'networkidle0' });
assert.match(await t2.text(), /Test version/);
assert.equal(await t2.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0, 'no worker from the test site');
assert.deepEqual(await t2.dbs(), ['gymlog-preview']);
await t2.close();
const r2 = await newPage(ctx);
await r2.goto(`${url}/`, { waitUntil: 'networkidle0' });
assert.match(await r2.text(), /Connect your sheet/, 'the real app does not pick anything up from the test site');
assert.doesNotMatch(await r2.text(), /Test version/);
assert.equal(await r2.kv('gymlog', 'testSheet'), null);
await r2.close();
await ctx.close();

assert.deepEqual(errors, []);
console.log('e2e preview passed:', sessionCount, 'invented sessions');
await browser.close();
server.close();
