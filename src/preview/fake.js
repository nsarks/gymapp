// The test site's backend: the real Code.gs running in the page against the mock sheet, with invented data.
// Only the test build loads this file. It never makes a network request.
import code from '../../apps-script/Code.gs?raw';
import { fixtureBook, gasGlobals, dumpBook, loadBook } from './sheet.js';
import { seedOps } from './seed.js';
import { isoOf, uuid } from '../logic.js';

const STATE = 'testSheet';
// Turns on "Suggest a session". Not a real key: the fake Groq in sheet.js answers, and nothing leaves the page.
const TEST_PROPS = { GROQ_API_KEY: 'test-site-only' };
let ready = null;

function run(book, props) {
  const g = gasGlobals(book, props, { uuid });
  const names = Object.keys(g);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `${code}\nreturn { doPost, setup };`)(...names.map((k) => g[k]));
}

function post(f, body) {
  // The fake holds its own key, so the app needs no Settings in test mode.
  const out = f.api.doPost({ postData: { contents: JSON.stringify({ ...body, key: f.props.KEY }) } });
  return JSON.parse(out.text);
}

async function open(store) {
  const saved = await store.get(STATE);
  if (saved) {
    const book = loadBook(saved.book), props = { ...saved.props, ...TEST_PROPS };
    return { api: run(book, props), book, props };
  }
  const book = fixtureBook(), props = { ...TEST_PROPS };
  const f = { api: run(book, props), book, props };
  f.api.setup();
  const boot = post(f, { action: 'bootstrap' });
  post(f, { action: 'sync', ops: seedOps(boot, isoOf(new Date())) });
  await persist(f, store);
  return f;
}

const persist = (f, store) => store.set(STATE, { book: dumpBook(f.book), props: f.props });

// store: { get, set } over the test site's own IndexedDB.
export async function fakePost(body, store) {
  const f = await (ready ||= open(store).catch((e) => { ready = null; throw e; }));
  await new Promise((r) => setTimeout(r, 150)); // a little delay, so sync states show as they would on the phone
  const res = post(f, body);
  if (body.action === 'sync') await persist(f, store);
  return res;
}
