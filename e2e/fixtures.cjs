// Sample Coros TCX files for the browser checks. Longitudes are moved by a fixed offset (see
// fixtures/README.md); distances, climbing and times are the real ones.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'fixtures');
const files = (dir) => fs.readdirSync(dir).filter((f) => /\.(tcx|gpx)$/i.test(f)).sort().map((f) => path.join(dir, f));

module.exports = {
  /** one outdoor run by local date, e.g. tcx('2026-11-04') */
  tcx: (date) => path.join(DIR, 'tcx', `${date}.tcx`),
  /** one treadmill run by local date */
  tm: (date) => path.join(DIR, 'tm', `${date}.tcx`),
  /** the outdoor runs */
  outdoor: () => files(path.join(DIR, 'tcx')),
  /** a whole Coros export: TCX_DIR if set, otherwise every fixture */
  all: () => (process.env.TCX_DIR ? files(process.env.TCX_DIR) : ['tcx', 'tm', 'other'].flatMap((d) => files(path.join(DIR, d)))),
};
