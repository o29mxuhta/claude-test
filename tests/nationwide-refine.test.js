// Nationwide scope REFINEMENT tests: run the real alert functions from
// web/index.html (same vm harness as tests/nationwide-scope.test.js) against
// the 2026-11-11 earthquake shape: Pikud HaOref issued the quake directive
// with the generic scope "בחלק מהאזורים בארץ" at 11:25:35 and, 2 seconds
// later, a same-threat alert naming the 5 cities actually alerted (באר אורה,
// אליפז ומכרות תמנע, אילת, אילות, אזור תעשייה שחורת). The generic record
// fans out to every polygon; the named companion refines the scope.
// Locks:
//  1. Rolling history feed: fan-out then named alert collapses the paint to
//     the named zones - unnamed zones end CLEAN (no green).
//  2. Live path: same collapse, via restored-coverage detection.
//  3. Tombstone: a delayed duplicate of the generic start cannot repaint.
//  4. A named alert OUTSIDE the window does not collapse the paint.
//  5. A named alert of a DIFFERENT threat does not collapse the paint.
//  6. A named GREEN (all-clear) is not a refinement - existing clear rules.
//  7. After refinement, the named TITLED clear greens exactly the named
//     zones (the named-clear rule from 2026-11-11 keeps working).
//  8. Replay (reconstructStateAt): overlay shrinks to the named zones.
//  9. Restored-cache coverage: collapse works with no timeline record.
// 10. Idempotency + status pill honesty after the collapse.
// Run: node tests/nationwide-refine.test.js

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
var reconstructSrc = extractFunction(html, 'reconstructStateAt');
var liveStatusSrc = extractFunction(html, 'updateLiveStatus');
var nwActivesMapSrc = extractFunction(html, 'nationwideActivesMap');
var nwActiveSrc = extractFunction(html, 'nationwideActiveThreats');
var nwCoverageSrc = extractFunction(html, 'restoredNationwideCoverage');
var nwThreatSrc = extractFunction(html, 'nationwideThreatActive');
var nwStartTsSrc = extractFunction(html, 'nationwideThreatStartTs');
var endNwSrc = extractFunction(html, 'endNationwideThreatForNamedClear');
var liveSrc = extractFunction(html, 'processLiveAlert');
var refineStart = html.indexOf('var NATIONWIDE_REFINE_WINDOW_MS');
var refineGateFn = extractFunction(html, 'nationwideRefinementStartTs');
assert(refineStart !== -1 && !!refineGateFn, 'extracted the refinement block');
var refineSrc = html.slice(refineStart, html.indexOf(refineGateFn) + refineGateFn.length);
assert(!!setStateSrc && !!resolveSrc && !!resolveLocSrc && !!expandSrc && !!parseDateSrc &&
  !!recordSrc && !!historyEntrySrc && !!reconstructSrc && !!liveStatusSrc &&
  !!nwActivesMapSrc && !!nwActiveSrc && !!nwCoverageSrc && !!nwThreatSrc && !!nwStartTsSrc &&
  !!endNwSrc && !!liveSrc, 'extracted every function under test');

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
// The 5 cities oref named on 2026-11-11, plus two far zones that must never
// stay painted once the scope refines.
var CITIES = ['באר אורה', 'אליפז ומכרות תמנע', 'אילת', 'אילות', 'אזור תעשייה שחורת'];
var FAR = ['עפולה', 'חיפה'];
var ZONES = CITIES.concat(FAR);
var nameToId = {};
ZONES.forEach(function (z, i) { nameToId[z] = i + 1; });
var painted = {};
var paintCalls = [];
var mapRemoved = [];
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
  applyFeatureStyle: function (name, state, opacity) { painted[name] = state; paintCalls.push({ name: name, state: state, opacity: opacity }); },
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
  map: { setFeatureState: function () {}, removeFeatureState: function (t) { mapRemoved.push(t); } },
  mapLoaded: true,
  paintCalls: paintCalls,
  mapRemoved: mapRemoved,
};
vm.createContext(sandbox);
vm.runInContext([
  classificationSrc, normalizeSrc, 'var nameIndex = { exact: {}, base: {}, zone: {} };',
  resolveLocSrc, unresolvedSrc, expandSrc, nationwideSrc, threatsSrc, setStateSrc,
  resolveSrc, cacheSrc, parseDateSrc, recordSrc, historyEntrySrc,
  reconstructSrc, liveStatusSrc,
  'var nationwideEndedThreats = {};', nwCoverageSrc, nwActivesMapSrc, nwActiveSrc, nwStartTsSrc,
  refineSrc, nwThreatSrc, endNwSrc, liveSrc
].join('\n'), sandbox);
vm.runInContext(
  JSON.stringify(ZONES) + '.forEach(function (z) { nameIndex.exact[foldName(z)] = [z]; });',
  sandbox);

var QUAKE_TITLE = 'רעידת אדמה - צאו לשטח פתוח';
var QUAKOVER = 'רעידת אדמה - הנחיות חזרה למבנים';
var SCOPE = 'בחלק מהאזורים בארץ';

function feedTs(date) {
  // oref timestamps are Asia/Jerusalem wall time (parseAlertDate parses them
  // in that zone), so format there too.
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
  paintCalls.length = 0;
  lastStatus = null;
  sandbox.localStorage.removeItem('oref-active-alerts');
}
function stateOf(z) {
  return sandbox.locationStates[z] ? sandbox.locationStates[z].state : null;
}

section('1. History feed: the 2026-11-11 event collapses to the named cities');
resetAll();
var t0 = new Date(Date.now() - 5 * 60000);
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
ZONES.forEach(function (z) {
  assert(stateOf(z) === 'earthquake', z + ' painted by the fan-out, got ' + stateOf(z));
});
var t1 = new Date(t0.getTime() + 2000); // oref named the cities 2s later
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: QUAKE_TITLE, data: CITIES, category: 7 });
CITIES.forEach(function (z) {
  assert(stateOf(z) === 'earthquake', z + ' stays painted after refinement, got ' + stateOf(z));
});
FAR.forEach(function (z) {
  assert(stateOf(z) === null, z + ' ends CLEAN after refinement (no green), got ' + stateOf(z));
  assert(painted[z] === undefined, z + ' feature style reset');
  assert(!sandbox.locationThreats[z], z + ' threat map emptied');
  assert(!paintCalls.some(function (c) { return c.name === z && c.state === 'green'; }),
    z + ' never painted green by the scope correction');
});
var cacheAfterRefine = JSON.parse(store['oref-active-alerts'] || '{}');
FAR.forEach(function (z) {
  assert(!cacheAfterRefine[z], z + ' dropped from the persisted alert cache');
});
CITIES.forEach(function (z) {
  assert(cacheAfterRefine[z] && cacheAfterRefine[z].threats && cacheAfterRefine[z].threats.earthquake !== undefined,
    z + ' kept in the persisted alert cache');
});
// The timeline keeps both records - the scope event and the named alert.
assert(sandbox.extendedHistory.some(function (h) { return h.nationwide === true && h.state === 'earthquake'; }),
  'nationwide scope record stays on the timeline');
assert(sandbox.extendedHistory.filter(function (h) { return !h.nationwide && h.state === 'earthquake'; }).length === 5,
  'the named alert adds 5 per-city timeline records, got ' +
  sandbox.extendedHistory.filter(function (h) { return !h.nationwide && h.state === 'earthquake'; }).length);

section('2. Live path: same collapse via restored-coverage detection');
// The live fan-out writes no timeline record; detection falls back to
// per-zone coverage, which needs a realistic polygon count (>= 50).
resetAll();
vm.runInContext('for (var i = 0; i < 53; i++) nameToId["filler-" + i] = 1000 + i; _allPolygonNames = null;', sandbox);
sandbox.processLiveAlert({ title: QUAKE_TITLE, data: [SCOPE], category: 7, alertDate: feedTs(t0) });
assert(Object.keys(sandbox.locationStates).length === 60,
  'live fan-out painted all 60 polygons, got ' + Object.keys(sandbox.locationStates).length);
sandbox.processLiveAlert({ title: QUAKE_TITLE, data: CITIES, category: 7, alertDate: feedTs(t1) });
CITIES.forEach(function (z) {
  assert(stateOf(z) === 'earthquake', 'live: ' + z + ' stays painted, got ' + stateOf(z));
});
assert(Object.keys(sandbox.locationStates).length === 5,
  'live: paint collapsed to the 5 named cities, got ' + Object.keys(sandbox.locationStates).length);
assert(painted['filler-0'] === undefined && painted['עפולה'] === undefined,
  'live: unnamed zones unpainted');
vm.runInContext('for (var i = 0; i < 53; i++) delete nameToId["filler-" + i]; _allPolygonNames = null;', sandbox);

section('3. Tombstone: a delayed duplicate of the generic start cannot repaint');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: QUAKE_TITLE, data: CITIES, category: 7 });
assert(stateOf('עפולה') === null, 'refined: עפולה clean before the duplicate');
// The rolling feed re-delivers the original generic record (same old issue time).
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
FAR.forEach(function (z) {
  assert(stateOf(z) === null, z + ' stays clean after the delayed duplicate, got ' + stateOf(z));
});
CITIES.forEach(function (z) {
  assert(stateOf(z) === 'earthquake', z + ' still painted after the delayed duplicate, got ' + stateOf(z));
});

section('4. A named alert OUTSIDE the window does not collapse the paint');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
var tLate = new Date(t0.getTime() + 10 * 60000); // 10 minutes later: a separate event
sandbox.processHistoryEntry({ alertDate: feedTs(tLate), title: QUAKE_TITLE, data: CITIES, category: 7 });
FAR.forEach(function (z) {
  assert(stateOf(z) === 'earthquake', z + ' keeps the nationwide paint, got ' + stateOf(z));
});

section('5. A named alert of a DIFFERENT threat does not collapse the paint');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: 'ירי רקטות וטילים - היכנסו למרחב המוגן', data: ['חיפה'], category: 1 });
FAR.forEach(function (z) {
  assert(stateOf(z) !== null, z + ' still painted, got ' + stateOf(z));
});
assert(stateOf('חיפה') === 'red', 'חיפה shows the rocket alert, got ' + stateOf('חיפה'));
assert(stateOf('עפולה') === 'earthquake', 'עפולה keeps the quake paint, got ' + stateOf('עפולה'));

section('6. A named GREEN is a clear, not a refinement');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
// Untitled all-clear naming one zone: only that zone greens (existing rule).
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: 'האירוע הסתיים', data: ['חיפה'], category: 1 });
assert(stateOf('חיפה') === 'green', 'named zone cleared green, got ' + stateOf('חיפה'));
assert(stateOf('עפולה') === 'earthquake' && stateOf('אילת') === 'earthquake',
  'an untitled green is not treated as a scope refinement');

section('7. After refinement, the named TITLED clear greens exactly the named zones');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: QUAKE_TITLE, data: CITIES, category: 7 });
var tClear = new Date(t0.getTime() + 49 * 60000); // the 12:14 return-to-buildings
sandbox.processHistoryEntry({ alertDate: feedTs(tClear), title: QUAKOVER, data: CITIES, category: 13 });
CITIES.forEach(function (z) {
  assert(stateOf(z) === 'green', z + ' releases green, got ' + stateOf(z));
});
FAR.forEach(function (z) {
  assert(stateOf(z) === null, z + ' stays clean - no green wave, got ' + stateOf(z));
});

section('8. Replay: the overlay shrinks to the named zones');
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
CITIES.forEach(function (z) {
  sandbox.extendedHistory.push({ location: z, title: QUAKE_TITLE, alertDate: t1.getTime(), state: 'earthquake' });
});
// Between the generic scope and the named alert: still the full fan-out.
sandbox.reconstructStateAt(t0.getTime() + 1000);
ZONES.forEach(function (z) {
  assert(painted[z] === 'earthquake', 'replay at +1s: ' + z + ' painted, got ' + painted[z]);
});
// After the named alert: only the named cities.
sandbox.reconstructStateAt(t0.getTime() + 30000);
CITIES.forEach(function (z) {
  assert(painted[z] === 'earthquake', 'replay at +30s: ' + z + ' painted, got ' + painted[z]);
});
FAR.forEach(function (z) {
  assert(painted[z] === undefined, 'replay at +30s: ' + z + ' clean, got ' + painted[z]);
});
// And after the named clears: green release on the named cities alone.
CITIES.forEach(function (z) {
  sandbox.extendedHistory.push({ location: z, title: QUAKOVER, alertDate: tClear.getTime(), state: 'green' });
});
sandbox.reconstructStateAt(t0.getTime() + 50 * 60000);
CITIES.forEach(function (z) {
  assert(painted[z] === 'green', 'replay at +50m: ' + z + ' green, got ' + painted[z]);
});
FAR.forEach(function (z) {
  assert(painted[z] === undefined, 'replay at +50m: ' + z + ' clean, got ' + painted[z]);
});

section('9. Replay: a named alert outside the window keeps the overlay');
resetAll();
sandbox.extendedHistory.push({ location: SCOPE, title: QUAKE_TITLE, alertDate: t0.getTime(), state: 'earthquake', nationwide: true });
CITIES.forEach(function (z) {
  sandbox.extendedHistory.push({ location: z, title: QUAKE_TITLE, alertDate: t0.getTime() + 10 * 60000, state: 'earthquake' });
});
sandbox.reconstructStateAt(t0.getTime() + 11 * 60000);
FAR.forEach(function (z) {
  assert(painted[z] === 'earthquake', 'replay: ' + z + ' keeps the overlay, got ' + painted[z]);
});

section('10. Restored-cache coverage: collapse with no timeline record');
resetAll();
vm.runInContext('for (var i = 0; i < 53; i++) nameToId["filler-" + i] = 1000 + i; _allPolygonNames = null;', sandbox);
// Simulate loadCachedAlerts() restoring the fan-out: every polygon painted.
var allNames = Object.keys(nameToId);
allNames.forEach(function (z) {
  sandbox.locationThreats[z] = { earthquake: t0.getTime() };
  sandbox.locationStates[z] = { state: 'earthquake', since: t0.getTime() };
  painted[z] = 'earthquake';
});
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: QUAKE_TITLE, data: CITIES, category: 7 });
assert(Object.keys(sandbox.locationStates).length === 5,
  'restored paint collapsed to the 5 named cities, got ' + Object.keys(sandbox.locationStates).length);
CITIES.forEach(function (z) {
  assert(stateOf(z) === 'earthquake', 'restored: ' + z + ' kept, got ' + stateOf(z));
});
vm.runInContext('for (var i = 0; i < 53; i++) delete nameToId["filler-" + i]; _allPolygonNames = null;', sandbox);

section('11. Idempotency and the status pill');
resetAll();
sandbox.processHistoryEntry({ alertDate: feedTs(t0), title: QUAKE_TITLE, data: SCOPE, category: 7 });
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: QUAKE_TITLE, data: CITIES, category: 7 });
// The feed re-delivers the named record; the collapse must be idempotent.
sandbox.processHistoryEntry({ alertDate: feedTs(t1), title: QUAKE_TITLE, data: CITIES, category: 7 });
assert(Object.keys(sandbox.locationStates).length === 5,
  'second delivery keeps the refined state, got ' + Object.keys(sandbox.locationStates).length);
// updateLiveStatus must no longer call this a nationwide alert.
vm.runInContext('initialized = true;', sandbox);
var realUpdate = extractFunction(html, 'updateLiveStatus');
sandbox.updateLiveStatus = vm.runInContext('updateLiveStatus', sandbox);
sandbox.updateLiveStatus();
assert(lastStatus && lastStatus.state === 'earthquake', 'pill still reports the quake, got ' + (lastStatus || {}).state);
assert(lastStatus.html.indexOf('התרעה ארצית') === -1,
  'pill no longer says התרעה ארצית after refinement, got: ' + lastStatus.html);
assert(lastStatus.html.indexOf('5 אזורי התראה') !== -1,
  'pill counts the 5 refined zones, got: ' + lastStatus.html);

console.log('\nnationwide-refine: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
