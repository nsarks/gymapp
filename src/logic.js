// Pure helpers: dates, parsing Chloe's plan text, session picking and the sums behind history.

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Other'];
export const LOWER = ['Legs', 'Glutes'];

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
export const dayOf = (iso) => DAYS[(parseISO(iso).getDay() + 6) % 7];
export const mondayOf = (iso) => addDays(iso, -DAYS.indexOf(dayOf(iso)));
export const niceDate = (iso) => { const d = parseISO(iso); return `${dayOf(iso)} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export const maxNum = (text, fallback = null) => {
  const m = String(text ?? '').match(/\d+(\.\d+)?/g);
  return m ? Math.max(...m.map(Number)) : fallback;
};
// "2min" -> 120, "1-2mins" -> 120, "20-30s" -> 30. The upper value is used; the timer can be dismissed early.
export const restSeconds = (text) => {
  const n = maxNum(text);
  if (n == null) return 60;
  return /min/i.test(String(text)) ? n * 60 : n;
};
export const fmtKg = (n) => (n === '' || n == null ? '' : String(Math.round(Number(n) * 100) / 100));
export const fmtSet = (s) => `${fmtKg(s.kg)} x ${s.reps}`;
export const e1rm = (kg, reps) => Number(kg) * (1 + Number(reps) / 30);
const score = (s) => e1rm(s.kg, s.reps) + Number(s.reps) / 1000;
export const bestSet = (sets) => sets.reduce((b, s) => (!b || score(s) > score(b) ? s : b), null);
export const volumeOf = (sets) => sets.reduce((t, s) => t + (Number(s.kg) || 0) * (Number(s.reps) || 0), 0);
export const fmtDuration = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`);
export const listWords = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
export const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/* ---------- applying queued operations to local data ---------- */

export function applyOp(o, log, sessions, library) {
  const r = o.row || {};
  if (o.op === 'log.append') { if (!log[r.ClientID]) log[r.ClientID] = r; }
  else if (o.op === 'log.update') log[r.ClientID] = r;
  else if (o.op === 'log.delete') delete log[r.ClientID];
  else if (o.op === 'session.upsert') sessions[r.SessionID] = r;
  else if (o.op === 'session.delete') delete sessions[r.SessionID];
  else if (o.op === 'library.add') { if (!library.some((l) => sameName(l.Exercise, r.Exercise))) library.push(r); }
}

/* ---------- history ---------- */

// exercise name -> sessions that included it, oldest first: [{ sessionId, date, at, sets: [{id, setNo, kg, reps, rpe}] }]
export function buildHistory(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.Status === 'skipped' || r.SetNo === '' || r.SetNo == null) continue;
    let byS = map.get(r.Exercise);
    if (!byS) map.set(r.Exercise, (byS = new Map()));
    let g = byS.get(r.SessionID);
    if (!g) byS.set(r.SessionID, (g = { sessionId: r.SessionID, date: r.Date, at: '', sets: [] }));
    g.sets.push({ id: r.ClientID, setNo: Number(r.SetNo), kg: Number(r.Kg) || 0, reps: Number(r.Reps) || 0, rpe: r.RPE });
    if (String(r.LoggedAt) > g.at) g.at = String(r.LoggedAt);
  }
  const out = new Map();
  for (const [ex, byS] of map) {
    const list = [...byS.values()].sort((a, b) => (a.date + a.at).localeCompare(b.date + b.at));
    list.forEach((g) => g.sets.sort((a, b) => a.setNo - b.setNo));
    out.set(ex, list);
  }
  return out;
}

export const lastTime = (hist, exercise, notSession) => {
  const list = (hist.get(exercise) || []).filter((g) => g.sessionId !== notSession);
  return list[list.length - 1] || null;
};

export function sessionStats(rows) {
  const sets = rows.filter((r) => r.Status !== 'skipped' && r.SetNo !== '' && r.SetNo != null);
  return {
    volume: Math.round(volumeOf(sets.map((r) => ({ kg: r.Kg, reps: r.Reps })))),
    sets: sets.length,
    skipped: rows.filter((r) => r.Status === 'skipped').length,
    swapped: new Set(rows.filter((r) => r.Status === 'swapped').map((r) => r.Exercise)).size,
    added: new Set(rows.filter((r) => r.Status === 'added').map((r) => r.Exercise)).size,
  };
}

// Rows of one session grouped by exercise in the order they were done.
export function sessionExercises(rows) {
  const out = [];
  const idx = {};
  [...rows].sort((a, b) => String(a.LoggedAt).localeCompare(String(b.LoggedAt)) || (Number(a.SetNo) || 0) - (Number(b.SetNo) || 0)).forEach((r) => {
    const k = r.Exercise + '|' + (r.Status === 'skipped' ? 'skip' : 'sets');
    if (idx[k] === undefined) { idx[k] = out.length; out.push({ exercise: r.Exercise, status: r.Status, planned: r.PlannedExercise, rows: [] }); }
    out[idx[k]].rows.push(r);
  });
  return out;
}

// What beat last time, as plain text lines.
export function improvements(hist, sessionId) {
  const out = [];
  for (const [ex, list] of hist) {
    const i = list.findIndex((g) => g.sessionId === sessionId);
    if (i < 1) continue;
    const now = bestSet(list[i].sets), before = bestSet(list[i - 1].sets);
    if (now && before && score(now) > score(before) + 1e-9) out.push(`${ex}: ${fmtSet(now)} (was ${fmtSet(before)})`);
  }
  return out;
}

/* ---------- plan and session picking ---------- */

export const sessionModeLabel = { 'as planned': 'As planned', modified: 'Modified', freestyle: 'Freestyle' };

export const dayDone = (sessions, day, monday) =>
  sessions.find((s) => s.Day === day && s.Mode !== 'freestyle' && s.End && s.Date >= monday && s.Date <= addDays(monday, 6)) || null;

// Planned sessions ordered by calendar distance from today; on a tie the upcoming one comes first.
export function candidates(today, planDays, sessions) {
  const ti = DAYS.indexOf(dayOf(today));
  return planDays.map((pd) => {
    let off = DAYS.indexOf(pd.Day) - ti;
    if (off > 3) off -= 7;
    if (off < -3) off += 7;
    const date = addDays(today, off);
    return { ...pd, offset: off, date, done: !!dayDone(sessions, pd.Day, mondayOf(date)), doneThisWeek: !!dayDone(sessions, pd.Day, mondayOf(today)) };
  }).sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || b.offset - a.offset);
}
export const preselect = (cands) => cands.find((c) => !c.done) || cands[0] || null;

export const planFor = (plan, day, withWarm) =>
  plan.filter((p) => p.Day === day && (withWarm || p.Block !== 'Warm-up')).sort((a, b) => Number(a.Order) - Number(b.Order));

export function describeDay(pd, plan) {
  const main = planFor(plan, pd.Day, false);
  const warm = plan.filter((p) => p.Day === pd.Day && p.Block === 'Warm-up').length;
  const names = main.map((p) => p.Exercise);
  const auto = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : listWords(names);
  const secs = main.reduce((t, p) => t + (maxNum(p.Sets, 1)) * (restSeconds(p.Rest) + 40), 0);
  return {
    title: pd.SessionName || `${DAY_FULL[pd.Day]} session`,
    meta: [DAY_FULL[pd.Day], pd.Location, pd.Focus].filter(Boolean).join(', '),
    summary: String(pd.Summary || '').trim() || auto,
    count: main.length, warm,
    minutes: Math.max(5, Math.round(secs / 300) * 5),
  };
}

export const groupOf = (library, name) => (library.find((l) => sameName(l.Exercise, name)) || {}).Group || 'Other';

/* ---------- week views ---------- */

// One week as seven cells: done, partly, skipped, upcoming, none (not planned), free (freestyle only).
export function weekCells(monday, today, planDays, sessions) {
  return DAYS.map((day, i) => {
    const date = addDays(monday, i);
    const planned = planDays.some((p) => p.Day === day);
    const inWeek = sessions.filter((s) => s.Date >= monday && s.Date <= addDays(monday, 6));
    const s = inWeek.find((x) => x.Day === day && x.Mode !== 'freestyle');
    const free = inWeek.some((x) => x.Mode === 'freestyle' && x.Date === date);
    let state = 'none';
    if (planned) {
      if (s && s.End && !s._skips) state = 'done';
      else if (s) state = 'partly';
      else state = date < today ? 'skipped' : 'upcoming';
    } else if (free) state = 'free';
    return { day, date, planned, state, isToday: date === today };
  });
}

export function toCsv(rows, head) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
}
