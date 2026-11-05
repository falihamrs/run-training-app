# Run Training Planner

A browser-only training plan generator for road and trail running. It builds a plan from a race
target, your schedule, past activity (TCX files) and your thresholds, and exports each workout
as copy-ready text for the Coros app. Everything stays in your browser; there is no server.

The full design is in the spec document ("Run Training Plan Generator: Detailed Spec").

## Status

| Milestone | Status |
| --- | --- |
| 1. Settings: race, schedule, thresholds, Coros zones, day terrain, backup | Done |
| 2. TCX upload and history analysis | Next |
| 3. Plan generator and tests | |
| 4. Plan view and export (text, CSV) | |
| 5. Tracking: planned vs. actual | |
| 6. Threshold update suggestions | |
| 7. Backup and polish | |

## Run it

No build step and no dependencies to install.

```sh
python3 -m http.server 8080     # or: npm run serve
```

Then open http://localhost:8080. Opening `index.html` directly from disk may not work, because the
app uses JavaScript modules, which browsers only load over http(s).

## Test it

Needs Node 20 or newer.

```sh
npm test
```

## Layout

- `js/core/` pure logic with no browser dependencies: dates, units, zones, thresholds, validation.
  This is where the plan generator will live, so it can be tested without a browser.
- `js/ui/` the screens. `js/storage.js` IndexedDB access through Dexie (vendored in `js/vendor/`).
- `tests/` unit tests for `js/core/`.

## Data and backups

Data is stored in your browser's IndexedDB, on one device. Clearing browser data erases it, so use
the Backup tab to export a JSON file regularly. The app asks the browser to keep the data when you
first save, but browsers may still refuse.
