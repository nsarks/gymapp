// A small stand-in for the Apps Script runtime so Code.gs can be run and tested in Node.
// The mock sheet itself lives in src/preview/sheet.js, which the test site uses too.
import fs from 'node:fs';
import vm from 'node:vm';
import { fixtureBook, gasGlobals } from '../src/preview/sheet.js';

export { fixtureBook };

export function loadScript(book, { fetch } = {}) {
  const props = {};
  const logs = [];
  let uuid = 0;
  const sandbox = {
    console, JSON, Date, Math, Object, Array, String, Number, isFinite,
    ...gasGlobals(book, props, { uuid: () => `0000${uuid++}-aaaa-bbbb-cccc-dddddddddddd`, logs, ...(fetch ? { fetch } : {}) }),
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  vm.runInContext(src + '\nthis.api = { doPost, setup, reseedPlan, appSheet_, readRows_, book_, checkSuggest };', sandbox);
  const post = (body) => JSON.parse(sandbox.api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
  return { api: sandbox.api, post, logs, props, book };
}
