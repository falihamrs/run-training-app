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
- Missed-week rules (85%, 70%) are advice; regeneration rebuilds the remaining weeks from your last
  four weeks of actual running, which has the same effect.
- Run summaries are backed up; the 5-second activity streams are not.

## Data and backups

Data is stored in your browser's IndexedDB, on one device. Clearing browser data erases it, so
export a JSON backup regularly. The Plan page reminds you after 14 days. The app asks the browser to
keep the data, but browsers may still refuse.
