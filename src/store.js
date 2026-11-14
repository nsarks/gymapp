// App state, IndexedDB persistence, the sync queue and every action that changes a session.
import { useEffect, useState } from 'preact/hooks';
import {
  applyOp, buildHistory, sessionStats, lastTime, improvements, isoOf, dayOf, uuid, maxNum, restSeconds,
  planFor, groupOf, sameName, LOWER,
} from './logic.js';

/* ---------- IndexedDB (one key-value store) ---------- */

let dbp;
const db = () => dbp || (dbp = new Promise((res, rej) => {
  const rq = indexedDB.open('gymlog', 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
  rq.onsuccess = () => res(rq.result);
  rq.onerror = () => rej(rq.error);
}));
const kvGet = async (k) => new Promise(async (res, rej) => {
  const rq = (await db()).transaction('kv').objectStore('kv').get(k);
  rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
});
const kvSet = async (k, v) => new Promise(async (res, rej) => {
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
  useEffect(() => { const f = () => set((x) => x + 1); subs.add(f); return () => subs.delete(f); }, []);
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
  const list = Object.values(sessions).map((s) => {
    const st = sessionStats(bySession[s.SessionID] || []);
    return { ...s, _stats: st, _skips: st.skipped };
  }).sort((a, b) => (b.Date + b.Start).localeCompare(a.Date + a.Start));
  return (viewCache = { rows, bySession, sessions: list, library, hist: buildHistory(rows) });
}

export async function init() {
  const vals = await Promise.all(KEYS.map((k) => kvGet(k).catch(() => null)));
  KEYS.forEach((k, i) => { if (vals[i]) S[k] = vals[i]; });
  S.ready = true;
  emit();
  addEventListener('online', () => { emit(); refresh(); });
  addEventListener('offline', emit);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  refresh();
}

/* ---------- network ---------- */

async function api(body) {
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
  if (!j.ok) throw Object.assign(new Error(j.error === 'Request refused' ? 'Key not accepted. Check Settings.' : j.error || 'Request failed'), { server: true });
  return j;
}

let timer = null, running = null, fails = 0;
const inflight = new Set();
export function scheduleSync(ms = 6000) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

export function syncNow() {
  if (running) return running;
  if (!S.settings.url || !S.queue.length) return Promise.resolve();
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
  const idField = op.startsWith('log.') ? 'ClientID' : op.startsWith('session.') ? 'SessionID' : null;
  if (idField && (op === 'log.update' || op === 'session.upsert')) {
    const q = S.queue.find((o) => !inflight.has(o.id) && o.row[idField] === row[idField] && (o.op === op || o.op === 'log.append'));
    if (q) { q.row = row; save('queue'); scheduleSync(); return q.id; }
  }
  const o = { id: uuid(), op, row };
  S.queue.push(o);
  save('queue');
  scheduleSync();
  return o.id;
}

// Runs an action and offers a 5 second undo for it.
function undoable(label, fn) {
  const snap = JSON.stringify(S.active);
  const before = new Set(S.queue.map((o) => o.id));
  const queuedRows = JSON.stringify(S.queue);
  fn();
  const added = S.queue.filter((o) => !before.has(o.id));
  const token = uuid();
  S.undo = {
    token, label,
    run() {
      added.forEach((o) => {
        const pending = S.queue.includes(o) && !inflight.has(o.id);
        if (pending) S.queue = S.queue.filter((x) => x !== o);
        else if (o.op === 'log.append') S.queue.push({ id: uuid(), op: 'log.delete', row: { ClientID: o.row.ClientID } });
      });
      // Put back any queued rows the action folded an edit into.
      JSON.parse(queuedRows).forEach((old) => { const q = S.queue.find((x) => x.id === old.id); if (q) q.row = old.row; });
      S.active = JSON.parse(snap);
      S.undo = null;
      if (S.active) pushSession();
      save('queue', 'active'); scheduleSync(); emit();
    },
  };
  setTimeout(() => { if (S.undo && S.undo.token === token) { S.undo = null; emit(); } }, 5000);
  save('active'); emit();
}
export const dismissUndo = () => { S.undo = null; emit(); };

/* ---------- session ---------- */

const libGroup = (name) => groupOf(view().library, name);
export const itemGroup = (it) => libGroup(it.exercise);
export const isLogged = (it) => it.sets.length > 0 || !!it.skipped;
export const isComplete = (it) => !!it.skipped || (it.sets.length > 0 && it.sets.length >= (it.target || 1));
export const lastFor = (it) => lastTime(view().hist, it.exercise, S.active ? S.active.id : null);

export function modeOf(s) {
  if (s.freestyle) return 'freestyle';
  return s.items.some((i) => i.kind !== 'planned' || i.skipped) ? 'modified' : 'as planned';
}
const sessionRow = (s) => ({
  SessionID: s.id, Date: s.date, Day: s.day, Mode: modeOf(s), Injury: !!s.injury,
  Note: [s.injuryNote, s.note].filter(Boolean).join(' | '), Start: s.start, End: s.end,
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
  it.sets.push({ id, kg: Number(v.kg) || 0, reps: Number(v.reps) || 0, rpe: v.rpe ?? '', note });
  it.draft = null;
  const secs = restSeconds(it.rest);
  s.timer = { end: Date.now() + secs * 1000, total: secs };
  save('active'); emit();
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
  save('active'); emit();
  const v = view();
  S.summary = {
    id: s.id, name: s.name, injuryNote: s.injuryNote, note: '', row,
    minutes: Math.max(1, Math.round((new Date(s.end) - new Date(s.start)) / 60000)),
    improved: improvements(v.hist, s.id),
  };
  emit();
  syncNow();
}

export function saveSummaryNote(text) {
  const m = S.summary;
  m.note = text;
  m.row = { ...m.row, Note: [m.injuryNote, text].filter(Boolean).join(' | ') };
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
