# Gym log: notes for Claude

Read this first, then `docs/STATUS.md` for where things stand. `README.md` has setup and the build decisions; `docs/build-spec.md` is the original spec (the code and README win where they differ).

## What this is

A phone-first PWA (Preact + Vite, Android Chrome) for Nick to log gym sessions. It syncs to a Google Sheet through a standalone Apps Script web app. Chloe, his personal trainer, owns the sheet and reads progress there. Single user. No Google Cloud project, no paid backend.

```
PWA on GitHub Pages  <-->  Apps Script web app (runs as Nick)  <-->  Google Sheet
```

## How changes reach production

**Every change goes feature branch, then `preview`, then `main`.**

1. Work on a feature branch (in a cloud session, the branch the session gives you). Run the checks below and push it.
2. Merge it into `preview` and push `preview`. That publishes the test site at https://nsarks.github.io/gymapp/preview/ (invented data, fake backend, yellow "Test version" bar). Give Nick that link and ask him to try the change.
3. Only when Nick says he is happy, merge `preview` into `main` and push. That publishes the real app. Never push to `main` or `preview` without Nick asking.

There is one `preview` branch, shared by all features. If `preview` holds something Nick has not approved, ask before merging it into `main`, since it would go out too.

- **Front end:** pushing to `main` or `preview` runs `.github/workflows/pages.yml`, which tests and builds both branches and publishes them together: `main` at https://nsarks.github.io/gymapp/ and `preview` (built with `--mode preview`) at `/gymapp/preview/`. The phone picks up a new version of the real app on the second open after a push.
- **Test site:** runs the repo's `Code.gs` against a mock sheet inside the page (`src/preview/`). It never calls the real script. It uses its own IndexedDB (`gymlog-preview`) and no service worker; the real worker ignores `preview/`. Keep those separations: both sites share the `nsarks.github.io` origin.
- **Backend: nothing deploys automatically.** Changing `apps-script/Code.gs` in the repo does nothing on its own. Nick (or Claude in the browser) must paste it into the Apps Script project "Gym app" at script.google.com, put the real sheet ID back in `SHEET_ID`, save, then **Deploy, Manage deployments, pencil, Version: New version, Deploy**.
- **Never use Deploy, New deployment.** It creates a new URL and the phone app stops working until the URL is re-entered in Settings.
- Functions run by hand from the editor (`setup`, `reseedPlan`, `resetKey`) use the saved code and need no deployment. `doPost` changes do.
- When a change touches both sides, keep the app working with the old backend until the new one is deployed, or say clearly that both must go out together.

## Rules

- **Never write to Chloe's tabs** (`PLAN`, `CORRECTIVE EXERCISE / WARM UP`, and the day tabs such as `Monday (Gym)`). The script only writes to `AppPlan`, `PlanDays`, `Log`, `Sessions`, `Library`, `Progress`, and `appSheet_()` enforces that. Keep that guard.
- **This repo is public. Never copy real sheet contents into it**: not Chloe's comments, Nick's weights, logs, notes, injury details or file names, in tests, docs or commit messages. Test data in `test/` is invented and must stay that way; mirror the sheet's layout, not its words.
- **No secrets in the repo.** The script URL and key live only in the phone's Settings. `apps-script/Code.gs` keeps `const SHEET_ID = 'PASTE_SHEET_ID_HERE';` in the repo. Do not commit sheet IDs, the web app URL or the key, and do not ask Nick to paste the key into a chat.
- **Sheet data contract.** Column order is defined by `HEADERS` in `Code.gs`. Changing it breaks the existing sheet and the `Progress` formulas, so add columns at the end and say so in the README.
- **Read Chloe's tabs as displayed text** (`getDisplayValues`). Some cells showing "10-12" are stored as dates.
- **Copy and docs:** British English, no em dashes anywhere (UI text, README, commit messages). Units are kilograms.
- **Design:** light, colourful theme with a colour per muscle group; 48px minimum tap targets; no sounds or vibration; prefer an undo bar to "Are you sure?". No streaks or personal best celebrations.
- When you make a judgement call, add it to "Decisions made during the build" in the README.

## Before pushing

```
npm install
npm test           # Apps Script tests against a mock sheet, logic tests, summary tests
npm run build
npm run build:test # the test site
npm run test:e2e   # e2e.mjs then e2e-preview.mjs; full run in headless Chrome against the mock backend; set CHROME=/path/to/chrome if not /usr/bin/google-chrome
```

All must pass. `test/mock-gas.mjs` is a simplified stand-in for Apps Script and Google Sheets, so script changes that pass locally can still fail on Google (the time zone bug did). After a backend change, ask Nick to check the app connects ("Connected. Plan loaded" in Settings) and look at the sheet.

## Map of the code

- `apps-script/Code.gs`: the whole backend. `doPost` (`bootstrap`, `sync`), `setup`, `reseedPlan`, `resetKey`, seeding from Chloe's tabs, `Progress` formulas.
- `src/store.js`: state, IndexedDB, the sync queue (writes go to the queue first, idempotent by `ClientID`), and every session action.
- `src/logic.js`: pure helpers: dates, choosing the session, history sums, the workout summary text.
- `src/start.jsx`, `session.jsx`, `history.jsx`, `settings.jsx`, `ui.jsx`, `main.jsx`: screens and shared parts. `src/style.css`: all styling.
- `src/descriptions.js`: the short exercise descriptions, matched on a normalised name.
- `src/preview/`: test site only (left out of the real build). `fake.js` (Code.gs in the page), `sheet.js` (the mock sheet, also used by the tests), `seed.js` (invented history).
- `public/sw.js`: offline app shell cache. Bump `CACHE` when changing how it caches. It must keep ignoring `preview/`.
- `test/`: `script.test.mjs`, `logic.test.mjs`, `summary.test.mjs`, `descriptions.test.mjs`, `preview.test.mjs`, `e2e.mjs`, `e2e-preview.mjs`; `mock-gas.mjs` and `server.mjs` support them.
