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
  runBlock.slimImpl = null;
  TimeoutSource.prototype.getBytes = function (offset, length) {
    this.ranges = this.ranges || [];
    this.ranges.push([offset, length]);
    if (this.url === SLIM && runBlock.slimImpl) return runBlock.slimImpl(offset, length);
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
  // The fallback receives the exact byte ranges of the original requests.
  var ranges = r3.slimPM.source.fallback.ranges || [];
  eq('fallback saw both requests', ranges.length, 2);
  eq('fallback range 1 offset', ranges[0] && ranges[0][0], 0);
  eq('fallback range 1 length', ranges[0] && ranges[0][1], 10);
  eq('fallback range 2 offset', ranges[1] && ranges[1][0], 20);
  eq('fallback range 2 length', ranges[1] && ranges[1][1], 10);
}).then(function () {
  // Routine cancellations are not archive failures: an aborted request rejects
  // without swapping archives, counting a fallback, or touching the original.
  var r4 = runBlock('redmap.me');
  runBlock.slimImpl = function () {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  };
  var ac = new AbortController();
  ac.abort();
  return r4.slimPM.source.getBytes(0, 10, ac.signal).then(function () {
    failed++; console.log('FAIL aborted request did not reject');
  }, function (e) {
    eq('abort propagates as AbortError', e && e.name, 'AbortError');
    eq('abort does not swap archives', r4.protocol.get(SLIM), r4.slimPM);
    eq('abort does not delegate to original', r4.slimPM.source.usingFallback, false);
    eq('abort not counted as fallback', r4.win.__pmStats.fallbacks, undefined);
    eq('abort did not touch original', r4.slimPM.source.fallback.ranges, undefined);
  });
}).then(function () {
  // A corrupt archive that answers 200 with non-PMTiles bytes triggers the same
  // fallback as a network failure instead of a blank map.
  var r5 = runBlock('redmap.me');
  runBlock.slimImpl = function () {
    return Promise.resolve({ data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer });
  };
  return r5.slimPM.source.getBytes(0, 16384).then(function (v) {
    eq('corrupt header served from original', v, 'bytes:' + ORIG);
    eq('corrupt header delegates to original', r5.slimPM.source.usingFallback, true);
    eq('corrupt header counted as fallback', r5.win.__pmStats.fallbacks, 1);
    eq('corrupt header swapped protocol', r5.protocol.get(SLIM), r5.originalPM);
  });
}).then(function () {
  // A valid PMTiles v3 header opens the slim archive with no fallback, and
  // post-header reads are not re-validated.
  var r6 = runBlock('redmap.me');
  runBlock.slimImpl = function () {
    var b = new Uint8Array(16);
    b.set([0x50, 0x4D, 0x54, 0x69, 0x6C, 0x65, 0x73, 0x03]);
    return Promise.resolve({ data: b.buffer });
  };
  return r6.slimPM.source.getBytes(0, 16384).then(function (v) {
    eq('valid header opens slim archive', r6.slimPM.source.opened, true);
    eq('valid header keeps slim source', r6.slimPM.source.usingFallback, false);
    eq('valid header keeps slim protocol', r6.protocol.get(SLIM), r6.slimPM);
    return r6.slimPM.source.getBytes(500, 100);
  }).then(function () {
    eq('post-header reads stay on slim', r6.slimPM.source.usingFallback, false);
    eq('post-header read served by slim', r6.slimPM.source.ranges.length, 2);
  });
}).then(function () {
  // Post-header failure: the current request rethrows (its offsets index the
  // slim archive, so replaying it against the original would serve corrupt
  // bytes), the protocol entry swaps, and later requests use the original.
  var r7 = runBlock('redmap.me');
  runBlock.slimImpl = function (offset) {
    if (offset === 0) {
      var b = new Uint8Array(16);
      b.set([0x50, 0x4D, 0x54, 0x69, 0x6C, 0x65, 0x73, 0x03]);
      return Promise.resolve({ data: b.buffer });
    }
    return Promise.reject(new Error('tile gone'));
  };
  return r7.slimPM.source.getBytes(0, 16384).then(function () {
    eq('post-header: slim opened', r7.slimPM.source.opened, true);
    return r7.slimPM.source.getBytes(500, 100).then(function () {
      failed++; console.log('FAIL post-header failing request did not rethrow');
    }, function (e) {
      eq('post-header: original error rethrown', e && e.message, 'tile gone');
      eq('post-header: protocol swapped', r7.protocol.get(SLIM), r7.originalPM);
      eq('post-header: fallback counted once', r7.win.__pmStats.fallbacks, 1);
      eq('post-header: failing request not replayed in-band', r7.slimPM.source.fallback.ranges, undefined);
      // Later tile requests arrive through the swapped protocol entry, i.e. the
      // original archive's own PMTiles instance with its own correct offsets.
      return r7.originalPM.source.getBytes(600, 100);
    });
  }).then(function (v) {
    eq('post-header: later request served from original', v, 'bytes:' + ORIG);
  });
}).then(function () {
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  failed++; console.log('FAIL async chain threw: ' + (e && e.stack || e));
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(1);
});
