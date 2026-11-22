# Gym log

A phone-first web app for logging gym sessions one-handed. It writes to a Google Sheet through a small Apps Script, so Chloe can read progress in the sheet.

```
Android Chrome PWA  <-->  Apps Script web app (runs as Nick)  <-->  Google Sheet
```

No secrets live in this repository. The script URL and key are typed into the app's Settings and stay on the phone.

**Picking this up in a new session?** Read `CLAUDE.md` (working rules, how to deploy each side) and `docs/STATUS.md` (where things stand, which sheet is live, backlog). `docs/build-spec.md` is the original spec.

**Updating the backend later:** the repo copy of `Code.gs` is not deployed automatically. Paste it into the Apps Script project, put the sheet ID back in `SHEET_ID`, save, then Deploy, Manage deployments, edit, New version. Never use New deployment: it changes the URL.

## 1. Backend (once)

1. Go to script.google.com, create a new project, and replace the contents of `Code.gs` with `apps-script/Code.gs`.
2. Set `SHEET_ID` at the top to the ID of a COPY of the sheet first (the long part of the sheet's address between `/d/` and `/edit`).
3. Choose the function `setup` and press Run. Approve the permission prompt. Open the execution log and copy the SECRET KEY. It is shown once. (`resetKey` makes a new one.)
4. Deploy, New deployment, type Web app. Execute as: Me. Who has access: Anyone. Copy the web app URL (it ends in `/exec`).
5. When you are happy with the copy, change `SHEET_ID` to the real sheet, run `setup` again, then Deploy, Manage deployments, edit, New version. The URL and key stay the same.

`setup` adds six tabs and leaves every existing tab alone: `AppPlan`, `PlanDays`, `Log`, `Sessions`, `Library`, `Progress`.

## 2. Front end

```
npm install
npm test          # script and logic tests
npm run build     # output in dist/
npm run test:e2e  # full run in headless Chrome against a mock sheet (needs Chrome)
```

### GitHub Pages

Push this folder to the `main` branch of the repository. In the repository: Settings, Pages, Source: GitHub Actions. The included workflow tests, builds and publishes on every push. The app is then at `https://<user>.github.io/<repo>/`.

### On the phone

Open the address in Chrome on Android, menu, Add to Home screen (Install app). Open it, go to Settings, paste the script URL and the key, and press Save and connect.

## When Chloe updates the plan

Each of her day tabs can hold several blocks separated by blank rows. The app uses the **last block** in each tab as the current plan, and keeps the most recent written comment for each exercise as its note. After she changes the plan, open the Apps Script project, choose `reseedPlan` and press Run. It rebuilds `AppPlan`, `PlanDays` and the plan part of `Library`; `Log`, `Sessions` and `Progress` are not touched.

## Decisions made during the build

The spec said to pick the simpler option and note it.

- **The plan tab is called `AppPlan`, not `Plan`.** Chloe already has a tab called `PLAN`, and Google Sheets treats tab names as case insensitive, so `Plan` cannot exist beside it.
- **Warm-up rows are repeated for each day in `AppPlan`** (Block = Warm-up), so each day can be edited on its own.
- **Timed holds** (reps shown as "/" with a duration, such as Side plank 30s) keep the duration in the Reps column, and the app counts seconds for them.
- **Sets written as a range** ("2-3") use the upper number for the rows shown. Rest written as a range ("1-2mins", "20-30s") uses the upper value for the timer; it can be dismissed early.
- **Two extra sync operations**, `log.delete` and `session.delete`, so undo, deleting an exercise or session, removing a mistaken set and discarding an abandoned session reach the sheet.
- **Sheet cells are read as displayed.** Some of Chloe's cells that show "10-12" are stored as dates (formatted d-m), so the script reads the displayed text.
- **Exercise descriptions live in the app** (`src/descriptions.js`), written once in plain English. New exercises without a match show no description.
- **Undo holds sync for five seconds**, so undo is an exact restore.
- **Bootstrap also returns the full Log and Sessions rows**, so history works on a new phone.
- **Swap and skip are offered only before any set is logged** for that exercise. After that, use Finish exercise or Delete exercise.
- **Swap is one tap on a suggestion.** Pick the optional reason chip first; there is no separate Swap button.
- **Long-press on + or -** shows the other step sizes (1.25 and 5 for kg).
- **Reps default to the top of the target range; kg defaults to last time.**
- **"Skip legs" applies to the main block only**, not to warm-up mobility work.
- **Exercise names are unified across days when seeding** (for example "Lat Pull down" and "Lat pull down" become one), so history does not split.
- **Reorder uses Move up and Move down** in the exercise options rather than drag.
- **Muscle groups in Library are a first guess from the exercise name.** Edit the Group column in the sheet if any are wrong; "Skip legs" uses Legs and Glutes.
- **A session done on a different day keeps its planned Day** (Monday's session done on Tuesday is logged as Day = Mon with Tuesday's date).

## Workout summary

When a session finishes, and from any finished session in History, the app offers a plain English summary with Copy and Share buttons, for pasting into Google Health or sending to Chloe. It is built on the phone from the logged sets by fixed rules (no AI service, no cost): session name and time, swaps and skips with reasons, warm-up, each exercise's sets, sets below the plan's rep target, up to three "up on last time" lines, and the session note.

- **Dumbbell weights are per dumbbell.** An exercise counts as dumbbell work when its Library Equipment is Dumbbell (or, if Equipment is blank, when its name contains "DB" or "dumbbell"). The summary says "with 14 kg dumbbells" and volume counts both dumbbells, in the app and the summary. The Progress tab in the sheet still counts one.
- **Warm-up state is stored at the front of the session note** ("Warm-up done | ..."), because the Sessions tab has no warm-up column and adding one would mean redeploying the script. "Whole warm-up done" on any warm-up exercise marks it in one tap; starting without the warm-up records "Warm-up skipped".
- **Past sessions can be corrected in History**: "Mark as done" for the warm-up, and "Wrong exercise? Change it" to rename an exercise. Against the plan, a rename is recorded as a swap so Chloe can see it.

## Layout

- `apps-script/Code.gs`: the whole backend.
- `src/logic.js`: pure helpers (dates, picking the session, sums, the workout summary). `src/store.js`: state, IndexedDB, sync queue, session actions.
- `src/start.jsx`, `session.jsx`, `history.jsx`, `settings.jsx`, `ui.jsx`, `main.jsx`: screens and shared parts. `src/style.css`: styling.
- `src/descriptions.js`: short exercise descriptions.
- `public/sw.js`: caches the app shell so it opens with no signal.
- `scripts/make-icons.py`: draws the app icons.
- `test/`: script tests against a mock of the sheet (`mock-gas.mjs`, a simplified stand-in for Google, so check backend changes on the real service too), logic and summary tests, and an end to end run (`e2e.mjs`, set `CHROME` if Chrome is not at `/usr/bin/google-chrome`).
- `CLAUDE.md`, `docs/`: notes for new sessions, current status and the original spec.
