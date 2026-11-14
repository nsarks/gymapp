import { useEffect, useState } from 'preact/hooks';
import {
  S, useStore, view, draftOf, setDraft, logSet, editSet, timerAdd, timerClear, skipItem, skipLegs, lowerBodyLeft, unskip,
  swapItem, addItem, addToLibrary, moveItem, goTo, setItemNote, setInjury, unloggedMain, finishSession, isComplete, isLogged,
  itemGroup, lastFor, saveSummaryNote, syncNow, syncLabel,
} from './store.js';
import { Icon, Tag, Sheet, Chips, Stepper, SyncBadge, useTick } from './ui.jsx';
import { fmtSet, fmtKg, niceDate, GROUPS, sameName, groupOf, fmtDuration, sessionStats } from './logic.js';

const SKIP_REASONS = ['Machine busy', 'Injury or niggle', 'Short on time', 'Not feeling it', 'Other'];
const SWAP_REASONS = ['Machine busy', 'No equipment', 'Injury or niggle', 'Prefer this', 'Other'];
const AREAS = ['Knee', 'Back', 'Shoulder', 'Hip', 'Ankle', 'Elbow', 'Other'];
const EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Band'];

function useWakeLock() {
  useEffect(() => {
    let lock = null, gone = false;
    const get = async () => {
      try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not available */ }
      if (gone && lock) lock.release();
    };
    get();
    document.addEventListener('visibilitychange', get);
    return () => { gone = true; document.removeEventListener('visibilitychange', get); if (lock) lock.release().catch(() => {}); };
  }, []);
}

// Reason chips. One tap picks a reason; "Other" opens a one-line box.
function Reasons({ options, onPick }) {
  const [other, setOther] = useState(null);
  if (other !== null) {
    return (
      <form class="row" onSubmit={(e) => { e.preventDefault(); onPick(other.trim() || 'Other'); }}>
        <input class="text" autoFocus placeholder="Reason" value={other} onInput={(e) => setOther(e.target.value)} maxLength={120} />
        <button class="btn small">Skip</button>
      </form>
    );
  }
  return <Chips label="Reason" options={options} onPick={(o) => (o === 'Other' ? setOther('') : onPick(o))} />;
}

function RestTimer({ t }) {
  useTick(250);
  const left = Math.max(0, Math.ceil((t.end - Date.now()) / 1000));
  const ready = left === 0;
  const C = 2 * Math.PI * 15;
  return (
    <div class={`timer ${ready ? 'ready' : ''}`} role="timer">
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="15" class="ring-bg" />
        <circle cx="20" cy="20" r="15" class="ring" stroke-dasharray={C} stroke-dashoffset={ready ? 0 : C * (left / t.total)} transform="rotate(-90 20 20)" />
        {ready && <path d="M13 20.5l5 5 9-10" class="ring-tick" />}
      </svg>
      <div class="timer-text">
        <strong>{ready ? 'Ready' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</strong>
        <span class="muted">{ready ? 'Rest finished' : 'Rest'}</span>
      </div>
      {!ready && <button class="chip" onClick={() => timerAdd(30)}>+30 s</button>}
      <button class="chip ghost" onClick={timerClear}>Dismiss</button>
    </div>
  );
}

// Search the library, or add a brand new exercise. Used for both swap and add.
export function Picker({ mode, item, onDone }) {
  const v = view();
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(null);
  const [equipment, setEquipment] = useState('');
  const choose = (name) => { if (mode === 'swap') swapItem(item.key, name, reason); else addItem(name); onDone(); };

  if (creating) {
    return (
      <div class="stack">
        <p class="muted">New exercise: <strong class="strong">{creating}</strong></p>
        <p class="label">Equipment (optional)</p>
        <Chips label="Equipment" options={EQUIPMENT} value={equipment} onPick={(e) => setEquipment(e === equipment ? '' : e)} />
        <p class="label">Muscle group (tap one to finish)</p>
        <Chips label="Muscle group" options={GROUPS} onPick={(g) => { addToLibrary(creating, g, equipment); choose(creating.trim()); }} />
      </div>
    );
  }
  const needle = q.trim().toLowerCase();
  const names = v.library.map((l) => l.Exercise).filter((n) => !item || !sameName(n, item.exercise));
  const match = (n) => !needle || n.toLowerCase().includes(needle);
  const group = item ? groupOf(v.library, item.planned || item.exercise) : null;
  const recent = [...v.hist.entries()].map(([ex, l]) => [ex, l[l.length - 1].date + l[l.length - 1].at]).sort((a, b) => b[1].localeCompare(a[1])).map((x) => x[0]);
  const used = new Set();
  const take = (list) => list.filter((n) => match(n) && !used.has(n.toLowerCase()) && used.add(n.toLowerCase()));
  const sections = [
    mode === 'swap' && group ? [`Same muscle group (${group})`, take(names.filter((n) => groupOf(v.library, n) === group))] : null,
    ['Recently used', take(recent.filter((n) => names.some((x) => sameName(x, n))).slice(0, 6))],
    ['All', take([...names].sort((a, b) => a.localeCompare(b)))],
  ].filter((s) => s && s[1].length);
  const exact = v.library.some((l) => sameName(l.Exercise, q));
  return (
    <div class="stack">
      <input class="text" type="search" placeholder="Search exercises" value={q} onInput={(e) => setQ(e.target.value)} maxLength={60} aria-label="Search exercises" />
      {mode === 'swap' && (
        <div>
          <p class="label">Reason (optional, pick before the exercise)</p>
          <Chips label="Swap reason" options={SWAP_REASONS} value={reason} onPick={(r) => setReason(r === reason ? '' : r)} />
        </div>
      )}
      <div class="list">
        {needle && !exact && <button class="listrow new" onClick={() => setCreating(q.trim())}><Icon name="plus" />Add '{q.trim()}' as a new exercise</button>}
        {sections.map(([title, list]) => (
          <div key={title}>
            <p class="label">{title}</p>
            {list.map((n) => <button key={n} class="listrow" onClick={() => choose(n)}>{n}<span class="muted">{groupOf(v.library, n)}</span></button>)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditSet({ set, onSave, onRemove, onClose }) {
  const [kg, setKg] = useState(Number(set.kg) || 0);
  const [reps, setReps] = useState(Number(set.reps) || 0);
  const [rpe, setRpe] = useState(set.rpe ?? '');
  return (
    <Sheet title="Edit set" onClose={onClose}>
      <div class="entry">
        <Stepper label="kg" value={kg} step={2.5} alt={[1.25, 5]} onChange={setKg} big />
        <Stepper label="reps" value={reps} step={1} onChange={setReps} big />
      </div>
      <p class="label">RPE (optional)</p>
      <Chips label="RPE" options={[6, 7, 8, 9, 10]} value={rpe} onPick={(r) => setRpe(String(r) === String(rpe) ? '' : r)} />
      <div class="row gap">
        {onRemove && <button class="btn ghost" onClick={onRemove}>Remove set</button>}
        <button class="btn" onClick={() => onSave({ kg, reps, rpe })}>Save</button>
      </div>
    </Sheet>
  );
}

function ExerciseCard({ it, index, count }) {
  const [open, setOpen] = useState(false);
  const [rpeOpen, setRpeOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const last = lastFor(it);
  const d = draftOf(it);
  const target = it.target ? `${it.setsText || it.target} x ${it.reps || '?'}` : '';
  const upcoming = Math.max(0, (it.target || 0) - it.sets.length - 1);
  const unit = /\d\s*s(ec|\b)/i.test(it.reps) ? 'secs' : 'reps'; // timed holds such as "30s"
  return (
    <section class="card exercise">
      <p class="muted small">Exercise {index + 1} of {count}{it.block === 'Warm-up' ? ', warm-up' : ''}</p>
      <h1>{it.exercise}</h1>
      <div class="row wrap gap">
        {it.kind === 'swapped' && <Tag kind="swapped" text={`Swapped from ${it.planned}`} />}
        {it.kind === 'added' && <Tag kind="added" />}
        {it.skipped && <Tag kind="skipped" text={`Skipped: ${it.skipped.reason}`} />}
      </div>
      {target && <p class="target">{target}</p>}
      <button class="reveal" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={open ? 'up' : 'down'} size={18} />{open ? 'Hide details' : 'Cue and last time'}
      </button>
      {open && (
        <div class="details">
          {it.tempo && <p><span class="muted">Tempo</span> {it.tempo}</p>}
          {it.rest && <p><span class="muted">Rest</span> {it.rest}</p>}
          {it.cue && <p><span class="muted">Chloe's note</span> {it.cue}</p>}
          <p><span class="muted">Last time</span> {last ? `${last.sets.map(fmtSet).join(', ')} (${niceDate(last.date)})` : 'No record yet'}</p>
          {it.note && <p><span class="muted">Your note</span> {it.note}</p>}
        </div>
      )}

      {it.skipped ? (
        <button class="btn ghost" onClick={() => unskip(it.key)}>Do it after all</button>
      ) : (
        <div class="sets">
          {it.sets.map((s, i) => (
            <button key={s.id} class="setrow logged" onClick={() => setEdit(s)} aria-label={`Set ${i + 1}, ${fmtKg(s.kg)} kg, ${s.reps} reps. Tap to edit`}>
              <span class="setno"><Icon name="check" size={16} />{i + 1}</span>
              <span class="setval">{fmtKg(s.kg)} kg x {s.reps}</span>
              <span class="muted">{s.rpe !== '' && s.rpe != null ? `RPE ${s.rpe}` : 'Edit'}</span>
            </button>
          ))}
          <div class="setrow current">
            <span class="setno">Set {it.sets.length + 1}</span>
            <div class="entry">
              <Stepper label="kg" value={d.kg} step={2.5} alt={[1.25, 5]} onChange={(kg) => setDraft(it.key, { kg })} big />
              <Stepper label={unit} value={d.reps} step={unit === 'secs' ? 5 : 1} alt={unit === 'secs' ? [1, 10] : null} onChange={(reps) => setDraft(it.key, { reps })} big />
            </div>
            <div class="row gap wrap">
              <button class="chip" onClick={() => setRpeOpen(!rpeOpen)} aria-expanded={rpeOpen}>{d.rpe !== '' ? `RPE ${d.rpe}` : 'Add RPE'}</button>
              {it.sets.length > 0 && (
                <button class="chip" onClick={() => { const p = it.sets[it.sets.length - 1]; logSet(it.key, { kg: p.kg, reps: p.reps, rpe: '' }); }}>Same as last set</button>
              )}
            </div>
            {rpeOpen && <Chips label="RPE" options={[6, 7, 8, 9, 10]} value={d.rpe} onPick={(r) => setDraft(it.key, { rpe: String(r) === String(d.rpe) ? '' : r })} />}
          </div>
          {Array.from({ length: upcoming }, (_, i) => (
            <div key={i} class="setrow todo"><span class="setno">{it.sets.length + 2 + i}</span><span class="muted">To do</span></div>
          ))}
        </div>
      )}
      {edit && (
        <EditSet set={edit} onClose={() => setEdit(null)}
          onSave={(p) => { editSet(it.key, edit.id, p); setEdit(null); }}
          onRemove={() => { editSet(it.key, edit.id, null); setEdit(null); }} />
      )}
    </section>
  );
}

export function Session({ go }) {
  useStore();
  useWakeLock();
  const s = S.active;
  const [sheet, setSheet] = useState(null);
  const [note, setNote] = useState('');
  const [area, setArea] = useState('');
  if (!s) return null;
  const it = s.items[s.cur];
  const close = () => setSheet(null);
  const legs = lowerBodyLeft();
  const left = unloggedMain(s);
  const lastOne = !s.items.some((x, i) => i !== s.cur && !isComplete(x));
  const next = () => {
    const n = s.items.findIndex((x, i) => i > s.cur && !isComplete(x));
    const any = s.items.findIndex((x) => !isComplete(x) && x !== it);
    if (n >= 0) goTo(n); else if (any >= 0) goTo(any); else finish();
  };
  const finish = () => (left.length ? setSheet('finish') : (finishSession(null), go('start')));
  const complete = it && isComplete(it);

  return (
    <div class="screen session">
      <header class="top">
        <button class="iconbtn" onClick={() => go('start')} aria-label="Back to start. The session stays open"><Icon name="left" /></button>
        <div class="grow">
          <strong>{s.name}</strong>
          <div class="row gap"><SyncBadge />{s.injury && <Tag kind="injury" />}</div>
        </div>
        <button class="iconbtn" onClick={() => setSheet('session')} aria-label="Session menu"><Icon name="dots" /></button>
      </header>

      {s.items.length > 0 && (
        <div class="pills" role="tablist" aria-label="Exercises">
          {s.items.map((x, i) => {
            const st = x.skipped ? 'skipped' : isComplete(x) ? 'done' : x.sets.length ? 'part' : 'todo';
            return (
              <button key={x.key} role="tab" aria-selected={i === s.cur} class={`pill ${st} ${i === s.cur ? 'cur' : ''}`} onClick={() => goTo(i)}
                aria-label={`${i + 1}. ${x.exercise}, ${st === 'todo' ? 'to do' : st === 'part' ? 'started' : st}`}>
                {st === 'done' ? <Icon name="check" size={16} /> : st === 'skipped' ? <Icon name="skip" size={16} /> : i + 1}
              </button>
            );
          })}
        </div>
      )}

      {it ? (
        <ExerciseCard key={it.key} it={it} index={s.cur} count={s.items.length} />
      ) : (
        <section class="card">
          <h1>Build your own</h1>
          <p class="muted">Start with an empty session and add what you do.</p>
          <button class="btn" onClick={() => setSheet('add')}>Add an exercise</button>
        </section>
      )}

      <div class="dock">
        {s.timer && <RestTimer t={s.timer} />}
        {it && (
          <div class="row gap">
            <button class="btn ghost side" onClick={() => setSheet('item')} aria-label="Exercise options"><Icon name="dots" />Options</button>
            {complete ? (
              <>
                {!it.skipped && <button class="btn ghost side" onClick={() => logSet(it.key)}>Extra set</button>}
                <button class="btn grow" onClick={next}>{lastOne ? 'Finish session' : 'Next exercise'}</button>
              </>
            ) : (
              <>
                {it.sets.length > 0 && <button class="btn ghost side" onClick={next}>Next</button>}
                <button class="btn grow" onClick={() => logSet(it.key)}>Log set {it.sets.length + 1}</button>
              </>
            )}
          </div>
        )}
        {!it && <button class="btn ghost" onClick={() => (finishSession(null), go('start'))}>Finish session</button>}
      </div>

      {sheet === 'item' && (
        <Sheet title={it.exercise} onClose={close}>
          <div class="list">
            {!isLogged(it) && <button class="listrow" onClick={() => setSheet('skip')}><Icon name="skip" />Skip</button>}
            {!isLogged(it) && <button class="listrow" onClick={() => setSheet('swap')}><Icon name="swap" />Swap</button>}
            <button class="listrow" onClick={() => { setNote(it.note || ''); setSheet('note'); }}><Icon name="note" />Add note</button>
            <button class="listrow" disabled={s.cur === 0} onClick={() => moveItem(it.key, -1)}><Icon name="up" />Move up</button>
            <button class="listrow" disabled={s.cur === s.items.length - 1} onClick={() => moveItem(it.key, 1)}><Icon name="down" />Move down</button>
          </div>
        </Sheet>
      )}
      {sheet === 'skip' && (
        <Sheet title={`Skip ${it.exercise}?`} onClose={close}>
          <Reasons options={SKIP_REASONS} onPick={(r) => { skipItem(it.key, r); close(); }} />
          <button class="link" onClick={() => { setNote(it.note || ''); setSheet('note'); }}>Add a note</button>
        </Sheet>
      )}
      {sheet === 'swap' && <Sheet title={`Swap ${it.exercise}`} onClose={close} tall><Picker mode="swap" item={it} onDone={close} /></Sheet>}
      {sheet === 'add' && <Sheet title="Add an exercise" onClose={close} tall><Picker mode="add" onDone={close} /></Sheet>}
      {sheet === 'note' && (
        <Sheet title="Add note" sub={it.exercise} onClose={close}>
          <form class="stack" onSubmit={(e) => { e.preventDefault(); setItemNote(it.key, note.trim()); close(); }}>
            <input class="text" autoFocus value={note} onInput={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note for Chloe" />
            <button class="btn">Save note</button>
          </form>
        </Sheet>
      )}
      {sheet === 'session' && (
        <Sheet title={s.name} onClose={close}>
          <div class="list">
            <button class="listrow" onClick={() => setSheet('add')}><Icon name="plus" />Add an exercise</button>
            {legs.length > 0 && <button class="listrow" onClick={() => setSheet('legs')}><Icon name="skip" />Skip legs</button>}
            <button class="listrow" onClick={() => { setArea(''); setNote(''); setSheet('injury'); }}><Icon name="flag" />Anything niggling?</button>
            <button class="listrow" onClick={finish}><Icon name="check" />Finish session</button>
          </div>
        </Sheet>
      )}
      {sheet === 'legs' && (
        <Sheet title="Skip legs?" sub={`This skips ${legs.length} ${legs.length === 1 ? 'exercise' : 'exercises'}.`} onClose={close}>
          <Reasons options={['Cycled in', ...SKIP_REASONS]} onPick={(r) => { skipLegs(r); close(); }} />
        </Sheet>
      )}
      {sheet === 'injury' && (
        <Sheet title="Anything niggling?" sub="Optional. This is just information for Chloe." onClose={close}>
          <form class="stack" onSubmit={(e) => { e.preventDefault(); setInjury(area, note.trim()); close(); }}>
            <Chips label="Area" options={AREAS} value={area} onPick={(a) => setArea(a === area ? '' : a)} />
            <input class="text" value={note} onInput={(e) => setNote(e.target.value)} maxLength={200} placeholder="What did you notice?" />
            <div class="row gap">
              {s.injury && <button type="button" class="btn ghost" onClick={() => { setInjury('', ''); close(); }}>Clear flag</button>}
              <button class="btn" disabled={!area && !note.trim()}>Save</button>
            </div>
          </form>
        </Sheet>
      )}
      {sheet === 'finish' && (
        <Sheet title={`${left.length} ${left.length === 1 ? 'exercise' : 'exercises'} not logged.`} sub="Mark them as skipped?" onClose={close}>
          <Reasons options={['Short on time', 'Machine busy', 'Injury or niggle', 'Not feeling it', 'Other']} onPick={(r) => { finishSession(r); go('start'); }} />
          <button class="btn ghost" onClick={() => { finishSession(null); go('start'); }}>Leave them</button>
        </Sheet>
      )}
    </div>
  );
}

export function Summary({ done }) {
  useStore();
  const m = S.summary;
  const [note, setNote] = useState(m.note);
  const st = sessionStats(view().bySession[m.id] || []);
  const l = syncLabel();
  return (
    <div class="screen">
      <header class="top"><div class="grow"><p class="muted small">Session finished</p><h1>{m.name}</h1></div></header>
      <section class="card">
        <dl class="stats">
          <div><dt>Duration</dt><dd>{fmtDuration(m.minutes)}</dd></div>
          <div><dt>Total volume</dt><dd>{st.volume.toLocaleString('en-GB')} kg</dd></div>
          <div><dt>Sets done</dt><dd>{st.sets}</dd></div>
          <div><dt>Skipped</dt><dd>{st.skipped}</dd></div>
          <div><dt>Swapped</dt><dd>{st.swapped}</dd></div>
          <div><dt>Added</dt><dd>{st.added}</dd></div>
        </dl>
      </section>
      <section class="card">
        <h2>Improved on last time</h2>
        {m.improved.length ? <ul class="plain">{m.improved.map((t) => <li key={t}>{t}</li>)}</ul> : <p class="muted">Nothing higher than last time.</p>}
      </section>
      <section class="card">
        <h2>Session note (optional)</h2>
        <input class="text" value={note} onInput={(e) => setNote(e.target.value)} onBlur={() => note.trim() !== m.note && saveSummaryNote(note.trim())} maxLength={300} placeholder="For example: cycled in, skipped legs" />
      </section>
      <div class="dock">
        <p class={`syncline sync-${l.tone}`}>Sync status: {l.text}</p>
        <div class="row gap">
          <button class="btn ghost side" onClick={() => { if (note.trim() !== m.note) saveSummaryNote(note.trim()); syncNow(); }}>Sync now</button>
          <button class="btn grow" onClick={() => { if (note.trim() !== m.note) saveSummaryNote(note.trim()); syncNow(); done(); }}>Done</button>
        </div>
      </div>
    </div>
  );
}
