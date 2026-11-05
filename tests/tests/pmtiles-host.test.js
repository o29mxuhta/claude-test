// PMTiles archive selection by hostname in web/index.html. The live and dev sites
// load the slimmed archive (faster on mobile networks); preview deployments and
// unknown hosts keep the original archive so a bad slim file can never reach them
// before it is validated on dev.
// Run: node tests/pmtiles-host.test.js
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
var start = html.indexOf('var PMTILES_ORIGINAL_URL');
var end = html.indexOf('protocol.add', start);
if (start < 0 || end < 0) { console.log('FAIL: PMTiles URL block not found'); process.exit(1); }
var src = html.slice(start, end);
function pmtilesFor(host) {
  return new Function('location', src + '; return PMTILES_HTTP_URL;')({ hostname: host });
}
var SLIM = 'https://assets.redmap.dev/middle-east.slim-20261102.pmtiles';
var ORIG = 'https://assets.redmap.dev/middle-east.pmtiles';
var passed = 0, failed = 0;
function eq(name, a, b) { if (a === b) passed++; else { failed++; console.log('FAIL ' + name + ': ' + a + ' != ' + b); } }
['redmap.me', 'www.redmap.me', 'dev.redmap.me'].forEach(function (h) {
  eq(h, pmtilesFor(h), SLIM);
});
['claude-test-lmz.pages.dev', 'abc123.claude-test-lmz.pages.dev', 'localhost', '127.0.0.1',
 'example.com', 'redmap.me.evil.com', 'evil-redmap.me', 'www.redmap.me.evil.com', ''].forEach(function (h) {
  eq(h || '(empty)', pmtilesFor(h), ORIG);
});
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
