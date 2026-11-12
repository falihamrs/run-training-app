// Offline support: network first, falling back to the cache, so updates arrive as soon as you are online.
const CACHE = 'run-training-planner-v28';
const ASSETS = [
  './',
  './index.html',
  "./css/styles.css",
  "./js/app.js",
  "./js/core/analyze.js",
  "./js/core/dates.js",
  "./js/core/defaults.js",
  "./js/core/elevation.js",
  "./js/core/export.js",
  "./js/core/geo.js",
  "./js/core/history.js",
  "./js/core/housekeeping.js",
  "./js/core/splits.js",
  "./js/core/aiExport.js",
  "./js/core/edits.js",
  "./js/core/aiChanges.js",
  "./js/core/plan/feasibility.js",
  "./js/core/plan/generate.js",
  "./js/core/plan/layout.js",
  "./js/core/plan/skeleton.js",
  "./js/core/plan/strength.js",
  "./js/core/plan/tables.js",
  "./js/core/plan/workouts.js",
  "./js/core/race.js",
  "./js/core/riegel.js",
  "./js/core/suggest.js",
  "./js/core/targets.js",
  "./js/core/tcx.js",
  "./js/core/thresholds.js",
  "./js/core/tracking.js",
  "./js/core/units.js",
  "./js/core/validate.js",
  "./js/core/zones.js",
  "./js/storage.js",
  "./js/ui/history.js",
  "./js/ui/housekeeping.js",
  "./js/ui/plan.js",
  "./js/ui/settings.js",
  "./js/ui/util.js",
  "./js/vendor/dexie.mjs",
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
