import { useState } from 'preact/hooks';
import { S, useStore, view, startSession, finishStale, discardSession, askSuggestion, startSuggested } from './store.js';
import { Icon, Sheet, SyncBadge, Tag } from './ui.jsx';
import {
  isoOf, dayOf, candidates, preselect, describeDay, weekCells, mondayOf, niceDate, lastTime, sameName, groupOf, fmtKg,
  DAY_FULL, FOCUS_GRADIENT, DEFAULT_GRADIENT, GROUP_COLOURS,
} from './logic.js';

const CELL_LABEL = { done: 'trained, on plan', off: 'trained, not on plan', partly: 'partly done', skipped: 'skipped', upcoming: 'planned', none: 'rest day' };

export function WeekStrip({ cells, onPick, selected }) {
  return (
    <div class="week" role="group" aria-label="This week">
      {cells.map((c) => (
        <button key={c.date} class={`weekday ${c.state} ${c.isToday ? 'today' : ''} ${selected === c.day ? 'sel' : ''}`} disabled={!onPick}
          onClick={() => onPick && onPick(c.day)} aria-label={`${DAY_FULL[c.day]}, ${CELL_LABEL[c.state]}`}>
          <span>{c.day[0]}</span>
          <i>{c.state === 'done' || c.state === 'off' ? <Icon name="check" size={12} /> : c.state === 'skipped' ? <Icon name="minus" size={12} /> : null}</i>
        </button>
      ))}
    </div>
  );
}

function DayCard({ c, plan, compact, onClick }) {
  const d = describeDay(c, plan);
  const Inner = (
    <>
      {!compact && <div class="heroband" style={{ background: FOCUS_GRADIENT[c.Focus] || DEFAULT_GRADIENT }}><span>{c.Focus || 'Session'}</span><span>{c.Location}</span></div>}
      <div class="row between">
        <h2>{d.title}</h2>
        {compact ? <span class={`badge ${c.doneThisWeek ? 'ok' : ''}`}>{c.doneThisWeek ? 'Done this week' : 'Not done this week'}</span> : c.done && <Tag kind="done" />}
      </div>
      <p class="meta">{d.meta}</p>
      <p class="muted">{d.summary}</p>
      <p class="muted small">{d.count} exercises, about {d.minutes} min</p>
    </>
  );
  return compact ? <button class="card pick" style={{ '--g-bg': FOCUS_GRADIENT[c.Focus] || DEFAULT_GRADIENT }} onClick={onClick}>{Inner}</button> : <div class="stack tight">{Inner}</div>;
}

const EXAMPLES = ['Legs, about 30 minutes', 'Upper body, go easy on the shoulders', 'Full body, 45 minutes'];

// Describe what you fancy, see a suggested session, then start it, ask again or cancel.
function Suggest({ onClose, onStart, onFreestyle }) {
  const [text, setText] = useState('');
  const [step, setStep] = useState('ask'); // ask, busy, show, failed
  const [sug, setSug] = useState(null);
  const [error, setError] = useState('');
  const ask = async (e) => {
    if (e) e.preventDefault();
    if (!text.trim()) return;
    setStep('busy');
    try { setSug(await askSuggestion(text.trim())); setStep('show'); } catch (err) { setError(err.message); setStep('failed'); }
  };
  const v = view();
  return (
    <Sheet title="Suggest a session" sub={step === 'ask' ? 'Say what you fancy. The app suggests a session you can start straight away.' : null} onClose={onClose} tall>
      {step === 'ask' && (
        <form class="stack" onSubmit={ask}>
          <label class="field">What would you like to do?
            <textarea class="text area" rows={3} maxLength={300} value={text} onInput={(e) => setText(e.target.value)} placeholder="For example: legs, about 30 minutes" />
          </label>
          <div class="chips" role="group" aria-label="Examples">
            {EXAMPLES.map((x) => <button type="button" key={x} class="chip" onClick={() => setText(x)}>{x}</button>)}
          </div>
          <button class="btn big" disabled={!text.trim()}>Suggest</button>
          <p class="muted small">Your request goes to an AI service (Groq), with each library exercise's name, muscle group and heaviest set last time. No dates, notes or injury details are sent.</p>
        </form>
      )}
      {step === 'busy' && <p class="muted pad" role="status">Putting a session together...</p>}
      {step === 'failed' && (
        <div class="stack">
          <p role="alert">{error}</p>
          <button class="btn" onClick={() => ask()}>Try again</button>
          <button class="btn ghost" onClick={onFreestyle}>Freestyle session</button>
        </div>
      )}
      {step === 'show' && sug && (
        <div class="stack">
          <div>
            <h2>{sug.name}</h2>
            <p class="muted small">For "{text.trim()}". {sug.exercises.length} exercises, {sug.exercises.reduce((t, x) => t + x.sets, 0)} sets.</p>
          </div>
          <div class="sugglist">
            {sug.exercises.map((x) => {
              const known = v.library.some((l) => sameName(l.Exercise, x.exercise));
              const group = known ? groupOf(v.library, x.exercise) : x.group;
              const last = lastTime(v.hist, x.exercise, null);
              const top = last && last.sets.reduce((b, y) => (y.kg > b.kg ? y : b), last.sets[0]);
              return (
                <div key={x.exercise} class="suggrow" style={{ '--g': GROUP_COLOURS[group] || GROUP_COLOURS.Other }}>
                  <div class="row between"><strong>{x.exercise}</strong>{!known && <Tag kind="added" text="New" />}</div>
                  <p class="muted small">{x.sets} x {x.reps}, rest {x.rest}. {group}.</p>
                  <p class="small">{last ? `Last time: ${fmtKg(top.kg)} kg x ${top.reps}` : x.kg > 0 ? `Suggested start: ${fmtKg(x.kg)} kg` : 'Bodyweight'}</p>
                  {!known && <p class="muted small">Added to your library when you start.</p>}
                </div>
              );
            })}
          </div>
          <button class="btn big" onClick={() => onStart(sug)}>Start session</button>
          <div class="row gap">
            <button class="btn ghost grow" onClick={() => ask()}>Ask again</button>
            <button class="btn ghost grow" onClick={() => setStep('ask')}>Change request</button>
          </div>
          <button class="link" onClick={onClose}>Cancel</button>
        </div>
      )}
    </Sheet>
  );
}

export function Start({ go }) {
  useStore();
  const v = view();
  const today = isoOf(new Date());
  const [pick, setPick] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [warm, setWarm] = useState(S.prefs.warm !== false);
  const cands = candidates(today, S.boot.planDays, v.sessions);
  // A tapped rest day selects the day itself; any other pick (or none) selects a planned session.
  const restPick = pick && !S.boot.planDays.some((p) => p.Day === pick) ? pick : null;
  const sel = restPick ? null : cands.find((c) => c.Day === pick) || preselect(cands);
  const [suggest, setSuggest] = useState(false);
  const freestyle = () => { startSession(null, false); setSheet(false); setSuggest(false); go('session'); };
  const a = S.active;
  const stale = a && Date.now() - new Date(a.start).getTime() > 12 * 3600 * 1000;
  const d = sel && describeDay(sel, S.boot.plan);

  return (
    <div class="screen">
      <header class="top">
        <div class="grow"><p class="muted small">{niceDate(today)}</p><h1>Today</h1></div>
        <SyncBadge />
      </header>
      {S.boot.planDays.length > 0 && (
        <WeekStrip cells={weekCells(mondayOf(today), today, S.boot.planDays, v.sessions)} onPick={a ? null : setPick} selected={a ? null : restPick || (sel && sel.Day)} />
      )}

      {!S.settings.url ? (
        <section class="card">
          <h2>Connect your sheet</h2>
          <p class="muted">Add the script URL and key once. They stay on this phone.</p>
          <button class="btn" onClick={() => go('settings')}>Open Settings</button>
        </section>
      ) : stale ? (
        <section class="card">
          <h2>Finish yesterday's session?</h2>
          <p class="muted">{a.name}, started {niceDate(a.date)}. Finish keeps what you logged. Discard removes it.</p>
          <div class="row gap">
            <button class="btn ghost" onClick={discardSession}>Discard</button>
            <button class="btn" onClick={finishStale}>Finish</button>
          </div>
        </section>
      ) : a ? (
        <section class="card hero">
          <p class="muted small">In progress</p>
          <h2>{a.name}</h2>
          <p class="muted">{a.items.filter((i) => i.sets.length || i.skipped).length} of {a.items.length} exercises started</p>
          <button class="btn big" onClick={() => go('session')}>Resume</button>
        </section>
      ) : restPick ? (
        <section class="card">
          <h2>{DAY_FULL[restPick]} is a rest day in the plan</h2>
          <p class="muted">{S.boot.suggest ? 'Pick any planned session to do today, build your own, or ask for a suggestion.' : 'Pick any planned session to do today, or build your own.'}</p>
          <button class="btn big" onClick={() => setSheet(true)}>Pick a session</button>
          <button class="btn ghost" onClick={freestyle}>Freestyle session</button>
          {S.boot.suggest && <button class="btn ghost" onClick={() => setSuggest(true)}>Suggest a session</button>}
        </section>
      ) : !sel ? (
        <section class="card">
          <h2>No plan loaded yet</h2>
          <p class="muted">Open the app once with signal so it can fetch your plan, or start a freestyle session.</p>
          <button class="btn" onClick={freestyle}>Freestyle session</button>
        </section>
      ) : (
        <section class="card hero">
          <DayCard c={sel} plan={S.boot.plan} />
          {sel.Day !== dayOf(today) && <p class="small movednote">{DAY_FULL[sel.Day]}'s session, logged today</p>}
          {d.warm > 0 && (
            <div class="row between warm">
              <span>{warm ? `Warm-up first (${d.warm} exercises)` : 'Warm-up skipped'}</span>
              <button class="chip" onClick={() => setWarm(!warm)}>{warm ? 'Skip warm-up' : 'Include warm-up'}</button>
            </div>
          )}
          <button class="btn big" onClick={() => { startSession(sel, warm && d.warm > 0); go('session'); }}>Start session</button>
          <button class="link" onClick={() => setSheet(true)}>Change session</button>
        </section>
      )}

      {sheet && (
        <Sheet title="Change session" onClose={() => setSheet(false)} tall>
          <div class="stack">
            {cands.map((c) => <DayCard key={c.Day} c={c} plan={S.boot.plan} compact onClick={() => { setPick(c.Day); setSheet(false); }} />)}
            <button class="card pick" onClick={freestyle}>
              <h2>Freestyle session</h2><p class="muted">Build from scratch.</p>
            </button>
            {S.boot.suggest && (
              <button class="card pick" onClick={() => { setSheet(false); setSuggest(true); }}>
                <h2>Suggest a session</h2><p class="muted">Say what you fancy, such as "legs, 30 minutes", and get a session to start.</p>
              </button>
            )}
          </div>
        </Sheet>
      )}
      {suggest && <Suggest onClose={() => setSuggest(false)} onFreestyle={freestyle} onStart={(sug) => { startSuggested(sug); setSuggest(false); go('session'); }} />}
    </div>
  );
}
