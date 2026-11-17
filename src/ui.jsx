import { useEffect, useRef, useState } from 'preact/hooks';
import { S, useStore, syncLabel, dismissUndo } from './store.js';
import { fmtKg } from './logic.js';

const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  skip: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  flag: 'M6 21V4h11l-2 4 2 4H6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  left: 'M14 6l-6 6 6 6',
  right: 'M10 6l6 6-6 6',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  note: 'M5 4h14v12l-4 4H5zM9 9h6M9 13h4',
  today: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  history: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8',
};
export const Icon = ({ name, size = 20 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);

const TAGS = {
  done: ['check', 'Done'], skipped: ['skip', 'Skipped'], swapped: ['swap', 'Swapped'], added: ['plus', 'Added'], injury: ['flag', 'Injury'],
};
export const Tag = ({ kind, text }) => (
  <span class={`tag tag-${kind}`}><Icon name={TAGS[kind][0]} size={14} />{text || TAGS[kind][1]}</span>
);

export function Sheet({ title, sub, onClose, children, tall }) {
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-label={title}>
        <div class="sheet-head">
          <div><h2>{title}</h2>{sub && <p class="muted">{sub}</p>}</div>
          <button class="iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export const Chips = ({ options, value, onPick, label }) => (
  <div class="chips" role="group" aria-label={label}>
    {options.map((o) => (
      <button type="button" key={o} class={`chip ${String(value) === String(o) ? 'on' : ''}`} onClick={() => onPick(o)}>{o}</button>
    ))}
  </div>
);

// Big +/- buttons. Tap the number to type it. Long-press a button for the other step sizes.
export function Stepper({ label, value, step, alt, onChange, big }) {
  const [typing, setTyping] = useState(false);
  const [pop, setPop] = useState(0);
  const hold = useRef(null);
  const round = (n) => Math.max(0, Math.round(n * 100) / 100);
  const press = (dir) => ({
    onPointerDown: () => { if (alt) hold.current = setTimeout(() => { hold.current = 'held'; setPop(dir); }, 450); },
    onPointerLeave: () => { if (hold.current !== 'held') clearTimeout(hold.current); },
    onContextMenu: (e) => e.preventDefault(),
    onClick: () => {
      if (hold.current === 'held') { hold.current = null; return; }
      clearTimeout(hold.current);
      setPop(0);
      onChange(round(Number(value) + dir * step));
    },
  });
  const commit = (e) => { const n = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(n)) onChange(round(n)); setTyping(false); };
  return (
    <div class={`stepper ${big ? 'big' : ''}`}>
      <div class="stepper-row">
        <button class="stepbtn" aria-label={`Less ${label}`} {...press(-1)}><Icon name="minus" size={26} /></button>
        {typing ? (
          <input class="num" type="number" inputMode="decimal" step="any" defaultValue={value} autoFocus aria-label={label}
            onFocus={(e) => e.target.select()} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
        ) : (
          <button class="num" onClick={() => setTyping(true)} aria-label={`${label}: ${fmtKg(value)}. Tap to type`}>{fmtKg(value)}<span class="stepper-label">{label}</span></button>
        )}
        <button class="stepbtn" aria-label={`More ${label}`} {...press(1)}><Icon name="plus" size={26} /></button>
      </div>
      {pop !== 0 && (
        <div class="steppop">
          {alt.map((a) => (
            <button key={a} class="chip" onClick={() => { onChange(round(Number(value) + pop * a)); setPop(0); }}>{pop > 0 ? '+' : '-'}{a}</button>
          ))}
          <button class="chip ghost" onClick={() => setPop(0)}>Close</button>
        </div>
      )}
    </div>
  );
}

export function UndoBar() {
  useStore();
  if (!S.undo) return null;
  return (
    <div class="undo" role="status">
      <span>{S.undo.label}</span>
      <button onClick={() => S.undo.run()}>Undo</button>
      <button class="iconbtn" onClick={dismissUndo} aria-label="Dismiss"><Icon name="close" size={16} /></button>
    </div>
  );
}

export function SyncBadge() {
  useStore();
  const l = syncLabel();
  return <span class={`sync sync-${l.tone}`}><i />{l.text}</span>;
}

export const Nav = ({ screen, go }) => (
  <nav class="nav">
    {[['start', 'today', 'Today'], ['history', 'history', 'History'], ['settings', 'settings', 'Settings']].map(([id, icon, label]) => (
      <button key={id} class={screen === id ? 'on' : ''} onClick={() => go(id)}><Icon name={icon} size={22} />{label}</button>
    ))}
  </nav>
);

// Inline SVG line chart in the accent colour. The best point gets a small dot and label.
export function LineChart({ points, unit }) {
  const W = 340, H = 180, L = 38, R = 12, T = 16, B = 26;
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1) { hi += 1; lo = Math.max(0, lo - 1); }
  const padY = (hi - lo) * 0.15; lo = Math.max(0, lo - padY); hi += padY;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, points.length - 1);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const bi = ys.indexOf(Math.max(...ys));
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Line chart, ${points.length} sessions, best ${fmtKg(ys[bi])} ${unit}`}>
      {ticks.map((t) => (
        <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} class="grid" /><text x={L - 6} y={y(t) + 4} text-anchor="end">{Math.round(t)}</text></g>
      ))}
      <polyline class="line" points={points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')} />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.y)} r={i === bi ? 5 : 3} class={i === bi ? 'dot best' : 'dot'} />)}
      <text x={Math.min(W - R - 30, Math.max(L + 30, x(bi)))} y={Math.max(11, y(ys[bi]) - 9)} text-anchor="middle" class="bestlabel">Best {fmtKg(Math.round(ys[bi] * 10) / 10)}</text>
      <text x={L} y={H - 6}>{points[0].label}</text>
      <text x={W - R} y={H - 6} text-anchor="end">{points[points.length - 1].label}</text>
    </svg>
  );
}

export function useTick(ms, on = true) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const i = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(i); }, [ms, on]);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

// The session summary as plain text, with Copy and (where the phone supports it) Share.
export function ShareSummary({ text, title }) {
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };
  return (
    <div class="stack tight">
      <div class="row gap">
        <button class="btn ghost grow" onClick={async () => flash((await copyText(text)) ? 'Copied. Paste it into Google Health or a message.' : 'Could not copy. Open the text and copy it by hand.')}><Icon name="copy" />Copy summary</button>
        {canShare && <button class="btn ghost grow" onClick={() => navigator.share({ title, text }).catch(() => {})}><Icon name="share" />Share</button>}
      </div>
      {msg && <p class="muted small" role="status">{msg}</p>}
      <button class="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide the text' : 'Show the text'}</button>
      {open && <pre class="summarytext">{text}</pre>}
    </div>
  );
}
