// Exercise descriptions: coverage, and that a variation never borrows the wrong lift's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe } from '../src/descriptions.js';

// Names written the way a plan or a quick add might write them (invented, not from the sheet).
const PLAN_STYLE = [
  'Arm circles', 'Banded ankle mobilisation', 'Barbell bench press', 'Bent over row OR Cable row', 'Body weight squat to box ',
  'Bulgarian SS', 'Cable - Bicep curl ', 'Calf raises ', 'Chest press - Fixed machine', 'Chest supported - DB row',
  'Clamshell', 'DB Bench Press', 'DB chest press', 'Facepulls ', 'Glute bridge - SL', 'Hammer curl ',
  'Hamtring Bridge with hip flexion ', 'Incline Bench press', 'Knee to wall ankle rocks ', 'Lat Pull down ',
  'Side plank', 'Plank', 'Tricep pull downs', 'Seated cable row', 'Leg press', 'Goblet squat', 'SL balance',
];

test('plan style names all have a description', () => {
  for (const n of PLAN_STYLE) assert.ok(describe(n), `no description for "${n}"`);
});

// [name, a phrase the text must contain, a phrase it must not contain]
const TRICKY = [
  ['Straight arm pulldown', 'straight arms', 'thighs under the pads'],
  ['Single leg deadlift', 'one leg', 'bar over your mid foot'],
  ['Single leg RDL', 'one leg', null],
  ['Hammer strength row', 'plate-loaded', 'palms facing in'],
  ['Close grip bench press', 'triceps than a normal bench', null],
  ['Seated calf raise', 'Sit in the machine', 'edge of a step'],
  ['Reverse lunge', 'step one foot back', 'Step forward'],
  ['Incline chest press', 'incline machine', 'back flat on the pad'],
  ['Reverse DB fly', 'rear shoulders', 'hugging arc'],
  ['Reverse pec deck', 'rear shoulders', 'hugging arc'],
  ['Hand release press-up', 'lift your hands off', null],
  ['Side plank', 'obliques', null],
  ['Copenhagen plank', 'inner thigh', null],
  ['Lying tricep extension', 'forehead', null],
  ['Overhead tricep extension', 'behind your head', null],
  ['Cable tricep kickback', 'triceps', 'glute'],
  ['Cable glute kickback', 'glutes', null],
  ['Single arm DB row', 'one knee and hand on a bench', null],
  ['Front squat', 'front of your shoulders', null],
  ['Squat', 'bar across your upper back', null],
  ['Lat pullover', 'straight arms', 'thighs under the pads'],
  ['Foam roll out', 'foam roller', 'ab wheel'],
  ['Scapular push-up', 'shoulder blades', null],
  ['Nordic hamstring curl', 'lean forward', 'In the machine'],
  ['Cable crossover', 'two high cables', null],
  ['Rowing machine', 'Push with your legs first', null],
];

test('variations get their own text, not a near match', () => {
  for (const [name, has, hasNot] of TRICKY) {
    const t = describe(name);
    assert.ok(t.includes(has), `"${name}" should mention "${has}", got: ${t}`);
    if (hasNot) assert.ok(!t.includes(hasNot), `"${name}" should not mention "${hasNot}"`);
  }
});

test('broad words alone do not pull in an unrelated description', () => {
  for (const n of ['Zorb lift', 'Smith machine bench press', 'Sumo squat', 'Hammer strength chest press', 'Seated DB press', 'Rear delt row', '']) {
    const t = describe(n);
    if (n === 'Smith machine bench press') assert.ok(!t.includes('Smith machine'), `"${n}" got squat text`);
    else if (n === 'Hammer strength chest press') assert.ok(!t.includes('row'), `"${n}" got row text`);
    else assert.equal(t, '', `"${n}" should have no description, got: ${t}`);
  }
});

test('the list is clean: no duplicate keys, no em or en dashes, keys already normalised', () => {
  const src = readFileSync(new URL('../src/descriptions.js', import.meta.url), 'utf8');
  assert.ok(!/[–—]/.test(src), 'dash found in descriptions');
  const body = src.slice(src.indexOf('const LIST'), src.indexOf('\n];'));
  const keys = [...body.matchAll(/\[\[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']*)'/g)].map((k) => k[1].replace(/^=/, '')));
  assert.ok(keys.length > 300, `expected many keys, found ${keys.length}`);
  const seen = new Set();
  for (const k of keys) {
    assert.match(k, /^[a-z0-9]+$/, `key "${k}" is not normalised`);
    assert.ok(!seen.has(k), `duplicate key "${k}"`);
    seen.add(k);
  }
});
