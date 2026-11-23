import { render } from 'preact';
import { useState } from 'preact/hooks';
import { S, useStore, init, emit, TEST } from './store.js';
import { Nav, UndoBar } from './ui.jsx';
import { Start } from './start.jsx';
import { Session, Summary } from './session.jsx';
import { History } from './history.jsx';
import { Settings } from './settings.jsx';
import './style.css';

// Always on screen in the test site, so it cannot be mistaken for the real app.
const TestBar = () => (TEST ? <div class="testbar" role="note">Test version. Invented data, not your sheet.</div> : null);

function App() {
  useStore();
  const [screen, go] = useState('start');
  if (!S.ready) return null;
  if (S.summary) return <div class="app"><TestBar /><Summary done={() => { S.summary = null; go('start'); emit(); }} /></div>;
  const inSession = screen === 'session' && S.active;
  return (
    <div class="app">
      <TestBar />
      {inSession ? <Session go={go} /> : screen === 'history' ? <History /> : screen === 'settings' ? <Settings /> : <Start go={go} />}
      <UndoBar />
      {!inSession && <Nav screen={screen === 'session' ? 'start' : screen} go={go} />}
    </div>
  );
}

init();
render(<App />, document.getElementById('app'));
// The test site registers no worker: it shares the origin with the real app and does not need to work offline.
if (!TEST && 'serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
