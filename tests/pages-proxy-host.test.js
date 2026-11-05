// Run: node tests/pages-proxy-host.test.js
import('../functions/api/_proxy.js').then(function (m) {
  var fails = 0;
  function eq(name, a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.error('FAIL', name, a, b); } }
  ['dev.redmap.me', 'claude-test-lmz.pages.dev', 'abc.claude-test-lmz.pages.dev'].forEach(function (h) {
    eq(h, m.proxyPoolFor(h), ['https://redmap-live-api-dev.xanaxmap.workers.dev']);
  });
  ['redmap.me', 'www.redmap.me', 'dev.redmap.me.evil.com', 'a.b.claude-test-lmz.pages.dev', ''].forEach(function (h) {
    eq(h || '(empty)', m.proxyPoolFor(h), ['https://api2.redmap.me']);
  });
  if (fails) process.exit(1);
  console.log('pages-proxy-host: all checks passed');
});
