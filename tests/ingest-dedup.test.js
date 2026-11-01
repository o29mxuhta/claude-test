// Regression test for archive duplicates in the ingestion worker
// (upstream maorcc/oref-map#69): a marker-write failure after the data
// write, or an overlapping run, used to append the same records to the
// R2 day file again. Drives the real worker scheduled() with an in-memory
// R2 bucket and a stubbed history relay.
// Run: node tests/ingest-dedup.test.js

var passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}
function section(name) { console.log('\n' + name); }

// 2026-11-01T12:03:30Z = 14:03:30 Israel (UTC+2) -> window [13:45, 14:00).
var SCHEDULED_MS = Date.parse('2026-11-01T12:03:30Z');
var DAY_KEY = '2026-11-01.jsonl';
var MARKER_KEY = 'meta/2026-11-01T13:45';

function ext(rid, city, time) {
  return { data: city, alertDate: '2026-11-01T' + time, category_desc: 'ירי רקטות וטילים', rid: rid };
}
function rolling(city, time) {
  return { data: city, alertDate: '2026-11-01 ' + time, title: 'ירי רקטות וטילים', category: 1 };
}

function makeBucket(seed) {
  var store = new Map(Object.entries(seed || {}));
  var etags = {};
  var n = 0;
  return {
    store: store,
    get: async function (key) {
      if (!store.has(key)) return null;
      if (!etags[key]) etags[key] = 'etag-seed';
      var v = store.get(key);
      return { text: async function () { return v; }, etag: etags[key] };
    },
    put: async function (key, value, opts) {
      if (opts && opts.onlyIf && opts.onlyIf.etagMatches &&
          etags[key] !== opts.onlyIf.etagMatches) return null; // R2 precondition failed
      if (opts && opts.onlyIf && opts.onlyIf.etagDoesNotMatch === '*' &&
          store.has(key)) return null; // create-if-absent failed
      store.set(key, value);
      etags[key] = 'etag-' + (++n);
      return { key: key, etag: etags[key] };
    },
    delete: async function (key) { store.delete(key); delete etags[key]; },
    list: async function () { return { objects: [] }; },
  };
}

function run(worker, bucket, payload) {
  global.fetch = async function () {
    return {
      ok: true, status: 200,
      headers: { get: function (k) { return k === 'X-Upstream-Status' ? '200' : null; } },
      text: async function () { return JSON.stringify(payload); },
    };
  };
  var env = { HISTORY_BUCKET: bucket, HISTORY_PROXY_URL: 'https://relay.test' };
  return worker.scheduled({ scheduledTime: SCHEDULED_MS }, env, { waitUntil: function () {} });
}

function lines(bucket, key) {
  return (bucket.store.get(key) || '').split('\n').filter(function (l) { return l.trim(); });
}

(async function () {
  var mod = await import('../ingestion/src/index.js');
  var worker = mod.default;

  section('1. First run archives the window records and writes the count marker');
  var b1 = makeBucket();
  await run(worker, b1, [ext(101, 'עפולה', '13:47:15'), ext(102, 'נצרת', '13:47:15'), ext(999, 'חיפה', '14:30:00')]);
  assert(lines(b1, DAY_KEY).length === 2, 'window records archived, expected 2 lines, got ' + lines(b1, DAY_KEY).length);
  assert(b1.store.get(MARKER_KEY) === '2', 'marker counts archived records, got ' + b1.store.get(MARKER_KEY));

  section('2. Retry after marker loss does not duplicate');
  b1.store.delete(MARKER_KEY); // marker write lost after data write
  await run(worker, b1, [ext(101, 'עפולה', '13:47:15'), ext(102, 'נצרת', '13:47:15')]);
  assert(lines(b1, DAY_KEY).length === 2, 'still 2 lines after retry, got ' + lines(b1, DAY_KEY).length);
  assert(b1.store.get(MARKER_KEY) === '2', 'marker rewritten with count 2');

  section('3. Marker-write failure between data write and retry does not duplicate');
  var b3 = makeBucket();
  await run(worker, b3, [ext(101, 'עפולה', '13:47:15')]);
  b3.store.delete(MARKER_KEY);
  var realPut = b3.put, failedOnce = false;
  b3.put = async function (key, value, opts) {
    if (!failedOnce && key.indexOf('meta/') === 0) { failedOnce = true; throw new Error('R2 write failed'); }
    return realPut(key, value, opts);
  };
  var threw = false;
  try { await run(worker, b3, [ext(101, 'עפולה', '13:47:15'), ext(103, 'נצרת', '13:48:00')]); }
  catch (e) { threw = true; }
  assert(threw, 'marker-write failure surfaces (window left unprocessed)');
  await run(worker, b3, [ext(101, 'עפולה', '13:47:15'), ext(103, 'נצרת', '13:48:00')]);
  var bodies3 = lines(b3, DAY_KEY).join('\n');
  assert(lines(b3, DAY_KEY).length === 2, '101 + 103 archived once each, got ' + lines(b3, DAY_KEY).length);
  assert((bodies3.match(/"rid":103/g) || []).length === 1, 'rid 103 appears exactly once');
  assert(b3.store.get(MARKER_KEY) === '2', 'marker counts the window records (2)');

  section('4. Duplicate rid inside one payload is archived once');
  var b4 = makeBucket();
  await run(worker, b4, [ext(104, 'עפולה', '13:47:15'), ext(104, 'עפולה', '13:47:15')]);
  assert(lines(b4, DAY_KEY).length === 1, 'same rid+city twice in payload -> 1 line, got ' + lines(b4, DAY_KEY).length);

  section('5. Rolling record (no rid) repeated across attempts is archived once');
  var b5 = makeBucket();
  await run(worker, b5, [rolling('עפולה', '13:52:40')]);
  b5.store.delete(MARKER_KEY);
  await run(worker, b5, [rolling('עפולה', '13:52:40')]);
  assert(lines(b5, DAY_KEY).length === 1, 'rolling record deduped on content key, got ' + lines(b5, DAY_KEY).length);

  section('6. Same timestamp, different threat text is NOT deduped');
  var b6 = makeBucket();
  await run(worker, b6, [rolling('עפולה', '13:52:40')]);
  b6.store.delete(MARKER_KEY);
  await run(worker, b6, [{ data: 'עפולה', alertDate: '2026-11-01 13:52:40', title: 'חדירת כלי טיס עוין', category: 2 }]);
  assert(lines(b6, DAY_KEY).length === 2, 'distinct records kept, got ' + lines(b6, DAY_KEY).length);

  section('7b. Concurrent first create forces re-read, records still archived once');
  var b7b = makeBucket();
  var realPut7b = b7b.put, raced7b = false;
  b7b.put = async function (key, value, opts) {
    if (!raced7b && key.slice(-6) === '.jsonl') {
      raced7b = true;
      b7b.store.set(key, value); // concurrent run creates the file first
      return realPut7b(key, value, opts); // our create-if-absent now fails -> null
    }
    return realPut7b(key, value, opts);
  };
  await run(worker, b7b, [ext(101, 'עפולה', '13:47:15')]);
  assert((lines(b7b, DAY_KEY).join('\n').match(/"rid":101/g) || []).length === 1,
    'rid 101 archived exactly once after create race');
  assert(b7b.store.get(MARKER_KEY) === '1', 'marker written after create-race recovery');

  section('7. Concurrent writer forces re-read, records still archived once');
  var b7 = makeBucket();
  var realPut7 = b7.put, raced = false;
  b7.put = async function (key, value, opts) {
    if (!raced && key.slice(-6) === '.jsonl') {
      raced = true;
      // A concurrent run writes the same records first, changing the etag.
      b7.store.set(key, value);
      return null; // precondition failure for our write
    }
    return realPut7(key, value, opts);
  };
  // Seed the etag so the conditional put has something to match against.
  b7.store.set(DAY_KEY, '');
  await b7.put(DAY_KEY, '', undefined);
  raced = false;
  await run(worker, b7, [ext(101, 'עפולה', '13:47:15')]);
  var bodies7 = lines(b7, DAY_KEY).join('\n');
  assert((bodies7.match(/"rid":101/g) || []).length === 1, 'rid 101 archived exactly once after race');
  assert(b7.store.get(MARKER_KEY) === '1', 'marker written after race recovery');

  console.log('\ningest-dedup: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error(err); process.exit(1); });
