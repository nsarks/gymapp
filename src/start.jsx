import { useState } from 'preact/hooks';
import { S, useStore, view, startSession, finishStale, discardSession } from './store.js';
import { Icon, Sheet, SyncBadge, Tag } from './ui.jsx';
import { isoOf, candidates, preselect, describeDay, weekCells, mondayOf, niceDate, DAY_FULL } from './logic.js';

const CELL_LABEL = { done: 'done', partly: 'partly done', skipped: 'skipped', upcoming: 'planned', none: 'not planned', free: 'freestyle' };

export function WeekStrip({ cells, onPick, selected }) {
  return (
    <div class="week" role="group" aria-label="This week">
      {cells.map((c) => (
        <button key={c.date} class={`weekday ${c.state} ${c.isToday ? 'today' : ''} ${selected === c.day ? 'sel' : ''}`} disabled={!c.planned || !onPick}
          onClick={() => onPick && onPick(c.day)} aria-label={`${DAY_FULL[c.day]}, ${CELL_LABEL[c.state]}`}>
          <span>{c.day[0]}</span>
          <i>{c.state === 'done' ? <Icon name="check" size={12} /> : c.state === 'skipped' ? <Icon name="minus" size={12} /> : null}</i>
        </button>
      ))}
    </div>
  );
}

function DayCard({ c, plan, compact, onClick }) {
  const d = describeDay(c, plan);
  const Inner = (
    <>
      <div class="row between">
        <h2>{d.title}</h2>
        {compact ? <span class={`badge ${c.doneThisWeek ? 'ok' : ''}`}>{c.doneThisWeek ? 'Done this week' : 'Not done this week'}</span> : c.done && <Tag kind="done" />}
      </div>
      <p class="meta">{d.meta}</p>
      <p class="muted">{d.summary}</p>
      <p class="muted small">{d.count} exercises, about {d.minutes} min</p>
    </>
  );
  return compact ? <button class="card pick" onClick={onClick}>{Inner}</button> : <div>{Inner}</div>;
}

export function Start({ go }) {
  useStore();
  const v = view();
  const today = isoOf(new Date());
  const [pick, setPick] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [warm, setWarm] = useState(S.prefs.warm !== false);
  const cands = candidates(today, S.boot.planDays, v.sessions);
  const sel = cands.find((c) => c.Day === pick) || preselect(cands);
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
        <WeekStrip cells={weekCells(mondayOf(today), today, S.boot.planDays, v.sessions)} onPick={a ? null : setPick} selected={!a && sel ? sel.Day : null} />
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
      ) : !sel ? (
        <section class="card">
          <h2>No plan loaded yet</h2>
          <p class="muted">Open the app once with signal so it can fetch your plan, or start a freestyle session.</p>
          <button class="btn" onClick={() => { startSession(null, false); go('session'); }}>Freestyle session</button>
        </section>
      ) : (
        <section class="card hero">
          <DayCard c={sel} plan={S.boot.plan} />
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
            <button class="card pick" onClick={() => { startSession(null, false); setSheet(false); go('session'); }}>
              <h2>Freestyle session</h2><p class="muted">Build from scratch.</p>
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
