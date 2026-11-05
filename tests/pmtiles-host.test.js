// PMTiles archive selection and failure fallback by hostname in web/index.html.
// The live and dev sites load the slimmed archive (faster on mobile networks);
// preview deployments and unknown hosts keep the original archive. If the selected
// archive fails at runtime, the original archive takes over the protocol entry.
// Run: node tests/pmtiles-host.test.js
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
var start = html.indexOf('var protocol = new pmtiles.Protocol()');
var end = html.indexOf('maplibregl.addProtocol', start);
if (start < 0 || end < 0) { console.log('FAIL: PMTiles registration block not found'); process.exit(1); }
var src = html.slice(start, end);

var SLIM = 'https://assets.redmap.dev/middle-east.slim-20261102.pmtiles';
var ORIG = 'https://assets.redmap.dev/middle-east.pmtiles';
var passed = 0, failed = 0;
function eq(name, a, b) { if (a === b) passed++; else { failed++; console.log('FAIL ' + name + ': ' + a + ' != ' + b); } }

// Stubs mirroring the real pmtiles v3 Protocol/PMTiles and the file's TimeoutSource.
// getBytes fails only for the slim archive, so fallback behavior is exercisable.
function runBlock(host) {
  function TimeoutSource(url) { this.url = url; }
  TimeoutSource.prototype.getKey = function () { return this.url; };
  TimeoutSource.prototype.getBytes = function () {
    if (this.url === SLIM) return Promise.reject(new Error('slim broken'));
    return Promise.resolve('bytes:' + this.url);
  };
  var pmtiles = {
    Protocol: function () {
      this.tiles = new Map();
      this.add = function (p) { this.tiles.set(p.source.getKey(), p); };
      this.get = function (u) { return this.tiles.get(u); };
    },
    PMTiles: function (source) { this.source = source; }
  };
  var windowStub = { __pmStats: { attempts: 0, timeouts: 0, retries: 0, failed: 0 } };
  var consoleStub = { error: function () {} };
  var fn = new Function('location', 'pmtiles', 'TimeoutSource', 'window', 'console',
    src + '; return { protocol: protocol, slimPM: slimPM, originalPM: originalPM };');
  var out = fn({ hostname: host }, pmtiles, TimeoutSource, windowStub, consoleStub);
  out.win = windowStub;
  return out;
}

['redmap.me', 'www.redmap.me', 'dev.redmap.me'].forEach(function (h) {
  var r = runBlock(h);
  eq(h + ' selection', r.slimPM.source.getKey(), SLIM);
  eq(h + ' registered under slim URL', r.protocol.get(SLIM), r.slimPM);
  eq(h + ' original prebuilt', r.originalPM.source.getKey(), ORIG);
  r.slimPM.source.onFailure(new Error('slim broken'));
  eq(h + ' fallback swap', r.protocol.get(SLIM), r.originalPM);
});

['claude-test-lmz.pages.dev', 'abc123.claude-test-lmz.pages.dev', 'localhost', '127.0.0.1',
 'example.com', 'redmap.me.evil.com', 'evil-redmap.me', 'www.redmap.me.evil.com', ''].forEach(function (h) {
  var name = h || '(empty)';
  var r = runBlock(h);
  eq(name + ' selection', r.slimPM.source.getKey(), ORIG);
  eq(name + ' registered under original URL', r.protocol.get(ORIG), r.slimPM);
  r.slimPM.source.onFailure(new Error('x'));
  eq(name + ' fallback swap', r.protocol.get(ORIG), r.originalPM);
});

// The swap is one-shot: a second failure keeps the original and does not double-count.
var r2 = runBlock('redmap.me');
r2.slimPM.source.onFailure(new Error('a'));
r2.slimPM.source.onFailure(new Error('b'));
eq('single fallback counted', r2.win.__pmStats.fallbacks, 1);
eq('fallback stays original', r2.protocol.get(SLIM), r2.originalPM);

// In-band fallback: while the header has not loaded, a failing request is served
// from the original archive; afterwards the source delegates to it permanently.
var r3 = runBlock('redmap.me');
eq('not yet on fallback', r3.slimPM.source.usingFallback, false);
r3.slimPM.source.getBytes(0, 10).then(function (v) {
  eq('failed request served from original', v, 'bytes:' + ORIG);
  eq('source delegates to original', r3.slimPM.source.usingFallback, true);
  eq('swap happened too', r3.protocol.get(SLIM), r3.originalPM);
  return r3.slimPM.source.getBytes(20, 10);
}).then(function (v) {
  eq('later requests use original', v, 'bytes:' + ORIG);
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  failed++; console.log('FAIL in-band fallback threw: ' + e);
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(1);
});
