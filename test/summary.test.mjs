import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionSummaryText, describeSets, buildHistory, splitNote, joinNote, sessionStats, volumeFactor } from '../src/logic.js';

const plan = [
  ['Warm-up', 'Arm circles', '2-3', '6-12'],
  ['Main', 'DB Bench Press', '3', '8-10'], ['Main', 'Chest supported - DB row', '3', '8-12'], ['Main', 'Incline Bench press', '3', '8-12'],
  ['Main', 'Lat Pull down', '3', '8-12'], ['Main', 'Facepulls', '2-3', '12-15'], ['Main', 'Hammer curl', '2', '10-12'], ['Main', 'Bicep curl', '2', '10-12'],
].map(([Block, Exercise, Sets, Reps], i) => ({ Day: 'Mon', Order: i + 1, Block, Exercise, Sets, Reps }));
const library = [
  { Exercise: 'Barbell bench press', Group: 'Chest', Equipment: 'Barbell' },
  { Exercise: 'Chest supported - DB row', Group: 'Back', Equipment: 'Dumbbell' },
  { Exercise: 'Hammer curl', Group: 'Arms', Equipment: 'Dumbbell' },
  { Exercise: 'Bicep curl', Group: 'Arms', Equipment: 'Cable' },
];
const planDay = { Day: 'Mon', SessionName: 'Gym day 1', Focus: 'Upper body' };
let n = 0;
const sets = (ex, list, extra = {}) => list.map(([kg, reps], i) => ({
  ClientID: 'c' + n, LoggedAt: `2026-11-17T11:${String(10 + n++).padStart(2, '0')}:00Z`, SessionID: 's1', Date: '2026-11-17', Day: 'Mon',
  Exercise: ex, PlannedExercise: '', Status: 'done', SetNo: i + 1, Kg: kg, Reps: reps, RPE: '', Note: '', ...extra,
}));
const rows = [
  ...sets('Barbell bench press', [[60, 8], [60, 6], [60, 6]], { Status: 'swapped', PlannedExercise: 'DB Bench Press' }),
  ...sets('Chest supported - DB row', [[14, 12], [14, 12], [14, 12]]),
  ...sets('Hammer curl', [[12, 12], [10, 12], [10, 12]]),
  ...sets('Bicep curl', [[8, 12], [8, 12]]),
];
const session = {
  SessionID: 's1', Date: '2026-11-17', Day: 'Mon', Mode: 'modified', Injury: '',
  Note: joinNote('done', 'Gym was busy, kept rests short'),
  Start: '2026-11-17T11:10:00Z', End: '2026-11-17T12:17:00Z',
};

test('summary of a real session reads as plain English', () => {
  const t = sessionSummaryText({ session, rows, planDay, plan, library, hist: buildHistory(rows) });
  assert.match(t, /^Strength session: Gym day 1 \(upper body\)\nTuesday 17 November 2026, \d\d:\d\d to \d\d:\d\d \(67 minutes\)/);
  assert.match(t, /Changed the plan: 1 swap\. 4 exercises, 11 working sets/);
  assert.match(t, /Warm-up: done\./);
  assert.match(t, /- Barbell bench press \(instead of DB Bench Press\): 3 sets at 60 kg: 8, 6 and 6 reps \(target 8 to 10\)/);
  assert.match(t, /- Chest supported - DB row: 3 x 12 with 14 kg dumbbells\n/);
  assert.match(t, /- Hammer curl: 1 x 12 with 12 kg dumbbells, then 2 x 12 with 10 kg dumbbells/);
  assert.match(t, /- Bicep curl: 2 x 12 at 8 kg/);
  assert.match(t, /Notes: Gym was busy, kept rests short\. Barbell bench press: 2 of 3 sets below the 8 to 10 rep target\./);
  assert.doesNotMatch(t, /Up on last time/);
  assert.doesNotMatch(t, /\u2014/); // no em dashes
});

test('dumbbell volume counts both dumbbells', () => {
  // 1200 bench + 2 x 504 row + 2 x 384 hammer + 192 curl
  assert.equal(sessionStats(rows, volumeFactor(library)).volume, 1200 + 1008 + 768 + 192);
  assert.match(sessionSummaryText({ session, rows, planDay, plan, library }), /about 3,200 kg total volume/);
});

test('up on last time, skips and swap reasons', () => {
  const before = sets('Chest supported - DB row', [[12, 12]], { SessionID: 's0', Date: '2026-11-10' });
  const now = [
    ...sets('Chest supported - DB row', [[14, 12]]),
    ...sets('Lat Pull down', [[0, 0]], { Status: 'skipped', SetNo: '', Kg: '', Reps: '', PlannedExercise: 'Lat Pull down', Note: 'Machine busy' }),
    ...sets('Cable row', [[40, 12]], { Status: 'swapped', PlannedExercise: 'Incline Bench press', Note: 'Swap reason: No equipment' }),
  ];
  const t = sessionSummaryText({ session: { ...session, Note: '' }, rows: now, planDay, plan, library, hist: buildHistory([...before, ...now]) });
  assert.match(t, /Up on last time: Chest supported - DB row \+2 kg \(14 x 12, was 12 x 12\)\./);
  assert.match(t, /Skipped: Lat Pull down \(machine busy\)\./);
  assert.match(t, /- Cable row \(instead of Incline Bench press, no equipment\): 1 x 12 at 40 kg/);
  assert.match(t, /Changed the plan: 1 swap and 1 skipped\./);
  assert.doesNotMatch(t, /Warm-up/);
});

test('warm-up marker round trip and set wording', () => {
  assert.deepEqual(splitNote('Warm-up skipped | Knee: sore'), { warm: 'skipped', rest: 'Knee: sore' });
  assert.deepEqual(splitNote('Just a note'), { warm: '', rest: 'Just a note' });
  assert.equal(joinNote('', 'a', ''), 'a');
  assert.equal(describeSets([{ kg: 0, reps: 30 }, { kg: 0, reps: 30 }], { timed: true }), '2 x 30 s at bodyweight');
});
