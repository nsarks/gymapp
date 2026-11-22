# Original build spec

> This is the spec the app was first built from (14 November 2026), kept for the reasoning behind the design. **Where it and the code disagree, the code and the README win.** Known differences:
>
> - The plan tab is `AppPlan`, not `Plan` (Chloe already has `PLAN`, and tab names are not case sensitive).
> - The theme is now light and colourful, not dark. The rest timer is still visual only.
> - There are extra sync operations, `log.delete` and `session.delete`, plus `reseedPlan()` in the script.
> - Added since: exercise descriptions, finish or delete an exercise, delete a session, workout summary with copy and share, one-tap warm-up, past session corrections.
> - See the README section "Decisions made during the build" for the full list.

---

## 1. Goal

A phone-first app (Android, installed from Chrome to the home screen) that lets Nick log a gym session quickly and one-handed, and writes everything back to a Google Sheet that his PT, Chloe, can read. The app must cope with real gym life: swapped, skipped and added exercises, injuries, and sessions that ignore the plan.

Non-goals: multi-user accounts, a native app, a paid backend, anything that needs a Google Cloud project.

## 2. Architecture

```
Android Chrome PWA  <-->  Apps Script web app (standalone, runs as Nick)  <-->  Google Sheet
 (static hosting)         (secret key in header-less body)                       (owned by Chloe, Nick has edit)
```

- **Front end:** installable PWA, static files, hosted free (GitHub Pages or Netlify). Preact or vanilla JS with Vite is fine. No heavy framework. Must be fast on a mid-range phone.
- **Back end:** a standalone Apps Script project (script.google.com, NOT bound to the sheet). It opens the sheet by ID with `SpreadsheetApp.openById`. Deployed as a web app: Execute as "Me", access "Anyone". Access control is a long random secret key stored in Script Properties and sent in every request body. Reject any request without the correct key.
- **Sheet:** Chloe's existing file. Nick has edit rights. Her existing tabs (PLAN, CORRECTIVE EXERCISE / WARM UP, Monday (Gym), Tuesday (Home), Wednesday (Gym), Friday (Gym), Saturday (Home)) are left completely untouched. New tabs are added alongside.
- **Units:** kilograms. UK English throughout the UI. No em dashes anywhere in copy.

## 3. Sheet design (new tabs)

Source of truth for what happened is `Log`. `Plan` is the template, not the record.

**Plan** (one row per planned exercise)
`PlanID | Day | Order | Block | Exercise | Sets | Reps | Tempo | Rest | Cue`
- Day: Mon, Tue, Wed, Fri, Sat. Block: Warm-up or Main.
- Seeded once by `setup()` from Chloe's existing tabs (Exercise, Reps, Sets, Tempo, Rest, Comments as Cue). Dates and weights are not copied into Plan.

**PlanDays** (one row per planned session, used for the session picker)
`Day | SessionName | Location | Focus | Summary`
- Example: `Mon | Gym day 1 | Gym | Upper body | Chest, back and arms`.
- Seeded from the existing tabs. Derive SessionName, Location and Focus from the tab name and its exercises. NOTE: Chloe's tab named "Friday (Gym)" has "Wednesday - GYM DAY 3" as its heading (a typo in her sheet). Seed by TAB NAME, not by the heading text, and do not edit her tab.
- `Summary` is a short human description (editable by Nick in the sheet). If blank, the app generates one from the first three exercise names, for example "DB bench press, Chest supported row, Incline press and 3 more".

**Log** (one row per set, append-only except corrections)
`ClientID | LoggedAt | SessionID | Date | Day | Exercise | PlannedExercise | Status | SetNo | Kg | Reps | RPE | Note`
- Status: `done`, `skipped`, `swapped`, `added`.
- `PlannedExercise` is filled for swapped and skipped rows so Chloe can see what was replaced.
- A skipped exercise writes one row with SetNo blank, Kg and Reps blank, and a reason in Note.
- `ClientID` is a UUID generated on the phone for each row. It makes writes idempotent: the script must ignore a row whose ClientID already exists.

**Sessions** (one row per session)
`SessionID | Date | Day | Mode | Injury | Note | Start | End`
- Mode: `as planned`, `modified`, `freestyle`.
- Injury: TRUE or blank. Note holds the free text (for example "cycled in, skipped legs").

**Library** (Nick's own exercise list, grows over time)
`Exercise | Group | Equipment | Unilateral`
- Seeded from Plan. New exercises typed in the app are appended here so names stay consistent.

**Progress** (built for Chloe, formulas only, no script writes)
- Per exercise: best set, latest set, estimated 1RM trend, weekly volume.
- Session adherence: planned vs done vs skipped per week.
- Sessions flagged Injury, newest first.

## 4. Apps Script API

Single deployment, two entry points. Use plain-text POST bodies (`Content-Type: text/plain`) so the browser sends a simple request with no CORS preflight, and follow the Apps Script redirect.

- `POST {key, action:"bootstrap"}` returns:
  - `plan` (all Plan rows), `planDays`, `library`, `weekStatus` (which planned sessions are already logged this week), `lastPerformance` (for each exercise, the sets from its most recent session: kg, reps, RPE, date), `recentSessions` (last 10).
- `POST {key, action:"sync", ops:[...]}` where each op is one of:
  - `session.upsert` (Sessions row, keyed by SessionID)
  - `log.append` (Log row, keyed by ClientID)
  - `log.update` (edit an earlier set in the same session, keyed by ClientID)
  - `library.add`
  - Returns the list of applied ClientIDs so the phone can clear its queue.
- Wrap writes in `LockService.getScriptLock()`. Batch with `setValues` rather than row-by-row appends.
- Never log the key. Return generic errors for a bad key.
- `setup()` (run once manually): creates the new tabs with headers and frozen rows, seeds Plan and Library from the existing tabs, generates the secret key into Script Properties and shows it in the log once.
- Do NOT try to import historic weights from Chloe's comment text (for example "12kg10. // 25kgx5x2"); it is too ambiguous. Show her note as a read-only "previous note" under the exercise instead, if available.

## 5. Screens and behaviour

**Start screen (session picker).**
- **Preselect by closest date.** Planned days are Mon, Tue, Wed, Fri, Sat. Preselect today's session if there is one. If today is not a planned day (Thu, Sun), preselect the nearest planned day by calendar distance, and on a tie prefer the upcoming one. A session already fully logged today is shown as "Done" and the preselection moves to the next unlogged one. If a session is in progress (unfinished, started today), preselect it and show "Resume".
- **The preselected session is shown as a large card**: session name, day, location and focus (for example "Gym day 1, Monday, Gym, Upper body"), a one-line summary (from PlanDays.Summary, or generated from the first exercises), number of exercises, and an estimated duration (sum of sets x (rest + about 40 seconds), rounded to 5 minutes). One big "Start session" button.
- **Swap session:** a "Change session" link opens a bottom sheet listing every planned session as a compact card (same fields as above, plus a small "Done this week" or "Not done this week" badge), ordered by closest date first. Tapping one selects it and returns to the start screen. The last item is "Freestyle session" (build from scratch).
- **Warm-up** is shown as the first block of the chosen session, with a "Skip warm-up" option.
- A week strip at the top (Mon to Sun, dots for planned days, green when done, grey when skipped) gives context at a glance. Tapping a dot selects that session.

**Exercise card (the core screen).**
- Header: exercise name and the target (sets x reps), large and always visible. This is the only thing the user asked to see at a glance.
- Secondary, one tap to reveal (collapsed by default): Chloe's cue and tempo, and a "Last time" line with the previous session's sets (for example 25 x 10, 25 x 10, 22.5 x 9) and date. Weight and reps still PREFILL from last time even while this panel is collapsed.
- One row per set. Each row has a kg stepper (default = last time's kg, steps 2.5, long-press for 1.25 or 5) and a reps stepper (default = target top end). Both use big +/- buttons by default and the number itself can be tapped to type it with a numeric keypad. RPE is an optional chip row (6 to 10), collapsed unless the user opens it. A large "Log set" button.
- "Same as last set" one-tap copy. Editable after logging.
- Logging a set auto-starts the rest timer (from the plan's rest value). The timer is VISUAL ONLY: no sound and no vibration. It counts down on screen (a ring or bar) and, when it reaches zero, the display changes clearly (for example the ring fills solid green and the label reads "Ready"). The user can dismiss it or add 30 seconds. Keep the screen awake via the Wake Lock API while a session is active.
- Overflow menu: Skip, Swap, Add note, Move up or down.

**Flexibility (must all work).**
- **Skip** an exercise with a reason chip: machine busy, injury, short on time, other.
- **Swap**: choose from Library (searchable, filtered by Group by default) or type a new one. The swapped exercise inherits sets and reps, writes Status `swapped` with PlannedExercise filled.
- **Add** an exercise anywhere in the session (Status `added`).
- **Skip all lower body in one tap** (all exercises in Group Legs or Glutes). Reason chip, for example "cycled in".
- **Injury flag** for the session with a note. Does not block anything.
- **Freestyle session:** build from scratch from the Library, same logging UI, Mode `freestyle`.
- Reorder exercises by drag or up/down buttons.

**History** (three simple views, offline readable from cached data, no heavy chart library: draw charts as inline SVG in the green accent on the dark background).
- **Sessions list (default).** Newest first. Each row: date, session name, a status chip (As planned, Modified, Freestyle), total volume (kg), sets done, skipped count, and a red injury marker if flagged. Tapping opens the session detail: every exercise with its sets, status and notes. Logged sets in a past session can be edited.
- **Exercise view.** Pick an exercise (search plus recents). Shows a line chart of the best set per session, with a toggle between Top weight and Estimated 1RM (Epley: kg x (1 + reps/30)). Range chips: 4 weeks, 12 weeks, All. The best ever point is marked quietly with a small dot and label (no celebration). Below the chart, a list of recent sessions for that exercise with all sets (kg x reps). Only draw the chart when there are at least two sessions; otherwise show the single entry as text. History is by exercise name as performed, so swapped-in exercises have their own history.
- **Week view.** A simple planned vs done strip per week for the last 8 weeks (done, partly done, skipped, not planned), so adherence is visible. Tapping a week lists its sessions.

**Settings.** Script URL and secret key (stored on device only), sync status, a "force sync" button, export last 30 days as CSV.

**Finish session.**
- If exercises are unlogged, ask once: "3 exercises not logged. Mark them as skipped?" with reason chips (Short on time, Machine busy, Injury or niggle, Not feeling it, Other) and a "Leave them" option. Never block finishing.
- Then show the end-of-session summary: duration, total volume, sets done, skipped and swapped counts, and anything that improved on last time (plain text list, no celebration). Optional session note, then "Sync now" with a sync status line.

**Prompts and wording (UK English, short, no jargon, no em dashes).** All prompts are bottom sheets that sit in thumb reach. Prefer one tap over confirmation dialogs, and always offer undo (a 5 second "Undo" bar) instead of asking "Are you sure?".
- **Skip an exercise.** Title: "Skip [exercise]?". Reason chips, one tap each: Machine busy, Injury or niggle, Short on time, Not feeling it, Other. Tapping a chip skips immediately and shows "Skipped. Undo". "Other" opens a one-line text box. An optional "Add a note" link. Reason is saved to Log.Note.
- **Skip all lower body.** Title: "Skip legs?". Subtitle shows the count: "This skips 4 exercises." Same reason chips, plus "Cycled in" as the first chip. One tap applies to every exercise with Group Legs or Glutes that is not yet logged. Undo available.
- **Swap an exercise.** Title: "Swap [exercise]". A search box at the top. Suggestions below in this order: Same muscle group, Recently used, then All. Each suggestion is one tap. If nothing matches, the first row reads: "Add '[typed name]' as a new exercise". Adding a new exercise asks for ONE required choice, its muscle group (chips: Chest, Back, Shoulders, Arms, Legs, Glutes, Core, Other), and optionally equipment. Sets and reps carry across from the original and stay editable. Below the list, optional reason chips: Machine busy, No equipment, Injury or niggle, Prefer this, Other. Button: "Swap". Result: "Swapped for [new]. Undo".
- **Add an exercise.** Title: "Add an exercise". Same picker as swap, without reasons. New exercises are added to the Library. Choose sets and reps defaults from the last time that exercise was done, otherwise 3 x 10.
- **Injury or niggle.** Title: "Anything niggling?". Area chips: Knee, Back, Shoulder, Hip, Ankle, Elbow, Other, plus a free text note. Optional. Saves Injury = TRUE and a note like "Knee: felt sharp on step up" on the session. Wording is calm and neutral: this is information for Chloe, not a warning.
- **Freestyle.** Title: "Build your own". Start with an empty session and "Add an exercise". No plan targets are shown, and the first set of each exercise prefills from last time if it exists.
- **Leaving mid-session.** If the app is closed, the session stays "in progress" and reappears with a "Resume" button on the start screen. Sessions older than 12 hours that were never finished prompt: "Finish yesterday's session?" with Finish and Discard.

## 6. Offline and sync

- Signal at the gym is usually fine, so offline support is a safety net, not the main mode. Keep it robust but do not over-engineer it.
- All writes go to IndexedDB first, then a queue. UI never waits on the network.
- Background sync with exponential backoff. Visible indicator: synced, pending (n), or offline.
- Service worker caches the app shell so it opens with no signal.
- Bootstrap data is cached and refreshed on open when online.
- Conflict rule: phone wins for rows it created. Duplicates prevented by ClientID.

## 7. Design requirements

- Android Chrome, portrait, one-handed use. Thumb-reachable primary actions at the bottom.
- **Theme (decided):** dark and high contrast, always dark (no light mode needed). Near-black background (for example #0B0D0C), off-white text, and ONE accent: electric green (for example #39FF14 or a slightly softer #2BE35A, check contrast on dark). Use green for primary buttons, the timer ring, completed sets and "Ready". Do not use green for errors.
- Status colours kept separate from the accent: skipped = muted grey, swapped = amber, added = blue, injury flag = red. Never rely on colour alone; add an icon or label.
- Minimum tap target 48px, large numerals (weight and reps are the biggest text on screen), clear visual hierarchy: target first, then the entry rows, then secondary info.
- Installable manifest with icon (dark tile, green mark), standalone display, theme colour matching the background.
- No sounds and no vibration anywhere. Feedback is visual only (button press states, a brief green flash on a logged set).
- Fast: first paint under 1 second on repeat load.
- Motivation features are deliberately minimal: an end-of-session summary only. No streaks, no personal best celebrations.

## 8. Security

- The Apps Script URL and key are secrets. Do not commit them. The front end asks for them on first run and stores them locally.
- The script runs as Nick. Do not share the URL or key with anyone, including Chloe. Chloe views the sheet directly, which is the point.
- The script only touches the new tabs. Add a guard that refuses to write to any other sheet name.

## 9. Build order (keep each step small and testable)

1. Write and test the Apps Script (`setup`, `bootstrap`, `sync`) with curl or a tiny test page against a COPY of the sheet first.
2. Scaffold the PWA: offline shell, settings, bootstrap fetch.
3. Today screen and exercise card with set logging, queue and sync.
4. Skip, swap, add, reorder, skip-lower-body, injury flag, freestyle.
5. History and charts.
6. Polish, install test on Android, offline test (airplane mode mid-session).

## 10. Acceptance checks

- Log a full session in airplane mode, reconnect, and every row appears once in Log with no duplicates.
- Swap an exercise: Log shows Status `swapped` and the original in PlannedExercise.
- "Skip lower body" marks every leg and glute exercise skipped with the reason.
- Wrong key returns an error and writes nothing.
- Chloe's original tabs are byte-for-byte unchanged after `setup()`.
- The Progress tab populates from Log without any script involvement.
- App installs from Chrome on Android and opens offline.
- On a Thursday the start screen preselects the nearest planned session (tie goes to the upcoming one); "Change session" lists all planned sessions plus Freestyle.
- PlanDays has five rows, and Friday's session is named from the tab name, not the mistyped "Wednesday - GYM DAY 3" heading.
- Skip, swap and "Skip legs?" each complete in one tap (plus a typed name for a brand new exercise) and each can be undone.
- Exercise history chart appears only with two or more sessions and toggles between top weight and estimated 1RM.

## 11. Decisions already made

- Standalone Apps Script (option C), no Google Cloud project, no OAuth in the app.
- New tabs live in Chloe's existing sheet, with her agreement. Her tabs are left as they are.
- The user is on Android.
- Scope is single user (Nick), built well. Chloe views the sheet; she does not use the app. The script URL and key stay entered in Settings rather than hard-coded, so the front end is not tied to one person, but no multi-user features are needed.
- Look and behaviour decisions from the product owner session: dark high-contrast theme with electric green accent; steppers plus tap-to-type entry; auto-start visual-only rest timer; target sets and reps shown at a glance, last time and Chloe's cue one tap away; end-of-session summary as the only motivation feature.
- Session start: preselect the closest planned session by date, with a descriptive card and an easy "Change session" picker. History: sessions list, per exercise chart (top weight or estimated 1RM), and a weekly adherence strip. Swap and skip prompts: bottom sheets with reason chips, one tap, and undo. All specified in section 5 using best-estimate defaults, which the user has accepted.
- Nothing left undecided at product level. If something is ambiguous during the build, choose the simpler option and note it, rather than stopping to ask.
