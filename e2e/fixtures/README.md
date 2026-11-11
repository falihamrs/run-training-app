Sample Coros TCX export (26 Oct – 10 Nov 2026) for the browser checks in `e2e/`.

- `tcx/` outdoor runs, named by local date (UTC+7)
- `tm/` the treadmill run (no GPS)
- `other/` the activities Coros exports with sport "Other" (hikes, walks, one indoor)

Privacy: every longitude is moved by −8°, so the tracks lie in the Indian Ocean. Haversine distance
depends only on longitude differences, so distance, pace, climbing, laps and times are exactly the
real ones, and the solar time zone stays UTC+7 (see `activityTzOffsetMin`). Latitude is unchanged.
Do not add files with real coordinates: this repository is public.

Use them through `e2e/fixtures.cjs`. Set `TCX_DIR` to run the export-based checks on another folder.
