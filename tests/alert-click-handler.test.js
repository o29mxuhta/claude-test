// Regression test: exactly one active click handler for alert-zone selection,
// and no raw DOM click listener on the map container. A raw DOM listener fired
// on every pointer release over the map (no drag tolerance), so dragging the
// map and lifting the finger/cursor over an alert polygon selected that zone
// (mobile + desktop, 2026-11-04). MapLibre's layer click handler ignores drags
// via clickTolerance, so it is the only registration allowed.
// Run: node tests/alert-click-handler.test.js
var fs = require('fs'), path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
var passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.log('FAIL: ' + m); } }

// Strip block comments so dead/commented-out code is not counted.
var code = html.replace(/\/\*[\s\S]*?\*\//g, '');

var layerClicks = code.split("map.on('click', 'alerts-hit'").length - 1;
assert(layerClicks === 1, "exactly one active map.on('click', 'alerts-hit') registration, found " + layerClicks);

assert(code.indexOf("getCanvasContainer().addEventListener('click'") === -1,
  'no raw DOM click listener on the map canvas container (bypasses drag tolerance)');

// The surviving handler must keep the UI-state guards.
var i = code.indexOf("map.on('click', 'alerts-hit'");
var body = code.slice(i, i + 800);
assert(body.indexOf('menuOpen') !== -1 && body.indexOf('drivingModeFeatureEnabled') !== -1,
  'surviving click handler keeps menuOpen / drivingModeFeatureEnabled guards');

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
