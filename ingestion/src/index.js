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

    // Check if this timeslot was already processed
    const marker = await env.HISTORY_BUCKET.head(`meta/${timeslot}`);

    // Alert-check run: notify if missed, always clean up old markers
    if (isAlertCheck) {
      if (!marker) {
        console.log(`Alert check: timeslot ${timeslot} was NOT processed after all attempts`);
        ctx.waitUntil(sendPushover(
          env,
          'redmap ingestion: missed window',
          `Window ${timeslot} [${windowStartStr}, ${windowEndStr}) was not processed after all attempts.`
        ));
      } else {
        console.log(`Alert check: timeslot ${timeslot} OK`);
      }
      ctx.waitUntil(cleanupOldMarkers(env));
      return;
    }

    if (marker) {
      console.log(`Timeslot ${timeslot} already processed`);
      return;
    }

    // Fetch from the history relay (single attempt, cron cadence provides retries)
    let entries;
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
        return;
      }
      const text = (await resp.text()).replace(/^﻿/, '');
      entries = JSON.parse(text);
      const dates = entries.map(e => e.alertDate).filter(Boolean).sort();
      console.log(`Fetched ${entries.length} entries, API range: ${dates[0] || 'n/a'} – ${dates[dates.length - 1] || 'n/a'}`);

      // Empty-success guard: an HTTP 200 with zero entries is ambiguous — it
      // is either a genuinely quiet period or a broken upstream feed. Writing
      // the window marker on a broken feed would silently drop real alerts,
      // so cross-check against the rolling 50-minute feed before believing
      // an empty result.
      if (entries.length === 0) {
        const crossCheck = await fetch(`${env.HISTORY_PROXY_URL}/api2/history`, { headers }).catch(() => null);
        if (crossCheck && crossCheck.ok) {
          const crossText = (await crossCheck.text()).replace(/^﻿/, '');
          let crossEntries = [];
          try { crossEntries = JSON.parse(crossText); } catch { crossEntries = []; }
          const inWindow = crossEntries.filter(e => {
            const t = (e.alertDate || '').replace(' ', 'T');
            return t >= windowStartStr && t < windowEndStr;
          });
          if (inWindow.length > 0) {
            console.error(`alarms-history returned [] but history feed has ${inWindow.length} entries in window — treating as feed failure, will retry`);
            ctx.waitUntil(sendPushover(
              env,
              'redmap ingestion: empty feed mismatch',
              `alarms-history was empty while the history feed showed ${inWindow.length} entries for ${timeslot}. Window left unprocessed for retry.`
            ));
            return; // no marker: the next cron run retries this window
          }
        }
      }
    } catch (e) {
      console.error(`Fetch exception: ${e.message}`);
      return;
    }

    const filtered = entries
      .filter(e => e.alertDate >= windowStartStr && e.alertDate < windowEndStr)
      .map(e => ({ data: e.data, alertDate: e.alertDate, category_desc: e.category_desc, rid: e.rid }));

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

    // Write timeslot marker
    await env.HISTORY_BUCKET.put(`meta/${timeslot}`, `${filtered.length}`, {
      httpMetadata: { contentType: 'text/plain' },
    });
    console.log(`Marker written: meta/${timeslot} (${filtered.length} entries)`);
  },
};
