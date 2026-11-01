// Backend selection by hostname in web/index.html. Dev hosts use dev workers;
// every other host (including unknown ones) must use production.
// Run: node tests/backends.test.js
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
var start = html.indexOf('var BACKENDS = (function () {');
var end = html.indexOf('})();', start) + 5;
if (start < 0 || end < 5) { console.log('FAIL: BACKENDS block not found'); process.exit(1); }
var src = html.slice(start, end);
function backendsFor(host) {
  return new Function('location', src + '; return BACKENDS;')({ hostname: host });
}
var PROD_HISTORY = 'https://history.redmap.me', PROD_LIVE = 'https://api2.redmap.me';
var DEV_HISTORY = 'https://redmap-history-api-dev.xanaxmap.workers.dev', DEV_LIVE = 'https://redmap-live-api-dev.xanaxmap.workers.dev';
var passed = 0, failed = 0;
function eq(name, a, b) { if (a === b) passed++; else { failed++; console.log('FAIL ' + name + ': ' + a + ' != ' + b); } }
['dev.redmap.me', 'claude-test-lmz.pages.dev', 'abc123.claude-test-lmz.pages.dev', 'dev-branch.claude-test-lmz.pages.dev'].forEach(function (h) {
  var b = backendsFor(h); eq(h + ' history', b.history, DEV_HISTORY); eq(h + ' live', b.live, DEV_LIVE);
});
['redmap.me', 'www.redmap.me', 'redmap.dev', 'localhost', '127.0.0.1', 'example.com',
 'evil-dev.redmap.me.example.com', 'dev.redmap.me.evil.com', 'claude-test-lmz.pages.dev.evil.com',
 'notclaude-test-lmz.pages.dev', 'a.b.claude-test-lmz.pages.dev', ''].forEach(function (h) {
  var b = backendsFor(h); eq((h || '(empty)') + ' history', b.history, PROD_HISTORY); eq((h || '(empty)') + ' live', b.live, PROD_LIVE);
});
eq('resetProxy uses BACKENDS.live', /function resetProxy\(\) \{\s*PROXY_BASE = BACKENDS\.live;/.test(html), true);
eq('no hardcoded api2 outside BACKENDS', (html.match(/'https:\/\/api2\.redmap\.me'/g) || []).length, 1);
eq('no hardcoded history outside BACKENDS', (html.match(/'https:\/\/history\.redmap\.me'/g) || []).length, 1);
['dev.redmap.me', 'abc.claude-test-lmz.pages.dev'].forEach(function (h) { eq(h + ' analytics', backendsFor(h).analytics, 'https://oref-proxy-dev.xanaxmap.workers.dev'); });
['redmap.me', 'localhost', 'example.com', 'dev.redmap.me.evil.com'].forEach(function (h) { eq(h + ' analytics', backendsFor(h).analytics, 'https://oref-proxy.xanaxmap.workers.dev'); });
eq('no hardcoded proxy analytics URL outside BACKENDS', (html.match(/'https:\/\/oref-proxy\.xanaxmap\.workers\.dev'/g) || []).length, 1);
console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
