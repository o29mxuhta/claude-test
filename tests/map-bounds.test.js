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

// 1. The constructor must not set maxBounds (the wedging constraint).
assert(!/^\s*maxBounds\s*:/m.test(html),
  'map constructor must not set maxBounds (wedges pan/zoom at zoomed-out levels)');

// 2. The center clamp must stay the sole pan guard.
assert(/map\.on\('move', function \(\) \{\s*var clamped = clampToAnchor\(map\.getCenter\(\)\);/.test(html),
  'clampToAnchor move handler must stay registered');

// 3. The clamp must return null when the center is unchanged, otherwise the
//    setCenter-inside-move handler recurses infinitely.
var clampBody = html.match(/function clampToAnchor\(center\) \{[\s\S]*?\n   \}/);
assert(clampBody, 'clampToAnchor function found');
assert(clampBody && /lng === center\.lng && lat === center\.lat/.test(clampBody[0]),
  'clampToAnchor must return null for an unchanged center (recursion guard)');

// 4. minZoom stays 6.8 (whole-country zoom-out preserved).
assert(/minZoom:\s*6\.8/.test(html), 'minZoom 6.8 preserved');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
