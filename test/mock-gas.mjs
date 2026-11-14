// A small stand-in for the Apps Script runtime so Code.gs can be run and tested in Node.
import fs from 'node:fs';
import vm from 'node:vm';

const colNum = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

class Range {
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

class Sheet {
  constructor(name, grid = [], merges = []) { this.name = name; this.grid = grid; this.merges = merges; this.writes = 0; }
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

class Book {
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
const tab = (name, title, rows, merges = []) => new Sheet(name,
  [[title, '', '', '', '', '', '', '', '', ''], hdr.slice(), ...rows.map((r) => ['', ...r, '']), ['', '', '', '', '', '', '', '', '', '']],
  [[1, 1, 1, 10], ...merges]);

// A copy of the layout of Chloe's sheet, including merged cells and the mistyped Friday heading.
export function fixtureBook() {
  return new Book([
    new Sheet('PLAN', [['', ''], ['', 'TRAINING PLAN (12wks) 2026 LOCK IN!!!'], ['', 'Monday - Gym (Upper)']]),
    tab('CORRECTIVE EXERCISE / WARM UP', 'CORRECTIVE EXERCISE / WARM UP - Repeat before EVERY workout', [
      ['Knee to wall ankle rocks ', 12, '2-3', '/', 'Medium', '30s', '', ''],
      ['Banded ankle mobilisation', 12, '', '/', 'Medium', '', '', ''],
      ['Body weight squat to box ', '6-12', '', '/', 'Medium', '', '', 'THINK ABOUT ENGAGING THE LEFT GLUTE'],
      ['Arm circles', '6-12', '', '/', 'Medium', '', '', ''],
      ['Press up release', '6-12', '', '/', 'Medium', '', '', ''],
    ], [[3, 4, 5, 1], [3, 7, 5, 1]]),
    tab('Monday (Gym)', '  Monday - GYM DAY 1', [
      ['DB Bench Press', '8-10', 3, '/', '2/0/2', '2min', '', '12kg10. // 25kgx5x2 '],
      ['Chest supported - DB row', '10-12', '', '/', '2/0/2', '2min', '', '12kgx12 // 15kgsx12x2'],
      ['Incline Bench press', '10-12', 3, '/', '2/0/2', '2min', '', '17.5kgx12  x5  // 15kg x7  x12'],
      ['Lat Pull down ', '12-15', 3, '/', '2/0/2', '2min', '', '60kgx15 // 75kgx12 x15'],
      ['Facepulls ', 15, 2, '/', '4/2/1', '1min', '', '25kg X12X3'],
      ['Hammer curl ', '10-12', 2, '/', '2/0/2', '1min', '', 'All in the biceps!!! 5kgsx12'],
    ], [[3, 4, 2, 1]]),
    tab('Tuesday (Home)', 'Tuesday - HOME WORKOUT A', [
      ['Sit-to-stand ', '8-10', 3, '/', '2/0/2', '20-30s', '', 'CONTROL '],
      ['Glute bridge SL ', '6-8', 3, '/', '2/0/2', '20-30s', '', 'CONNECT WITH THE GLUTES'],
      ['Clamshell', '8-10/side', 2, '/', '2/0/2', '20-30s', '', 'THE LEFT SIDE WAS SLIGHTLY PAINFUL LAST TIME'],
      ['Calf raises ', '12-15', 2, '/', '2/0/2', '20-30s', '', 'CONTROL'],
      ['SL Balance ', '/', 2, '20-30s/side', 'Hold', '20-30s', '', 'CLOSE THE EYES'],
    ]),
    tab('Wednesday (Gym)', 'Wednesday - GYM DAY 2', [
      ['SL Sit to stand', 15, 3, '/', '/', '45s', '', 'FIND THE MIDE TO MUSCLE CONNECTION'],
      ['Side plank', '/', 3, '30s', '/', '45s', '', 'ENGAGE THE WHOLE BODY '],
      ['Seated Cable Row ', '10-12', 3, '/', '2/0/2', '1-2mins', '', '52kg x12x3'],
      ['DB chest press', '8-10', 3, '/', '2/0/2', '1-2mins', '', '26kg per arm x10x3'],
      ['Bulgarian SS', 15, 3, '/', '/', '45s', '', "DON'T OVER DO IT"],
      ['Hamtring Bridge with hip flexion ', 10, 3, '/', '/', '45s', '', 'PUSH THE HIPS HIGH'],
    ]),
    tab('Friday (Gym)', 'Wednesday - GYM DAY 3', [
      ['Incline bench press', '8-10', 3, '/', '3/1/1', '1-2mins', '', '18kg x12x3'],
      ['Bent over row OR Cable row', '10-12', 3, '/', '2/0/2', '1-2mins', '', '40kg x12x3'],
      ['Chest press - Fixed machine', '10-12', 3, '/', 'Medium', '1-2mins', '', '50kg x12x3'],
      ['Lat pull down', '12-15', 3, '/', 'Medium', '1-2mins', '', '70kg x15x3'],
      ['Facepulls ', 15, 2, '/', 'Medium', '1min', '', '41kg x15x2'],
      ['Cable - Bicep curl ', '10-12', 2, '/', 'Medium', '1min', '', '13.7kg x12x3'],
      ['Remember to stretch after', '', '', '', '', '', '', ''],
    ]),
    tab('Saturday (Home)', 'Saturday - HOME WORKOUT B', [
      ['Supported Split squat', '8-10', 2, '/', '2/0/2', '20-30s', '', 'FOCUS ON CONTROL RATHER THAN DEPTH'],
      ['Glute bridge - SL', '6-8', 2, '/', '2/0/2', '20-30s', '', 'CONNECT WITH THE GLUTES'],
      ['Clamshell', '8-10/side', 2, '/', '2/0/2', '20-30s', '', 'FOCUS ON THE SIDE GLUTES'],
      ['Side plank', '/', 2, '20s/side', 'Hold', '20-30s', '', 'ELBOW UNDER THE SHOULDER'],
      ['Single-leg balance', '/', 2, '20-30s/side', 'Hold', '20-30s', '', 'CLOSE THE EYES'],
    ]),
  ]);
}

export function loadScript(book) {
  const props = {};
  const logs = [];
  let uuid = 0;
  const pad = (n) => String(n).padStart(2, '0');
  const sandbox = {
    console, JSON, Date, Math, Object, Array, String, Number, isFinite,
    SpreadsheetApp: { openById: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: (m) => logs.push(m) },
    Utilities: {
      getUuid: () => `0000${uuid++}-aaaa-bbbb-cccc-dddddddddddd`,
      formatDate: (d, tz, f) => { if (typeof tz !== 'string') throw new Error('Invalid argument: timeZone'); return f === 'u' ? String(d.getUTCDay() || 7) : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
    },
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  vm.runInContext(src + '\nthis.api = { doPost, setup, appSheet_, readRows_, book_ };', sandbox);
  const post = (body) => JSON.parse(sandbox.api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
  return { api: sandbox.api, post, logs, props, book };
}
