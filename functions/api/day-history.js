import { corsPreflight } from './_proxy.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };

function jsonResponse(body, cacheControl) {
  return new Response(body, {
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    }, CORS),
  });
}

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, CORS),
  });
}

// The day files are comma-per-line JSONL: every entry ends with ",\n", so the
// array is rebuilt by wrapping the text and dropping the final comma. That is
// fast (no per-entry parse) but silently produces malformed JSON if the file is
// truncated mid-write, carries a BOM, or omits the trailing comma. A malformed
// body served as 200 makes an entire day vanish from the timeline while the UI
// reports success, so validate before returning and fall back to a strict
// line-by-line parse that salvages every intact entry.
function jsonlToArray(text) {
  const trimmed = text.replace(/^﻿/, '').trimEnd();
  if (!trimmed) return { body: '[]', recovered: false };

  const candidate = '[' + (trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed) + ']';
  try {
    JSON.parse(candidate);
    return { body: candidate, recovered: false };
  } catch {
    // Salvage path: keep every line that parses, drop only the damaged ones.
    const entries = [];
    let dropped = 0;
    for (const rawLine of trimmed.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        dropped++;
      }
    }
    return { body: JSON.stringify(entries), recovered: true, dropped };
  }
}

export async function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');

  // This format check is what makes the R2 key and the dev-mode outbound URL
  // safe — neither is independently encoded. Do not loosen it.
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('Bad Request: ?date=YYYY-MM-DD required', 400);
  }

  // Local dev: proxy to production
  if (!context.env.HISTORY_BUCKET) {
    return fetch(`https://oref-map.org/api/day-history?date=${date}`);
  }

  const todayIsrael = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jerusalem' }).format(new Date());

  let obj;
  try {
    obj = await context.env.HISTORY_BUCKET.get(`${date}.jsonl`);
  } catch (err) {
    // An R2 failure is not an empty day. Say so, so the client can retry
    // instead of rendering a silently empty timeline.
    return errorResponse('Bad Gateway: history store unavailable', 502);
  }

  if (!obj) {
    if (date === todayIsrael) {
      return jsonResponse('[]', 'public, max-age=60');
    }
    return errorResponse('Not Found', 404);
  }

  const text = await obj.text();
  const result = jsonlToArray(text);

  if (result.recovered) {
    console.warn(`day-history: ${date}.jsonl was malformed; recovered by line-parse, dropped ${result.dropped} damaged line(s)`);
  }

  // Past days are immutable — cache for 1 hour. Today changes every 15 min.
  // A recovered (damaged) file is not cached long, so a repaired file is picked
  // up quickly.
  const cacheControl = result.recovered
    ? 'public, max-age=60'
    : (date < todayIsrael ? 'public, max-age=3600' : 'public, max-age=60');

  return jsonResponse(result.body, cacheControl);
}
