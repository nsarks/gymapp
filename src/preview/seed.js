// Invented history for the test site: about three weeks of sessions before today, built from the plan.
// It returns sync ops, so the data goes through the real script the same way the phone's does.
// Nothing here comes from the real sheet.
import { addDays, dayOf, parseISO, planFor, maxNum, uuid, joinNote, groupOf, isDumbbell } from '../logic.js';

const DAYS_BACK = 21;
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const at = (iso, mins) => { const d = parseISO(iso); d.setHours(18, mins, 0, 0); return d.toISOString(); };

// A starting weight from the exercise's kit, rising every second time it is done.
function weightFor(library, name, nth, home) {
  const eq = String((library.find((l) => l.Exercise === name) || {}).Equipment || '');
  const group = groupOf(library, name);
  if (home || group === 'Core' || group === 'Glutes' || /sit.to.stand|bulgarian|squat to box|bridge|plank|balance|push.?up/i.test(name)) return 0;
  const h = hash(name);
  const step = Math.floor(nth / 2);
  if (isDumbbell(library, name) || (group === 'Arms' && !/cable/i.test(name))) return 8 + (h % 5) * 2 + step * 2;
  if (/cable|machine/i.test(eq) || /cable|machine|pull/i.test(name)) return 20 + (h % 5) * 5 + step * 2.5;
  return 20 + (h % 4) * 5 + step * 2.5;
}

const EXTRA = [
  { Exercise: 'Plank', Group: 'Core', Equipment: '', Unilateral: '' },
  { Exercise: 'Goblet squat', Group: 'Legs', Equipment: 'Dumbbell', Unilateral: '' },
  { Exercise: 'Push-up', Group: 'Chest', Equipment: '', Unilateral: '' },
];

/**
 * boot: { plan, planDays, library } from bootstrap. today: ISO date. Returns ops for the sync action.
 * Shapes on purpose: most sessions as planned, one skipped planned day, one with a skipped exercise,
 * one swap, one added exercise, one injury note, one freestyle session, warm-up done or skipped.
 */
export function seedOps({ plan, planDays, library }, today) {
  const ops = [];
  const lib = [...library];
  EXTRA.forEach((x) => { if (!lib.some((l) => l.Exercise === x.Exercise)) { lib.push(x); ops.push({ id: uuid(), op: 'library.add', row: x }); } });
  const count = {}; // exercise -> times done so far
  const dates = [];
  for (let i = DAYS_BACK; i >= 1; i--) dates.push(addDays(today, -i));
  const plannedDates = dates.filter((d) => planDays.some((p) => p.Day === dayOf(d)));
  const back = (d) => plannedDates.length - 1 - plannedDates.indexOf(d); // 0 = the latest planned day
  const freeDate = [...dates].reverse().find((d) => !planDays.some((p) => p.Day === dayOf(d)) && d < plannedDates[plannedDates.length - 2]);

  dates.forEach((date) => {
    const pd = planDays.find((p) => p.Day === dayOf(date));
    if (!pd && date !== freeDate) return;
    const n = pd ? back(date) : -1;
    if (n === 2 || n === 8) return; // missed days
    const SessionID = uuid();
    const home = /home/i.test(pd ? pd.Location : '');
    let items;
    if (pd) {
      items = planFor(plan, pd.Day, false).map((p) => ({ exercise: p.Exercise, planned: p.Exercise, status: 'done', sets: maxNum(p.Sets, 1), reps: p.Reps }));
    } else {
      items = [{ exercise: 'Push-up', sets: 3, reps: '10-12' }, { exercise: 'Goblet squat', sets: 3, reps: '10-12' }, { exercise: 'Plank', sets: 2, reps: '30s' }].map((x) => ({ ...x, planned: '', status: 'done' }));
    }
    let skip = null, swapNote = '', injury = '';
    if (n === 1 && items.length > 2) skip = items[items.length - 1];
    if (n === 4) {
      const other = plan.find((p) => p.Block === 'Main' && p.Day !== pd.Day && !items.some((i) => i.exercise === p.Exercise) && groupOf(lib, p.Exercise) === groupOf(lib, items[0].exercise));
      if (other) { Object.assign(items[0], { exercise: other.Exercise, status: 'swapped' }); swapNote = 'Swap reason: Equipment busy'; }
    }
    if (n === 5) items.push({ exercise: 'Plank', planned: '', status: 'added', sets: 2, reps: '30s' });
    if (n === 3) injury = 'Lower back: a bit stiff, kept the weights light';
    const warm = !pd ? '' : n % 3 === 0 ? 'skipped' : 'done';

    let mins = warm === 'done' ? 8 : 0;
    items.forEach((it) => {
      if (it === skip) {
        ops.push({ id: uuid(), op: 'log.append', row: {
          ClientID: uuid(), LoggedAt: at(date, mins), SessionID, Date: date, Day: pd.Day, Exercise: it.exercise,
          PlannedExercise: it.planned, Status: 'skipped', SetNo: '', Kg: '', Reps: '', RPE: '', Note: 'Short on time',
        } });
        return;
      }
      const nth = count[it.exercise] = (count[it.exercise] ?? -1) + 1;
      const kg = weightFor(lib, it.exercise, nth, home);
      const timed = /\d\s*s\b|sec/i.test(String(it.reps));
      const top = maxNum(it.reps, timed ? 30 : 10);
      for (let s = 1; s <= it.sets; s++) {
        mins += 2 + (hash(it.exercise + s) % 2);
        const tired = !timed && s === it.sets && (hash(date + it.exercise) % 3 === 0) ? 2 : 0;
        ops.push({ id: uuid(), op: 'log.append', row: {
          ClientID: uuid(), LoggedAt: at(date, mins), SessionID, Date: date, Day: pd ? pd.Day : dayOf(date), Exercise: it.exercise,
          PlannedExercise: it.status === 'swapped' ? it.planned : '', Status: it.status, SetNo: s, Kg: kg, Reps: top - tired,
          RPE: s === it.sets && !timed ? 7 + (hash(date + it.exercise) % 3) : '', Note: s === 1 && it.status === 'swapped' ? swapNote : '',
        } });
      }
    });
    const changed = skip || swapNote || items.some((i) => i.status === 'added');
    ops.push({ id: uuid(), op: 'session.upsert', row: {
      SessionID, Date: date, Day: pd ? pd.Day : dayOf(date), Mode: !pd ? 'freestyle' : changed ? 'modified' : 'as planned',
      Injury: !!injury, Note: joinNote(warm, injury), Start: at(date, 0), End: at(date, mins + 3),
    } });
  });
  return ops;
}
