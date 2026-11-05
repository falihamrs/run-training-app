// Synthetic activity generators for tests.
// segments: [{ sec, pace (s/km), hr, grade (fraction, e.g. 0.08), pause?:true }]
export function makePoints(segments, { start = Date.parse('2026-03-02T00:00:00Z'), lat = 13.7, lon = 100.5, altStart = 100, noise = 0 } = {}) {
  const pts = [];
  let t = start, dist = 0, alt = altStart, i = 0;
  for (const s of segments) {
    for (let k = 0; k < s.sec; k++) {
      if (s.pause) { t += 1000; continue; }
      const v = 1000 / s.pace;
      dist += v;
      alt += v * (s.grade || 0);
      pts.push({ t, dist, alt: alt + (noise ? Math.sin(i * 1.7) * noise : 0), hr: s.hr ?? null, lat: lat + dist / 111320, lon });
      t += 1000;
      i++;
    }
  }
  return pts;
}

export function toTcx(points, { sport = 'Running', ns = '' } = {}) {
  const p = ns ? `${ns}:` : '';
  const tp = points.map((x) => `<${p}Trackpoint><${p}Time>${new Date(x.t).toISOString()}</${p}Time>` +
    (x.lat != null ? `<${p}Position><${p}LatitudeDegrees>${x.lat}</${p}LatitudeDegrees><${p}LongitudeDegrees>${x.lon}</${p}LongitudeDegrees></${p}Position>` : '') +
    (x.alt != null ? `<${p}AltitudeMeters>${x.alt}</${p}AltitudeMeters>` : '') +
    (x.dist != null ? `<${p}DistanceMeters>${x.dist}</${p}DistanceMeters>` : '') +
    (x.hr != null ? `<${p}HeartRateBpm><${p}Value>${x.hr}</${p}Value></${p}HeartRateBpm>` : '') +
    `</${p}Trackpoint>`).join('');
  return `<?xml version="1.0"?><${p}TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><${p}Activities><${p}Activity Sport="${sport}"><${p}Id>${new Date(points[0].t).toISOString()}</${p}Id><${p}Lap><${p}Track>${tp}</${p}Track></${p}Lap></${p}Activity></${p}Activities></${p}TrainingCenterDatabase>`;
}

export function toGpx(points, { type = 'running' } = {}) {
  const tp = points.map((x) => `<trkpt lat="${x.lat}" lon="${x.lon}"><ele>${x.alt}</ele><time>${new Date(x.t).toISOString()}</time>` +
    (x.hr != null ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${x.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : '') + `</trkpt>`).join('');
  return `<?xml version="1.0"?><gpx version="1.1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><type>${type}</type><trkseg>${tp}</trkseg></trk></gpx>`;
}
