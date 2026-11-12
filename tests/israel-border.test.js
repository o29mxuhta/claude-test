// Israel's solid bold border: a stroke on the existing focus 'zone' feature —
// the `_border` dissolve of all 1,449 Oref alert polygons (baked into
// ISRAEL_ZONE_RINGS). Checks the ring's geography (includes Golan + the Oref
// West Bank zones, excludes Gaza) and the rendered layer list (casing + solid
// core above the dashed foreign borders). Runs the real functions, not a text
// match. Run: node tests/israel-border.test.js
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; } else { failed++; console.error('  FAIL: ' + m); } }
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

// --- Ring checks: the baked copy of the alert-polygon union outline ---
var ringMatch = html.match(/var ISRAEL_ZONE_RINGS = (\[\[\[[\s\S]*?\]\]\]);/);
assert(!!ringMatch, 'ISRAEL_ZONE_RINGS is defined');
var rings = JSON.parse(ringMatch[1]);
assert(rings.length === 1 && rings[0].length > 200,
  'outline is one detailed ring (' + rings[0].length + ' vertices)');
var ring = rings[0];
var lons = ring.map(function (c) { return c[0]; }), lats = ring.map(function (c) { return c[1]; });
assert(Math.min.apply(null, lons) > 34.0 && Math.max.apply(null, lons) < 36.1 &&
       Math.min.apply(null, lats) > 29.3 && Math.max.apply(null, lats) < 33.6,
  'outline stays within the expected Israel-area bbox');

function contains(lon, lat) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) &&
        lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Inside: Israel proper, Golan, and the Oref-covered West Bank zones.
[[34.78, 32.08, 'Tel Aviv'], [35.21, 31.77, 'Jerusalem'], [34.95, 29.55, 'Eilat'],
 [35.77, 33.27, 'Majdal Shams (Golan)'], [35.26, 32.22, 'Nablus'], [35.09, 31.53, 'Hebron'],
 [34.57, 31.67, 'Ashkelon']].forEach(function (t) {
  assert(contains(t[0], t[1]) === true, 'outline includes ' + t[2]);
});
// Outside: Gaza and every neighbouring country.
[[34.44, 31.5, 'Gaza City'], [34.25, 31.29, 'Rafah'], [34.4, 30.0, 'Egypt (Negev border)'],
 [35.93, 31.95, 'Amman'], [35.5, 33.4, 'Lebanon']].forEach(function (t) {
  assert(contains(t[0], t[1]) === false, 'outline excludes ' + t[2]);
});

// --- Layer checks (run the real customizeBasemapLayers) ---
var scaleStart = html.indexOf('function scaleWidthExpr(');
var scaleEnd = html.indexOf('\n  }', scaleStart) + 4;
var start = html.indexOf('function customizeBasemapLayers(');
var end = html.indexOf('function buildMapStyle(', start);
assert(scaleStart !== -1 && start !== -1 && end !== -1, 'found the layer-building code');

var sandbox = { console: console, JSON: JSON, basemaps: { themes: { light: {}, black: {} } }, FOCUS_GEOJSON: { type: 'FeatureCollection', features: [] } };
vm.createContext(sandbox);
vm.runInContext(html.slice(scaleStart, scaleEnd) + '\n' + html.slice(start, end) +
  '\nthis.customizeBasemapLayers = customizeBasemapLayers;', sandbox);

var input = [
  { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': '#000' } },
  { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': '#1e3048' } },
  { id: 'boundaries_country', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
    paint: { 'line-color': '#999', 'line-width': 1 } }
];
var flavor = { earth: '#111111' };

[true, false].forEach(function (isDark) {
  var out = sandbox.customizeBasemapLayers(JSON.parse(JSON.stringify(input)), isDark, flavor);
  var tag = isDark ? 'dark' : 'light';
  var ids = out.map(function (l) { return l.id; });
  var casing = out.filter(function (l) { return l.id === 'israel-border-casing'; })[0];
  var line = out.filter(function (l) { return l.id === 'israel-border-line'; })[0];
  assert(!!casing && !!line, tag + ': israel-border casing + line layers rendered');
  if (!casing || !line) return;
  assert(ids.indexOf('israel-border-casing') > ids.indexOf('boundaries_foreign'),
    tag + ': drawn above the dashed foreign borders');
  assert(ids.indexOf('israel-border-line') === ids.indexOf('israel-border-casing') + 1,
    tag + ': core line directly above its casing');
  [casing, line].forEach(function (l, idx) {
    var nm = idx === 0 ? 'casing' : 'line';
    assert(l.source === 'focus', tag + ': ' + nm + ' reads the focus source (alert-polygon union)');
    assert(JSON.stringify(l.filter) === JSON.stringify(['==', ['get', 'role'], 'zone']),
      tag + ': ' + nm + ' strokes only the zone feature, never the mask');
  });
  assert(!line.paint['line-dasharray'], tag + ': core line is solid (no dasharray)');
  assert(JSON.stringify(line.paint['line-width']).indexOf('interpolate') !== -1,
    tag + ': core width grows with zoom');
  assert(JSON.stringify(casing.paint['line-width']).indexOf('interpolate') !== -1,
    tag + ': casing width grows with zoom');
  assert(line.paint['line-color'] === (isDark ? '#b3b3b3' : '#565656'),
    tag + ': core colour is the approved soft grey (Gil 2026-11-12: grey, not white/black)');
  assert(line.paint['line-color'] !== '#f5f5f5' && line.paint['line-color'] !== '#1a1a1a',
    tag + ': core is not the rejected bright white / near-black');
  assert(casing.paint['line-color'] === (isDark ? '#000000' : '#ffffff'),
    tag + ': casing colour contrasts with the core');
});

// The rectangular sea excursion off Binyamina/Zikhron Ya'akov is gone:
// no vertex west of 34.87 between the Carmel-coast latitudes 32.44-32.50.
var seaBump = ring.filter(function (c) { return c[0] < 34.87 && c[1] > 32.44 && c[1] < 32.50; });
assert(seaBump.length === 0, 'no sea-bump vertices off Binyamina (' + seaBump.length + ' left)');

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
