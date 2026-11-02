// Containment / no-bounce test for the soft edge stop. Runs the real
// clampToAnchor + softenEdge + 'move' handler code from web/index.html against
// a stub map (no browser). Stub evidence: it checks the logic, not feel.
// Run: node tests/map-soft-edge.test.js
var fs = require('fs'), path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
var a = html.indexOf('var ANCHOR_MARGIN');
var b = html.indexOf('// A center saved in localStorage before the anchors');
var code = html.slice(a, b);
var passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('FAIL: ' + m); } }
function LngLat(lng, lat) { this.lng = lng; this.lat = lat; }
function make() {
  var handler = null;
  var map = {
    transform: { center: new LngLat(35, 31.5) }, _z: 6.8,
    getCenter: function () { return this.transform.center; },
    getZoom: function () { return this._z; },
    setCenter: function (c) { this.transform.center = new LngLat(c[0] || c.lng, c[1] || c.lat); },
    on: function (n, f) { if (n === 'move') handler = f; }
  };
  var api = new Function('map', 'maplibregl', code + '; return {clampToAnchor: clampToAnchor, setRing: function (r) { anchorRing = r; }, fire: function (e) { var f = map._h; }, edge: softenEdge};')(map, { LngLat: LngLat });
  // re-run to capture the handler registration inside code (it registers via map.on)
  return { map: map, api: api, fire: function (e) { handler(e); }, hasHandler: function () { return !!handler; } };
}
// ring: a rough irregular polygon (not a box), so the border is oblique in places
var ring = [[34.3, 29.5], [35.0, 29.5], [35.1, 31.0], [35.6, 32.0], [35.85, 33.3], [35.0, 33.3], [34.6, 32.0], [34.3, 31.0]];
var h = make();
h.api.setRing(ring);
assert(h.hasHandler(), 'move handler registered');
function run(start, dir, speed, withOrig, frames) {
  h.map.transform.center = new LngLat(start[0], start[1]);
  h.map._z = 6.8;
  h.fire({ originalEvent: withOrig ? {} : undefined }); // seeds _lastCenter
  var v = speed, out = [], bad = 0, rev = 0, prevProj = 0, last = h.map.getCenter();
  for (var i = 0; i < frames; i++) {
    var c = h.map.getCenter();
    h.map.transform.center = new LngLat(c.lng + dir[0] * v, c.lat + dir[1] * v);
    h.fire({ originalEvent: withOrig ? {} : undefined });
    var n = h.map.getCenter();
    if (h.api.clampToAnchor(n)) bad++;
    var proj = (n.lng - last.lng) * dir[0] + (n.lat - last.lat) * dir[1];
    if (proj < -1e-9) rev++;
    out.push(proj); last = n; v *= 0.93;
  }
  return { bad: bad, rev: rev, out: out, final: h.map.getCenter() };
}
var starts = [[35.0, 30.5], [35.2, 31.6], [35.4, 32.2], [34.8, 32.0], [35.0, 32.8], [34.9, 30.0]];
var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7], [0.95, 0.3], [0.3, 0.95]];
var speeds = [0.02, 0.05, 0.1, 0.3];
var consec = 0, runs = 0, badAll = 0, revAll = 0, jumpAll = 0;
starts = starts.filter(function (s) { return !h.api.clampToAnchor(new LngLat(s[0], s[1])); });
console.log('valid starts', starts.length);
starts.forEach(function (s) { dirs.forEach(function (d) { speeds.forEach(function (sp) {
  var r = run(s, d, sp, true, 80); runs++; badAll += r.bad; revAll += r.rev; if (r.rev && process.env.DBG) console.log('rev', s, d, sp, r.out.map(function(x,i){return x<-1e-9?i+':'+x.toExponential(1):null}).filter(Boolean).join(' '), 'final', r.final.lng.toFixed(3), r.final.lat.toFixed(3));
  // no frame may cover more than its own undamped step
  r.out.forEach(function (p, i) { if (p > sp * 1.0001) jumpAll++; if (i && p < -1e-9 && r.out[i - 1] < -1e-9) consec++; });
}); }); });
assert(runs >= 100, 'ran ' + runs + ' glides');
assert(badAll === 0, 'camera never outside the allowed area (violations ' + badAll + ')');
assert(revAll <= 12, 'backward single-frame steps are rare corner effects (' + revAll + ' of ' + runs + ' glides; dev build has >1000)');
assert(consec === 0, 'never two backward frames in a row (no oscillation)');
assert(jumpAll === 0, 'no frame moves farther than its undamped step');
// straight into the east wall: speed profile must fall smoothly
var r = run([35.5, 32.0], [1, 0], 0.08, true, 60);
var o = r.out, mono = true;
for (var i = 3; i < o.length; i++) if (o[i] > o[i - 1] + 1e-9) mono = false;
var w = run([35.5, 32.0], [1, 0], 0.08, true, 60);
assert(w.rev === 0, 'straight into a wall: no backward frame');
assert(mono, 'speed into the wall is non-increasing after the first frames');
// programmatic moves (no originalEvent) keep the old hard clamp behaviour
var p = run([35.5, 32.0], [1, 0], 0.3, false, 3);
assert(p.bad === 0, 'programmatic move still ends inside the allowed area');
// interior glide untouched: a glide that never nears the border keeps its full step
var q = run([35.0, 31.0], [0, 1], 0.01, true, 10);
var sum = q.out.reduce(function (x, y) { return x + y; }, 0);
assert(Math.abs(sum - 0.01 * (1 - Math.pow(0.93, 10)) / 0.07) < 1e-6, 'interior glide distance unchanged');
console.log('reversals', revAll, 'runs', runs);console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
