import { useState } from 'preact/hooks';
import { S, useStore, view, updateRow, deleteSession } from './store.js';
import { Icon, Tag, Sheet, Chips, LineChart } from './ui.jsx';
import { EditSet, Description } from './session.jsx';
import { WeekStrip } from './start.jsx';
import {
  niceDate, isoOf, addDays, mondayOf, sessionModeLabel, sessionExercises, fmtKg, fmtSet, e1rm, weekCells, DAY_FULL,
} from './logic.js';

const nameOf = (s) => (s.Mode === 'freestyle' ? 'Freestyle' : (S.boot.planDays.find((p) => p.Day === s.Day) || {}).SessionName || `${DAY_FULL[s.Day] || s.Day} session`);

function SessionRow({ s, onOpen }) {
  const st = s._stats;
  return (
    <button class="card pick" onClick={onOpen}>
      <div class="row between"><h2>{nameOf(s)}</h2><span class="muted">{niceDate(s.Date)}</span></div>
      <div class="row gap wrap">
        <span class={`badge mode-${s.Mode === 'as planned' ? 'ok' : s.Mode}`}>{sessionModeLabel[s.Mode] || s.Mode}{!s.End ? ', not finished' : ''}</span>
        {s.Injury === true && <Tag kind="injury" />}
      </div>
      <p class="muted small">{st.volume.toLocaleString('en-GB')} kg volume, {st.sets} sets, {st.skipped} skipped</p>
    </button>
  );
}

function SessionDetail({ s, onClose }) {
  const [edit, setEdit] = useState(null);
  const rows = view().bySession[s.SessionID] || [];
  return (
    <Sheet title={nameOf(s)} sub={niceDate(s.Date)} onClose={onClose} tall>
      {s.Note && <p class="notebox">{s.Injury === true && <Tag kind="injury" />} {s.Note}</p>}
      {!rows.length && <p class="muted">Nothing was logged.</p>}
      {sessionExercises(rows).map((ex) => (
        <div class="histex" key={ex.exercise + ex.status}>
          <div class="row between">
            <strong>{ex.exercise}</strong>
            {ex.status !== 'done' && <Tag kind={ex.status} />}
          </div>
          {ex.status === 'swapped' && ex.planned && <p class="muted small">Instead of {ex.planned}</p>}
          {ex.rows.map((r) => r.Status === 'skipped' ? (
            <p class="muted" key={r.ClientID}>{r.Note || 'No reason given'}</p>
          ) : (
            <button class="setrow logged" key={r.ClientID} onClick={() => setEdit(r)} aria-label={`Set ${r.SetNo}. Tap to edit`}>
              <span class="setno">{r.SetNo}</span>
              <span class="setval">{fmtKg(r.Kg)} kg x {r.Reps}</span>
              <span class="muted">{r.RPE !== '' && r.RPE != null ? `RPE ${r.RPE}` : 'Edit'}</span>
              {r.Note && <span class="muted small wide">{r.Note}</span>}
            </button>
          ))}
        </div>
      ))}
      {(!S.active || S.active.id !== s.SessionID) && (
        <button class="btn ghost danger" onClick={() => { deleteSession(s.SessionID); onClose(); }}>Delete this session</button>
      )}
      {edit && (
        <EditSet set={{ kg: edit.Kg, reps: edit.Reps, rpe: edit.RPE }} onClose={() => setEdit(null)}
          onSave={(p) => { updateRow(edit, { Kg: p.kg, Reps: p.reps, RPE: p.rpe === '' ? '' : Number(p.rpe) }); setEdit(null); }} />
      )}
    </Sheet>
  );
}

function ExerciseView() {
  const v = view();
  const names = [...v.hist.keys()];
  const recents = names.map((n) => { const l = v.hist.get(n); return [n, l[l.length - 1].date + l[l.length - 1].at]; }).sort((a, b) => b[1].localeCompare(a[1])).map((x) => x[0]);
  const [ex, setEx] = useState(recents[0] || '');
  const [q, setQ] = useState('');
  const [metric, setMetric] = useState('Top weight');
  const [range, setRange] = useState('12 weeks');
  if (!names.length) return <p class="muted pad">Nothing logged yet. Your exercises appear here after the first session.</p>;
  const needle = q.trim().toLowerCase();
  const shown = needle ? names.filter((n) => n.toLowerCase().includes(needle)).sort() : recents.slice(0, 6);
  const from = range === 'All' ? '' : addDays(isoOf(new Date()), range === '4 weeks' ? -28 : -84);
  const list = (v.hist.get(ex) || []).filter((g) => g.date >= from);
  const points = list.map((g) => {
    const y = metric === 'Top weight' ? Math.max(...g.sets.map((s) => s.kg)) : Math.max(...g.sets.map((s) => e1rm(s.kg, s.reps)));
    return { y, label: niceDate(g.date).slice(4) };
  });
  return (
    <div class="stack">
      <input class="text" type="search" placeholder="Search exercises" value={q} onInput={(e) => setQ(e.target.value)} aria-label="Search exercises" />
      <Chips label={needle ? 'Matches' : 'Recent exercises'} options={shown} value={ex} onPick={(n) => { setEx(n); setQ(''); }} />
      {ex && (
        <section class="card">
          <h2>{ex}</h2>
          <Description name={ex} />
          <Chips label="Measure" options={['Top weight', 'Estimated 1RM']} value={metric} onPick={setMetric} />
          <Chips label="Range" options={['4 weeks', '12 weeks', 'All']} value={range} onPick={setRange} />
          {points.length >= 2 ? <LineChart points={points} unit="kg" />
            : points.length === 1 ? <p>One session in this range: {list[0].sets.map(fmtSet).join(', ')} on {niceDate(list[0].date)}. {metric} {fmtKg(Math.round(points[0].y * 10) / 10)} kg.</p>
            : <p class="muted">No sessions in this range.</p>}
          <h3>Recent sessions</h3>
          <ul class="plain">
            {[...list].reverse().slice(0, 12).map((g) => (
              <li key={g.sessionId}><span class="muted">{niceDate(g.date)}</span> {g.sets.map(fmtSet).join(', ')}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function WeekView({ open }) {
  const v = view();
  const today = isoOf(new Date());
  const [sel, setSel] = useState(null);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(mondayOf(today), -7 * i));
  return (
    <div class="stack">
      <p class="muted small legend">Tick: done. Green ring: partly done. Dash: skipped. Dotted ring: still to come. Small dot: not planned.</p>
      {weeks.map((mon) => {
        const inWeek = v.sessions.filter((s) => s.Date >= mon && s.Date <= addDays(mon, 6));
        return (
          <section class="card" key={mon}>
            <button class="row between rowbtn" onClick={() => setSel(sel === mon ? null : mon)} aria-expanded={sel === mon}>
              <strong>{mon === mondayOf(today) ? 'This week' : `Week of ${niceDate(mon).slice(4)}`}</strong>
              <span class="muted">{inWeek.length} {inWeek.length === 1 ? 'session' : 'sessions'} <Icon name={sel === mon ? 'up' : 'down'} size={16} /></span>
            </button>
            <WeekStrip cells={weekCells(mon, today, S.boot.planDays, v.sessions)} />
            {sel === mon && (inWeek.length ? inWeek.map((s) => <SessionRow key={s.SessionID} s={s} onOpen={() => open(s)} />) : <p class="muted">No sessions logged.</p>)}
          </section>
        );
      })}
    </div>
  );
}

export function History() {
  useStore();
  const [tab, setTab] = useState('Sessions');
  const [open, setOpen] = useState(null);
  const v = view();
  const current = open && v.sessions.find((s) => s.SessionID === open);
  return (
    <div class="screen">
      <header class="top"><div class="grow"><h1>History</h1></div></header>
      <Chips label="View" options={['Sessions', 'Exercise', 'Week']} value={tab} onPick={setTab} />
      {tab === 'Sessions' && (
        <div class="stack">
          {v.sessions.length ? v.sessions.map((s) => <SessionRow key={s.SessionID} s={s} onOpen={() => setOpen(s.SessionID)} />)
            : <p class="muted pad">No sessions yet.</p>}
        </div>
      )}
      {tab === 'Exercise' && <ExerciseView />}
      {tab === 'Week' && <WeekView open={(s) => setOpen(s.SessionID)} />}
      {current && <SessionDetail s={current} onClose={() => setOpen(null)} />}
    </div>
  );
}
