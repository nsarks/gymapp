import { useState } from 'preact/hooks';
import { S, useStore, view, saveSettings, syncNow, refresh, syncLabel, TEST, resetTestData } from './store.js';
import { isoOf, addDays, toCsv } from './logic.js';

const HEAD = ['Date', 'Day', 'Exercise', 'PlannedExercise', 'Status', 'SetNo', 'Kg', 'Reps', 'RPE', 'Note', 'SessionID', 'LoggedAt'];

export function Settings() {
  useStore();
  const [url, setUrl] = useState(S.settings.url);
  const [key, setKey] = useState(S.settings.key);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const l = syncLabel();
  const save = async (e) => {
    e.preventDefault();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url.trim())) { setMsg('That does not look like a web app URL. It should start with https://script.google.com/macros/s/ and end with /exec.'); return; }
    setMsg('Checking...');
    setMsg((await saveSettings(url, key)) ? 'Connected. Plan loaded.' : `Saved, but could not connect: ${S.sync.error}`);
  };
  const exportCsv = () => {
    const from = addDays(isoOf(new Date()), -30);
    const rows = view().rows.filter((r) => r.Date >= from).sort((a, b) => String(a.LoggedAt).localeCompare(String(b.LoggedAt)));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(rows, HEAD)], { type: 'text/csv' }));
    a.download = `gym-log-${isoOf(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  return (
    <div class="screen">
      <header class="top"><div class="grow"><h1>Settings</h1></div></header>
      {TEST ? (
        <section class="card stack">
          <h2>Test version</h2>
          <p class="muted">This is the test site. It uses invented data and never connects to your sheet. Anything logged here stays in this browser.</p>
          <button class="btn ghost" onClick={resetTestData}>Reset test data</button>
        </section>
      ) : (
        <form class="card stack" onSubmit={save}>
          <h2>Sheet connection</h2>
          <p class="muted small">Stored on this phone only. Do not share either of these with anyone.</p>
          <label class="field">Script URL
            <input class="text" type="url" value={url} onInput={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off" autocapitalize="off" spellcheck={false} />
          </label>
          <label class="field">Secret key
            <input class="text" type={show ? 'text' : 'password'} value={key} onInput={(e) => setKey(e.target.value)} autocomplete="off" autocapitalize="off" spellcheck={false} />
          </label>
          <div class="row gap">
            <button type="button" class="btn ghost side" onClick={() => setShow(!show)}>{show ? 'Hide key' : 'Show key'}</button>
            <button class="btn grow">Save and connect</button>
          </div>
          {msg && <p class="muted" role="status">{msg}</p>}
        </form>
      )}
      <section class="card stack">
        <h2>Sync</h2>
        <p class={`syncline sync-${l.tone}`}>Status: {l.text}</p>
        <p class="muted small">{S.queue.length} waiting to send. {S.sync.last ? `Last synced ${new Date(S.sync.last).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : ''}</p>
        <button class="btn ghost" onClick={() => syncNow().then(refresh)}>Force sync</button>
      </section>
      <section class="card stack">
        <h2>Export</h2>
        <button class="btn ghost" onClick={exportCsv}>Export last 30 days as CSV</button>
      </section>
      <p class="muted small pad">Gym log 1.0. Weights in kilograms.</p>
    </div>
  );
}
