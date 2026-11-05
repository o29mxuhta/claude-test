// Behaviour test for the drag stop at the pan anchors: runs the real handler
// code from web/index.html against a stub map (no browser). It checks logic,
// not feel: the stop is still hard, it just must not slide sideways or shake.
// Run: node tests/map-drag-stop.test.js
var fs = require('fs'), path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
var code = html.slice(html.indexOf('var ANCHOR_MARGIN'), html.indexOf('// A center saved in localStorage before the anchors'));
var passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('FAIL: ' + m); } }
function LngLat(lng, lat) { this.lng = lng; this.lat = lat; }
var handler = null;
var map = {
  transform: { center: new LngLat(35, 31.5) },
  getCenter: function () { return this.transform.center; },
  setCenter: function (c) { this.transform.center = new LngLat(c[0], c[1]); },
  on: function (n, f) { if (n === 'move') handler = f; }
};
var api = new Function('map', 'maplibregl', code + '; return {clamp: clampToAnchor, setRing: function (r) { anchorRing = r; }};')(map, { LngLat: LngLat });
// Slanted east side and a notch (concave gap) on the north side.
api.setRing([[34.3, 29.5], [35.0, 29.5], [35.1, 31.0], [35.6, 32.0], [35.6, 32.8], [35.2, 32.8], [35.2, 32.2], [34.9, 32.2], [34.9, 32.8], [34.5, 32.8], [34.3, 31.0]]);
assert(typeof handler === 'function', 'move handler registered');
function seed(x, y) { map.transform.center = new LngLat(x, y); handler({ originalEvent: {} }); }
function drag(start, deltas, orig) {
  seed(start[0], start[1]);
  var path = [map.getCenter()], bad = 0;
  deltas.forEach(function (d) {
    var c = map.getCenter();
    map.transform.center = new LngLat(c.lng + d[0], c.lat + d[1]);
    handler({ originalEvent: orig === false ? undefined : {} });
    var n = map.getCenter();
    if (api.clamp(n)) bad++;
    path.push(n);
  });
  return { path: path, bad: bad };
}
function rep(v, n) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
function flips(p, axis) { var f = 0, pd = 0; for (var i = 1; i < p.length; i++) { var d = p[i][axis] - p[i - 1][axis]; if (d * pd < -1e-9) f++; if (Math.abs(d) > 1e-9) pd = d; } return f; }
function last(r) { return r.path[r.path.length - 1]; }
// 1. Horizontal push into the slanted east wall: stays inside, never reverses,
//    and the latitude does not move at all (no sideways slide along the border).
var r = drag([35.2, 31.6], rep([0.03, 0], 60));
assert(r.bad === 0, 'push: camera stays inside the allowed area');
assert(flips(r.path.map(function (c) { return [c.lng, c.lat]; }), 0) === 0, 'push: no direction flips');
assert(Math.abs(last(r).lat - 31.6) < 1e-9, 'push: no sideways slide (lat ended ' + last(r).lat + ')');
assert(last(r).lng > 35.2, 'push: camera did advance to the border');
// 2. Noisy diagonal push into the slanted wall: the camera never reverses
//    beyond what the input does (the input here never reverses), never exits.
var seedv = 7; function rnd() { seedv = (seedv * 16807) % 2147483647; return seedv / 2147483647; }
var noisy = []; for (var j = 0; j < 100; j++) noisy.push([0.03 * (0.4 + 1.2 * rnd()), 0.02 * (0.4 + 1.2 * rnd())]);
var rn = drag([35.2, 31.2], noisy);
var pts = rn.path.map(function (c) { return [c.lng, c.lat]; });
assert(rn.bad === 0, 'noisy diagonal: inside the allowed area');
assert(flips(pts, 0) === 0 && flips(pts, 1) === 0, 'noisy diagonal: no camera reversal (lng ' + flips(pts, 0) + ', lat ' + flips(pts, 1) + ')');
// 3. Return to the interior is followed 1:1 once the input reverses.
var ret = drag([35.2, 31.6], rep([0.03, 0], 40).concat(rep([-0.03, 0], 40)));
assert(ret.bad === 0 && last(ret).lng < 35.2 - 0.3, 'return: camera comes back into the interior');
// 4. A fast flick across the notch stops at the first crossing, no tunnelling.
var fl = drag([35.05, 31.9], [[0, 0.5], [0, 0.5]]);
assert(fl.bad === 0 && last(fl).lat < 32.4, 'flick at a notch: stops at the first crossing (lat ' + last(fl).lat.toFixed(3) + ')');
// 5. Programmatic moves (no originalEvent) still use the old clamp and end inside.
var pm = drag([35.2, 31.6], rep([0.5, 0], 3), false);
assert(pm.bad === 0, 'programmatic move ends inside the allowed area');
// 6. Interior drag far from the border moves 1:1.
var it = drag([34.5, 30.5], rep([0.01, 0.005], 20));
assert(Math.abs(it.path[20].lng - it.path[0].lng - 0.2) < 1e-9 && Math.abs(it.path[20].lat - it.path[0].lat - 0.1) < 1e-9, 'interior drag moves 1:1');
// 7. A gesture move that starts outside the area (stale state) still ends inside.
map.transform.center = new LngLat(38, 31.5); handler({ originalEvent: {} });
assert(!api.clamp(map.getCenter()), 'gesture move from outside the area ends inside');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
