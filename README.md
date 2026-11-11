# Run Training Planner

A browser-only training plan generator for road and trail running. It builds a plan from a race
target, your schedule, past activity (TCX or GPX files from Strava or Coros) and your thresholds,
tracks how training goes, and exports every workout as copy-ready text for the Coros app.
Everything stays in your browser. There is no server, no account and no build step.

## How to use it

1. **Settings.** Enter the race (date, distance, and for trail the elevation gain), your weekly
   schedule (runs per week, long-run day, which days have hills or an incline treadmill, strength
   sessions), and your thresholds (LTHR, and threshold pace for road). If you want the Coros
   zones used instead of the default percentages, type them in on the Zones tab. Press Save.
2. **History.** Upload your recent TCX or GPX files (8 to 12 weeks is ideal). The app reads
   distance, moving time, climbing, best efforts and climbs, then shows your baseline weekly
   volume and suggests thresholds. With no files you can type your recent numbers instead.
3. **Plan.** Press Generate. Each workout shows pace, heart rate and (trail) RPE ranges for its
   date. Use Copy on a workout or a week and type the steps into the Coros app, or download the CSV.
4. **Track.** Upload each run after you do it. It is matched to the planned workout (change the
   match in History if needed). The Plan page shows done and missed workouts and weekly completion.
5. **Update thresholds.** When hard efforts show a clear change, the Plan page suggests new
   thresholds. Accept them and they apply from your next workout; earlier workouts and matched runs
   keep the targets they had. Use "Regenerate from next Monday" after missed weeks.

Back up your data from Settings, Backup. Browsers can delete site data, and nothing is stored anywhere else.

## Status

All seven milestones are built.

| Milestone | Status |
| --- | --- |
| 1. Settings: race, schedule, thresholds, Coros zones, day terrain, backup | Done |
| 2. TCX/GPX upload and history analysis | Done |
| 3. Plan generator and tests | Done |
| 4. Plan view and export (text, CSV) | Done |
| 5. Tracking: planned vs. actual, regenerate from next Monday | Done |
| 6. Threshold update suggestions, 30-minute test | Done |
| 7. Backup, restore, offline use, polish | Done |

## Run it

No dependencies to install.

```sh
python3 -m http.server 8080     # or: npm run serve
```

Then open http://localhost:8080. Opening `index.html` straight from disk does not work, because
browsers only load JavaScript modules over http(s).

### Put it online (GitHub Pages)

In the repository on GitHub: Settings, Pages, Source "Deploy from a branch", branch `main`, folder
`/ (root)`. After a minute the app is live at `https://<your-user>.github.io/run-training-app/`.
Your data still stays in each browser; hosting only serves the files. After the first visit the app
also works offline.

## Test it

Needs Node 20 or newer.

```sh
npm test
```

## Layout

- `js/core/` pure logic with no browser dependencies, covered by unit tests:
  `tcx.js`, `analyze.js`, `history.js` (reading files and baselines), `plan/` (feasibility,
  weekly volume, day layout, workout library, `generate.js`), `targets.js` (zones to paces and
  heart rates for a date), `tracking.js`, `suggest.js`, `export.js`.
- `js/ui/` the screens (settings, history, plan). `js/storage.js` is IndexedDB through Dexie
  (vendored in `js/vendor/`). `sw.js` is the offline cache.
- `tests/` unit tests, including the spec's test scenarios, with synthetic TCX/GPX generators.

## Where the app differs from the spec

- Tune-up races inside a plan (scenario 16) are not built. Plan one main race.
- A break is also detected when two or more of the last four weeks have no runs.
- Heart rate and pace targets are stored as zones. Race-pace and marathon-pace work resolves from
  the plan's goal pace, so it does not change when thresholds change.
- The marathon steady run is 30 minutes (Z3) and the marathon race-pace session is 3 × 3 km, to keep
  the weekly hard-time check from removing them.
- In trail Build weeks from the third, downhill practice replaces the climbing session every other week.
- Strength sessions never sit the day before a long or quality run, so a week can hold fewer than the
  requested number.
- Missed weeks and low weeks give advice instead of fixed 85% and 70% cuts: the message states the volume
  "Regenerate from next Monday" would really restart from (your last four full weeks) as a share of the last
  loading week.
- Three weeks at 120% or more of the plan give a note: the plan never speeds up on its own, and regenerating
  would start from your real volume. Within four weeks of the race the note only says to keep to the plan.
- Run summaries are backed up; the 5-second activity streams are not.

- Weeks before the first uploaded run count as "no data", not as a break. With fewer than four full weeks of history the baseline is the average of the weeks there are.
- Plans longer than 24 weeks hold the starting volume only for weeks the ramp does not need: the build must still reach its peak targets by the start of the peak phase.
- A race on a Monday or Tuesday leaves its own week empty, so the taper moves one week earlier and the week before is laid out like a race week.
- Weekly volume always grows by at least 0.25 h (trail) or 1 km (road) per loading week, so low starting volumes do not stall on rounding.
- Easy runs are never longer than the long run, quality sessions shrink to fit small weeks, and runs are dropped (down to two) when a week is too small for the chosen number.
- A threshold entry with only LTHR or only pace keeps the other value from the entry before it.
- An activity's date uses the browser's time zone at the time of the run; if the GPS shows it was recorded more than three hours of time zone away, the run's own zone is used.
- Trail races above 45 km or 75 km-effort stay out of scope: the training tables stop there.
- Being below the usual starting point for a race does not block a plan that has time to build the base first: the plan must reach that level and still leave the minimum block before the race. Only shorter plans need "Generate anyway".
- "Regenerate from next Monday" keeps each remaining week in the phase it already had and continues the session ladders; only the volume restarts from what you actually ran. A plan that is under way is never refused for a low baseline.
- In back-to-back weeks the flat tempo becomes an easy run when its only free day follows the previous long run; the climbing session stays.
- A threshold entry can be corrected by adding one with the same date. New entries still cannot start in the past.
- A plan that is not a real training block (fewer than half the minimum weeks, or for a half marathon, marathon or trail race above 25 km-effort a weekly peak under 40% of what the race needs) carries a warning at the top. New plans like this are already refused; the warning shows after "Generate anyway" or a late "Regenerate". Weeks that still run more than 15% over target are flagged.
- When saving settings fails (storage full, storage closed), the message shows on every tab, the save bar says "Not saved" and the edits stay on screen for another try.

## Typing in climbing (treadmill runs)

A treadmill file has no elevation, and a watch cannot change it afterwards. In History, press **edit**
next to a run's climbing. When the file has the watch's laps (Coros and Strava TCX exports do), each
lap is a row, so an interval session shows every interval and recovery on its own; otherwise the run is
shown in 1 km splits. Each row has its pace and heart rate. Type the incline (%)
you used in each split, or switch to metres for an outdoor run with a wrong reading. "Fill all" sets
every split at once. Saving replaces the run's climbing, so weekly climbing, plan progress, sustained
climbs (8 minutes or more at 6% or steeper) and threshold suggestions all use it. "Back to the watch
value" undoes it.

Moving time leaves out only near-standing (slower than 33:20/km over about 10 seconds), so walking
recoveries and steep power-hiking count. All distance is kept, including what was covered while stopped,
so totals match the watch. Checked against a real Coros TCX export (distance within 0.01 km, time within
10 seconds).

Runs with no GPS in the file are marked **indoor**. Their moving time is the watch's timer time (a
treadmill sensor's still seconds are not stops), and their pace is never used to estimate threshold
pace, because it comes from a wrist or foot sensor. Heart rate and climbing still count.

## Report for an AI chat

On the Plan screen, "Copy report" or "Download .md" makes one Markdown file to paste into an AI chat. It
holds the race, your thresholds and zones, schedule and baseline, the app's warnings and advice, then week
by week the target, planned and done volume and each workout with the run matched to it (laps and typed
climbing included), plus unplanned runs and the runs before the plan. Choose the last 4 weeks and next 4
(short enough to paste) or the whole plan. Nothing is sent anywhere: you copy it yourself.

## Editing workouts

Every workout from today on has an **Edit** link: change its length, move it to another day of the same
week, make it an easy run, or make it a rest day. Each week has "Adjust this week" (10–30% less, 5–10%
more). The same training checks as the plan apply: by hand you get a warning (for example a hard session
next to another, or a week more than 10% over its target) and the edit still saves. Quality sessions can
only get shorter. Past workouts, the race and workouts with a matched run cannot be edited. "Undo last
change" in the plan header reverses the last edit (up to ten steps back), and "Regenerate" says how many
edits it will replace.

## Applying AI feedback

The AI report ends with a format for changes: the AI is asked to finish its answer with a `plan-changes`
block of JSON naming workouts by the ids shown in the report. Under "Apply AI feedback" on the Plan screen,
upload its answer (.md or .txt) or paste it. Each change is listed with the AI's reason and a tick box:

- Workout and week changes start next Monday and must pass every training check; ones that do not are
  shown as refused, with the reason. Anything the app does not understand is listed, not guessed.
- Setting changes (runs per week, long-run day, terrain or availability of a day) are saved in Settings
  and rebuild the plan from next Monday. The workout changes are then checked against the rebuilt plan.
- A threshold change is only a suggestion: "Review in Settings" opens it pre-filled for you to add.
- "Apply selected" is one step that "Undo last change" reverses (settings stay changed).
- Applied changes, with their reasons, appear in the next report, so the AI knows what it changed.

## Data and backups

Data is stored in your browser's IndexedDB, on one device. Clearing browser data erases it, so
export a JSON backup regularly. The Plan page reminds you after 14 days. The app asks the browser to
keep the data, but browsers may still refuse.
