// Reports the earliest day the history store actually holds, so the client
// never offers browsable days that have no data. The backfill tooling writes
// meta/history-range.json into the bucket after a verified import; until
// then the default matches the existing archive's start date.

import { corsPreflight } from './_proxy.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const DEFAULT_MIN_DATE = '2026-02-28';

function jsonResponse(body) {
  return new Response(body, {
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    }, CORS),
  });
}

export async function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestGet(context) {
  let minDate = DEFAULT_MIN_DATE;
  let coverage;
  if (context.env.HISTORY_BUCKET) {
    try {
      const obj = await context.env.HISTORY_BUCKET.get('meta/history-range.json');
      if (obj) {
        const cfg = JSON.parse(await obj.text());
        if (/^\d{4}-\d{2}-\d{2}$/.test(cfg.minDate || '')) {
          minDate = cfg.minDate;
          coverage = cfg.coverage;
        }
      }
    } catch (err) {
      // A broken range object must not break the picker: fall back to default.
      console.warn(`history-range: failed to read meta/history-range.json: ${err}`);
    }
  }
  return jsonResponse(JSON.stringify({ minDate, coverage }));
}
