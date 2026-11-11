// Nationwide-scope alert tests: run the real alert functions from
// web/index.html (extracted from the inline script, same harness as
// tests/alert-end-clearing.test.js) against the 2026-11-11 earthquake shape:
// Pikud HaOref issued "רעידת אדמה - צאו לשטח פתוח" whose entire location
// field was the generic scope "בחלק מהאזורים בארץ" - no zone names at all.
// Before the fix, every display path silently dropped such alerts.
// Locks:
//  1. nationwideScopeOf() recognizes the official scope (only as the whole
//     data value) and rejects zone names, partial strings and multi-values.
//  2. The rolling history feed paints EVERY polygon, records per-city
//     history, and adds ONE timeline entry labeled with the scope text.
//  3. A green nationwide event wipes the board (global all-clear).
//  4. A genuinely unknown location string is still dropped (regression).
//  5. The archive path keeps the record as a single nationwide timeline
//     entry; a nationwide record with no type stays a neutral unknown row.
//  6. History replay paints the whole country for the event window only.
//  7. The status pill reports an earthquake as active (it used to fall to
//     "no alerts"), shows "התרעה ארצית" for a full fan-out, and never counts
//     earthquake zones as "במקלטים".
// Run: node tests/nationwide-scope.test.js

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

// --- Extract the real code under test ---
var classStart = html.indexOf('var GREEN_TERMS');
var classFn = extractFunction(html, 'classifyTitle');
assert(classStart !== -1 && !!classFn, 'extracted classification block');
var classificationSrc = html.slice(classStart, html.indexOf(classFn) + classFn.length);

// Slice the normalization block by boundary markers, not by brace scanning:
// foldName's regexes contain quote characters, which defeats the scanner.
var normStart = html.indexOf('var BIDI_MARKS_RE');
var normEnd = html.indexOf('var nameIndex = {');
assert(normStart !== -1 && normEnd > normStart, 'extracted name normalization block');
var normalizeSrc = html.slice(normStart, normEnd);

var threatsStart = html.indexOf('var locationThreats = {};');
var applyFn = extractFunction(html, 'applyThreatEvent');
assert(threatsStart !== -1 && !!applyFn, 'extracted threat-state block');
var threatsSrc = html.slice(threatsStart, html.indexOf(applyFn) + applyFn.length);

var setStateSrc = extractFunction(html, 'setLocationState');
var resolveSrc = extractFunction(html, 'resolveInheritedState');
var resolveLocSrc = extractFunction(html, 'resolveLocation');
var expandSrc = extractFunction(html, 'expandAndResolveLocations');
var parseDateSrc = extractFunction(html, 'parseAlertDate');
var recordSrc = extractFunction(html, 'recordHistory');
var historyEntrySrc = extractFunction(html, 'processHistoryEntry');
var processEntriesSrc = extractFunction(html, 'processEntries');
var reconstructSrc = extractFunction(html, 'reconstructStateAt');
var heatmapSrc = extractFunction(html, 'generateHeatmapData');
assert(!!heatmapSrc, 'extracted generateHeatmapData');
var liveStatusSrc = extractFunction(html, 'updateLiveStatus');
assert(!!setStateSrc && !!resolveSrc && !!resolveLocSrc && !!expandSrc && !!parseDateSrc &&
  !!recordSrc && !!historyEntrySrc && !!processEntriesSrc && !!reconstructSrc && !!liveStatusSrc,
  'extracted every function under test');

var cacheStart = html.indexOf('var alertCacheSuspend');
var flushFn = extractFunction(html, 'flushAlertCache');
assert(cacheStart !== -1 && !!flushFn, 'extracted alert-cache batch block');
var cacheSrc = html.slice(cacheStart, html.indexOf(flushFn) + flushFn.length);

var unresolvedStart = html.indexOf('var unresolvedLocations = {};');
var noteFn = extractFunction(html, 'noteUnresolved');
var unresolvedSrc = html.slice(unresolvedStart, html.indexOf(noteFn) + noteFn.length);

var nwStart = html.indexOf('var NATIONWIDE_SCOPES');
var allNamesFn = extractFunction(html, 'allPolygonNames');
assert(nwStart !== -1 && !!allNamesFn, 'extracted nationwide scope block');
var nationwideSrc = html.slice(nwStart, html.indexOf(allNamesFn) + allNamesFn.length);

// --- Sandbox ---
var store = {};
var ZONES = ['עפולה', 'חיפה', 'אילת'];
var nameToId = { 'עפולה': 1, 'חיפה': 2, 'אילת': 3 };
// Captured via closures: `this` inside Node stubs does not sync back from the vm.
var painted = {};
var lastStatus = null;

var sandbox = {
  console: { warn: function () {}, log: function () {}, error: function () {} },
  window: {},
  document: { dispatchEvent: function () {} },
  CustomEvent: function () {},
  Date: Date, Math: Math, JSON: JSON, Set: Set, Object: Object, Array: Array, String: String, Number: Number,
  localStorage: {
    getItem: function (k) { return store[k] === undefined ? null : store[k]; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  },
  nameToId: nameToId,
  locationStates: {},
  locationHistory: {},
  preAlertMemory: {},
  extendedHistory: [],
  extendedRids: new Set(),
  isLiveMode: true,
  liveLocationStates: null,
  selectedLocation: null,
  initialized: true,
  feedHealth: { alerts: {}, history: {} },
  locationPopulations: { 'עפולה': 50000, 'חיפה': 300000, 'אילת': 50000 },
  lastDangerTime: 0,
  GREEN_FADE_MS: 120000,
  ALERT_MAX_AGE_MS: 3600000,
  HISTORICAL_ALIASES: {},
  HISTORICAL_CONTAINERS: {},
  isViewingToday: function () { return true; },
  applyFeatureStyle: function (name, state) { painted[name] = state; },
  resetFeatureStyle: function (name) { delete painted[name]; },
  addTTAMarker: function () {}, removeTTAMarker: function () {},
  playSoundForState: function () {},
  updateLiveStatus: function () {},
  renderFeedHealth: function () {},
  allFeedsHealthy: function () { return true; },
  setStatus: function () {},
  setStatusHTML: function (state, htmlText) { lastStatus = { state: state, html: htmlText }; },
  formatRelativeTime: function () { return ''; },
  cancelPolygonHint: function () {},
  _applyPanelHighlight: function () {},
  updateShadowState: function () {},
};
vm.createContext(sandbox);
vm.runInContext([
  classificationSrc, normalizeSrc, 'var nameIndex = { exact: {}, base: {}, zone: {} };',
  resolveLocSrc, unresolvedSrc, expandSrc, nationwideSrc, threatsSrc, setStateSrc,
  resolveSrc, cacheSrc, parseDateSrc, recordSrc, historyEntrySrc, processEntriesSrc,
  reconstructSrc, liveStatusSrc, heatmapSrc
].join('\n'), sandbox);

var QUAKE_TITLE = 'רעידת אדמה - צאו לשטח פתוח';
var SCOPE = 'בחלק מהאזורים בארץ';

function feedTs(date) {
  var pad = function (n) { return n < 10 ? '0' + n : n; };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}
function resetAll() {
  vm.runInContext(
    'locationStates = {}; locationHistory = {}; extendedHistory = []; extendedRids = new Set();' +
    'for (var k in locationThreats) delete locationThreats[k];' +
    'for (var k2 in locationThreatParts) delete locationThreatParts[k2];' +
    'for (var k3 in unresolvedLocations) delete unresolvedLocations[k3];' +
    '_allPolygonNames = null;', sandbox);
  painted = {};
  lastStatus = null;
  sandbox.localStorage.removeItem('oref-active-alerts');
}
function unresolvedCount() {
  return vm.runInContext('Object.keys(unresolvedLocations).length', sandbox);
}

section('1. nationwideScopeOf matches only the exact whole-data scope');
assert(sandbox.nationwideScopeOf([SCOPE]) === SCOPE, 'exact scope string matches');
assert(sandbox.nationwideScopeOf(['בחלק מהאזורים בארץ']) !== null, 'repeated literal matches');
assert(sandbox.nationwideScopeOf(['‏בחלק מהאזורים בארץ‎']) === SCOPE, 'bidi-marked scope matches and returns the clean label');
assert(sandbox.nationwideScopeOf(['חיפה']) === null, 'a zone name is not a scope');
assert(sandbox.nationwideScopeOf(['בארץ']) === null, 'a substring is not a scope');
assert(sandbox.nationwideScopeOf([SCOPE, 'חיפה']) === null, 'multi-value data is not a scope');
assert(sandbox.nationwideScopeOf([]) === null && sandbox.nationwideScopeOf(null) === null, 'empty data is not a scope');
assert(sandbox.allPolygonNames().length === 3, 'allPolygonNames returns every polygon name');

section('2. Rolling history feed: earthquake with generic scope paints the whole country');
resetAll();
var t0 = new Date(Date.now() - 5 * 60000);
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
ZONES.forEach(function (z) {
  assert(sandbox.locationStates[z] && sandbox.locationStates[z].state === 'earthquake',
    z + ' painted earthquake, got ' + (sandbox.locationStates[z] || {}).state);
  assert(painted[z] === 'earthquake', z + ' feature style applied');
  assert((sandbox.locationHistory[z] || []).some(function (h) { return h.title === QUAKE_TITLE; }),
    z + ' city history recorded the quake');
});
assert(sandbox.extendedHistory.length === 1, 'exactly one timeline entry, got ' + sandbox.extendedHistory.length);
assert(sandbox.extendedHistory[0].nationwide === true && sandbox.extendedHistory[0].location === SCOPE,
  'timeline entry is the nationwide scope record');
assert(sandbox.extendedHistory[0].state === 'earthquake', 'timeline entry classified earthquake');
assert(unresolvedCount() === 0, 'scope is not logged as unresolved');
// Replay of the same feed entry must not duplicate the timeline record.
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
assert(sandbox.extendedHistory.length === 1, 'replayed entry does not duplicate the timeline record');

section('3. A green nationwide event wipes the board');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
var cacheBeforeClear = JSON.parse(store['oref-active-alerts'] || '{}');
assert(Object.keys(cacheBeforeClear).length > 0, 'cache actually persisted the quake before the clear (non-vacuous check)');
sandbox.processHistoryEntry({ alertDate: feedTs(new Date()), title: 'האירוע הסתיים', data: SCOPE, category: 7 });
ZONES.forEach(function (z) {
  assert(sandbox.locationStates[z] && sandbox.locationStates[z].state === 'green',
    z + ' cleared to green, got ' + (sandbox.locationStates[z] || {}).state);
});
var cacheAfterClear = JSON.parse(store['oref-active-alerts'] || '{}');
assert(Object.keys(cacheAfterClear).length === 0, 'persisted cache rebuilt without the cleared threats');

section('4. Regression: a genuinely unknown location is still dropped');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: 'מקום בדימיון', category: 7 });
assert(Object.keys(sandbox.locationStates).length === 0, 'no zone painted for an unknown place');
assert(sandbox.extendedHistory.length === 0, 'no timeline entry for an unknown place');
assert(unresolvedCount() === 1, 'unknown place logged as unresolved');

section('5. Archive: the day record becomes ONE nationwide timeline entry');
resetAll();
var added = sandbox.processEntries([
  { data: SCOPE, alertDate: feedTs(t0).replace(' ', 'T'), category_desc: QUAKE_TITLE, rid: 9001 }
]);
assert(added === 1, 'one entry added, got ' + added);
assert(sandbox.extendedHistory.length === 1 && sandbox.extendedHistory[0].nationwide === true &&
  sandbox.extendedHistory[0].state === 'earthquake' && sandbox.extendedHistory[0].location === SCOPE,
  'archive record kept as a single nationwide timeline entry');
assert(Object.keys(sandbox.locationHistory).length === 0, 'archive path adds no per-city history rows');
// A nationwide record with no type stays a neutral unknown row, never a threat.
added = sandbox.processEntries([
  { data: SCOPE, alertDate: feedTs(new Date(t0.getTime() + 60000)).replace(' ', 'T'), category_desc: '', rid: 9002 }
]);
assert(added === 1, 'missing-type record still listed, got ' + added);
assert(sandbox.extendedHistory.length === 2 &&
  sandbox.extendedHistory[1].state === 'unknown' && !sandbox.extendedHistory[1].nationwide,
  'missing-type nationwide record stays neutral');

section('6. Replay paints the whole country for the event window only');
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.reconstructStateAt(t0.getTime() + 60000);
ZONES.forEach(function (z) {
  assert(painted[z] === 'earthquake', z + ' painted during the event window');
});
sandbox.reconstructStateAt(t0.getTime() + 2 * 3600000);
assert(Object.keys(painted).length === 0, 'paint expires past the alert max age');
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.extendedHistory.push({ location: SCOPE, title: 'האירוע הסתיים', alertDate: t0.getTime() + 120000, state: 'green', nationwide: true });
sandbox.reconstructStateAt(t0.getTime() + 180000);
assert(Object.keys(painted).length === 0, 'a later nationwide all-clear ends the replay paint');

section('7. Status pill reports earthquakes honestly');
resetAll();
ZONES.forEach(function (z) { sandbox.locationStates[z] = { state: 'earthquake', since: t0.getTime() }; });
sandbox.updateLiveStatus();
assert(lastStatus && lastStatus.state === 'earthquake',
  'earthquake is the dominant status, got ' + (lastStatus || {}).state);
assert(lastStatus.html.indexOf('התרעה ארצית') !== -1, 'full fan-out labeled התרעה ארצית, got: ' + lastStatus.html);
assert(lastStatus.html.indexOf('במקלטים') === -1, 'no shelter count for an earthquake');
resetAll();
sandbox.locationStates['עפולה'] = { state: 'earthquake', since: t0.getTime() };
sandbox.updateLiveStatus();
assert(lastStatus && lastStatus.state === 'earthquake', 'single-city earthquake is active status');
assert(lastStatus.html.indexOf('אזורי התראה') !== -1 && lastStatus.html.indexOf('במקלטים') === -1,
  'single-city earthquake shows zone count without shelter wording, got: ' + lastStatus.html);


section('8. Sourcery review regressions');
// 8a. allPolygonNames must not cache an empty list before polygons load.
resetAll();
vm.runInContext('var _savedNameToId = nameToId; nameToId = {}; _allPolygonNames = null;', sandbox);
assert(sandbox.allPolygonNames().length === 0, 'no polygons before buildPolygons');
vm.runInContext('nameToId = _savedNameToId; delete _savedNameToId;', sandbox);
assert(sandbox.allPolygonNames().length === 3,
  'empty result was not cached - polygons found once loaded, got ' + sandbox.allPolygonNames().length);

// 8b. A nationwide all-clear from the feed is itself recorded on the timeline.
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
sandbox.processHistoryEntry({ alertDate: feedTs(new Date(t0.getTime() + 300000)), title: 'האירוע הסתיים', data: SCOPE, category: 7 });
assert(sandbox.extendedHistory.length === 2, 'quake + clear both on the timeline, got ' + sandbox.extendedHistory.length);
assert(sandbox.extendedHistory[1].nationwide === true && sandbox.extendedHistory[1].state === 'green',
  'the nationwide clear is a nationwide green timeline record');
ZONES.forEach(function (z) {
  assert((sandbox.locationHistory[z] || []).some(function (h) { return h.state === 'green'; }),
    z + ' city history recorded the clear');
});

// 8c. Replay: a local alert must not survive a later nationwide all-clear.
resetAll();
sandbox.extendedHistory.push({ location: 'חיפה', title: 'ירי רקטות', alertDate: t0.getTime(), state: 'red' });
sandbox.extendedHistory.push({ location: SCOPE, title: 'האירוע הסתיים', alertDate: t0.getTime() + 120000, state: 'green', nationwide: true });
sandbox.reconstructStateAt(t0.getTime() + 120000 + 120000 + 1000);
assert(painted['חיפה'] !== 'red', 'local red alert wiped by the nationwide clear, got ' + painted['חיפה']);

// 8d. Replay: a city cleared after a nationwide alert stays cleared.
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.extendedHistory.push({ location: 'חיפה', title: 'האירוע הסתיים', alertDate: t0.getTime() + 60000, state: 'green' });
sandbox.reconstructStateAt(t0.getTime() + 90000);
assert(painted['עפולה'] === 'earthquake', 'uncleared zone still painted by the overlay');
assert(painted['חיפה'] !== 'earthquake', 'city cleared after the nationwide alert is not repainted, got ' + painted['חיפה']);

// 8e. Replay: a later weaker nationwide threat never replaces a stronger one.
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.extendedHistory.push({ location: SCOPE, title: 'התרעה', alertDate: t0.getTime() + 60000, state: 'yellow', nationwide: true });
sandbox.reconstructStateAt(t0.getTime() + 90000);
ZONES.forEach(function (z) {
  assert(painted[z] === 'earthquake', z + ' keeps the stronger nationwide threat, got ' + painted[z]);
});

// 8f. A helper throwing mid-fan-out must release the alert-cache suspension.
resetAll();
vm.runInContext('var _origATE = applyThreatEvent; applyThreatEvent = function () { throw new Error("boom"); };', sandbox);
var threw = false;
try {
  sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
} catch (e) { threw = true; }
vm.runInContext('applyThreatEvent = _origATE; delete _origATE;', sandbox);
assert(threw, 'the throwing helper propagated');
assert(vm.runInContext('alertCacheSuspend', sandbox) === 0,
  'cache suspension released on throw, got ' + vm.runInContext('alertCacheSuspend', sandbox));
resetAll();


section('9. Stale feed responses and heatmap');
// 9a. A late older replay of the quake must not revive zones cleared by the all-clear.
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
var tClear = new Date(t0.getTime() + 300000);
sandbox.processHistoryEntry({ alertDate: feedTs(tClear), title: 'האירוע הסתיים', data: SCOPE, category: 7 });
ZONES.forEach(function (z) {
  assert(sandbox.locationStates[z] && sandbox.locationStates[z].state === 'green', z + ' cleared');
});
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
ZONES.forEach(function (z) {
  assert(sandbox.locationStates[z] && sandbox.locationStates[z].state === 'green',
    z + ' stays cleared when the older alert replays late, got ' + (sandbox.locationStates[z] || {}).state);
});

// 9b. Heatmap: a nationwide event contributes a point for every polygon.
resetAll();
var heatFeatures = null;
vm.runInContext(
  'mapLoaded = true; _polygonCentroid = function (n) { return [n.length, n.charCodeAt(0)]; };' +
  'map = { getSource: function () { return { setData: function (d) { __heat = d; } }; } };',
  sandbox);
vm.runInContext('var __heat = null;', sandbox);
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.generateHeatmapData();
heatFeatures = vm.runInContext('__heat ? __heat.features.length : -1', sandbox);
assert(heatFeatures === 3, 'nationwide event heats all 3 polygons, got ' + heatFeatures);
resetAll();
vm.runInContext('__heat = null;', sandbox);
sandbox.extendedHistory.push({ location: 'חיפה', title: 'ירי רקטות', alertDate: t0.getTime(), state: 'red' });
sandbox.generateHeatmapData();
heatFeatures = vm.runInContext('__heat ? __heat.features.length : -1', sandbox);
assert(heatFeatures === 1, 'a city alert still contributes exactly one point, got ' + heatFeatures);

console.log('\nnationwide-scope: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
