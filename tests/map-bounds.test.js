// Regression test for the 2026-11-01 pan/zoom freeze: the map constructor set
// BOTH minZoom 6.8 and a tight maxBounds box. MapLibre raises the effective
// minZoom so the viewport always fits inside maxBounds and hard-clamps the
// camera, so once the viewport covered the box (zoomed out, desktop or mobile)
// panning and zoom-out wedged completely, and MapLibre's internal _constrain
// ping-ponged with the clampToAnchor 'move' handler into infinite setCenter
// recursion (Maximum call stack size exceeded). The fix removes maxBounds and
// keeps clampToAnchor as the only pan guard.
// Run: node tests/map-bounds.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

// 1. No maxBounds anywhere: neither a constructor maxBounds property nor a
//    map.setMaxBounds(...) call (both reintroduce the wedging constraint).
assert(!/^\s*maxBounds\s*:/m.test(html),
  'map constructor must not set maxBounds (wedges pan/zoom at zoomed-out levels)');
assert(!/\.setMaxBounds\(/.test(html),
  'no map.setMaxBounds(...) call anywhere (same wedging constraint)');

// 2. The center clamp must stay the sole pan guard, and the move handler must
//    actually apply the clamp result with setCenter.
var moveHandler = html.match(/map\.on\('move', function \(\) \{[\s\S]*?\n   \}\);/);
assert(moveHandler, 'clampToAnchor move handler must stay registered');
assert(moveHandler && /var clamped = clampToAnchor\(map\.getCenter\(\)\);/.test(moveHandler[0]),
  'move handler must compute clamped = clampToAnchor(map.getCenter())');
assert(moveHandler && /map\.setCenter\(clamped\)/.test(moveHandler[0]),
  'move handler must apply the clamp result with setCenter');

// 3. The clamp must return null when the center is unchanged, otherwise the
//    setCenter-inside-move handler recurses infinitely. Every early return in
//    clampToAnchor must return null (not coordinates) for an unchanged center.
var clampBody = html.match(/function clampToAnchor\(center\) \{[\s\S]*?\n   \}/);
assert(clampBody, 'clampToAnchor function found');
var unchangedReturns = clampBody ? clampBody[0].match(/lng === center\.lng && lat === center\.lat\) \? null/g) : null;
assert(unchangedReturns && unchangedReturns.length >= 2,
  'clampToAnchor must return null (not coordinates) for an unchanged center in every branch');

// 4. minZoom stays 6.8 inside the map constructor options (whole-country
//    zoom-out preserved); a comment or unrelated object must not satisfy this.
var ctor = html.match(/new maplibregl\.Map\(\{[\s\S]*?\n\}\);/);
assert(ctor, 'map constructor found');
assert(ctor && /minZoom:\s*6\.8/.test(ctor[0]), 'constructor minZoom 6.8 preserved');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
