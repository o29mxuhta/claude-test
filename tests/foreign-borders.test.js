// Neighbouring-country borders: dashed, thin, never Israel's own, no disputed outlines.
// Run: node tests/foreign-borders.test.js
var fs = require('fs');
var path = require('path');
var passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; } else { failed++; console.error('  FAIL: ' + m); } }
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
var i = html.indexOf("id: 'boundaries_foreign'");
assert(i !== -1, 'boundaries_foreign layer is defined');
var block = html.slice(i, i + 900);
assert(/'line-dasharray': \[4, 3\]/.test(block), 'foreign borders are dashed');
assert(/'!=', 'adm0_l', 'ISR'/.test(block) && /'!=', 'adm0_r', 'ISR'/.test(block), 'excludes Israel borders');
assert(/'!=', 'disputed', true/.test(block), 'excludes disputed outlines');
assert(/'line-width': 1\.3/.test(block), 'thin line');
var israel = html.indexOf("if (l.id === 'boundaries_country')");
assert(html.indexOf("l.paint['line-width'] = 2.5") > israel, "Israel border stays thick");
assert(!/boundaries_disputed/.test(html), 'no disputed layer added');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
