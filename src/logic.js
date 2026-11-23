// Pure helpers: dates, parsing Chloe's plan text, session picking and the sums behind history.

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Other'];
export const LOWER = ['Legs', 'Glutes'];
export const GROUP_COLOURS = { Chest: '#EA580C', Back: '#2563EB', Shoulders: '#7C3AED', Arms: '#DB2777', Legs: '#0D9488', Glutes: '#C026D3', Core: '#CA8A04', Other: '#64748B' };
export const FOCUS_GRADIENT = {
  'Upper body': 'linear-gradient(135deg, #2563EB, #7C3AED)',
  'Lower body': 'linear-gradient(135deg, #0D9488, #16A34A)',
  'Full body': 'linear-gradient(135deg, #EA580C, #DB2777)',
};
export const DEFAULT_GRADIENT = 'linear-gradient(135deg, #0EA5E9, #16A34A)';

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

// factor(exercise) is 2 for dumbbell work, since dumbbell weights are logged per dumbbell.
export function sessionStats(rows, factor = () => 1) {
  const sets = rows.filter((r) => r.Status !== 'skipped' && r.SetNo !== '' && r.SetNo != null);
  return {
    volume: Math.round(sets.reduce((t, r) => t + (Number(r.Kg) || 0) * (Number(r.Reps) || 0) * factor(r.Exercise), 0)),
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

// One week as seven cells, judged only by what was done on each date, so the ticks count the days trained.
// done: that day's own planned session. partly: that session with skips, or still going.
// off: trained, but not that day's planned session (another day's session, freestyle, or a rest day).
// skipped, upcoming: a planned day with nothing done that date. none: a rest day with nothing done.
export function weekCells(monday, today, planDays, sessions) {
  return DAYS.map((day, i) => {
    const date = addDays(monday, i);
    const planned = planDays.some((p) => p.Day === day);
    const onDate = sessions.filter((s) => s.Date === date);
    const own = onDate.find((s) => s.Day === day && s.Mode !== 'freestyle');
    let state;
    if (own) state = own.End && !own._skips ? 'done' : 'partly';
    else if (onDate.length) state = 'off';
    else if (planned) state = date < today ? 'skipped' : 'upcoming';
    else state = 'none';
    return { day, date, planned, state, isToday: date === today };
  });
}

export function toCsv(rows, head) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
}

/* ---------- warm-up marker ---------- */

// The Sessions tab has no warm-up column, so the state rides at the front of the session note,
// where Chloe can read it too: "Warm-up done | Left bicep sore".
export const WARM = { done: 'Warm-up done', skipped: 'Warm-up skipped' };
export function splitNote(note) {
  const parts = String(note || '').split(' | ').map((p) => p.trim()).filter(Boolean);
  let warm = '';
  if (parts[0] === WARM.done) warm = 'done';
  else if (parts[0] === WARM.skipped) warm = 'skipped';
  return { warm, rest: (warm ? parts.slice(1) : parts).join(' | ') };
}
export const joinNote = (warm, ...rest) => [WARM[warm] || '', ...rest].filter(Boolean).join(' | ');

/* ---------- plain English session summary ---------- */

const libEntry = (library, name) => library.find((l) => sameName(l.Exercise, name)) || {};
// Dumbbell weights are logged per dumbbell, so volume counts both.
export const isDumbbell = (library, name) => {
  const eq = String(libEntry(library, name).Equipment || '');
  return eq ? /dumb/i.test(eq) : /\bDB\b|dumbbell/i.test(String(name));
};
export const volumeFactor = (library) => (name) => (isDumbbell(library, name) ? 2 : 1);

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const d = parseISO(iso); return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`; };
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const nums = (text) => (String(text ?? '').match(/\d+(\.\d+)?/g) || []).map(Number);
const isTimed = (repsText) => /\d\s*s\b|sec/i.test(String(repsText || ''));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// "3 x 12 at 14 kg", "3 sets at 60 kg: 8, 6 and 6 reps", "1 x 12 at 12 kg, then 2 x 12 at 10 kg"
export function describeSets(sets, { dumbbell = false, timed = false } = {}) {
  const groups = [];
  sets.forEach((s) => {
    const g = groups[groups.length - 1];
    if (g && g.kg === s.kg) g.reps.push(s.reps); else groups.push({ kg: s.kg, reps: [s.reps] });
  });
  const load = (kg) => (!kg ? 'bodyweight' : dumbbell ? `${fmtKg(kg)} kg dumbbells` : `${fmtKg(kg)} kg`);
  const unit = timed ? ' s' : '';
  const one = (g) => {
    const at = `${g.kg ? (dumbbell ? 'with' : 'at') : 'at'} ${load(g.kg)}`;
    if (g.reps.every((r) => r === g.reps[0])) return `${g.reps.length} x ${g.reps[0]}${unit} ${at}`;
    return `${g.reps.length} sets ${at}: ${listWords(g.reps.map(String))}${timed ? ' seconds' : ' reps'}`;
  };
  return groups.map(one).join(', then ');
}

/**
 * Builds the copy-and-paste summary for one session from logged data only.
 * session: Sessions row. rows: its Log rows. planDay: PlanDays row or null. plan: AppPlan rows.
 * hist: buildHistory of all rows, for the "up on last time" lines.
 */
export function sessionSummaryText({ session, rows, planDay, plan = [], library = [], hist = new Map() }) {
  const freestyle = session.Mode === 'freestyle';
  const dayPlan = planDay ? plan.filter((p) => p.Day === planDay.Day) : [];
  const planned = (name) => dayPlan.find((p) => sameName(p.Exercise, name));
  const warmNames = dayPlan.filter((p) => p.Block === 'Warm-up').map((p) => p.Exercise);
  const isWarmRow = (r) => warmNames.some((n) => sameName(n, r.Exercise));
  const { warm: warmMark, rest: noteText } = splitNote(session.Note);
  const warmLogged = rows.some((r) => isWarmRow(r) && r.Status !== 'skipped');
  const warm = warmMark || (warmLogged ? 'done' : '');

  const exercises = sessionExercises(rows.filter((r) => !isWarmRow(r)));
  const worked = exercises.filter((e) => e.status !== 'skipped');
  const skipped = exercises.filter((e) => e.status === 'skipped');
  const swaps = worked.filter((e) => e.status === 'swapped');
  const added = worked.filter((e) => e.status === 'added');
  const factor = volumeFactor(library);
  const setRows = worked.flatMap((e) => e.rows.map((r) => ({ ...r, _ex: e.exercise })));
  const volume = setRows.reduce((t, r) => t + (Number(r.Kg) || 0) * (Number(r.Reps) || 0) * factor(r._ex), 0);

  const title = freestyle ? 'Freestyle session'
    : planDay ? `${planDay.SessionName || DAY_FULL[planDay.Day] + ' session'}${planDay.Focus ? ` (${lower(planDay.Focus)})` : ''}`
    : `${DAY_FULL[session.Day] || ''} session`.trim();
  const out = [`Strength session: ${title}`];
  let when = longDate(session.Date);
  if (session.Start && session.End) {
    const mins = Math.max(1, Math.round((new Date(session.End) - new Date(session.Start)) / 60000));
    when += `, ${clock(session.Start)} to ${clock(session.End)} (${plural(mins, "minute")})`;
  }
  out.push(when);

  let shape;
  if (freestyle) shape = 'My own session, not from the plan.';
  else if (!swaps.length && !skipped.length && !added.length) shape = 'Followed the plan, no swaps or skips.';
  else {
    const bits = [];
    if (swaps.length) bits.push(plural(swaps.length, 'swap'));
    if (skipped.length) bits.push(`${skipped.length} skipped`);
    if (added.length) bits.push(`${added.length} added`);
    shape = `Changed the plan: ${listWords(bits)}.`;
  }
  out.push(`${shape} ${plural(worked.length, 'exercise')}, ${plural(setRows.length, 'working set')}, about ${(Math.round(volume / 100) * 100).toLocaleString('en-GB')} kg total volume.`);
  if (warm === 'done') out.push('Warm-up: done.');
  else if (warm === 'skipped') out.push('Warm-up: skipped.');
  out.push('');

  const flags = [];
  worked.forEach((e) => {
    const sets = e.rows.map((r) => ({ kg: Number(r.Kg) || 0, reps: Number(r.Reps) || 0 }));
    const p = planned(e.status === 'swapped' && e.planned ? e.planned : e.exercise);
    const timed = isTimed(p && p.Reps);
    let line = `- ${e.exercise}`;
    if (e.status === 'swapped') {
      const why = (e.rows.map((r) => String(r.Note || '').match(/^Swap reason: (.+)$/)).find(Boolean) || [])[1];
      line += ` (instead of ${e.planned}${why ? `, ${lower(why)}` : ''})`;
    } else if (e.status === 'added' && !freestyle) line += ' (added)';
    line += `: ${describeSets(sets, { dumbbell: isDumbbell(library, e.exercise), timed })}`;
    const range = p ? nums(p.Reps) : [];
    if (range.length) {
      const lo = Math.min(...range), hi = Math.max(...range);
      const target = lo === hi ? `${lo}` : `${lo} to ${hi}`;
      const below = sets.filter((s) => s.reps < lo).length;
      if (below) {
        line += ` (target ${target}${timed ? ' seconds' : ''})`;
        flags.push(`${e.exercise}: ${below === sets.length ? 'all sets' : `${below} of ${sets.length} sets`} below the ${target}${timed ? ' second' : ' rep'} target.`);
      }
    }
    out.push(line);
  });
  if (!worked.length) out.push('- Nothing logged.');
  if (skipped.length) {
    out.push('');
    out.push(`Skipped: ${skipped.map((e) => { const r = e.rows[0].Note; return r ? `${e.exercise} (${lower(r)})` : e.exercise; }).join('; ')}.`);
  }

  const ups = [];
  for (const e of worked) {
    const list = hist.get(e.exercise) || [];
    const i = list.findIndex((g) => g.sessionId === session.SessionID);
    if (i < 1) continue;
    const now = bestSet(list[i].sets), before = bestSet(list[i - 1].sets);
    if (!now || !before) continue;
    if (now.kg > before.kg) ups.push(`${e.exercise} +${fmtKg(now.kg - before.kg)} kg (${fmtSet(now)}, was ${fmtSet(before)})`);
    else if (now.kg === before.kg && now.reps > before.reps) ups.push(`${e.exercise} +${now.reps - before.reps} reps at ${fmtKg(now.kg)} kg`);
    if (ups.length === 3) break;
  }
  if (ups.length) { out.push(''); out.push(`Up on last time: ${ups.join('; ')}.`); }

  const notes = [];
  if ((session.Injury === true || session.Injury === 'TRUE') && !noteText) notes.push('Injury or niggle flagged.');
  if (noteText) notes.push(/[.!?]$/.test(noteText) ? noteText : noteText + '.');
  notes.push(...flags);
  if (notes.length) { out.push(''); out.push(`Notes: ${notes.join(' ')}`); }
  return out.join('\n');
}
