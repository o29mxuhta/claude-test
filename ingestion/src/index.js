// redmap-ingestion: cron worker that archives oref alert history into R2.
//
// Adapted from upstream maorcc/oref-map ingestion/ (same windowing scheme):
// every 15 minutes of Israel-local time is fetched ~6 times over the
// following 15 minutes, then appended to per-day JSONL files in the
// HISTORY_BUCKET R2 bucket. `meta/<timeslot>` markers make each window
// idempotent; a final alert-check run per window can notify via Pushover
// (optional PUSHOVER_USER / PUSHOVER_TOKEN secrets) when a window was missed.
//
// Day-file layout mirrors functions/api/day-history.js: `<date>.jsonl`,
// comma-terminated JSONL, events from 23:xx belong to the NEXT day's file.
//
// Additionally exposes POST /ingest: browsers forward live alerts here
// (see web/index.html forwardAlertToCache). These are written to a separate
// `live/` holding prefix, NEVER to the canonical day files: the endpoint is
// unauthenticated by design (any browser can reach it), so its data must be
// treated as untrusted until reviewed. Merging live/ into canonical history
// is a separate, explicit step.

function toIsraelTimeStr(timestampMs) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestampMs)).replace(' ', 'T');
}

async function sendPushover(env, title, message) {
  if (!env.PUSHOVER_USER || !env.PUSHOVER_TOKEN) return;
  await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: env.PUSHOVER_TOKEN,
      user: env.PUSHOVER_USER,
      title,
      message,
    }),
  });
}

// Map alertDate to R2 file date key. Events from 23:xx belong to next day's file.
// Each day file covers (D-1)T23:00 to DT22:59, Israel local time.
// The string is Israel-local wall time; only date arithmetic is done here, so
// the (fixed) offset cancels out.
function r2DateKey(alertDateStr) {
  const d = new Date(alertDateStr.slice(0, 10) + 'T12:00:00Z');
  if (parseInt(alertDateStr.slice(11, 13)) >= 23)
    d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Determine the 15-minute ingestion window from wall time.
// Returns { windowStartMs, windowEndMs, timeslot, isAlertCheck } or null (dead zone).
//
// Cron runs every 2 min at odd minutes (:01, :03, ..., :59).
// Each 15-min window gets ~6 fetch attempts plus a final alert-check.
//
//   :01–:11 → [XX:45, XX+1:00)  alert-check at :13
//   :15     → dead zone
//   :17–:25 → [XX:00, XX:15)    alert-check at :27
//   :29,:31 → dead zone
//   :33–:41 → [XX:15, XX:30)    alert-check at :43
//   :45     → dead zone
//   :47–:55 → [XX:30, XX:45)    alert-check at :57
//   :59     → dead zone
function computeWindow(nowMs) {
  const israelStr = toIsraelTimeStr(nowMs);
  const minute = parseInt(israelStr.slice(14, 16));

  let windowEndMinute;
  let isAlertCheck = false;

  if (minute >= 1 && minute <= 13) {
    windowEndMinute = 0;       // [XX:45, XX+1:00)
    isAlertCheck = minute === 13;
  } else if (minute >= 17 && minute <= 27) {
    windowEndMinute = 15;      // [XX:00, XX:15)
    isAlertCheck = minute === 27;
  } else if (minute >= 33 && minute <= 43) {
    windowEndMinute = 30;      // [XX:15, XX:30)
    isAlertCheck = minute === 43;
  } else if (minute >= 47 && minute <= 57) {
    windowEndMinute = 45;      // [XX:30, XX:45)
    isAlertCheck = minute === 57;
  } else {
    return null; // dead zone
  }

  const seconds = parseInt(israelStr.slice(17, 19));
  const offsetMinutes = windowEndMinute === 0 ? minute : minute - windowEndMinute;
  const windowEndMs = nowMs - offsetMinutes * 60000 - seconds * 1000;
  const windowStartMs = windowEndMs - 15 * 60000;

  // timeslot = window start in Israel time, truncated to minute (e.g. "2026-03-28T14:15")
  const timeslot = toIsraelTimeStr(windowStartMs).slice(0, 16);

  return { windowStartMs, windowEndMs, timeslot, isAlertCheck };
}

async function cleanupOldMarkers(env) {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const cutoff = toIsraelTimeStr(twoHoursAgo).slice(0, 16);

  const listed = await env.HISTORY_BUCKET.list({ prefix: 'meta/' });
  let deleted = 0;
  for (const obj of listed.objects) {
    // key = "meta/2026-03-28T14:15"
    const timeslot = obj.key.slice(5);
    // Only timeslot markers are disposable. Anything else under meta/
    // (e.g. history-range.json, written by the backfill import) is kept.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(timeslot)) continue;
    if (timeslot < cutoff) {
      await env.HISTORY_BUCKET.delete(obj.key);
      deleted++;
    }
  }
  console.log(`Cleanup: deleted ${deleted} old markers`);
}

// Coverage metadata only. Canonical events and original markers are untouched.
const COVERAGE_RANGE_KEY = 'meta/history-range.json';
const COVERAGE_CAP_BYTES = 16 * 1024;
const COVERAGE_MAX_SLOTS = 16000; // 166 days 16 hours, no pruning
const QUARTER_MS = 15 * 60 * 1000;

async function recordFinalCoverage(env, windowStartMs, markerValue) {
  // Local-time marker keys cannot distinguish the repeated DST hour. Do not
  // certify either occurrence from that ambiguous marker.
  const local = toIsraelTimeStr(windowStartMs).slice(0, 16);
  const ambiguous = [-3600000, 3600000].some(delta =>
    toIsraelTimeStr(windowStartMs + delta).slice(0, 16) === local);
  const code = ambiguous ? '?' : /^\d+$/.test(markerValue || '') && Number(markerValue) > 0 ? 'a'
    : markerValue === 'quiet-unconfirmed' || markerValue === 'pending-quiet' ? 'q'
    : markerValue === null || markerValue === 'error' ? 'f' : '?';
  const slot = Math.floor(windowStartMs / QUARTER_MS);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const obj = await env.HISTORY_BUCKET.get(COVERAGE_RANGE_KEY);
      // Never invent minDate or create a replacement if the existing range is
      // missing/broken. A metadata failure must not affect event archival.
      if (!obj) { console.warn('Coverage unavailable: range metadata missing'); return; }
      const cfg = JSON.parse(await obj.text());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.minDate || '')) return;
      const old = cfg.coverage;
      if (old && (old.v !== 1 || !Number.isSafeInteger(old.start) ||
          typeof old.states !== 'string' || !/^[aqf?]*$/.test(old.states))) return;
      const start = old ? old.start : slot;
      if (slot < start) return; // no backfill or expansion into older history
      const index = slot - start;
      const capped = index >= COVERAGE_MAX_SLOTS;
      if (capped && old && old.capped) return;
      let states = old ? old.states : '';
      if (!capped) {
        if (index < states.length && states[index] === code) return;
        states = states.padEnd(index + 1, '?');
        states = states.slice(0, index) + code + states.slice(index + 1);
      }
      cfg.coverage = {v: 1, start, states, asOf: capped && old ? old.asOf : new Date().toISOString()};
      if (capped) cfg.coverage.capped = true;
      const body = JSON.stringify(cfg);
      if (new TextEncoder().encode(body).length > COVERAGE_CAP_BYTES) {
        console.warn('Coverage metadata cap reached'); return;
      }
      const saved = await env.HISTORY_BUCKET.put(COVERAGE_RANGE_KEY, body, {
        onlyIf: {etagMatches: obj.etag}, storageClass: 'Standard',
        httpMetadata: {contentType: 'application/json'},
      });
      if (saved) return;
      // Failed conditional writes count as operations. At most three attempts.
    } catch (err) {
      console.warn('Coverage metadata update failed', String(err));
      return; // no automatic retry on network/error with uncertain write result
    }
  }
  console.warn('Coverage update conflict budget exhausted');
}

// --- POST /ingest: browser-forwarded live alerts into the live/ holding area ---

const INGEST_MAX_CITIES = 50;
const INGEST_MAX_ENTRIES_PER_RUN = 200;
const LIVE_FILE_CAP_BYTES = 5 * 1024 * 1024;

function minuteKey(alertDateStr) {
  return alertDateStr.slice(0, 16);
}

async function handleIngest(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Bad Request: JSON body required', { status: 400 });
  }

  const cities = Array.isArray(payload && payload.cities) ? payload.cities : [];
  const threat = typeof (payload && payload.threat) === 'string' ? payload.threat.slice(0, 200) : '';
  if (!cities.length || !threat) {
    return new Response('Bad Request: cities[] and threat required', { status: 400 });
  }

  // Client clocks are untrusted: clamp to server time +/- 10 minutes.
  const nowMs = Date.now();
  let tsMs = Date.parse(payload.timestamp || '');
  if (isNaN(tsMs) || Math.abs(tsMs - nowMs) > 10 * 60 * 1000) tsMs = nowMs;
  const alertDate = toIsraelTimeStr(tsMs);
  const dateKey = r2DateKey(alertDate);
  const objKey = `live/${dateKey}.jsonl`;

  const existing = await env.HISTORY_BUCKET.get(objKey);
  const existingText = existing ? await existing.text() : '';
  if (existingText.length > LIVE_FILE_CAP_BYTES) {
    return new Response('live file full', { status: 507 });
  }

  // Dedupe against what is already held: same city, minute and threat.
  const seen = new Set();
  for (const line of existingText.split('\n')) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed);
      seen.add(`${e.data}|${minuteKey(e.alertDate)}|${e.category_desc}`);
    } catch { /* ignore damaged lines */ }
  }

  let appended = 0;
  let out = '';
  for (const rawCity of cities.slice(0, INGEST_MAX_CITIES)) {
    if (typeof rawCity !== 'string' || !rawCity) continue;
    if (appended >= INGEST_MAX_ENTRIES_PER_RUN) break;
    const entry = {
      data: rawCity,
      alertDate,
      category_desc: threat,
      rid: 0, // browser-forwarded alerts carry no oref rid
    };
    const key = `${entry.data}|${minuteKey(entry.alertDate)}|${entry.category_desc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out += JSON.stringify(entry) + ',\n';
    appended++;
  }

  if (appended > 0) {
    await env.HISTORY_BUCKET.put(objKey, existingText + out, {
      httpMetadata: { contentType: 'application/jsonl' },
    });
  }
  console.log(`ingest: ${appended} new entries into ${objKey} (${cities.length} cities offered)`);
  return new Response(null, { status: 204 });
}


// --- History entry normalization (rolling + extended documented shapes) ---
//
// The relay's /api2/alarms-history route aliases the rolling
// AlertsHistory.json feed. Documented shapes (docs/architecture.md:34,42):
//   rolling:   { data: "location", alertDate: "YYYY-MM-DD HH:MM:SS", title, category, desc? }
//   extended:  { data: "location", alertDate: "YYYY-MM-DDTHH:MM:SS", category_desc, rid, ... }
// Only these documented shapes are mapped. The only transformation is
// normalizing the rolling space separator to 'T' so window comparison and the
// archive layout stay ISO. Documented fields are copied verbatim - no rid for
// rolling records (they carry none) and no authored category text. A missing
// rolling title falls back to the prefix of the source's own desc field, the
// same transformation the production UI applies (web/index.html
// processHistoryEntry). Records with neither title nor desc are archived
// without category_desc (the R2 timeline currently skips such entries; known
// partial result, see review). Records outside the documented shape - e.g.
// non-string data (the relay tolerates array data), a non-numeric extended
// rid, an invalid calendar date - are rejected, and any rejection fails the
// whole window closed (unprocessed, no marker) rather than archiving a
// silently partial window. Unknown extra source fields are not archived.

function normalizeHistoryEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  if (typeof e.data !== 'string' || !e.data.trim()) return null;

  const rawDate = typeof e.alertDate === 'string' ? e.alertDate.trim() : '';
  const alertDate = rawDate.indexOf('T') === -1 ? rawDate.replace(' ', 'T') : rawDate;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(alertDate);
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3], hour = +m[4], minute = +m[5], second = +m[6];
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;

  const descPrefix = (typeof e.desc === 'string' && e.desc.trim())
    ? e.desc.split('-')[0].trim() : '';
  const categoryDesc =
    (typeof e.category_desc === 'string' && e.category_desc.trim()) ? e.category_desc :
    (typeof e.title === 'string' && e.title.trim()) ? e.title :
    descPrefix || null;

  const out = { data: e.data, alertDate };
  if (categoryDesc) out.category_desc = categoryDesc;
  if (typeof e.rid === 'number') out.rid = e.rid;              // extended only, verbatim
  else if ('rid' in e) return null;                            // documented rid is numeric
  if (typeof e.category === 'number') out.category = e.category; // rolling only, verbatim
  else if ('category' in e) return null;                       // documented category is numeric
  if (typeof e.desc === 'string' && e.desc) out.desc = e.desc;   // rolling only, verbatim
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ingest' && request.method === 'POST') {
      return handleIngest(request, env);
    }
    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const window = computeWindow(event.scheduledTime);
    if (!window) {
      console.log('Dead zone — skipping');
      return;
    }
    const { windowStartMs, windowEndMs, timeslot, isAlertCheck } = window;

    const windowStartStr = toIsraelTimeStr(windowStartMs);
    const windowEndStr = toIsraelTimeStr(windowEndMs);

    console.log(`Timeslot: ${timeslot}, window: [${windowStartStr}, ${windowEndStr}), alertCheck: ${isAlertCheck}`);

    // Check this timeslot's marker VALUE, not just existence: the marker is a
    // small state machine, and 'pending-quiet' / 'error' are non-final states
    // that must be retried while this window's normal attempts remain.
    //   '<n>' (n >= 1)      final: n records archived
    //   'pending-quiet'     non-final: trustworthy empty answer so far; retry
    //   'error'             non-final: last attempt failed; retry
    //   'quiet-unconfirmed' final: latest trustworthy answer quiet with no
    //                       subsequent handled failure; coverage unverified,
    //                       NOT a verified zero
    //   (missing)           never attempted / never completed
    const markerObj = await env.HISTORY_BUCKET.get(`meta/${timeslot}`);
    const markerValue = markerObj ? (await markerObj.text()).trim() : null;

    // Alert-check run: final classification + cleanup of old markers.
    // Missing or 'error' means the window never reached a result in any of its
    // attempts: a true miss, notified. 'pending-quiet' becomes the final
    // 'quiet-unconfirmed' state - the feed answered empty on every attempt,
    // which is a valid real-time "nothing active" answer but cannot verify a
    // past window; it is classified, not completed, and not a miss.
    if (isAlertCheck) {
      if (markerValue === null || markerValue === 'error') {
        console.log(`Alert check: timeslot ${timeslot} was NOT processed after all attempts`);
        ctx.waitUntil(sendPushover(
          env,
          'redmap ingestion: missed window',
          `Window ${timeslot} [${windowStartStr}, ${windowEndStr}) was not processed after all attempts.`
        ));
      } else if (markerValue === 'pending-quiet') {
        await env.HISTORY_BUCKET.put(`meta/${timeslot}`, 'quiet-unconfirmed', {
          httpMetadata: { contentType: 'text/plain' },
        });
        console.log(`Alert check: timeslot ${timeslot} classified quiet-unconfirmed (latest trustworthy answer quiet, no subsequent handled failure; coverage unverified)`);
      } else if (markerValue === 'quiet-unconfirmed') {
        console.log(`Alert check: timeslot ${timeslot} already classified quiet-unconfirmed (final; inferred, not verified)`);
      } else {
        console.log(`Alert check: timeslot ${timeslot} OK (${markerValue} entries)`);
      }
      await recordFinalCoverage(env, windowStartMs, markerValue);
      ctx.waitUntil(cleanupOldMarkers(env));
      return;
    }

    // Only a completed window is skipped. 'pending-quiet' and 'error' are
    // retried while this window's normal attempts remain: a later attempt may
    // find records that were not visible yet, and a real error after a quiet
    // answer must not end up classified as quiet.
    if (markerValue !== null && markerValue !== 'pending-quiet' && markerValue !== 'error') {
      console.log(`Timeslot ${timeslot} already processed (${markerValue} entries)`);
      return;
    }

    // Any failure after a 'pending-quiet' answer downgrades it to 'error', so
    // a stale quiet answer can never survive a later real failure into the
    // final classification.
    const failAttempt = async () => {
      if (markerValue === 'pending-quiet') {
        await env.HISTORY_BUCKET.put(`meta/${timeslot}`, 'error', {
          httpMetadata: { contentType: 'text/plain' },
        });
      }
    };

    // Fetch from the history relay (single attempt, cron cadence provides retries)
    let entries;
    let upstreamStatus = '';
    try {
      const headers = {};
      // RELAY_KEY authenticates the worker to the upstream history relay, if the
      // relay requires it. Unrelated to this worker's own /ingest endpoint.
      if (env.RELAY_KEY) headers['X-Ingest-Key'] = env.RELAY_KEY;
      const resp = await fetch(
        `${env.HISTORY_PROXY_URL}/api2/alarms-history`,
        { headers }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        const respHeaders = Object.fromEntries(resp.headers.entries());
        console.error(`Error Fetch URL: ${env.HISTORY_PROXY_URL}/api2/alarms-history`);
        console.error(`FETCH failed: HTTP ${resp.status}: ${body.slice(0, 200)}`);
        console.error(`Response headers: ${JSON.stringify(respHeaders)}`);
        await failAttempt();
        return;
      }
      const text = (await resp.text()).replace(/^\uFEFF/, '');
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('payload is not an array');
      entries = parsed.map(normalizeHistoryEntry);
      const badIndex = entries.findIndex(e => e === null);
      if (badIndex !== -1) {
        console.error(`Malformed history record at index ${badIndex}: ${JSON.stringify(parsed[badIndex]).slice(0, 200)}`);
        await failAttempt();
        return; // fail closed: the next cron run retries this window
      }
      const dates = entries.map(e => e.alertDate).filter(Boolean).sort();
      console.log(`Fetched ${entries.length} entries, API range: ${dates[0] || 'n/a'} – ${dates[dates.length - 1] || 'n/a'}`);
      upstreamStatus = resp.headers.get('X-Upstream-Status') || '';
    } catch (e) {
      console.error(`Fetch exception: ${e.message}`);
      await failAttempt();
      return;
    }

    const filtered = entries
      .filter(e => e.alertDate >= windowStartStr && e.alertDate < windowEndStr);

    filtered.sort((a, b) => a.alertDate < b.alertDate ? -1 : a.alertDate > b.alertDate ? 1 : 0);

    // Group by R2 date key (events 23:xx go to next day's file)
    const byDate = {};
    for (const e of filtered) {
      const d = r2DateKey(e.alertDate);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(e);
    }

    console.log(`Filtered: ${filtered.length} entries, dates: ${Object.keys(byDate).join(', ') || 'none'}`);

    // Append to each date's JSONL file
    for (const [d, dateEntries] of Object.entries(byDate)) {
      const existing = await env.HISTORY_BUCKET.get(`${d}.jsonl`);
      const existingText = existing ? await existing.text() : '';
      const newLines = dateEntries.map(e => JSON.stringify(e) + ',\n').join('');
      await env.HISTORY_BUCKET.put(`${d}.jsonl`, existingText + newLines, {
        httpMetadata: { contentType: 'application/jsonl' },
      });
      console.log(`Wrote ${d}.jsonl: ${dateEntries.length} new + ${existingText.length} bytes existing`);
    }

    // Write the timeslot marker.
    //  - Records archived: the marker is the count (final for this window).
    //  - No records in this window: an empty window is INFERRED, never
    //    verified - a valid real-time "nothing active" answer cannot prove a
    //    past window was quiet, and a non-empty answer elsewhere in the feed
    //    does not prove it either. The window becomes 'pending-quiet' and is
    //    retried while its normal attempts remain; the alert-check assigns
    //    the final 'quiet-unconfirmed' classification. A fully empty answer
    //    without the relay's confirmed upstream 200 is not trustworthy even
    //    that far: the attempt fails and the window is retried.
    if (filtered.length === 0) {
      if (entries.length === 0 && upstreamStatus !== '200') {
        console.error(`Empty payload without confirmed upstream 200 (got '${upstreamStatus || 'none'}') - window ${timeslot} left unprocessed`);
        await failAttempt();
        return;
      }
      await env.HISTORY_BUCKET.put(`meta/${timeslot}`, 'pending-quiet', {
        httpMetadata: { contentType: 'text/plain' },
      });
      console.log(`Marker written: meta/${timeslot} (pending-quiet)`);
      return;
    }
    await env.HISTORY_BUCKET.put(`meta/${timeslot}`, `${filtered.length}`, {
      httpMetadata: { contentType: 'text/plain' },
    });
    console.log(`Marker written: meta/${timeslot} (${filtered.length} entries)`);
  },
};
