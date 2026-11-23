// App state, IndexedDB persistence, the sync queue and every action that changes a session.
import { useEffect, useState } from 'preact/hooks';
import {
  applyOp, buildHistory, sessionStats, lastTime, improvements, isoOf, dayOf, uuid, maxNum, restSeconds,
  planFor, groupOf, sameName, LOWER, joinNote, splitNote, volumeFactor, sessionSummaryText,
} from './logic.js';

// True in the test site build (vite build --mode preview): invented data, a fake backend and its own storage.
export const TEST = __TEST__;

/* ---------- IndexedDB (one key-value store) ---------- */

// The test site shares the origin with the real app, so it must use its own database.
let dbp, resetting = false;
const db = () => dbp || (dbp = new Promise((res, rej) => {
  const rq = indexedDB.open(TEST ? 'gymlog-preview' : 'gymlog', 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
  rq.onsuccess = () => res(rq.result);
  rq.onerror = () => rej(rq.error);
}));
const kvGet = async (k) => new Promise(async (res, rej) => {
  const rq = (await db()).transaction('kv').objectStore('kv').get(k);
  rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
});
const kvSet = async (k, v) => new Promise(async (res, rej) => {
  if (resetting) { res(); return; }
  const tx = (await db()).transaction('kv', 'readwrite');
  tx.objectStore('kv').put(JSON.parse(JSON.stringify(v ?? null)), k);
  tx.oncomplete = res; tx.onerror = () => rej(tx.error);
});

/* ---------- state ---------- */

export const S = {
  ready: false,
  settings: { url: '', key: '' },
  boot: { plan: [], planDays: [], library: [] },
  base: { log: {}, sessions: {} }, // what the sheet had at the last sync
  queue: [], // writes not yet confirmed by the sheet
  active: null, // session in progress
  prefs: { warm: true },
  sync: { state: 'idle', error: '', last: 0 },
  undo: null,
  summary: null,
  v: 0,
};
const KEYS = ['settings', 'boot', 'base', 'queue', 'active', 'prefs'];
const subs = new Set();
let viewCache = null;
export function emit() { S.v++; viewCache = null; subs.forEach((f) => f()); }
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    subs.add(f);
    f(); // catch any change that landed between the first render and subscribing (start-up race)
    return () => subs.delete(f);
  }, []);
  return S;
}
const save = (...keys) => keys.forEach((k) => kvSet(k, S[k]).catch(() => {}));

// Sheet data with the unsynced queue applied on top. The phone wins for rows it created.
export function view() {
  if (viewCache) return viewCache;
  const log = { ...S.base.log }, sessions = { ...S.base.sessions }, library = [...S.boot.library];
  S.queue.forEach((o) => applyOp(o, log, sessions, library));
  const rows = Object.values(log);
  const bySession = {};
  rows.forEach((r) => (bySession[r.SessionID] ||= []).push(r));
  const factor = volumeFactor(library);
  const list = Object.values(sessions).map((s) => {
    const st = sessionStats(bySession[s.SessionID] || [], factor);
    return { ...s, _stats: st, _skips: st.skipped };
  }).sort((a, b) => (b.Date + b.Start).localeCompare(a.Date + a.Start));
  return (viewCache = { rows, bySession, sessions: list, library, hist: buildHistory(rows) });
}

export async function init() {
  const vals = await Promise.all(KEYS.map((k) => kvGet(k).catch(() => null)));
  KEYS.forEach((k, i) => { if (vals[i]) S[k] = vals[i]; });
  if (TEST) S.settings = { url: 'test', key: '' }; // the fake backend needs no connection details
  S.ready = true;
  emit();
  addEventListener('online', () => { emit(); refresh(); });
  addEventListener('offline', emit);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  refresh();
}

/* ---------- network ---------- */

async function api(body) {
  const j = TEST ? await testApi(body) : await realApi(body);
  if (!j.ok) throw Object.assign(new Error(j.error === 'Request refused' ? 'Key not accepted. Check Settings.' : j.error || 'Request failed'), { server: true });
  return j;
}

// Test mode never reaches this, so it cannot call a real script URL.
async function realApi(body) {
  let res;
  try {
    res = await fetch(S.settings.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // a simple request, so no CORS preflight
      body: JSON.stringify({ key: S.settings.key, ...body }),
    });
  } catch (e) { throw new Error('No connection'); }
  if (!res.ok) throw new Error('No connection');
  let j;
  try { j = await res.json(); } catch (e) { throw Object.assign(new Error('Unexpected reply. Check the script URL in Settings.'), { server: true }); }
  return j;
}

async function testApi(body) {
  if (!TEST) throw new Error('Test backend in the real app');
  const { fakePost } = await import('./preview/fake.js');
  return fakePost(body, { get: kvGet, set: kvSet });
}

// Test site only: wipes its own database (never the real app's) and starts again from the invented data.
export async function resetTestData() {
  if (!TEST) return;
  clearTimeout(timer);
  resetting = true; // no more saves, so nothing lands after the wipe
  const d = await db();
  await new Promise((res, rej) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').clear();
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  location.reload();
}

let timer = null, running = null, fails = 0;
let holdUntil = 0, inAction = false; // nothing is sent while an undo is on offer
const inflight = new Set();
export function scheduleSync(ms = 6000) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

export function syncNow() {
  if (running) return running;
  if (!S.settings.url || !S.queue.length) return Promise.resolve();
  if (Date.now() < holdUntil) { scheduleSync(holdUntil - Date.now() + 200); return Promise.resolve(); }
  clearTimeout(timer);
  running = (async () => {
    S.sync = { ...S.sync, state: 'syncing' }; emit();
    try {
      while (S.queue.length) {
        const batch = S.queue.slice(0, 150);
        batch.forEach((o) => inflight.add(o.id));
        let res;
        try { res = await api({ action: 'sync', ops: batch }); } finally { inflight.clear(); }
        const done = new Set(res.applied);
        const applied = S.queue.filter((o) => done.has(o.id));
        applied.forEach((o) => applyOp(o, S.base.log, S.base.sessions, S.boot.library));
        S.queue = S.queue.filter((o) => !done.has(o.id));
        save('queue', 'base', 'boot');
        if (!applied.length) break;
      }
      fails = 0;
      S.sync = { state: 'ok', error: '', last: Date.now() };
    } catch (e) {
      fails++;
      S.sync = { ...S.sync, state: e.server ? 'error' : 'offline', error: e.message };
      if (!e.server) timer = setTimeout(syncNow, Math.min(300000, 5000 * 2 ** fails)); // backoff
    }
    running = null;
    emit();
  })();
  return running;
}

export async function bootstrap() {
  if (!S.settings.url) return false;
  try {
    const b = await api({ action: 'bootstrap' });
    S.boot = { plan: b.plan, planDays: b.planDays, library: b.library };
    S.base = { log: Object.fromEntries(b.log.map((r) => [r.ClientID, r])), sessions: Object.fromEntries(b.sessions.map((r) => [r.SessionID, r])) };
    S.sync = { state: 'ok', error: '', last: Date.now() };
    save('boot', 'base');
    emit();
    return true;
  } catch (e) {
    S.sync = { ...S.sync, state: e.server ? 'error' : 'offline', error: e.message };
    emit();
    return false;
  }
}

// Push anything pending, then pull fresh data.
export async function refresh() {
  if (!S.settings.url || !navigator.onLine) return;
  await syncNow();
  if (!S.queue.length) await bootstrap();
}

export async function saveSettings(url, key) {
  S.settings = { url: url.trim(), key: key.trim() };
  save('settings');
  emit();
  return bootstrap();
}

export const syncLabel = () => {
  if (!S.settings.url) return { text: 'Not set up', tone: 'warn' };
  if (S.sync.state === 'error') return { text: S.sync.error, tone: 'bad' };
  if (!navigator.onLine || (S.sync.state === 'offline' && S.queue.length)) return { text: S.queue.length ? `Offline, pending (${S.queue.length})` : 'Offline', tone: 'warn' };
  if (S.queue.length) return { text: `Pending (${S.queue.length})`, tone: 'warn' };
  return { text: 'Synced', tone: 'ok' };
};

/* ---------- queue ---------- */

function enqueue(op, row) {
  // Fold an edit into a write that has not been sent yet.
  if (!inAction && S.undo) { S.undo = null; holdUntil = 0; } // a new action ends the undo offer
  let q = null;
  if (op === 'log.update') q = S.queue.find((o) => !inflight.has(o.id) && (o.op === 'log.append' || o.op === 'log.update') && o.row.ClientID === row.ClientID);
  if (op === 'session.upsert') q = S.queue.find((o) => !inflight.has(o.id) && o.op === 'session.upsert' && o.row.SessionID === row.SessionID);
  if (q) { q.row = row; save('queue'); scheduleSync(); return q.id; }
  const o = { id: uuid(), op, row };
  S.queue.push(o);
  save('queue');
  scheduleSync();
  return o.id;
}

// Runs an action and offers a 5 second undo for it. Sync is held until the offer ends, so undo is a plain restore.
function undoable(label, fn) {
  const snapActive = JSON.stringify(S.active);
  const snapQueue = JSON.stringify(S.queue);
  inAction = true;
  try { fn(); } finally { inAction = false; }
  holdUntil = Date.now() + 5500;
  const token = uuid();
  S.undo = {
    token, label,
    run() {
      S.queue = JSON.parse(snapQueue);
      S.active = JSON.parse(snapActive);
      S.undo = null;
      holdUntil = 0;
      save('queue', 'active'); scheduleSync(); emit();
    },
  };
  setTimeout(() => { if (S.undo && S.undo.token === token) { S.undo = null; emit(); } }, 5000);
  save('active', 'queue'); scheduleSync(); emit();
}
export const dismissUndo = () => { S.undo = null; holdUntil = 0; emit(); syncNow(); };

/* ---------- session ---------- */

const libGroup = (name) => groupOf(view().library, name);
export const itemGroup = (it) => libGroup(it.exercise);
export const isLogged = (it) => it.sets.length > 0 || !!it.skipped || !!it.done;
export const isComplete = (it) => !!it.skipped || !!it.done || (it.finished && it.sets.length > 0) || (it.sets.length > 0 && it.sets.length >= (it.target || 1));
export const lastFor = (it) => lastTime(view().hist, it.exercise, S.active ? S.active.id : null);

export function modeOf(s) {
  if (s.freestyle) return 'freestyle';
  return s.removed || s.items.some((i) => i.kind !== 'planned' || i.skipped) ? 'modified' : 'as planned';
}
const sessionRow = (s) => ({
  SessionID: s.id, Date: s.date, Day: s.day, Mode: modeOf(s), Injury: !!s.injury,
  Note: joinNote(s.warm, s.injuryNote, s.note), Start: s.start, End: s.end,
});
function pushSession() { enqueue('session.upsert', sessionRow(S.active)); }

const newItem = (o) => ({
  key: uuid(), exercise: '', planned: '', kind: 'planned', block: 'Main', target: 0, setsText: '', reps: '', tempo: '',
  rest: '', cue: '', sets: [], skipped: null, note: '', draft: null, ...o,
});

export function startSession(pd, withWarm) {
  const today = isoOf(new Date());
  S.active = {
    id: uuid(), date: today, day: pd ? pd.Day : dayOf(today), freestyle: !pd, name: pd ? (pd.SessionName || pd.Day) : 'Freestyle',
    start: new Date().toISOString(), end: '', injury: false, injuryNote: '', note: '', cur: 0, timer: null,
    items: pd ? planFor(S.boot.plan, pd.Day, withWarm).map((p) => newItem({
      exercise: p.Exercise, planned: p.Exercise, block: p.Block, target: maxNum(p.Sets, 1), setsText: String(p.Sets), reps: String(p.Reps),
      tempo: p.Tempo, rest: p.Rest, cue: p.Cue,
    })) : [],
  };
  // '' until the warm-up is done; 'skipped' when the session starts without it.
  S.active.warm = pd && !withWarm && planFor(S.boot.plan, pd.Day, true).some((p) => p.Block === 'Warm-up') ? 'skipped' : '';
  S.prefs.warm = withWarm;
  S.summary = null;
  pushSession();
  save('active', 'prefs'); emit();
}

export function defaultDraft(it) {
  const prev = it.sets[it.sets.length - 1];
  const last = lastFor(it);
  const l = last && (last.sets[it.sets.length] || last.sets[last.sets.length - 1]);
  const top = maxNum(it.reps);
  return {
    kg: prev ? prev.kg : l ? l.kg : 0,
    reps: top != null ? top : prev ? prev.reps : l ? l.reps : 10,
    rpe: '',
  };
}
export const draftOf = (it) => it.draft || defaultDraft(it);
export function setDraft(key, patch) {
  const it = S.active.items.find((i) => i.key === key);
  it.draft = { ...draftOf(it), ...patch };
  save('active'); emit();
}

const setRow = (s, it, n, v, id) => ({
  ClientID: id, LoggedAt: new Date().toISOString(), SessionID: s.id, Date: s.date, Day: s.day, Exercise: it.exercise,
  PlannedExercise: it.kind === 'swapped' ? it.planned : '', Status: it.kind === 'planned' ? 'done' : it.kind,
  SetNo: n, Kg: Number(v.kg) || 0, Reps: Number(v.reps) || 0, RPE: v.rpe === '' || v.rpe == null ? '' : Number(v.rpe), Note: v.note || '',
});

export function logSet(key, vals) {
  const s = S.active, it = s.items.find((i) => i.key === key);
  const v = vals || draftOf(it);
  const id = uuid();
  const note = it.note; it.note = '';
  enqueue('log.append', setRow(s, it, it.sets.length + 1, { ...v, note }, id));
  if (it.block === 'Warm-up' && s.warm !== 'done') { s.warm = 'done'; pushSession(); }
  it.sets.push({ id, kg: Number(v.kg) || 0, reps: Number(v.reps) || 0, rpe: v.rpe ?? '', note });
  it.draft = null;
  const secs = restSeconds(it.rest);
  s.timer = { end: Date.now() + secs * 1000, total: secs };
  save('active'); emit();
}
// One tap for the whole warm-up instead of logging each mobility exercise.
export function markWarmDone() {
  undoable('Warm-up done.', () => {
    const s = S.active;
    s.warm = 'done';
    s.items.forEach((i) => { if (i.block === 'Warm-up' && !i.sets.length && !i.skipped) i.done = true; });
    const n = s.items.findIndex((i) => !isComplete(i));
    if (n >= 0) s.cur = n;
    pushSession();
  });
}
export function timerAdd(secs) { const t = S.active.timer; t.end = Math.max(t.end, Date.now()) + secs * 1000; t.total += secs; save('active'); emit(); }
export function timerClear() { if (S.active) { S.active.timer = null; save('active'); emit(); } }

// Edit or remove a set in the session in progress.
export function editSet(key, setId, patch) {
  const s = S.active, it = s.items.find((i) => i.key === key);
  const i = it.sets.findIndex((x) => x.id === setId);
  if (patch === null) {
    it.sets.splice(i, 1);
    enqueueDelete(setId);
    it.sets.forEach((x, n) => { if (n >= i) enqueue('log.update', { ...view().rows.find((r) => r.ClientID === x.id), SetNo: n + 1 }); });
  } else {
    Object.assign(it.sets[i], patch);
    const old = view().rows.find((r) => r.ClientID === setId);
    enqueue('log.update', { ...old, Kg: Number(it.sets[i].kg) || 0, Reps: Number(it.sets[i].reps) || 0, RPE: it.sets[i].rpe === '' ? '' : Number(it.sets[i].rpe) });
  }
  save('active'); emit();
}
function enqueueDelete(clientId) {
  const q = S.queue.find((o) => o.op === 'log.append' && o.row.ClientID === clientId && !inflight.has(o.id));
  if (q) { S.queue = S.queue.filter((o) => o !== q && !(o.op === 'log.update' && o.row.ClientID === clientId)); save('queue'); }
  else enqueue('log.delete', { ClientID: clientId });
}
// Edit a set from history.
export function updateRow(row, patch) { enqueue('log.update', { ...row, ...patch }); emit(); }

function skipRow(s, it, reason) {
  const id = uuid();
  enqueue('log.append', {
    ClientID: id, LoggedAt: new Date().toISOString(), SessionID: s.id, Date: s.date, Day: s.day, Exercise: it.exercise,
    PlannedExercise: it.planned || it.exercise, Status: 'skipped', SetNo: '', Kg: '', Reps: '', RPE: '',
    Note: [reason, it.note].filter(Boolean).join('. '),
  });
  it.skipped = { id, reason };
}
const advance = (s) => {
  const next = s.items.findIndex((i, n) => n > s.cur && !isComplete(i));
  if (next >= 0) s.cur = next;
};

export function skipItem(key, reason) {
  undoable('Skipped.', () => {
    const s = S.active, it = s.items.find((i) => i.key === key);
    skipRow(s, it, reason);
    if (s.items[s.cur] === it) advance(s);
    pushSession();
  });
}
export const lowerBodyLeft = () => (S.active ? S.active.items.filter((i) => i.block === 'Main' && !isLogged(i) && LOWER.includes(itemGroup(i))) : []);
export function skipLegs(reason) {
  const list = lowerBodyLeft();
  undoable(`Skipped ${list.length} ${list.length === 1 ? 'exercise' : 'exercises'}.`, () => {
    const s = S.active;
    list.forEach((it) => skipRow(s, it, reason));
    if (isComplete(s.items[s.cur])) advance(s);
    pushSession();
  });
}
export function unskip(key) {
  const it = S.active.items.find((i) => i.key === key);
  enqueueDelete(it.skipped.id);
  it.skipped = null;
  pushSession(); save('active'); emit();
}

export function addToLibrary(name, group, equipment) {
  if (!view().library.some((l) => sameName(l.Exercise, name))) enqueue('library.add', { Exercise: name.trim(), Group: group, Equipment: equipment || '', Unilateral: '' });
}

export function swapItem(key, name, reason) {
  undoable(`Swapped for ${name}.`, () => {
    const it = S.active.items.find((i) => i.key === key);
    if (!it.planned) it.planned = it.exercise;
    it.exercise = name;
    it.kind = sameName(name, it.planned) ? 'planned' : 'swapped';
    it.cue = ''; it.tempo = ''; it.draft = null;
    it.note = reason ? `Swap reason: ${reason}` : '';
    pushSession();
  });
}

export function addItem(name) {
  const s = S.active;
  const last = lastTime(view().hist, name, s.id);
  const it = newItem({
    exercise: name, kind: s.freestyle ? 'planned' : 'added',
    target: s.freestyle ? 0 : last ? last.sets.length : 3,
    reps: s.freestyle ? '' : String(last ? Math.max(...last.sets.map((x) => x.reps)) : 10),
    rest: '1min',
  });
  it.setsText = it.target ? String(it.target) : '';
  const at = s.items.length ? s.cur + 1 : 0;
  s.items.splice(at, 0, it);
  s.cur = at;
  pushSession(); save('active'); emit();
}

// Ends an exercise early, keeping the sets already logged.
export function finishItem(key) {
  undoable('Exercise finished.', () => {
    const s = S.active, it = s.items.find((i) => i.key === key);
    it.finished = true;
    if (s.items[s.cur] === it) advance(s);
  });
}

// Takes an exercise out of the session and deletes anything logged for it.
export function deleteItem(key) {
  const s = S.active, it = s.items.find((i) => i.key === key);
  undoable(`Removed ${it.exercise}.`, () => {
    it.sets.forEach((x) => enqueueDelete(x.id));
    if (it.skipped) enqueueDelete(it.skipped.id);
    const i = s.items.indexOf(it);
    s.items.splice(i, 1);
    if (it.kind === 'planned' && !s.freestyle) s.removed = (s.removed || 0) + 1;
    if (s.cur >= s.items.length) s.cur = Math.max(0, s.items.length - 1);
    else if (i < s.cur) s.cur--;
    if (s.timer && !s.items.length) s.timer = null;
    pushSession();
  });
}

// Deletes a past session and all its sets from the sheet.
export function deleteSession(id) {
  undoable('Session deleted.', () => {
    (view().bySession[id] || []).forEach((r) => enqueueDelete(r.ClientID));
    S.queue = S.queue.filter((o) => !(o.op === 'session.upsert' && o.row.SessionID === id && !inflight.has(o.id)));
    enqueue('session.delete', { SessionID: id });
  });
}

export function moveItem(key, dir) {
  const s = S.active, i = s.items.findIndex((x) => x.key === key), j = i + dir;
  if (j < 0 || j >= s.items.length) return;
  const cur = s.items[s.cur];
  [s.items[i], s.items[j]] = [s.items[j], s.items[i]];
  s.cur = s.items.indexOf(cur);
  save('active'); emit();
}
export function goTo(i) { S.active.cur = Math.max(0, Math.min(S.active.items.length - 1, i)); save('active'); emit(); }

export function setItemNote(key, text) {
  const it = S.active.items.find((i) => i.key === key);
  const lastSet = it.sets[it.sets.length - 1];
  if (lastSet) {
    lastSet.note = text;
    enqueue('log.update', { ...view().rows.find((r) => r.ClientID === lastSet.id), Note: text });
  } else it.note = text; // goes on the first set, or on the skip row
  save('active'); emit();
}

export function setInjury(area, text) {
  const s = S.active;
  s.injury = !!(area || text);
  s.injuryNote = [area, text].filter(Boolean).join(': ');
  pushSession(); save('active'); emit();
}

export const unloggedMain = (s) => s.items.filter((i) => i.block === 'Main' && !isLogged(i));

export function finishSession(skipReason, endAt) {
  const s = S.active;
  if (skipReason) unloggedMain(s).forEach((it) => skipRow(s, it, skipReason));
  s.end = endAt || new Date().toISOString();
  s.timer = null;
  const row = sessionRow(s);
  enqueue('session.upsert', row);
  S.active = null;
  S.undo = null;
  holdUntil = 0;
  save('active'); emit();
  const v = view();
  S.summary = {
    id: s.id, name: s.name, injuryNote: s.injuryNote, warm: s.warm, note: '', row,
    minutes: Math.max(1, Math.round((new Date(s.end) - new Date(s.start)) / 60000)),
    improved: improvements(v.hist, s.id),
  };
  emit();
  syncNow();
}

export function saveSummaryNote(text) {
  const m = S.summary;
  m.note = text;
  m.row = { ...m.row, Note: joinNote(m.warm, m.injuryNote, text) };
  enqueue('session.upsert', m.row);
  emit();
}

// A session left unfinished for over 12 hours: finish it as it stands, or throw it away.
export function finishStale() {
  const s = S.active;
  const times = s.items.flatMap((i) => i.sets.map((x) => (view().rows.find((r) => r.ClientID === x.id) || {}).LoggedAt)).filter(Boolean).sort();
  finishSession(null, times[times.length - 1] || s.start);
}
export function discardSession() {
  const s = S.active;
  (view().bySession[s.id] || []).forEach((r) => enqueueDelete(r.ClientID));
  S.queue = S.queue.filter((o) => !(o.op === 'session.upsert' && o.row.SessionID === s.id && !inflight.has(o.id)));
  if (S.base.sessions[s.id] || inflight.size) S.queue.push({ id: uuid(), op: 'session.delete', row: { SessionID: s.id } });
  S.active = null;
  save('queue', 'active'); scheduleSync(); emit();
}

/* ---------- corrections to a past session ---------- */

const SESSION_FIELDS = ['SessionID', 'Date', 'Day', 'Mode', 'Injury', 'Note', 'Start', 'End'];
const sessionOnly = (s) => Object.fromEntries(SESSION_FIELDS.map((k) => [k, s[k] ?? '']));

export function setSessionWarm(session, warm) {
  enqueue('session.upsert', { ...sessionOnly(session), Note: joinNote(warm, splitNote(session.Note).rest) });
  emit();
}

// Fixes an exercise logged under the wrong name. Against the plan it is recorded as a swap, so Chloe sees it.
export function renameExercise(session, rows, name) {
  rows.filter((r) => r.Status !== 'skipped').forEach((r) => {
    const planned = r.Status === 'swapped' ? r.PlannedExercise : r.Status === 'added' ? '' : r.Exercise;
    const back = planned && sameName(planned, name);
    enqueue('log.update', {
      ...r, Exercise: name,
      Status: r.Status === 'added' ? 'added' : back ? 'done' : 'swapped',
      PlannedExercise: r.Status === 'added' || back ? '' : planned,
    });
  });
  if (session.Mode === 'as planned') enqueue('session.upsert', { ...sessionOnly(session), Mode: 'modified' });
  emit();
}

// Plain English summary of a finished session, built from the logged rows.
export function summaryText(sessionId, fallback) {
  const v = view();
  const session = v.sessions.find((x) => x.SessionID === sessionId) || fallback;
  if (!session) return '';
  const planDay = session.Mode === 'freestyle' ? null : S.boot.planDays.find((p) => p.Day === session.Day) || null;
  return sessionSummaryText({ session, rows: v.bySession[sessionId] || [], planDay, plan: S.boot.plan, library: v.library, hist: v.hist });
}
