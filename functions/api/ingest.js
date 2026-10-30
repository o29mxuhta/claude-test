// Relays browser-observed live alerts to the redmap-ingestion worker.
//
// web/index.html forwardAlertToCache() POSTs each live alert here
// (same-origin, no CORS). This Function forwards the body verbatim to the
// worker's /ingest endpoint, which writes it to the UNTRUSTED live/ holding
// prefix in R2 — never to canonical day-history files.
//
// Requires the INGEST_WORKER_URL Pages env var, e.g.
//   https://redmap-ingestion.<account-subdomain>.workers.dev/ingest
// Until that is set, returns 503 and the client silently logs the failure,
// exactly as it did when the old hardcoded collector domain went away.

import { corsPreflight } from './_proxy.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const MAX_BODY_BYTES = 8192;

export async function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestPost(context) {
  const target = context.env.INGEST_WORKER_URL;
  if (!target) {
    return new Response('ingest not configured', {
      status: 503,
      headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, CORS),
    });
  }

  let text;
  try {
    text = await context.request.text();
  } catch {
    return new Response('Bad Request', { status: 400, headers: CORS });
  }
  if (text.length > MAX_BODY_BYTES) {
    return new Response('Payload Too Large', { status: 413, headers: CORS });
  }
  try {
    JSON.parse(text);
  } catch {
    return new Response('Bad Request: JSON body required', { status: 400, headers: CORS });
  }

  let resp;
  try {
    resp = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    });
  } catch (err) {
    return new Response('Bad Gateway: ingestion worker unreachable', { status: 502, headers: CORS });
  }
  return new Response(null, { status: resp.status === 204 ? 204 : 502, headers: CORS });
}
