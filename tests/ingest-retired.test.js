// Regression test for the 2026-10-31 retirement of the unauthenticated
// browser-ingest path (abuse-control review, docs/r2-history-migration.md
// step 8). Locks the worker route table: POST /ingest must stay 404 and
// GET /health must keep answering, with no R2 binding touched.
// Run: node tests/ingest-retired.test.js

var passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

(async function() {
  var mod = await import('../ingestion/src/index.js');
  var worker = mod.default;

  // A throwing R2 binding proves the retired route never reaches the bucket.
  var env = { HISTORY_BUCKET: { get: function() { throw new Error('R2 get called'); },
                                put: function() { throw new Error('R2 put called'); } } };

  var post = await worker.fetch(new Request('https://worker.test/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cities: ['x'], threat: 'y' })
  }), env);
  assert(post.status === 404, 'POST /ingest returns 404, got ' + post.status);

  var getIngest = await worker.fetch(new Request('https://worker.test/ingest'), env);
  assert(getIngest.status === 404, 'GET /ingest returns 404, got ' + getIngest.status);

  var health = await worker.fetch(new Request('https://worker.test/health'), env);
  assert(health.status === 200, 'GET /health returns 200, got ' + health.status);
  assert(await health.text() === 'ok', 'GET /health body is ok');

  console.log('\ningest-retired: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function(err) { console.error(err); process.exit(1); });
