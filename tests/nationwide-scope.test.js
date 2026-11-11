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
var reconcileSrc = extractFunction(html, 'reconcileRestoredAlerts');
assert(!!reconcileSrc, 'extracted reconcileRestoredAlerts');
var nwActiveSrc = extractFunction(html, 'nationwideActiveThreats');
var nwCoverageSrc = extractFunction(html, 'restoredNationwideCoverage');
var fadeSrc = extractFunction(html, 'fadeGreenMarkers');
var removeLocSrc = extractFunction(html, 'removeLocation');
var loadCachedSrc = extractFunction(html, 'loadCachedAlerts');
assert(!!fadeSrc && !!removeLocSrc && !!loadCachedSrc, 'extracted expiry and cache-restore functions');
assert(!!nwCoverageSrc, 'extracted restoredNationwideCoverage');
var nwThreatSrc = extractFunction(html, 'nationwideThreatActive');
var endNwSrc = extractFunction(html, 'endNationwideThreatForNamedClear');
var liveSrc = extractFunction(html, 'processLiveAlert');
assert(!!nwActiveSrc && !!nwThreatSrc && !!endNwSrc && !!liveSrc,
  'extracted the named-clear helpers and processLiveAlert');
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
  shouldAutoZoomToEvents: function () { return false; },
  map: { setFeatureState: function () {}, removeFeatureState: function () {} },
  mapLoaded: true,
};
vm.createContext(sandbox);
vm.runInContext([
  classificationSrc, normalizeSrc, 'var nameIndex = { exact: {}, base: {}, zone: {} };',
  resolveLocSrc, unresolvedSrc, expandSrc, nationwideSrc, threatsSrc, setStateSrc,
  resolveSrc, cacheSrc, parseDateSrc, recordSrc, historyEntrySrc, processEntriesSrc,
  reconstructSrc, liveStatusSrc, heatmapSrc, reconcileSrc,
  'var nationwideEndedThreats = {};', nwCoverageSrc, nwActiveSrc, nwThreatSrc, endNwSrc, liveSrc,
  fadeSrc, removeLocSrc, loadCachedSrc
].join('\n'), sandbox);
// resolveLocation() consults nameIndex, which cities.json fills in the real
// app; seed the three test zones with their folded forms as keys.
vm.runInContext(
  "['עפולה', 'חיפה', 'אילת'].forEach(function (z) { nameIndex.exact[foldName(z)] = [z]; });",
  sandbox);

var QUAKE_TITLE = 'רעידת אדמה - צאו לשטח פתוח';
var SCOPE = 'בחלק מהאזורים בארץ';

function feedTs(date) {
  // oref timestamps are Asia/Jerusalem wall time (parseAlertDate parses them
  // in that zone), so format there too - otherwise the tests only pass on
  // machines whose locale happens to be Jerusalem.
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  var v = {};
  parts.forEach(function (p) { v[p.type] = p.value; });
  return v.year + '-' + v.month + '-' + v.day + ' ' + (v.hour === '24' ? '00' : v.hour) + ':' + v.minute + ':' + v.second;
}
function resetAll() {
  vm.runInContext(
    'locationStates = {}; locationHistory = {}; extendedHistory = []; extendedRids = new Set();' +
    'for (var k in locationThreats) delete locationThreats[k];' +
    'for (var k2 in locationThreatParts) delete locationThreatParts[k2];' +
    'for (var k3 in unresolvedLocations) delete unresolvedLocations[k3];' +
    'for (var k4 in nationwideEndedThreats) delete nationwideEndedThreats[k4];' +
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

section('10. Earthquake return-to-buildings clears to green');
assert(sandbox.classifyTitle('רעידת אדמה - הנחיות חזרה למבנים') === 'green',
  'return-to-buildings classifies green, got ' + sandbox.classifyTitle('רעידת אדמה - הנחיות חזרה למבנים'));
assert(sandbox.classifyTitle(QUAKE_TITLE) === 'earthquake',
  'the quake warning itself still classifies earthquake');
// Zone-scoped: only the named zone goes green; the rest stay under the quake.
resetAll();
sandbox.applyThreatEvent('אילת', QUAKE_TITLE, 'earthquake', t0.getTime());
sandbox.applyThreatEvent('חיפה', QUAKE_TITLE, 'earthquake', t0.getTime());
sandbox.applyThreatEvent('אילת', 'רעידת אדמה - הנחיות חזרה למבנים', 'green', t0.getTime() + 60000);
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'green',
  'named zone cleared to green, got ' + (sandbox.locationStates['אילת'] || {}).state);
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'earthquake',
  'unmentioned zone stays under the quake, got ' + (sandbox.locationStates['חיפה'] || {}).state);
// Nationwide variant: return-to-buildings with the generic scope clears every zone.
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
sandbox.processHistoryEntry({ alertDate: feedTs(new Date()), title: 'רעידת אדמה - הנחיות חזרה למבנים', data: SCOPE, category: 13 });
ZONES.forEach(function (z) {
  assert(sandbox.locationStates[z] && sandbox.locationStates[z].state === 'green',
    z + ' cleared to green by the nationwide return, got ' + (sandbox.locationStates[z] || {}).state);
});
assert(sandbox.extendedHistory.some(function (h) { return h.nationwide === true && h.state === 'green'; }),
  'nationwide green timeline entry recorded');

section('11. Replay: a titled all-clear preserves unrelated active threats');
// Sourcery finding: reconstructStateAt treated every green as a full-zone clear.
// Same zone, mixed threats: rockets active, quake hidden behind them by priority;
// the earthquake-only return-to-buildings must not erase the rockets.
resetAll();
sandbox.extendedHistory.push({ location: 'אילת', title: 'ירי רקטות וטילים - היכנסו למרחב המוגן', alertDate: t0.getTime(), state: 'red' });
sandbox.extendedHistory.push({ location: 'אילת', title: QUAKE_TITLE, alertDate: t0.getTime() + 60000, state: 'earthquake' });
sandbox.extendedHistory.push({ location: 'אילת', title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: t0.getTime() + 120000, state: 'green' });
sandbox.reconstructStateAt(t0.getTime() + 180000);
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'red',
  'rockets survive the earthquake-only clear in replay, got ' + (sandbox.locationStates['אילת'] || {}).state);
// A zone under the quake alone does clear green.
resetAll();
sandbox.extendedHistory.push({ location: 'חיפה', title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake' });
sandbox.extendedHistory.push({ location: 'חיפה', title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: t0.getTime() + 60000, state: 'green' });
sandbox.reconstructStateAt(t0.getTime() + 120000);
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'green',
  'quake-only zone clears green in replay, got ' + (sandbox.locationStates['חיפה'] || {}).state);
// Nationwide titled variant: clears the nationwide quake but not local rockets.
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.extendedHistory.push({ location: 'אילת', title: 'ירי רקטות וטילים - היכנסו למרחב המוגן', alertDate: t0.getTime() + 60000, state: 'red' });
sandbox.extendedHistory.push({ location: SCOPE, title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: t0.getTime() + 120000, state: 'green', nationwide: true });
sandbox.reconstructStateAt(t0.getTime() + 180000);
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'red',
  'rockets survive the nationwide earthquake clear, got ' + (sandbox.locationStates['אילת'] || {}).state);
assert(!sandbox.locationStates['חיפה'],
  'nationwide quake paint clears, got ' + JSON.stringify(sandbox.locationStates['חיפה'] || null));
// Untitled nationwide all-clear still wipes everything, rockets included.
resetAll();
sandbox.extendedHistory.push({ location: 'אילת', title: 'ירי רקטות וטילים - היכנסו למרחב המוגן', alertDate: t0.getTime(), state: 'red' });
sandbox.extendedHistory.push({ location: SCOPE, title: 'האירוע הסתיים', alertDate: t0.getTime() + 60000, state: 'green', nationwide: true });
sandbox.reconstructStateAt(t0.getTime() + 120000);
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'green',
  'untitled nationwide all-clear still wipes rockets, got ' + (sandbox.locationStates['אילת'] || {}).state);

section('12. Reload reconciliation: cached threats end via today\'s clears');
// Gil's stuck map: old code cached the earthquake threat; after deploy+reload
// the 12:14 titled clear must end it.
resetAll();
sandbox.locationThreats['אילת'] = { earthquake: t0.getTime() };
sandbox.locationStates['אילת'] = { state: 'earthquake', since: t0.getTime() };
sandbox.extendedHistory.push({ location: 'אילת', title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: Date.now() - 30000, state: 'green' });
sandbox.reconcileRestoredAlerts();
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'green',
  'restored quake zone clears green on reload, got ' + (sandbox.locationStates['אילת'] || {}).state);
assert(!sandbox.locationThreats['אילת'], 'restored earthquake threat removed');
// ...but a clear whose green fade has long expired ends the zone CLEAN (no green flash).
resetAll();
sandbox.locationThreats['אילת'] = { earthquake: Date.now() - 30 * 60000 };
sandbox.locationStates['אילת'] = { state: 'earthquake', since: Date.now() - 30 * 60000 };
sandbox.extendedHistory.push({ location: 'אילת', title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: Date.now() - 10 * 60000, state: 'green' });
sandbox.reconcileRestoredAlerts();
assert(!sandbox.locationStates['אילת'] && !sandbox.locationThreats['אילת'],
  'an expired clear ends the zone clean, got ' + JSON.stringify(sandbox.locationStates['אילת'] || null));
assert(painted['אילת'] === undefined, 'an expired clear paints nothing');
// An unrelated restored threat survives a titled clear.
resetAll();
sandbox.locationThreats['אילת'] = { red: t0.getTime(), earthquake: t0.getTime() };
sandbox.locationStates['אילת'] = { state: 'red', since: t0.getTime() };
sandbox.extendedHistory.push({ location: 'אילת', title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: t0.getTime() + 60000, state: 'green' });
sandbox.reconcileRestoredAlerts();
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'red',
  'rockets survive the titled clear on reload, got ' + (sandbox.locationStates['אילת'] || {}).state);
assert(sandbox.locationThreats['אילת'] && sandbox.locationThreats['אילת'].red !== undefined &&
  sandbox.locationThreats['אילת'].earthquake === undefined, 'only the earthquake threat ended');
// A nationwide titled clear ends matching restored threats everywhere.
resetAll();
sandbox.locationThreats['אילת'] = { earthquake: t0.getTime() };
sandbox.locationStates['אילת'] = { state: 'earthquake', since: t0.getTime() };
sandbox.locationThreats['חיפה'] = { red: t0.getTime() };
sandbox.locationStates['חיפה'] = { state: 'red', since: t0.getTime() };
sandbox.extendedHistory.push({ location: SCOPE, title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: Date.now() - 30000, state: 'green', nationwide: true });
sandbox.reconcileRestoredAlerts();
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'green',
  'nationwide titled clear greens the quake zone, got ' + (sandbox.locationStates['אילת'] || {}).state);
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'red',
  'rockets zone untouched by the nationwide titled clear, got ' + (sandbox.locationStates['חיפה'] || {}).state);
// A threat that STARTED after the clear was issued is not erased.
resetAll();
sandbox.locationThreats['אילת'] = { earthquake: t0.getTime() + 120000 };
sandbox.locationStates['אילת'] = { state: 'earthquake', since: t0.getTime() + 120000 };
sandbox.extendedHistory.push({ location: 'אילת', title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: t0.getTime() + 60000, state: 'green' });
sandbox.reconcileRestoredAlerts();
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'earthquake',
  'a threat newer than the clear survives reconciliation, got ' + (sandbox.locationStates['אילת'] || {}).state);
// Nothing restored: reconciliation is a no-op and cannot paint phantom greens.
resetAll();
sandbox.extendedHistory.push({ location: 'אילת', title: 'רעידת אדמה - הנחיות חזרה למבנים', alertDate: t0.getTime() + 60000, state: 'green' });
sandbox.reconcileRestoredAlerts();
assert(Object.keys(sandbox.locationStates).length === 0, 'no restored threats means no state changes');


section("13. Named-zones all-clear ends an active nationwide paint (Gil's rule)");
var QUAKOVER = 'רעידת אדמה - הנחיות חזרה למבנים';
// 13a. Rolling feed: nationwide quake, then a TITLED return-to-buildings that
// names one zone - the paint ends everywhere; only the named zone goes green.
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
var tClearNamed = new Date(t0.getTime() + 60000);
sandbox.processHistoryEntry({ alertDate: feedTs(tClearNamed), title: QUAKOVER, data: 'חיפה', category: 13 });
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'green',
  'named zone releases green, got ' + (sandbox.locationStates['חיפה'] || {}).state);
assert(!sandbox.locationStates['עפולה'] && !sandbox.locationStates['אילת'],
  'unnamed zones go CLEAN (no green), got ' + JSON.stringify(sandbox.locationStates));
assert(painted['עפולה'] === undefined && painted['אילת'] === undefined, 'unnamed zones unpainted');
assert(!sandbox.locationThreats['עפולה'] && !sandbox.locationThreats['אילת'], 'unnamed threat maps emptied');
var cacheAfterNamed = JSON.parse(store['oref-active-alerts'] || '{}');
assert(!cacheAfterNamed['עפולה'] && !cacheAfterNamed['אילת'], 'unnamed zones dropped from the alert cache');
// A named clear while NO nationwide paint is active behaves as before (local only).
resetAll();
sandbox.locationThreats['אילת'] = { earthquake: t0.getTime() };
sandbox.locationStates['אילת'] = { state: 'earthquake', since: t0.getTime() };
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: 'חיפה', category: 7 });
sandbox.processHistoryEntry({ alertDate: feedTs(tClearNamed), title: QUAKOVER, data: 'חיפה', category: 13 });
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'green',
  'local clear still greens the named zone');
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'earthquake',
  'without a nationwide paint the unnamed zone keeps its threat, got ' + (sandbox.locationStates['אילת'] || {}).state);
// Staleness: a clear issued BEFORE the nationwide paint does not end it.
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKOVER, data: 'חיפה', category: 13 });
sandbox.processHistoryEntry({ alertDate: feedTs(tClearNamed), title: QUAKE_TITLE, data: SCOPE, category: 7 });
assert(sandbox.locationStates['עפולה'] && sandbox.locationStates['עפולה'].state === 'earthquake',
  'a clear predating the paint leaves the unnamed zones painted, got ' + (sandbox.locationStates['עפולה'] || {}).state);

// 13b. Live path: same semantics via processLiveAlert, and the payload's
// issue time drives the threat clock (Sourcery finding a).
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
sandbox.processLiveAlert({ title: QUAKOVER, data: ['חיפה'], category: 13, alertDate: feedTs(tClearNamed) });
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'green', 'live: named zone green');
assert(!sandbox.locationStates['עפולה'] && !sandbox.locationStates['אילת'], 'live: unnamed zones clean');
resetAll();
var tIssue = new Date(Date.now() - 10 * 60000);
sandbox.processLiveAlert({ title: 'ירי רקטות וטילים - היכנסו למרחב המוגן', data: ['חיפה'], category: 1, alertDate: feedTs(tIssue) });
var redSince = sandbox.locationThreats['חיפה'] && sandbox.locationThreats['חיפה'].red;
assert(typeof redSince === 'number' && Math.abs(redSince - tIssue.getTime()) < 2000,
  'live threat uses the issue time, got delta ' + Math.abs((redSince || 0) - tIssue.getTime()));

// 13c. Replay: a named TITLED clear ends the nationwide overlay.
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.extendedHistory.push({ location: 'חיפה', title: QUAKOVER, alertDate: t0.getTime() + 60000, state: 'green' });
sandbox.extendedHistory.push({ location: 'אילת', title: QUAKOVER, alertDate: t0.getTime() + 60000, state: 'green' });
sandbox.reconstructStateAt(t0.getTime() + 90000);
assert(painted['חיפה'] === 'green' && painted['אילת'] === 'green',
  'replay: named zones green, got חיפה=' + painted['חיפה'] + ' אילת=' + painted['אילת']);
assert(painted['עפולה'] === undefined && !sandbox.locationStates['עפולה'],
  'replay: unnamed zone clean, got ' + painted['עפולה']);
// Replay staleness: a clear issued BEFORE the nationwide paint keeps the overlay.
resetAll();
sandbox.extendedHistory.push({ location: 'חיפה', title: QUAKOVER, alertDate: t0.getTime(), state: 'green' });
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime() + 60000, state: 'earthquake', nationwide: true });
sandbox.reconstructStateAt(t0.getTime() + 90000);
assert(painted['עפולה'] === 'earthquake', 'replay: predating clear leaves the overlay, got ' + painted['עפולה']);

// 13d. Reload reconciliation: cached nationwide paint ends for unnamed zones.
resetAll();
ZONES.forEach(function (z) {
  sandbox.locationThreats[z] = { earthquake: t0.getTime() };
  sandbox.locationStates[z] = { state: 'earthquake', since: t0.getTime() };
});
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.extendedHistory.push({ location: 'חיפה', title: QUAKOVER, alertDate: Date.now() - 60000, state: 'green' });
sandbox.extendedHistory.push({ location: 'אילת', title: QUAKOVER, alertDate: Date.now() - 60000, state: 'green' });
sandbox.reconcileRestoredAlerts();
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'green', 'reconcile: first named zone green');
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'green', 'reconcile: second named zone green');
assert(!sandbox.locationStates['עפולה'] && !sandbox.locationThreats['עפולה'],
  'reconcile: unnamed zone clean, got ' + JSON.stringify(sandbox.locationStates['עפולה'] || null));

// 13e. Cross-day clears (Sourcery finding b): greens fetched from a previous
// day's archive apply to restored threats too.
resetAll();
sandbox.locationThreats['אילת'] = { earthquake: Date.now() - 26 * 3600000 };
sandbox.locationStates['אילת'] = { state: 'earthquake', since: Date.now() - 26 * 3600000 };
sandbox.reconcileRestoredAlerts([{ location: 'אילת', title: QUAKOVER, alertDate: Date.now() - 60000, state: 'green' }]);
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'green',
  "yesterday's clear ends a restored threat, got " + (sandbox.locationStates['אילת'] || {}).state);

// 13f. Sourcery finding (e): one malformed clear does not skip the ones after it.
resetAll();
sandbox.locationThreats['חיפה'] = { earthquake: t0.getTime() };
sandbox.locationStates['חיפה'] = { state: 'earthquake', since: t0.getTime() };
sandbox.extendedHistory.push({ location: SCOPE, title: {}, alertDate: Date.now() - 50000, state: 'green', nationwide: true });
sandbox.extendedHistory.push({ location: 'חיפה', title: QUAKOVER, alertDate: Date.now() - 40000, state: 'green' });
sandbox.reconcileRestoredAlerts();
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'green',
  'a malformed entry does not skip a later valid clear, got ' + (sandbox.locationStates['חיפה'] || {}).state);

// 13g. Sourcery finding (d): archive timestamps parse as Asia/Jerusalem wall
// time, independent of the machine/browser locale (Nov = IST UTC+2, Jul = IDT UTC+3).
assert(sandbox.parseAlertDate('2026-11-11 11:25:33') === Date.UTC(2026, 10, 11, 9, 25, 33), 'winter IST parse');
assert(sandbox.parseAlertDate('2026-07-01 12:00:00') === Date.UTC(2026, 6, 1, 9, 0, 0), 'summer IDT parse');
assert(sandbox.parseAlertDate('2026-11-11T12:14:38') === Date.UTC(2026, 10, 11, 10, 14, 38), 'T separator parses');

section('14. Sourcery round-2 findings (ended-threat tombstone, parts, stale guards, offsets)');

// 14a. A named TITLED clear ends the nationwide ACTIVE flag: a later local
// clear of the same threat must NOT re-run the nationwide sweep.
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
sandbox.extendedHistory.push({ location: 'אילת', title: QUAKOVER, alertDate: t0.getTime() + 1000, state: 'green' });
assert(sandbox.nationwideActiveThreats(t0.getTime() + 2000).indexOf('earthquake') === -1,
  'named titled clear ends the nationwide active flag, got ' + sandbox.nationwideActiveThreats(t0.getTime() + 2000));

// 14b. endNationwideThreatForNamedClear leaves a tombstone: a delayed
// nationwide start issued BEFORE the clear cannot repaint afterwards.
resetAll();
sandbox.locationThreats['עפולה'] = { earthquake: t0.getTime() };
sandbox.locationStates['עפולה'] = { state: 'earthquake', since: t0.getTime() };
sandbox.endNationwideThreatForNamedClear('earthquake', ['אילת'], t0.getTime() + 60000);
assert(!sandbox.locationThreats['עפולה'], 'sweep removed the unnamed zone threat');
var r = sandbox.applyThreatEvent('עפולה', QUAKE_TITLE, 'earthquake', t0.getTime());
assert(r === null && !sandbox.locationThreats['עפולה'] && !sandbox.locationStates['עפולה'],
  'delayed pre-clear start rejected, got ' + JSON.stringify({ r: r, t: sandbox.locationThreats['עפולה'] || null }));
r = sandbox.applyThreatEvent('עפולה', QUAKE_TITLE, 'earthquake', t0.getTime() + 120000);
assert(r === 'earthquake' && sandbox.locationThreats['עפולה'] && sandbox.locationThreats['עפולה'].earthquake === t0.getTime() + 120000,
  'a NEWER start after the clear still paints, got ' + JSON.stringify(sandbox.locationThreats['עפולה'] || null));

// 14c. Green-recency pre-guard: a threat issued before a landed all-clear is
// rejected before it can pollute locationThreats or the cache.
resetAll();
sandbox.locationStates['חיפה'] = { state: 'green', since: t0.getTime() + 60000 };
r = sandbox.applyThreatEvent('חיפה', QUAKE_TITLE, 'earthquake', t0.getTime());
assert(r === null && !sandbox.locationThreats['חיפה'],
  'stale threat rejected pre-mutation, got ' + JSON.stringify(sandbox.locationThreats['חיפה'] || null));
assert(JSON.stringify(sandbox.localStorage.getItem('oref-active-alerts')) === 'null' || sandbox.localStorage.getItem('oref-active-alerts') === '{}',
  'stale threat never reaches the cache, got ' + sandbox.localStorage.getItem('oref-active-alerts'));

// 14d. Same-state parts: a clear removes only the parts it covers; a part
// that started after the clear survives with the threat still displayed.
resetAll();
sandbox.locationThreats['חיפה'] = { earthquake: t0.getTime() + 120000 };
sandbox.locationThreatParts['חיפה'] = { earthquake: { 'nationwide-quake': t0.getTime(), 'local-quake': t0.getTime() + 120000 } };
sandbox.locationStates['חיפה'] = { state: 'earthquake', since: t0.getTime() + 120000 };
sandbox.endNationwideThreatForNamedClear('earthquake', ['אילת'], t0.getTime() + 60000);
assert(sandbox.locationThreats['חיפה'] && sandbox.locationThreats['חיפה'].earthquake === t0.getTime() + 120000,
  'newer same-state part survives the clear, got ' + JSON.stringify(sandbox.locationThreats['חיפה'] || null));
assert(sandbox.locationThreatParts['חיפה'].earthquake['local-quake'] === t0.getTime() + 120000 &&
  sandbox.locationThreatParts['חיפה'].earthquake['nationwide-quake'] === undefined,
  'only the covered part was removed');
assert(sandbox.locationStates['חיפה'] && sandbox.locationStates['חיפה'].state === 'earthquake',
  'zone still displays the surviving threat');

// 14e. Explicit timezone suffixes are honored, not re-read as Jerusalem wall time.
assert(sandbox.parseAlertDate('2026-11-11T12:14:38Z') === Date.UTC(2026, 10, 11, 12, 14, 38), 'Z suffix honored');
assert(sandbox.parseAlertDate('2026-11-11T12:14:38+03:00') === Date.UTC(2026, 10, 11, 9, 14, 38), '+03:00 offset honored');
assert(sandbox.parseAlertDate('2026-11-11 12:14:38') === Date.UTC(2026, 10, 11, 10, 14, 38), 'bare wall time still Jerusalem');

// 14f. DST transition: wall times straddling the spring forward (2026-03-27,
// 02:00 IST -> 03:00 IDT) resolve to instants 60 minutes apart, not 120.
var before = sandbox.parseAlertDate('2026-03-27 01:30:00');
var after = sandbox.parseAlertDate('2026-03-27 03:30:00');
assert(before === Date.UTC(2026, 2, 26, 23, 30, 0), 'pre-transition wall time resolves as IST, got ' + (before && new Date(before).toISOString()));
assert(after === Date.UTC(2026, 2, 27, 0, 30, 0), 'post-transition wall time resolves as IDT, got ' + (after && new Date(after).toISOString()));
assert(after - before === 3600000, 'straddling wall times are 60 real minutes apart, got ' + (after - before));

// 14g. Restored-cache nationwide detection: a threat covering ~every polygon
// counts as a nationwide paint even without a timeline start entry.
resetAll();
vm.runInContext('allPolygonNames = function () { var a = []; for (var i = 0; i < 100; i++) a.push("zone-" + i); return a; };', sandbox);
for (var zi = 0; zi < 95; zi++) sandbox.locationThreats['zone-' + zi] = { earthquake: t0.getTime() };
assert(sandbox.nationwideThreatActive('earthquake', t0.getTime() + 60000) === true,
  'restored 95% coverage counts as nationwide-active');
assert(sandbox.nationwideThreatActive('red', t0.getTime() + 60000) === false,
  'an absent threat is not nationwide-active');

section('15. Earthquake auto-release after one hour (Gil 2026-11-11)');

// The heatmap test replaced the global map with a minimal stub - restore it.
vm.runInContext('map = { setFeatureState: function () {}, removeFeatureState: function () {} };', sandbox);

// 15a. Under the old 30-minute default a quake paint lapsed early: at 45
// minutes it must still be displayed (dimmed, but present).
resetAll();
sandbox.locationStates['אילת'] = { state: 'earthquake', since: Date.now() - 45 * 60000 };
sandbox.locationThreats['אילת'] = { earthquake: Date.now() - 45 * 60000 };
sandbox.fadeGreenMarkers();
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'earthquake',
  'quake paint survives at 45 minutes');

// 15b. At 61 minutes with no newer directive the paint auto-releases - clean,
// not green (a local timeout is not an official all-clear).
resetAll();
sandbox.locationStates['אילת'] = { state: 'earthquake', since: Date.now() - 61 * 60000 };
sandbox.locationThreats['אילת'] = { earthquake: Date.now() - 61 * 60000 };
sandbox.fadeGreenMarkers();
assert(!sandbox.locationStates['אילת'] && !sandbox.locationThreats['אילת'],
  'quake paint auto-releases after one hour, got ' + JSON.stringify(sandbox.locationStates['אילת'] || null));
assert((sandbox.localStorage.getItem('oref-active-alerts') || '{}') === '{}',
  'released paint also drops out of the persisted cache');

// 15c. An active Pikud HaOref directive renews the hour: a newer quake event
// refreshes the zone's `since`, so the paint survives past the first hour.
resetAll();
sandbox.locationStates['אילת'] = { state: 'earthquake', since: Date.now() - 55 * 60000 };
sandbox.locationThreats['אילת'] = { earthquake: Date.now() - 55 * 60000 };
// New directive 10 minutes ago (aftershock / renewed instruction).
sandbox.applyThreatEvent('אילת', QUAKE_TITLE, 'earthquake', Date.now() - 10 * 60000);
sandbox.fadeGreenMarkers();
assert(sandbox.locationStates['אילת'] && sandbox.locationStates['אילת'].state === 'earthquake',
  'paint with an active directive is not released');

// 15d. Rockets keep the 30-minute default (regression guard).
resetAll();
sandbox.locationStates['חיפה'] = { state: 'red', since: Date.now() - 31 * 60000 };
sandbox.locationThreats['חיפה'] = { red: Date.now() - 31 * 60000 };
sandbox.fadeGreenMarkers();
assert(!sandbox.locationStates['חיפה'], 'rockets still expire at 30 minutes');

// 15e. Cache restore honors the same window: a quake older than one hour
// stays expired across reload; a younger one restores; hazmat is unchanged.
resetAll();
sandbox.localStorage.setItem('oref-active-alerts', JSON.stringify({
  'אילת': { threats: { earthquake: Date.now() - 2 * 3600000 } },
  'חיפה': { threats: { earthquake: Date.now() - 20 * 60000 } },
  'עפולה': { threats: { hazmat: Date.now() - 3 * 3600000 } }
}));
sandbox.loadCachedAlerts();
assert(!sandbox.locationThreats['אילת'], 'quake older than one hour is not restored');
assert(sandbox.locationThreats['חיפה'] && sandbox.locationThreats['חיפה'].earthquake, 'recent quake restores');
assert(sandbox.locationThreats['עפולה'] && sandbox.locationThreats['עפולה'].hazmat, 'hazmat still restores regardless of age');

console.log('\nnationwide-scope: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
