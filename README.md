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
npm test            # script and logic tests
npm run build       # the real app, output in dist/
npm run build:test  # the test site, output in dist-preview/
npm run test:e2e    # full runs in headless Chrome against a mock sheet (needs both builds and Chrome)
npm run dev:test    # the test site on your computer, with live reload
```

### GitHub Pages

Push this folder to the `main` branch of the repository. In the repository: Settings, Pages, Source: GitHub Actions. The included workflow tests, builds and publishes on every push to `main` or `preview`. The app is then at `https://<user>.github.io/<repo>/`, and the test site at `https://<user>.github.io/<repo>/preview/`.

The `preview` branch must be allowed to deploy: Settings, Environments, github-pages, Deployment branches and tags, add `preview`.

### Test site and release pipeline

Every change goes **feature branch, then `preview`, then `main`**:

1. Work happens on a feature branch. Nothing is published.
2. Merge the feature branch into `preview`. The test site at https://nsarks.github.io/gymapp/preview/ updates a minute or two later. Try it there, on the phone or a computer.
3. Once happy, merge `preview` into `main`. That publishes the real app.

There is one `preview` branch, not one per feature. A push to either branch rebuilds both sites, because GitHub Pages serves one site per repository: the real app from `main` at `/gymapp/`, the test site from `preview` at `/gymapp/preview/`.

The test site:

- has a striped yellow "Test version" bar on every screen and "(test)" in the tab title;
- runs the real `Code.gs` inside the page against a mock sheet with invented data (`src/preview/`), so it needs no Settings and cannot reach the real script or sheet;
- starts with about three weeks of invented history before today, so the week strip, History and summaries have something to show;
- keeps what you log in that browser only, and Settings has **Reset test data** to go back to the invented data;
- does not install as an app and has no offline cache.

It uses its own browser database (`gymlog-preview`) and registers no service worker, so it never sees the real app's URL, key or queued data. The real app's service worker ignores everything under `preview/`.

**Backend changes** cannot be tried on the test site against the real sheet: it runs the repo's `Code.gs` against the mock sheet only. The real backend still needs pasting and deploying by hand (see above).

### On the phone

Open the address in Chrome on Android, menu, Add to Home screen (Install app). Open it, go to Settings, paste the script URL and the key, and press Save and connect.

## Suggest a session (optional)

**Change session, Suggest a session** takes a short request ("legs, about 30 minutes", "upper body, go easy on the shoulders") and comes back with a full session: exercises, sets, reps, rest and a starting weight. You can start it, ask again, change the request or cancel. Once started it is a normal freestyle session.

The script asks [Groq](https://groq.com) for the session, so the request leaves Google. **What is sent:** the request text, and for each exercise in `Library` its name, muscle group and heaviest set last time (kg and reps). **Not sent:** dates, notes, injury details, the session history, or Chloe's plan and comments. The Groq key stays in the script's properties; the phone never sees it.

It is also on the card shown when a rest day is tapped in the week strip. The option only appears once the script supports it and has a Groq key. To set it up:

1. Get an API key at console.groq.com (API Keys, Create API key).
2. In the Apps Script project: Project Settings (the gear on the left), Script Properties, Edit script properties, Add script property. Property `GROQ_API_KEY`, value the key. Save script properties. Leave the existing `KEY` property alone.
3. Optional: a `GROQ_MODEL` property chooses the model. Without it the script uses `openai/gpt-oss-20b`, and tries `openai/gpt-oss-120b` once if a reply fails.
4. Paste the new `Code.gs` in (sheet ID back in `SHEET_ID`), save, choose the function `checkSuggest` and press Run. Google asks for a new permission ("Connect to an external service"); approve it. The log should say "Suggestions work". Do this **before** deploying, so the web app is never left without the permission it needs.
5. Deploy, Manage deployments, pencil, Version: New version, Deploy. The URL stays the same.

Removing `GROQ_API_KEY` hides the option again.

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
- **A description is only shown when the name clearly matches.** If the whole name is not a known key, the longest known key inside it is used, so "Seated calf raise" gets its own text rather than the standing one. Keys that are too broad (such as "squat", "pulldown" or "Smith machine") only match a name that is exactly that word, so a variation shows no description rather than a wrong one.
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
- **The test site runs the real `Code.gs` in the page**, with the same mock sheet the tests use (`src/preview/sheet.js`), rather than a separate stub. The test site then behaves like the real backend, and the invented plan comes from the same seeding code. The fake waits 150 ms per request so sync states show.
- **The test site's invented history is generated from today's date** (`src/preview/seed.js`): about three weeks of the plan's sessions, with two missed days, one skipped exercise, one swap, one added exercise, one injury note and one freestyle session. On a Monday the Today strip is empty because the week has just started; History's Week view shows the earlier weeks.
- **The test site has no service worker and no install manifest.** It shares `nsarks.github.io` with the real app, and a second worker or install would add risk for no benefit.
- **A session done on a different day keeps its planned Day** (Monday's session done on Tuesday is logged as Day = Mon with Tuesday's date).
- **The week strip shows the days trained, not which planned sessions are done.** Each day is judged only by what was logged on that date. That day's own planned session gets a green circle with a white tick (on plan). Any other session that date (another day's session, freestyle, or anything on a rest day) gets a white circle with a green tick (not on plan). So Wednesday's session done on Thursday ticks Thursday and leaves Wednesday as skipped. The Change session sheet and the suggested session still count it as done for Wednesday, so it is not suggested again.
- **Every day in the Today week strip can be tapped.** Tapping a day picks that day's session to do today; it never backdates. Tapping a rest day shows "Pick a session" and "Freestyle session" rather than choosing for you. Opening the app on a rest day still suggests the nearest session not yet done. When the suggested session belongs to another day, the card says so ("Wednesday's session, logged today").

- **Suggest a session sends weights to Groq** (issue 4). The issue first said names and groups only. Nick chose to send each library exercise's last weight too, so Groq can suggest a sensible starting weight for an exercise he has not done, from similar ones. The heaviest set last time (kg and reps) is sent, as reps say as much as kg about what the weight means. Dates, notes, injury details and history beyond that one set are not sent.
- **For an exercise Nick has done, the phone's own history sets the weight**, set by set, as in any session. Groq's weight is used only for exercises with no history, and shows as "Suggested start" in the suggestion and in the exercise's details.
- **A suggestion writes nothing.** New exercises are added to `Library` (with Groq's muscle group) through the normal sync when the session is started, so asking again does not fill the library. Names Groq returns are matched to the `Library` spelling, so history and weights line up.
- **Suggest a session is in Change session and on the rest-day card** (added after Nick tried the test site: on a rest day it was buried at the bottom of the Change session list). It shows only when the script reports it is set up (`bootstrap` returns `suggest: true` when `GROQ_API_KEY` is set). An older script returns nothing, so the option stays hidden.
- **The model is asked for strict JSON** (Groq's structured outputs). The script caps a suggestion at 10 exercises and 1 to 6 sets, rounds weights to 0.5 kg, and tries the fallback model once if a reply is missing or broken. A refused key or a rate limit stops at once with a plain message.
- **The AI's coaching tip is labelled "Suggested tip"**, not "Note from the sheet", so it is never mistaken for Chloe's words.
- **The tests and the test site use an invented Groq** (`fakeGroq` in `src/preview/sheet.js`). It builds a session from the request and the library list in the prompt and never touches the network.

## Workout summary

When a session finishes, and from any finished session in History, the app offers a plain English summary with Copy and Share buttons, for pasting into Google Health or sending to Chloe. It is built on the phone from the logged sets by fixed rules (no AI service, no cost): session name and time, swaps and skips with reasons, warm-up, each exercise's sets, sets below the plan's rep target, up to three "up on last time" lines, and the session note.

- **Dumbbell weights are per dumbbell.** An exercise counts as dumbbell work when its Library Equipment is Dumbbell (or, if Equipment is blank, when its name contains "DB" or "dumbbell"). The summary says "with 14 kg dumbbells" and volume counts both dumbbells, in the app and the summary. The Progress tab in the sheet still counts one.
- **Warm-up state is stored at the front of the session note** ("Warm-up done | ..."), because the Sessions tab has no warm-up column and adding one would mean redeploying the script. "Whole warm-up done" on any warm-up exercise marks it in one tap; starting without the warm-up records "Warm-up skipped".
- **Past sessions can be corrected in History**: "Mark as done" for the warm-up, and "Wrong exercise? Change it" to rename an exercise. Against the plan, a rename is recorded as a swap so Chloe can see it.

## Layout

- `apps-script/Code.gs`: the whole backend, including the optional Groq call for Suggest a session.
- `src/logic.js`: pure helpers (dates, picking the session, sums, the workout summary). `src/store.js`: state, IndexedDB, sync queue, session actions.
- `src/start.jsx`, `session.jsx`, `history.jsx`, `settings.jsx`, `ui.jsx`, `main.jsx`: screens and shared parts. `src/style.css`: styling.
- `src/descriptions.js`: short exercise descriptions.
- `src/preview/`: the test site only. `fake.js` runs `Code.gs` in the page, `sheet.js` is the mock sheet (shared with the tests), `seed.js` makes the invented history. The real build leaves all of it out.
- `public/sw.js`: caches the app shell so it opens with no signal. It ignores `preview/`.
- `scripts/make-icons.py`: draws the app icons.
- `test/`: script tests against a mock of the sheet (`mock-gas.mjs`, a simplified stand-in for Google, so check backend changes on the real service too), logic and summary tests, and two end to end runs (set `CHROME` if Chrome is not at `/usr/bin/google-chrome`): `e2e.mjs` for the real app, and `e2e-preview.mjs` for the real app and test site side by side, checking they never share data.
- `CLAUDE.md`, `docs/`: notes for new sessions, current status and the original spec.
