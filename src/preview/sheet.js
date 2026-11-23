// The mock Google Sheet behind the test site and the tests. No Node APIs, so it runs in the browser too.
// Everything here is invented. Never paste real sheet contents into this file.

const colNum = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export class Range {
  constructor(sheet, r, c, nr, nc, dummy = false) { Object.assign(this, { sheet, r, c, nr, nc, dummy }); }
  getRow() { return this.r; } getColumn() { return this.c; }
  getNumRows() { return this.nr; } getNumColumns() { return this.nc; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push((this.sheet.grid[this.r - 1 + i] || [])[this.c - 1 + j] ?? '');
      out.push(row);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((row, i) => row.map((v, j) => {
      const d = this.sheet.display[`${this.r + i},${this.c + j}`];
      if (d !== undefined) return d;
      if (v instanceof Date) return v.toDateString();
      return v === '' || v == null ? '' : String(v);
    }));
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const g = this.sheet.grid[this.r - 1 + i]; if (g) g[this.c - 1 + j] = ''; }
    return this;
  }
  setValues(vals) {
    if (this.dummy) throw new Error('setValues on a column range');
    this.sheet.writes++;
    vals.forEach((row, i) => {
      const g = (this.sheet.grid[this.r - 1 + i] ||= []);
      row.forEach((v, j) => {
        // Sheets parses a typed ISO date into a real date.
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00:00Z');
        g[this.c - 1 + j] = v;
      });
      for (let k = 0; k < g.length; k++) if (g[k] === undefined) g[k] = '';
    });
    for (let k = 0; k < this.sheet.grid.length; k++) this.sheet.grid[k] ||= [];
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFormula(f) { return this.setValues([[f]]); }
  setFormulas(f) { return this.setValues(f); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  getMergedRanges() { return this.sheet.merges.map(([r, c, nr, nc]) => new Range(this.sheet, r, c, nr, nc)); }
}

export class Sheet {
  constructor(name, grid = [], merges = []) { this.name = name; this.grid = grid; this.merges = merges; this.writes = 0; this.display = {}; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.grid.length; r > 0; r--) if ((this.grid[r - 1] || []).some((v) => v !== '' && v != null)) return r;
    return 0;
  }
  getDataRange() {
    const cols = Math.max(1, ...this.grid.map((r) => (r || []).length));
    return new Range(this, 1, 1, Math.max(1, this.getLastRow()), cols);
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)$/);
      if (m) return new Range(this, +m[2], colNum(m[1]), 1, 1);
      return new Range(this, 1, 1, 1, 1, true);
    }
    return new Range(this, a, b, c ?? 1, d ?? 1);
  }
  deleteRow(r) { this.writes++; this.grid.splice(r - 1, 1); }
  setFrozenRows() {}
}

export class Book {
  constructor(sheets) { this.sheets = sheets; }
  getSheets() { return this.sheets.slice(); }
  getSpreadsheetTimeZone() { return null; }
  insertSheet(name) {
    if (this.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error('A sheet with the name "' + name + '" already exists.');
    const s = new Sheet(name);
    this.sheets.push(s);
    return s;
  }
}

const hdr = ['DATE ', 'EXERCISE ', 'REPS ', 'SETS', 'DURATION', 'TEMPO', 'REST', 'RPE (/10)', 'COMMENTS', 'COMPLETE'];
const D = (s) => ({ date: s });
const tab = (name, title, rows, merges = []) => {
  const sh = new Sheet(name,
  [[title, '', '', '', '', '', '', '', '', ''], hdr.slice(), ...rows.map((r) => ['', ...r, '']), ['', '', '', '', '', '', '', '', '', '']],
  [[1, 1, 1, 10], ...merges]);
  sh.grid.forEach((row, r) => row.forEach((v, c) => {
    if (v && v.date) { row[c] = new Date('2026-12-10T00:00:00Z'); sh.display[`${r + 1},${c + 1}`] = v.date; }
  }));
  return sh;
};

// Mirrors the LAYOUT of Chloe's sheet (merged cells, date-typed cells, several blocks per tab, the mistyped Friday heading).
// All comments and weights here are invented. Never paste real sheet contents into this file.
export function fixtureBook() {
  return new Book([
    new Sheet('PLAN', [['', ''], ['', 'TRAINING PLAN'], ['', 'Monday - Gym (Upper)']]),
    tab('CORRECTIVE EXERCISE / WARM UP', 'CORRECTIVE EXERCISE / WARM UP - Repeat before EVERY workout', [
      ['Knee to wall ankle rocks ', 12, '2-3', '/', 'Medium', '30s', '', ''],
      ['Banded ankle mobilisation', 12, '', '/', 'Medium', '', '', ''],
      ['Body weight squat to box ', '6-12', '', '/', 'Medium', '', '', 'SLOW AND CONTROLLED'],
      ['Arm circles', '6-12', '', '/', 'Medium', '', '', ''],
      ['Press up release', '6-12', '', '/', 'Medium', '', '', ''],
    ], [[3, 4, 5, 1], [3, 7, 5, 1]]),
    tab('Monday (Gym)', '  Monday - GYM DAY 1', [
      ['DB Bench Press', '8-10', 3, '/', '2/0/2', '2min', '', '20kgx10 // 22.5kgx8 '],
      ['Chest supported - DB row', '10-12', '', '/', '2/0/2', '2min', '', '10kgx12 // 12kgx10'],
      ['Incline Bench press', '10-12', 3, '/', '2/0/2', '2min', '', '16kgx10  x3  // 14kg x12'],
      ['Lat Pull down ', '12-15', 3, '/', '2/0/2', '2min', '', '45kgx12 // 50kgx10'],
      ['Facepulls ', 15, 2, '/', '4/2/1', '1min', '', '20kg X15X2'],
      ['Hammer curl ', D('10-12'), 2, '/', '2/0/2', '1min', '', 'Squeeze at the top 8kgx12'],
      ['', '', '', '', '', '', '', ''],
      ['bar bench press', 8, 3, '/', '2/0/2', '2min', '', 60],
      ['hammer ', 12, 1, '/', '2/0/2', '1min', '', 10],
      ['', '', '', '', '', '', '', ''],
      ['DB Bench Press', '8-10', 3, '/', '2/0/2', '2min', '', ''],
      ['Chest supported - DB row', '8-12', 3, '/', '2/0/2', '2min', '', ''],
      ['Incline Bench press', '8-12', 3, '/', '2/0/2', '2min', '', ''],
      ['Lat Pull down ', '8-12', 3, '/', '2/0/2', '2min', '', ''],
      ['Facepulls ', '12-15', D('2-3'), '/', '4/2/1', '1min', '', ''],
      ['Hammer curl ', D('10-12'), 2, '/', '2/0/2', '1min', '', ''],
    ], [[3, 4, 2, 1]]),
    tab('Tuesday (Home)', 'Tuesday - HOME WORKOUT A', [
      ['Sit-to-stand ', '8-10', 3, '/', '2/0/2', '20-30s', '', 'SMOOTH '],
      ['Glute bridge SL ', '6-8', 3, '/', '2/0/2', '20-30s', '', 'PAUSE AT THE TOP'],
      ['Clamshell', '8-10/side', 2, '/', '2/0/2', '20-30s', '', 'KEEP THE FEET TOGETHER'],
      ['Calf raises ', '12-15', 2, '/', '2/0/2', '20-30s', '', 'FULL RANGE'],
      ['SL Balance ', '/', 2, '20-30s/side', 'Hold', '20-30s', '', 'EYES FORWARD'],
    ]),
    tab('Wednesday (Gym)', 'Wednesday - GYM DAY 2', [
      ['SL Sit to stand', 15, 3, '/', '/', '45s', '', 'STAND TALL AT THE TOP'],
      ['Side plank', '/', 3, '30s', '/', '45s', '', 'HIPS IN LINE '],
      ['Seated Cable Row ', '10-12', 3, '/', '2/0/2', '1-2mins', '', '45kg x12x3'],
      ['DB chest press', '8-10', 3, '/', '2/0/2', '1-2mins', '', '20kg per arm x10x3'],
      ['Bulgarian SS', 15, 3, '/', '/', '45s', '', 'STEADY PACE'],
      ['Hamtring Bridge with hip flexion ', 10, 3, '/', '/', '45s', '', 'HEELS DOWN'],
    ]),
    tab('Friday (Gym)', 'Wednesday - GYM DAY 3', [
      ['Incline bench press', '8-10', 3, '/', '3/1/1', '1-2mins', '', '16kg x12x3'],
      ['Bent over row OR Cable row', '10-12', 3, '/', '2/0/2', '1-2mins', '', '35kg x12x3'],
      ['Chest press - Fixed machine', '10-12', 3, '/', 'Medium', '1-2mins', '', '45kg x12x3'],
      ['Lat pull down', '12-15', 3, '/', 'Medium', '1-2mins', '', '55kg x12x3'],
      ['Facepulls ', 15, 2, '/', 'Medium', '1min', '', '30kg x15x2'],
      ['Cable - Bicep curl ', D('10-12'), 2, '/', 'Medium', '1min', '', '12kg x12x3'],
      ['', '', '', '', '', '', '', ''],
      ['Incline bench press', '8-10', 3, '/', '2/0/2', '2min', '', '16*2+18*1'],
      ['Bent over row OR Cable row', '8-12', 3, '/', '2/0/2', '2min', '', '35.0'],
      ['Chest press - Fixed machine', '8-12', 3, '/', '2/0/2', '2min', '', '45.0'],
      ['Lat pull down', '8-12', 3, '/', '2/0/2', '2min', '', 'lighter next time'],
      ['Facepulls ', '12-15', D('2-3'), '/', '4/2/1', '1min', '', '30*3*15'],
      ['Cable - Bicep curl ', D('10-12'), 2, '/', '2/0/2', '1min', '', 'done'],
      ['Remember to stretch after', '', '', '', '', '', '', ''],
    ]),
    tab('Saturday (Home)', 'Saturday - HOME WORKOUT B', [
      ['Supported Split squat', '8-10', 2, '/', '2/0/2', '20-30s', '', 'SHORT STEPS'],
      ['Glute bridge - SL', '6-8', 2, '/', '2/0/2', '20-30s', '', 'PAUSE AT THE TOP'],
      ['Clamshell', '8-10/side', 2, '/', '2/0/2', '20-30s', '', 'SLOW LOWER'],
      ['Side plank', '/', 2, '20s/side', 'Hold', '20-30s', '', 'BREATHE OUT'],
      ['Single-leg balance', '/', 2, '20-30s/side', 'Hold', '20-30s', '', 'EYES FORWARD'],
    ]),
  ]);
}

// The Apps Script services Code.gs uses, backed by the mock book. props holds the script properties.
export function gasGlobals(book, props, { uuid, logs = [] } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    SpreadsheetApp: { openById: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: (m) => logs.push(m) },
    Utilities: {
      getUuid: uuid,
      formatDate: (d, tz, f) => { if (typeof tz !== 'string') throw new Error('Invalid argument: timeZone'); return f === 'u' ? String(d.getUTCDay() || 7) : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
    },
  };
}

// The book as plain JSON (dates tagged), so the test site can keep it in IndexedDB.
export const dumpBook = (book) => book.sheets.map((s) => ({
  name: s.name, merges: s.merges, display: s.display,
  grid: s.grid.map((row) => (row || []).map((v) => (v instanceof Date ? { $date: v.toISOString() } : v))),
}));
export const loadBook = (data) => new Book(data.map((d) => {
  const s = new Sheet(d.name, d.grid.map((row) => row.map((v) => (v && v.$date ? new Date(v.$date) : v))), d.merges);
  s.display = d.display || {};
  return s;
}));
