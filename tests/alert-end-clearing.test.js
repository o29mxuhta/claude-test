// End-of-alert clearing tests: run the real alert-state functions from
// web/index.html (extracted from the inline script, same harness as
// tests/alert-lifecycle.test.js) against scripted end-of-alert sequences.
// Locks three safety behaviors:
//  1. Two distinct threats that share a display state (rockets and
//     non-conventional are both 'red') are tracked by identity: a
//     threat-specific end removes only its own threat, never the other one.
//  2. Staleness is per threat: an end title ends only threats that started
//     before it was issued - a hidden newer threat cannot block a valid
//     all-clear, and a stale all-clear cannot erase a threat that began
//     after it.
//  3. Threat identity survives the localStorage cache round-trip, so the
//     same rules hold for alerts restored after a page reload.
// Run: node tests/alert-end-clearing.test.js

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}
function section(name) { console.log('\n' + name); }

var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

// Balanced-brace scan honoring strings, template literals and comments.
function findBlockEnd(src, openIdx) {
  var depth = 0, quote = null, esc = false, line = false, block = false;
  for (var i = openIdx; i < src.length; i++) {
    var c = src[i], nx = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && nx === '/') { block = false; i++; } continue; }
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && nx === '/') { line = true; i++; continue; }
    if (c === '/' && nx === '*') { block = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}
function extractFunction(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  var end = findBlockEnd(src, src.indexOf('{', start));
  return end === -1 ? null : src.slice(start, end);
}

var classStart = html.indexOf('var GREEN_TERMS');
var classFn = extractFunction(html, 'classifyTitle');
assert(classStart !== -1 && !!classFn, 'extracted classification block from web/index.html');
var classificationSrc = html.slice(classStart, html.indexOf(classFn) + classFn.length);

var threatsStart = html.indexOf('var locationThreats = {};');
var applyFn = extractFunction(html, 'applyThreatEvent');
assert(threatsStart !== -1 && !!applyFn, 'extracted threat-state block from web/index.html');
var threatsSrc = html.slice(threatsStart, html.indexOf(applyFn) + applyFn.length);

var setStateSrc = extractFunction(html, 'setLocationState');
var resolveSrc = extractFunction(html, 'resolveInheritedState');
var cacheWriteSrc = extractFunction(html, 'updateAlertCache');
var cacheReadSrc = extractFunction(html, 'loadCachedAlerts');
assert(!!setStateSrc && !!resolveSrc && !!cacheWriteSrc && !!cacheReadSrc,
  'extracted setLocationState, resolveInheritedState, updateAlertCache, loadCachedAlerts');

var store = {};
var sandbox = {
  console: { warn: function () {}, log: function () {}, error: function () {} },
  locationStates: {},
  Date: Date, Math: Math, JSON: JSON,
  localStorage: {
    getItem: function (k) { return store[k] === undefined ? null : store[k]; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  },
  applyFeatureStyle: function () {},
  addTTAMarker: function () {}, removeTTAMarker: function () {},
  playSoundForState: function () {}, updateLiveStatus: function () {},
};
vm.createContext(sandbox);
vm.runInContext(classificationSrc + '\n' + threatsSrc + '\n' + setStateSrc + '\n' +
  resolveSrc + '\n' + cacheWriteSrc + '\n' + cacheReadSrc, sandbox);

var T0 = 1700000000000; // fixed clock for determinism
var LOC = 'עפולה';
function reset() {
  delete sandbox.locationStates[LOC];
  vm.runInContext('delete locationThreats[' + JSON.stringify(LOC) + ']; delete locationThreatParts[' + JSON.stringify(LOC) + '];', sandbox);
  sandbox.localStorage.removeItem('oref-active-alerts');
}
function displayed() {
  var e = sandbox.locationStates[LOC];
  return e ? e.state : null;
}

var ROCKETS = 'ירי רקטות וטילים';
var NONCON = 'נשק לא קונבנציונלי';
var UAV = 'חדירת כלי טיס עוין';
var ALL_CLEAR = 'ניתן לצאת מהמרחב המוגן';

section('1. Same-state threats: a threat-specific end removes only its own threat');
reset();
sandbox.applyThreatEvent(LOC, ROCKETS + ' - היכנסו למרחב המוגן', 'red', T0);
sandbox.applyThreatEvent(LOC, NONCON + ' - היכנסו למרחב המוגן', 'red', T0 + 60000);
assert(displayed() === 'red', 'two red threats displayed red');
var r = sandbox.applyThreatEvent(LOC, ROCKETS + ' - האירוע הסתיים', 'green', T0 + 120000);
assert(r === 'red' && displayed() === 'red',
  'rockets-end keeps the non-conventional threat displayed, got ' + displayed());
r = sandbox.applyThreatEvent(LOC, NONCON + ' - האירוע הסתיים', 'green', T0 + 180000);
assert(r === 'green' && displayed() === 'green',
  'last same-state threat end clears the display, got ' + displayed());

section('2. A hidden newer threat cannot block a valid all-clear');
reset();
sandbox.applyThreatEvent(LOC, ROCKETS + ' - היכנסו למרחב המוגן', 'red', T0);
sandbox.applyThreatEvent(LOC, UAV + ' - היכנסו למרחב המוגן', 'purple', T0 + 50000); // hidden behind red
r = sandbox.applyThreatEvent(LOC, ALL_CLEAR, 'green', T0 + 30000); // issued before the UAV alert
assert(r === 'purple' && displayed() === 'purple',
  'all-clear ends the red it covers; the later UAV stays displayed, got ' + displayed());

section('3. A stale all-clear cannot erase a threat that began after it');
reset();
sandbox.applyThreatEvent(LOC, UAV + ' - היכנסו למרחב המוגן', 'purple', T0 + 50000);
sandbox.applyThreatEvent(LOC, ROCKETS + ' - היכנסו למרחב המוגן', 'red', T0); // backdated, replaces display
r = sandbox.applyThreatEvent(LOC, ALL_CLEAR, 'green', T0 + 30000);
assert(r === 'purple' && displayed() === 'purple',
  'all-clear covers the red (T0) but not the UAV (T0+50s), got ' + displayed());

section('4. Existing end-of-alert behaviors unchanged');
reset();
sandbox.applyThreatEvent(LOC, ROCKETS + ' - היכנסו למרחב המוגן', 'red', T0);
sandbox.applyThreatEvent(LOC, UAV + ' - היכנסו למרחב המוגן', 'purple', T0 + 30000);
r = sandbox.applyThreatEvent(LOC, UAV + ' - האירוע הסתיים', 'green', T0 + 60000);
assert(r === 'red' && displayed() === 'red', 'distinct-state threat end keeps the other, got ' + displayed());
r = sandbox.applyThreatEvent(LOC, ALL_CLEAR, 'green', T0 + 120000);
assert(r === 'green' && displayed() === 'green', 'fresh generic all-clear clears everything, got ' + displayed());
reset();
sandbox.applyThreatEvent(LOC, ROCKETS + ' - היכנסו למרחב המוגן', 'red', T0 + 60000);
r = sandbox.applyThreatEvent(LOC, ROCKETS + ' - האירוע הסתיים', 'green', T0);
assert(r === 'red' && displayed() === 'red', 'stale threat-specific end ignored, got ' + displayed());

section('5. Threat identity without a recorded id ends the whole state (legacy fallback)');
reset();
vm.runInContext('locationThreats[' + JSON.stringify(LOC) + '] = { red: ' + T0 + ' };', sandbox); // restored shape, no parts
sandbox.locationStates[LOC] = { state: 'red', since: T0 };
r = sandbox.applyThreatEvent(LOC, ROCKETS + ' - האירוע הסתיים', 'green', T0 + 60000);
assert(r === 'green' && displayed() === 'green',
  'unknown-identity red end clears the state entry like today, got ' + displayed());

section('6. Threat identity survives the cache round-trip');
reset();
// Recent real timestamps: the restore path smart-expires rockets after 30 min,
// so this scenario must stay well inside that window.
var NOW = Date.now();
sandbox.applyThreatEvent(LOC, ROCKETS + ' - היכנסו למרחב המוגן', 'red', NOW - 600000);
sandbox.applyThreatEvent(LOC, NONCON + ' - היכנסו למרחב המוגן', 'red', NOW - 540000);
sandbox.updateAlertCache(LOC, 'red', NOW - 540000);
// Simulate a reload: wipe live memory, restore from the persisted cache.
vm.runInContext('delete locationThreats[' + JSON.stringify(LOC) + ']; delete locationThreatParts[' + JSON.stringify(LOC) + '];', sandbox);
delete sandbox.locationStates[LOC];
sandbox.loadCachedAlerts();
r = sandbox.applyThreatEvent(LOC, ROCKETS + ' - האירוע הסתיים', 'green', NOW - 60000);
assert(r === 'red' && displayed() === 'red',
  'after restore, rockets-end still keeps the non-conventional threat, got ' + displayed());

section('7. Combined titles keep first-match classification (documented limitation)');
assert(sandbox.classifyTitle(ROCKETS + ', ' + UAV + ' - היכנסו למרחב המוגן') === 'red',
  'combined rockets+UAV title classifies by the first threat term (red)');
reset();
sandbox.applyThreatEvent(LOC, ROCKETS + ', ' + UAV + ' - היכנסו למרחב המוגן', 'red', T0);
r = sandbox.applyThreatEvent(LOC, UAV + ' - האירוע הסתיים', 'green', T0 + 60000);
assert(r === 'red' && displayed() === 'red',
  'a UAV end does not end a combined title classified as rockets (known limitation)');

section('8. removeLocation drops threats and their identity map');
assert(/function removeLocation[\s\S]{0,400}delete locationThreatParts\[name\]/.test(html),
  'removeLocation also clears locationThreatParts');

console.log('\nalert-end-clearing: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
