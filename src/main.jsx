import { render } from 'preact';
import { useState } from 'preact/hooks';
import { S, useStore, init, emit } from './store.js';
import { Nav, UndoBar } from './ui.jsx';
import { Start } from './start.jsx';
import { Session, Summary } from './session.jsx';
import { History } from './history.jsx';
import { Settings } from './settings.jsx';
import './style.css';

function App() {
  useStore();
  const [screen, go] = useState('start');
  if (!S.ready) return null;
  if (S.summary) return <div class="app"><Summary done={() => { S.summary = null; go('start'); emit(); }} /></div>;
  const inSession = screen === 'session' && S.active;
  return (
    <div class="app">
      {inSession ? <Session go={go} /> : screen === 'history' ? <History /> : screen === 'settings' ? <Settings /> : <Start go={go} />}
      <UndoBar />
      {!inSession && <Nav screen={screen === 'session' ? 'start' : screen} go={go} />}
    </div>
  );
}

init();
render(<App />, document.getElementById('app'));
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
