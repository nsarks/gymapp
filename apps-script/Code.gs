/**
 * Gym log backend. Standalone Apps Script web app (script.google.com, not bound to the sheet).
 *
 * Deploy: Execute as "Me", access "Anyone". Every request must carry the secret key in its body.
 * Run setup() once by hand. It creates the app tabs, seeds the plan and prints the key once.
 *
 * This script only ever writes to the tabs listed in HEADERS plus Progress. Chloe's tabs are read, never written.
 */

// The spreadsheet to use. Point this at a COPY first, then at the real sheet.
const SHEET_ID = 'PASTE_SHEET_ID_HERE';

// Chloe already has a tab called PLAN, and Google Sheets tab names are not case sensitive,
// so the app's plan tab is called AppPlan.
const HEADERS = {
  AppPlan: ['PlanID', 'Day', 'Order', 'Block', 'Exercise', 'Sets', 'Reps', 'Tempo', 'Rest', 'Cue'],
  PlanDays: ['Day', 'SessionName', 'Location', 'Focus', 'Summary'],
  Log: ['ClientID', 'LoggedAt', 'SessionID', 'Date', 'Day', 'Exercise', 'PlannedExercise', 'Status', 'SetNo', 'Kg', 'Reps', 'RPE', 'Note'],
  Sessions: ['SessionID', 'Date', 'Day', 'Mode', 'Injury', 'Note', 'Start', 'End'],
  Library: ['Exercise', 'Group', 'Equipment', 'Unilateral'],
};
const PROGRESS = 'Progress';
// Columns held as plain text so nothing typed on the phone can turn into a formula.
const TEXT_COLS = {
  AppPlan: ['A:B', 'D:J'],
  PlanDays: ['A:E'],
  Log: ['A:C', 'E:H', 'M:M'],
  Sessions: ['A:A', 'C:D', 'F:H'],
  Library: ['A:C'],
};
const DATE_COLS = { Log: 'D:D', Sessions: 'B:B' };
const NUMBER_FIELDS = { Log: { SetNo: 1, Kg: 1, Reps: 1, RPE: 1 }, AppPlan: { Order: 1 } };
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

/* ---------- entry points ---------- */

function doGet() {
  return ContentService.createTextOutput('Gym log is running.');
}

function doPost(e) {
  let out;
  let req = null;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    req = null;
  }
  if (!req || !keyOk_(req.key)) {
    out = { ok: false, error: 'Request refused' };
  } else {
    try {
      if (req.action === 'bootstrap') out = bootstrap_();
      else if (req.action === 'sync') out = sync_(Array.isArray(req.ops) ? req.ops : []);
      else out = { ok: false, error: 'Unknown action' };
    } catch (err) {
      out = { ok: false, error: 'Server error: ' + (err && err.message ? err.message : 'unknown') };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function keyOk_(given) {
  const real = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!real || typeof given !== 'string' || given.length !== real.length) return false;
  let diff = 0;
  for (let i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/* ---------- sheet helpers ---------- */

function book_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

// Exact, case sensitive lookup. getSheetByName could hand back Chloe's PLAN tab for "Plan".
function findSheet_(ss, name) {
  const all = ss.getSheets();
  for (let i = 0; i < all.length; i++) if (all[i].getName() === name) return all[i];
  return null;
}

function isAppTab_(name) {
  return name === PROGRESS || Object.prototype.hasOwnProperty.call(HEADERS, name);
}

// The only way this script gets a sheet it will write to.
function appSheet_(ss, name) {
  if (!isAppTab_(name)) throw new Error('Refusing to touch sheet "' + name + '"');
  const sheet = findSheet_(ss, name);
  if (!sheet) throw new Error('Tab "' + name + '" is missing. Run setup().');
  return sheet;
}

function isoDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v == null ? '' : v).slice(0, 10);
}

function addDays_(iso, n) {
  const p = iso.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.toISOString().slice(0, 10);
}

function readRows_(ss, name) {
  const sheet = appSheet_(ss, name);
  const head = HEADERS[name];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = ss.getSpreadsheetTimeZone();
  const values = sheet.getRange(2, 1, last - 1, head.length).getValues();
  const rows = [];
  values.forEach(function (r) {
    if (r[0] === '' || r[0] == null) return;
    const o = {};
    head.forEach(function (k, i) {
      let v = r[i];
      if (k === 'Date') v = v === '' ? '' : isoDate_(v, tz);
      else if (v instanceof Date) v = v.toISOString();
      o[k] = v;
    });
    rows.push(o);
  });
  return rows;
}

function toRow_(name, obj) {
  return HEADERS[name].map(function (k) {
    let v = obj ? obj[k] : '';
    if (v === undefined || v === null) v = '';
    if (k === 'Injury') return v === true || v === 'TRUE' ? true : '';
    if (k === 'Unilateral') return v === true || v === 'TRUE' ? true : '';
    if (k === 'Date') return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '';
    if (NUMBER_FIELDS[name] && NUMBER_FIELDS[name][k]) {
      if (v === '') return '';
      const n = Number(v);
      return isFinite(n) ? n : '';
    }
    return String(v).slice(0, 500);
  });
}

/* ---------- bootstrap ---------- */

function bootstrap_() {
  const ss = book_();
  const tz = ss.getSpreadsheetTimeZone();
  const plan = readRows_(ss, 'AppPlan');
  const planDays = readRows_(ss, 'PlanDays');
  const library = readRows_(ss, 'Library');
  const log = readRows_(ss, 'Log');
  const sessions = readRows_(ss, 'Sessions');

  const now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const dow = Number(Utilities.formatDate(now, tz, 'u')); // 1 = Monday
  const monday = addDays_(today, 1 - dow);

  const weekStatus = planDays.map(function (d) {
    const hit = sessions.filter(function (s) {
      return s.Day === d.Day && s.Mode !== 'freestyle' && s.End && s.Date >= monday && s.Date <= addDays_(monday, 6);
    })[0];
    return { Day: d.Day, done: !!hit, date: hit ? hit.Date : '' };
  });

  // For each exercise, the sets from its most recent session.
  const groups = {}; // exercise -> session -> { date, at, sets }
  log.forEach(function (r) {
    if (r.Status === 'skipped' || r.SetNo === '') return;
    const byEx = groups[r.Exercise] || (groups[r.Exercise] = {});
    const g = byEx[r.SessionID] || (byEx[r.SessionID] = { date: r.Date, at: '', sets: [] });
    g.sets.push({ setNo: r.SetNo, kg: r.Kg, reps: r.Reps, rpe: r.RPE });
    if (String(r.LoggedAt) > g.at) g.at = String(r.LoggedAt);
  });
  const lastPerformance = {};
  Object.keys(groups).forEach(function (ex) {
    let best = null;
    Object.keys(groups[ex]).forEach(function (sid) {
      const g = groups[ex][sid];
      if (!best || g.date + g.at > best.date + best.at) best = g;
    });
    best.sets.sort(function (a, b) { return a.setNo - b.setNo; });
    lastPerformance[ex] = { date: best.date, sets: best.sets.map(function (s) { return { kg: s.kg, reps: s.reps, rpe: s.rpe }; }) };
  });

  const recentSessions = sessions.slice().sort(function (a, b) {
    return (b.Date + b.Start).localeCompare(a.Date + a.Start);
  }).slice(0, 10);

  return {
    ok: true, today: today, plan: plan, planDays: planDays, library: library,
    weekStatus: weekStatus, lastPerformance: lastPerformance, recentSessions: recentSessions,
    sessions: sessions, log: log,
  };
}

/* ---------- sync ---------- */

function sync_(ops) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = book_();
    const applied = [];
    applyKeyed_(ss, 'Log', 'ClientID', ops, { 'log.append': 'append', 'log.update': 'upsert', 'log.delete': 'delete' }, applied);
    applyKeyed_(ss, 'Sessions', 'SessionID', ops, { 'session.upsert': 'upsert' }, applied);
    applyKeyed_(ss, 'Library', 'Exercise', ops, { 'library.add': 'append' }, applied);
    return { ok: true, applied: applied };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Applies the ops for one tab in order, with one read of the key column and batched writes.
 * append: ignored if the key already exists (idempotent). upsert: replace or add. delete: remove if present.
 */
function applyKeyed_(ss, name, keyField, ops, kinds, applied) {
  const mine = ops.filter(function (o) { return o && kinds[o.op]; });
  if (!mine.length) return;
  const sheet = appSheet_(ss, name);
  const width = HEADERS[name].length;
  const last = sheet.getLastRow();
  const where = {}; // key -> sheet row number, or 'n' + index into fresh
  const norm = function (k) { return name === 'Library' ? String(k).trim().toLowerCase() : String(k); };
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) {
      if (r[0] !== '') where[norm(r[0])] = i + 2;
    });
  }
  const fresh = [];
  const updates = {};
  const deletes = {};
  mine.forEach(function (o) {
    const kind = kinds[o.op];
    const key = norm(o.row && o.row[keyField] != null ? o.row[keyField] : (o.key || ''));
    if (key) {
      const at = where[key];
      if (kind === 'delete') {
        if (typeof at === 'number') { deletes[at] = true; delete updates[at]; }
        else if (at) fresh[Number(at.slice(1))] = null;
        delete where[key];
      } else if (at === undefined) {
        where[key] = 'n' + fresh.length;
        fresh.push(toRow_(name, o.row));
      } else if (kind === 'upsert') {
        if (typeof at === 'number') updates[at] = toRow_(name, o.row);
        else fresh[Number(at.slice(1))] = toRow_(name, o.row);
      }
    }
    if (o.id) applied.push(o.id);
  });
  Object.keys(updates).forEach(function (r) {
    sheet.getRange(Number(r), 1, 1, width).setValues([updates[r]]);
  });
  const rows = fresh.filter(function (r) { return r; });
  if (rows.length) sheet.getRange(last + 1, 1, rows.length, width).setValues(rows);
  Object.keys(deletes).map(Number).sort(function (a, b) { return b - a; }).forEach(function (r) {
    sheet.deleteRow(r);
  });
}

/* ---------- setup (run once by hand) ---------- */

function setup() {
  const ss = book_();
  Object.keys(HEADERS).forEach(function (name) { ensureTab_(ss, name); });
  const seeded = seedPlan_(ss);
  seedLibrary_(ss);
  buildProgress_(ss);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('KEY')) {
    const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('KEY', key);
    Logger.log('SECRET KEY (shown once, paste it into the app Settings): ' + key);
  } else {
    Logger.log('A key already exists and is not shown again. Run resetKey() if you need a new one.');
  }
  Logger.log(seeded ? 'Plan seeded: ' + seeded + ' rows.' : 'Plan already had rows, left as it was.');
}

function resetKey() {
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('KEY', key);
  Logger.log('NEW SECRET KEY (shown once): ' + key);
}

function ensureTab_(ss, name) {
  if (!isAppTab_(name)) throw new Error('Refusing to create sheet "' + name + '"');
  let sheet = findSheet_(ss, name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name, ss.getSheets().length);
  const head = HEADERS[name];
  if (head) {
    (TEXT_COLS[name] || []).forEach(function (a1) { sheet.getRange(a1).setNumberFormat('@'); });
    if (DATE_COLS[name]) sheet.getRange(DATE_COLS[name]).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function clean_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function nameKey_(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Reads one of Chloe's tabs. Read only.
function readSourceTab_(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  range.getMergedRanges().forEach(function (m) {
    const r0 = m.getRow() - 1, c0 = m.getColumn() - 1;
    const v = values[r0] ? values[r0][c0] : '';
    for (let r = r0; r < r0 + m.getNumRows() && r < values.length; r++) {
      for (let c = c0; c < c0 + m.getNumColumns() && c < values[r].length; c++) values[r][c] = v;
    }
  });
  let headRow = -1;
  const col = {};
  for (let r = 0; r < values.length && headRow < 0; r++) {
    const labels = values[r].map(function (v) { return clean_(v).toUpperCase(); });
    if (labels.indexOf('EXERCISE') >= 0 && labels.indexOf('SETS') >= 0) {
      headRow = r;
      labels.forEach(function (l, i) { if (l && col[l] === undefined) col[l] = i; });
    }
  }
  if (headRow < 0) return [];
  const get = function (row, label) { return col[label] === undefined ? '' : clean_(row[col[label]]); };
  const blank = function (v) { return v === '' || v === '/'; };
  const out = [];
  const seen = {};
  for (let r = headRow + 1; r < values.length; r++) {
    const row = values[r];
    const exercise = get(row, 'EXERCISE');
    if (!exercise || exercise.toUpperCase() === 'EXERCISE') continue;
    let reps = get(row, 'REPS');
    const sets = get(row, 'SETS');
    const duration = get(row, 'DURATION');
    if (blank(reps) && blank(sets) && blank(duration)) continue; // a note, not an exercise
    if (seen[nameKey_(exercise)]) continue;
    seen[nameKey_(exercise)] = true;
    if (blank(reps)) reps = blank(duration) ? '' : duration;
    const tempo = get(row, 'TEMPO');
    out.push({
      Exercise: exercise, Sets: blank(sets) ? '' : sets, Reps: reps,
      Tempo: blank(tempo) ? '' : tempo, Rest: get(row, 'REST'), Cue: get(row, 'COMMENTS'),
    });
  }
  return out;
}

function guessGroup_(name) {
  const n = name.toLowerCase();
  if (/face\s*pull|shoulder|lateral|overhead|arm circle|rear delt/.test(n)) return 'Shoulders';
  if (/squat|sit.to.stand|lunge|calf|leg|hamstr|hamtr|bulgarian|step|deadlift|ankle|knee/.test(n)) return 'Legs';
  if (/glute|clam|hip thrust|bridge/.test(n)) return 'Glutes';
  if (/curl|tricep|dip|pushdown|skull/.test(n)) return 'Arms';
  if (/row|pull|lat\b|chin/.test(n)) return 'Back';
  if (/bench|chest|press|push.?up|fly/.test(n)) return 'Chest';
  if (/plank|balance|crunch|core|dead bug|sit.?up/.test(n)) return 'Core';
  return 'Other';
}

function guessEquipment_(name) {
  const n = name.toLowerCase();
  if (/\bdb\b|dumbbell/.test(n)) return 'Dumbbell';
  if (/cable|face\s*pull/.test(n)) return 'Cable';
  if (/machine|lat pull/.test(n)) return 'Machine';
  if (/band/.test(n)) return 'Band';
  return '';
}

function listWords_(items) {
  const low = items.map(function (s, i) { return i ? s.toLowerCase() : s; });
  if (low.length < 2) return low.join('');
  return low.slice(0, -1).join(', ') + ' and ' + low[low.length - 1];
}

// Seeds AppPlan and PlanDays from Chloe's tabs, by TAB NAME (her Friday tab has a mistyped heading).
function seedPlan_(ss) {
  const planSheet = appSheet_(ss, 'AppPlan');
  if (planSheet.getLastRow() > 1) return 0;
  let warm = [];
  const days = {};
  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (isAppTab_(name)) return;
    const m = name.match(/^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s*(?:\(([^)]*)\))?/i);
    if (m) days[DAY_NAMES[m[1].toLowerCase()]] = { location: clean_(m[2] || ''), rows: readSourceTab_(sheet) };
    else if (/warm\s*-?\s*up/i.test(name)) warm = readSourceTab_(sheet);
  });

  const canon = {}; // one spelling per exercise across the whole plan
  const fix = function (row) {
    const k = nameKey_(row.Exercise);
    if (!canon[k]) canon[k] = row.Exercise;
    row.Exercise = canon[k];
    return row;
  };
  const planRows = [];
  const dayRows = [];
  let gym = 0, home = 0;
  DAY_ORDER.forEach(function (day) {
    const d = days[day];
    if (!d || !d.rows.length) return;
    let order = 0;
    const add = function (block, row) {
      order++;
      row = fix(row);
      planRows.push(toRow_('AppPlan', {
        PlanID: day + '-' + (order < 10 ? '0' : '') + order, Day: day, Order: order, Block: block,
        Exercise: row.Exercise, Sets: row.Sets, Reps: row.Reps, Tempo: row.Tempo, Rest: row.Rest, Cue: row.Cue,
      }));
    };
    warm.forEach(function (w) { add('Warm-up', Object.assign({}, w)); });
    d.rows.forEach(function (w) { add('Main', w); });

    const loc = d.location.toLowerCase();
    let sessionName;
    if (loc === 'gym') sessionName = 'Gym day ' + (++gym);
    else if (loc === 'home') sessionName = 'Home workout ' + String.fromCharCode(65 + home++);
    else sessionName = day + ' session';
    const count = {};
    d.rows.forEach(function (w) { const g = guessGroup_(w.Exercise); count[g] = (count[g] || 0) + 1; });
    const upper = (count.Chest || 0) + (count.Back || 0) + (count.Shoulders || 0) + (count.Arms || 0);
    const lower = (count.Legs || 0) + (count.Glutes || 0);
    const total = d.rows.length;
    const focus = upper >= 0.7 * total ? 'Upper body' : (lower + (count.Core || 0) >= 0.7 * total && lower > 0 ? 'Lower body' : 'Full body');
    const groups = Object.keys(count).filter(function (g) { return g !== 'Other'; })
      .sort(function (a, b) { return count[b] - count[a]; }).slice(0, 4);
    dayRows.push(toRow_('PlanDays', {
      Day: day, SessionName: sessionName, Location: loc ? loc.charAt(0).toUpperCase() + loc.slice(1) : '',
      Focus: focus, Summary: listWords_(groups),
    }));
  });
  if (planRows.length) planSheet.getRange(2, 1, planRows.length, planRows[0].length).setValues(planRows);
  const daySheet = appSheet_(ss, 'PlanDays');
  if (daySheet.getLastRow() < 2 && dayRows.length) daySheet.getRange(2, 1, dayRows.length, dayRows[0].length).setValues(dayRows);
  return planRows.length;
}

function seedLibrary_(ss) {
  const sheet = appSheet_(ss, 'Library');
  if (sheet.getLastRow() > 1) return;
  const seen = {};
  const rows = [];
  readRows_(ss, 'AppPlan').forEach(function (p) {
    const k = nameKey_(p.Exercise);
    if (seen[k]) return;
    seen[k] = true;
    rows.push(toRow_('Library', {
      Exercise: p.Exercise, Group: guessGroup_(p.Exercise), Equipment: guessEquipment_(p.Exercise),
      Unilateral: /\bsl\b|single|side|split|bulgarian|clam/i.test(p.Exercise),
    }));
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

// Progress is formulas only. The script writes the formulas once here and never touches the tab again.
function buildProgress_(ss) {
  let sheet = findSheet_(ss, PROGRESS);
  if (sheet) return;
  sheet = ss.insertSheet(PROGRESS, ss.getSheets().length);
  const N = 60;
  const sel = 'Log!$F$2:$F=$A{r},ISNUMBER(Log!$J$2:$J)';
  const k = 'FILTER(Log!$J$2:$J,' + sel + ')';
  const reps = 'FILTER(Log!$K$2:$K,' + sel + ')';
  const e1 = 'FILTER(Log!$J$2:$J*(1+Log!$K$2:$K/30),' + sel + ')';
  const wrap = function (body) { return '=IF($A{r}="","",IFERROR(' + body + ',""))'; };
  const perRow = [
    wrap('LET(k,' + k + ',r,' + reps + ',e,ARRAYFORMULA(k*(1+r/30)+r/1000),i,MATCH(MAX(e),e,0),INDEX(k,i)&" x "&INDEX(r,i))'),
    wrap('ROUND(MAX(' + e1 + '),1)'),
    wrap('LET(k,' + k + ',r,' + reps + ',INDEX(k,ROWS(k))&" x "&INDEX(r,ROWS(r)))'),
    wrap('MAX(FILTER(Log!$D$2:$D,' + sel + '))'),
    wrap('SPARKLINE(' + e1 + ',{"color","#1a9c3c"})'),
    '=IF($A{r}="","",SUMPRODUCT((Log!$F$2:$F=$A{r})*(Log!$D$2:$D>=$J$4)*(Log!$D$2:$D<$J$4+7),Log!$J$2:$J,Log!$K$2:$K))',
    '=IF($A{r}="","",SUMPRODUCT((Log!$F$2:$F=$A{r})*(Log!$D$2:$D>=$J$5)*(Log!$D$2:$D<$J$5+7),Log!$J$2:$J,Log!$K$2:$K))',
  ];
  const block = [];
  for (let i = 0; i < N; i++) {
    const r = 4 + i;
    block.push(perRow.map(function (f) { return f.replace(/\{r\}/g, r); }));
  }
  sheet.getRange('A1').setValue('Progress. Built from the Log tab by formulas only. Please do not type in the tables.');
  sheet.getRange(3, 1, 1, 8).setValues([['Exercise', 'Best set (kg x reps)', 'Best est. 1RM', 'Latest set', 'Latest date', 'Est. 1RM trend', 'Volume this week (kg)', 'Volume last week (kg)']]).setFontWeight('bold');
  sheet.getRange('A4').setFormula('=IFERROR(SORT(UNIQUE(FILTER(Log!F2:F,Log!F2:F<>"",Log!H2:H<>"skipped"))),"")');
  sheet.getRange(4, 2, N, 7).setFormulas(block);
  sheet.getRange('E4:E' + (3 + N)).setNumberFormat('d mmm yyyy');

  sheet.getRange(3, 10, 1, 5).setValues([['Week starting', 'Sessions done', 'Planned exercises', 'Exercises done', 'Exercises skipped']]).setFontWeight('bold');
  const weeks = [];
  for (let w = 0; w < 12; w++) {
    const r = 4 + w;
    weeks.push([
      w === 0 ? '=TODAY()-WEEKDAY(TODAY(),2)+1' : '=J' + (r - 1) + '-7',
      '=COUNTIFS(Sessions!$B$2:$B,">="&J' + r + ',Sessions!$B$2:$B,"<"&J' + r + '+7)',
      '=COUNTIF(AppPlan!$D$2:$D,"Main")',
      '=IFERROR(ROWS(UNIQUE(FILTER(Log!$C$2:$C&"|"&Log!$F$2:$F,Log!$D$2:$D>=J' + r + ',Log!$D$2:$D<J' + r + '+7,Log!$H$2:$H<>"skipped"))),0)',
      '=COUNTIFS(Log!$D$2:$D,">="&J' + r + ',Log!$D$2:$D,"<"&J' + r + '+7,Log!$H$2:$H,"skipped")',
    ]);
  }
  sheet.getRange(4, 10, 12, 5).setFormulas(weeks);
  sheet.getRange('J4:J15').setNumberFormat('d mmm yyyy');

  sheet.getRange(3, 16, 1, 4).setValues([['Injury flagged: date', 'Day', 'Mode', 'Note']]).setFontWeight('bold');
  sheet.getRange('P4').setFormula('=IFERROR(QUERY(Sessions!A2:H,"select B, C, D, F where E = true order by B desc",0),"None flagged")');
  sheet.getRange('P4:P200').setNumberFormat('d mmm yyyy');
  sheet.setFrozenRows(3);
}
