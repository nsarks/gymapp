# Status and backlog

Last updated: 26 November 2026. Update this file whenever the state below changes.

## Where things stand

- **Front end:** live at https://nsarks.github.io/gymapp/, deployed from `main` by GitHub Actions.
- **Test site:** https://nsarks.github.io/gymapp/preview/, built from the `preview` branch with invented data (issue #5). Changes go feature branch, then `preview`, then `main` (see `CLAUDE.md`). The `preview` branch is allowed to deploy in the github-pages environment settings.
- A push to either `main` or `preview` rebuilds and publishes both sites.
- **On a phone or browser that has used the real app**, open the real app twice after the 24 November release so its service worker updates. Before that, the old worker answers `/gymapp/preview/` with a blank page; an incognito tab works either way.
- **Backend:** Apps Script project "Gym app" at script.google.com, deployed as a web app (Execute as: Me, Who has access: Anyone). The phone app is connected to it.
- **Sheet:** the script still points at a **test copy** of Chloe's sheet in Nick's Drive, not the real sheet. Nothing logged so far has reached Chloe's sheet.
- **Deployed backend version:** matches the repo's `doPost` code before issue 4 (the editor holds the issue 4 code, saved but not deployed). The editor also has a later fix to muscle group guesses, which only affects `setup` and `reseedPlan` and needs no new deployment.
- The phone queues writes and syncs; offline use works.
- **Issue 1** (any day can be picked; the week strip shows days trained, on plan or not): built on branch `claude/eloquent-bardeen-4glpj8`, front end only. Tried on the test site and released to `main` on 24 November 2026.
- **Issue 4** (Suggest a session with AI, through Groq): built on branch `claude/exciting-franklin-iq6ehi`, front end and backend. Not yet on the test site or released. The front end works with the current backend (the option stays hidden). To switch it on: `GROQ_API_KEY` in Script Properties, paste the new `Code.gs`, run `checkSuggest` and approve the new permission, then deploy a new version (README, Suggest a session). Nick chose to send each library exercise's last weight to Groq as well as its name and group.
  - 26 November: `GROQ_API_KEY` is in Script Properties, the new `Code.gs` is saved in the editor (still pointing at the test copy), and `checkSuggest` ran and returned a session with weights, so the new permission is approved. **Not yet deployed as a new version**: the phone still runs the previous backend, so the option stays hidden in the real app.

## Next step: switch to Chloe's real sheet

1. In the Apps Script editor, set `SHEET_ID` to the real sheet's ID and save.
2. Run `setup` once. It adds the six app tabs to her sheet and seeds the plan; it does not touch her tabs. The key is unchanged (it is only shown when first created).
3. Deploy, Manage deployments, pencil, New version, Deploy. The URL stays the same.
4. On the phone: Settings, Force sync. History from the test copy disappears from the app once it refreshes from the real sheet.
5. Check `AppPlan`, `PlanDays` and the `Library` Group column in her sheet.

## Backlog

Ideas raised so far. None is agreed yet; confirm with Nick before building.

- "New version ready, tap to reload" banner, so updates arrive in one open instead of two.
- The `Progress` tab counts one dumbbell, while the app and summary count both. Align them if Chloe finds it confusing.
- Exercise descriptions cover the current plan and about 120 common gym, mobility and cardio exercises. An exercise with no match shows none; an optional `Description` column in `Library` (needs a backend change) would let Nick or Chloe fill the gaps.
- Deploying the backend is manual. `clasp` (Google's Apps Script command-line tool) could let Claude Code push and publish it, at the cost of a one-time login on Nick's computer.

## Known limitations

- Single user by design. The URL and key must not be shared, including with Chloe.
- The test mock is not Google: backend changes need checking against the real service.
