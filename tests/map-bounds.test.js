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
var moveHandler = html.match(/map\.on\('move', function \(e\) \{[\s\S]*?\n   \}\);/);
assert(moveHandler, 'clampToAnchor move handler must stay registered');
assert(moveHandler && /var clamped = clampToAnchor\(map\.getCenter\(\)\);/.test(moveHandler[0]),
  'move handler must compute clamped = clampToAnchor(map.getCenter())');
assert(moveHandler && /applyAnchorClamp\(clamped\)/.test(moveHandler[0]),
  'move handler must apply the clamp result via applyAnchorClamp');
// The move handler must NOT call map.setCenter directly: setCenter stops the
// active drag and release inertia (the edge-jump bug at zoomed-out levels).
assert(moveHandler && !/map\.setCenter\(/.test(moveHandler[0]),
  'move handler must not call map.setCenter (cancels the drag gesture)');
var applyFn = html.match(/function applyAnchorClamp\(clamped\) \{[\s\S]*?\n   \}/);
assert(applyFn && /tr\.center = new maplibregl\.LngLat\(/.test(applyFn[0]),
  'applyAnchorClamp must write the centre onto map.transform');
assert(applyFn && /map\.setCenter\(clamped\)/.test(applyFn[0]),
  'applyAnchorClamp must keep setCenter as the fallback');

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

// 5. Soft edge: the damping step must ease motion toward the border to zero at
//    the border, never touch motion away from it, and keep tangential motion.
var stepFn = html.match(/function edgeDampedStep\([\s\S]*?\n   \}/);
assert(stepFn, 'edgeDampedStep helper found');
if (stepFn) {
  var edgeDampedStep = new Function(stepFn[0] + '; return edgeDampedStep;')();
  var near = function (a, b) { return Math.abs(a - b) < 1e-12; };
  var s0 = edgeDampedStep(0.1, 0, 1, 0, 0, 1);      // at the border, heading out
  assert(near(s0[0], 0) && near(s0[1], 0), 'no outward motion at the border');
  var s1 = edgeDampedStep(0.1, 0, 1, 0, 0.5, 1);    // halfway: share q^2 = 0.25
  assert(near(s1[0], 0.025), 'outward motion falls with the square of the remaining distance');
  var s2 = edgeDampedStep(0.1, 0, 1, 0, 2, 1);      // outside the band
  assert(near(s2[0], 0.1), 'no damping outside the band');
  var s3 = edgeDampedStep(-0.1, 0.07, 1, 0, 0, 1);  // heading away, plus tangential
  assert(near(s3[0], -0.1) && near(s3[1], 0.07), 'motion away from the border is untouched');
  var s4 = edgeDampedStep(0.1, 0.07, 1, 0, 0, 1);   // outward plus tangential
  assert(near(s4[0], 0) && near(s4[1], 0.07), 'tangential motion survives at the border');
  var s5 = edgeDampedStep(5, 0, 1, 0, 0.2, 1);      // huge step near the border
  assert(s5[0] <= 0.2 * 0.35 + 1e-12, 'one step never covers more than 35% of the remaining distance');
  var prev = 1, mono = true;                        // never moves more outward than asked
  for (var q = 0; q <= 1.0001; q += 0.1) { var r = edgeDampedStep(0.3, 0, 1, 0, q, 1); if (r[0] > 0.3 + 1e-12 || r[0] < 0) mono = false; }
  assert(mono, 'damped outward step stays between 0 and the requested step');
}
var rayFn = html.match(/function rayRingHit\([\s\S]*?\n   \}/);
assert(rayFn, 'rayRingHit helper found');
if (rayFn) {
  var rayRingHit = new Function(rayFn[0] + '; return rayRingHit;')();
  var sq = [[0, 0], [4, 0], [4, 4], [0, 4]];       // 4x4 square, inside is 0..4
  var o = [0, 0];
  var h1 = rayRingHit(1, 2, 1, 0, 10, sq, o);      // heading east from (1,2): wall at x=4
  assert(Math.abs(h1 - 3) < 1e-9 && Math.abs(o[0] - 1) < 1e-9 && Math.abs(o[1]) < 1e-9, 'ray hits the east wall at distance 3 with an outward normal');
  var h2 = rayRingHit(1, 2, -1, 0, 10, sq, o);     // heading west: wall at x=0
  assert(Math.abs(h2 - 1) < 1e-9 && Math.abs(o[0] + 1) < 1e-9, 'ray hits the west wall with a westward normal');
  var h3 = rayRingHit(1, 2, 0, 1, 10, sq, o);      // heading north: wall at y=4
  assert(Math.abs(h3 - 2) < 1e-9 && Math.abs(o[1] - 1) < 1e-9, 'ray hits the north wall');
  assert(rayRingHit(1, 2, 1, 0, 2, sq, o) === -1, 'no hit when the border is beyond the look-ahead');
}
// The hard clamp must stay as the final guard after the soft edge.
assert(moveHandler && moveHandler[0].indexOf('softenEdge(e)') < moveHandler[0].indexOf('clampToAnchor(map.getCenter())'),
  'soft edge runs before the hard clamp, which stays as the final guard');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
