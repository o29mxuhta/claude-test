// Data-integrity tests for the UI translation table in web/i18n.js.
//
// The table is the part that broke language switching in the past (missing or
// shifted translations silently render the wrong language). The file wraps the
// table in an IIFE that touches localStorage/document, so instead of executing
// it we extract the RAW literal with a balanced-brace scan and validate it.
// Run: node tests/i18n.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}
function section(name) { console.log('\n' + name); }

var file = path.join(__dirname, '..', 'web', 'i18n.js');
var src = fs.readFileSync(file, 'utf8');

// Extract the RAW object literal with a brace-matching scan.
function extractRaw(src) {
  var start = src.indexOf('var RAW = {');
  if (start === -1) return null;
  var i = src.indexOf('{', start);
  var depth = 0, inStr = false, esc = false;
  for (var j = i; j < src.length; j++) {
    var c = src[j];
    if (inStr) {
      if (esc) { esc = false; }
      else if (c === '\\') { esc = true; }
      else if (c === '"') { inStr = false; }
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

var literal = extractRaw(src);

section('RAW table extraction');
assert(literal !== null, 'RAW object literal not found in web/i18n.js - structure changed?');

var RAW = null;
if (literal) {
  try { RAW = eval('(' + literal + ')'); }
  catch (e) { assert(false, 'RAW literal failed to parse: ' + e.message); }
}

if (RAW) {
  var keys = Object.keys(RAW);

  section('Table shape');
  assert(keys.length > 100, 'expected a substantial table, got only ' + keys.length + ' entries');

  section('Every entry has exactly one English and one Russian translation');
  var bad = [];
  keys.forEach(function (k) {
    var v = RAW[k];
    if (!Array.isArray(v) || v.length !== 2) { bad.push(k.slice(0, 40) + ' (not a 2-item array)'); return; }
    if (typeof v[0] !== 'string' || v[0].trim() === '') bad.push(k.slice(0, 40) + ' (empty English)');
    if (typeof v[1] !== 'string' || v[1].trim() === '') bad.push(k.slice(0, 40) + ' (empty Russian)');
  });
  assert(bad.length === 0, bad.length + ' malformed entries:\n    ' + bad.slice(0, 10).join('\n    '));

  section('English and Russian translations differ (no copy-paste leftovers)');
  var same = keys.filter(function (k) { var v = RAW[k]; return Array.isArray(v) && v[0] === v[1] && !/^[^\u0590-\u05FF]*$/.test(v[0]); });
  // Entries with no Hebrew letters in the key (pure emoji/numbers) may legitimately share text.
  assert(same.length === 0, same.length + ' entries with identical en/ru: ' + same.slice(0, 5).join(' | '));

  section('Keys are unique after parsing (duplicate keys silently drop translations)');
  var seen = {}, dups = [];
  var re = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm;
  var m, count = 0;
  while ((m = re.exec(literal)) !== null) {
    var k = JSON.parse('"' + m[1] + '"');
    count++;
    if (seen[k]) dups.push(k.slice(0, 40));
    seen[k] = true;
  }
  assert(dups.length === 0, dups.length + ' duplicate keys: ' + dups.slice(0, 5).join(' | '));
  assert(count === keys.length, 'parsed key count ' + keys.length + ' != scanned key count ' + count);

  section('Safety banner is translated (must never stay Hebrew-only)');
  var bannerKey = keys.find(function (k) { return k.indexOf('נא להסתמך על אמצעי ההתרעה הרשמיים') !== -1; });
  assert(!!bannerKey, 'official-channels safety banner key missing from table');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
