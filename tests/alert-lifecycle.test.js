// Alert lifecycle simulation tests: run the real alert-state functions from
// web/index.html (extracted from the inline script, like tests/i18n.test.js
// extracts RAW) against a scripted sequence of Pikud HaOref alert events.
// Locks two safety behaviors:
//  1. A pre-alert / early warning (הנחיה מקדימה) is displayed as a yellow
//     pre-alert, never escalated to an active red alert by its generic
//     shelter instructions (regression: pre-alerts rendered red).
//  2. The display clears when the alert ends: an end title removes its
//     threat and the polygon goes green, a stale end title cannot kill a
//     fresher live alert, and one threat's end keeps other active threats.
// Run: node tests/alert-lifecycle.test.js

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

// 1. Classification block: GREEN/THREAT/INHERIT/YELLOW term lists through
//    classifyTitle (includes titleIncludesAny + explicitThreatIn).
var classStart = html.indexOf('var GREEN_TERMS');
var classFn = extractFunction(html, 'classifyTitle');
assert(classStart !== -1 && !!classFn, 'extracted classification block from web/index.html');
var classificationSrc = html.slice(classStart, html.indexOf(classFn) + classFn.length);

// 2. Simultaneous-threat machinery: locationThreats + topThreats +
//    secondThreatOf + applyThreatEvent.
var threatsStart = html.indexOf('var locationThreats = {};');
var applyFn = extractFunction(html, 'applyThreatEvent');
assert(threatsStart !== -1 && !!applyFn, 'extracted threat-state block from web/index.html');
var threatsSrc = html.slice(threatsStart, html.indexOf(applyFn) + applyFn.length);

var setStateSrc = extractFunction(html, 'setLocationState');
var resolveSrc = extractFunction(html, 'resolveInheritedState');
assert(!!setStateSrc && !!resolveSrc, 'extracted setLocationState + resolveInheritedState');

// Run the extracted production code in a sandbox with display stubs.
var styleCalls = [];
var sandbox = {
  console: { warn: function () {}, log: function () {}, error: function () {} },
  locationStates: {},
  Date: Date, Math: Math,
  applyFeatureStyle: function (name, state, opacity, lineState) {
    styleCalls.push({ name: name, state: state, opacity: opacity });
  },
  addTTAMarker: function () {}, removeTTAMarker: function () {},
  playSoundForState: function () {},
};
vm.createContext(sandbox);
vm.runInContext(classificationSrc + '\n' + threatsSrc + '\n' + setStateSrc + '\n' + resolveSrc, sandbox);

var T0 = 1700000000000; // fixed clock for determinism
var LOC = 'עפולה';

// Mirror of processLiveAlert's title-first, desc-rescue-only-when-inherit step.
function classifyEvent(title, desc) {
  var state = sandbox.classifyTitle(String(title || '').replace(/\s+/g, ' ').trim());
  if (state === 'inherit') {
    var rescued = sandbox.explicitThreatIn(String(desc || ''));
    if (rescued) state = rescued;
  }
  return state;
}
function reset(name) {
  delete sandbox.locationStates[name];
  vm.runInContext('delete locationThreats[' + JSON.stringify(name) + '];', sandbox);
  styleCalls = [];
}
function displayed(name) {
  var e = sandbox.locationStates[name];
  return e ? e.state : null;
}

section('1. Pre-alert (הנחיה מקדימה) is yellow, never red');
assert(classifyEvent('בדקות הקרובות צפויות להתקבל התרעות באזורך') === 'yellow',
  'pre-alert title classifies yellow');
assert(classifyEvent('בדקות הקרובות צפויות להתקבל התרעות באזורך', 'היכנסו למרחב המוגן') === 'yellow',
  'generic shelter desc must not escalate the pre-alert to red');
assert(classifyEvent('התרעה מוקדמת') === 'yellow', 'התרעה מוקדמת classifies yellow');
assert(classifyEvent('איום מלבנון - התקרבו למרחב מוגן') === 'yellow', 'איום מלבנון classifies yellow');
reset(LOC);
sandbox.applyThreatEvent(LOC, 'בדקות הקרובות צפויות להתקבל התרעות באזורך', 'yellow', T0);
assert(displayed(LOC) === 'yellow', 'pre-alert displayed as yellow pre-alert, got ' + displayed(LOC));

section('2. Real alert after a pre-alert takes over the display');
var rocket = 'ירי רקטות וטילים - היכנסו למרחב המוגן';
assert(classifyEvent(rocket) === 'red', 'rocket title classifies red');
sandbox.applyThreatEvent(LOC, rocket, 'red', T0 + 60000);
assert(displayed(LOC) === 'red', 'active red alert displayed, got ' + displayed(LOC));

section('3. Display clears when the alert ends');
var endRockets = 'ירי רקטות וטילים - האירוע הסתיים';
assert(classifyEvent(endRockets) === 'green', 'end title classifies green');
var after = sandbox.applyThreatEvent(LOC, endRockets, 'green', T0 + 10 * 60000);
assert(after === 'yellow' && displayed(LOC) === 'yellow',
  'rocket end clears red; pre-alert yellow remains, got ' + displayed(LOC));
var allClear = 'ניתן לצאת מהמרחב המוגן';
assert(classifyEvent(allClear) === 'green', 'generic all-clear classifies green');
after = sandbox.applyThreatEvent(LOC, allClear, 'green', T0 + 11 * 60000);
assert(after === 'green' && displayed(LOC) === 'green', 'generic all-clear clears every threat');
assert(styleCalls.length > 0 && styleCalls[styleCalls.length - 1].state === 'green',
  'polygon repainted green (display actually cleared)');

section('4. A stale end title cannot kill a fresher live alert');
reset(LOC);
sandbox.applyThreatEvent(LOC, rocket, 'red', T0 + 60000);
var stale = sandbox.applyThreatEvent(LOC, endRockets, 'green', T0); // end predates the live alert
assert(stale === 'red' && displayed(LOC) === 'red',
  'stale all-clear ignored, red still displayed, got ' + displayed(LOC));

section('5. One threat ends, a simultaneous threat stays displayed');
reset(LOC);
sandbox.applyThreatEvent(LOC, rocket, 'red', T0);
sandbox.applyThreatEvent(LOC, 'חדירת כלי טיס עוין', 'purple', T0 + 30000);
var r = sandbox.applyThreatEvent(LOC, 'חדירת כלי טיס עוין - האירוע הסתיים', 'green', T0 + 60000);
assert(r === 'red' && displayed(LOC) === 'red',
  'drone end clears only the drone threat; rockets stay red, got ' + displayed(LOC));

section('6. Generic shelter command inherits the active threat');
assert(sandbox.resolveInheritedState('inherit', LOC) === 'red',
  'shelter command during red stays red');
reset(LOC);
sandbox.applyThreatEvent(LOC, 'בדקות הקרובות צפויות להתקבל התרעות באזורך', 'yellow', T0);
assert(sandbox.resolveInheritedState('inherit', LOC) === 'red',
  'shelter command after only a pre-alert escalates to red (real alert)');
reset(LOC);
assert(sandbox.resolveInheritedState('inherit', LOC) === 'red',
  'shelter command with no history fails safe to red');
assert(classifyEvent('היכנסו למרחב המוגן', 'חדירת כלי טיס עוין - אין לצאת מהמרחב המוגן') === 'purple',
  'generic title + drone desc rescues to purple');

section('7. Wiring locks on processLiveAlert');
assert(/classifyTitle\(cleanTitle\)/.test(html), 'processLiveAlert classifies the title only');
assert(/state === 'inherit'\)[\s\S]{0,200}explicitThreatIn\(String\(alert\.desc/.test(html),
  'desc is consulted only when the title is a generic shelter command');
assert(html.indexOf('window.injectAlert') !== -1, 'manual injectAlert simulation entry point intact');

console.log('\nalert-lifecycle: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
