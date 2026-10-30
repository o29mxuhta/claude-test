# R2 history and 2023 backfill

Adds an upstream-derived AGPL-3.0 ingestion worker, an isolated browser-ingest relay, a metadata-controlled date range, and a CSV backfill tool. Existing date limits remain until day files and then the range marker are uploaded. Browser-submitted data stays in an untrusted live/ prefix, separate from canonical history; abuse and cost controls must be reviewed before enabling the relay. Empty-feed cross-checks detect disagreement, not two feeds failing empty together. Switching to a past day with no data clears the previous day's alert colors from the map (today's live alerts are never touched).

The conversion produces 614 daily files, 74,882 entries, about 11 MB for 2023-01-01 through 2026-02-27. Source: https://github.com/yuval-harpaz/alarms - keep this attribution with the data. Anyone redistributing derived data is responsible for holding the source author's permission. The source lacks all-clear messages and some alert categories. Historical replay uses its existing one-hour expiry, not an official event-end time. 102 unresolved place names affect 2,471 rows (3.3%); preserve them without guessing a current polygon.

## Activation runbook

Set up usage monitoring first. Check the current R2 and Workers tier limits (https://developers.cloudflare.com/r2/pricing/, https://developers.cloudflare.com/workers/platform/pricing/) and the account's billing state in the dashboard before creating anything. Those are external tier limits, not a guarantee: stop if the dashboard asks for a payment method or a paid plan.

1. Create the bucket `oref-history` (dashboard R2 > Create bucket, or `npx wrangler r2 bucket create oref-history`).
2. Deploy the collector: `cd ingestion && npx wrangler deploy`. Confirm the cron trigger (`1/2 * * * *`) and the HISTORY_BUCKET binding. Marker objects under `meta/<timeslot>` should appear within 15 minutes; logs show `Marker written: meta/<timeslot>`.
3. Seed days the collector cannot recover: the collector only accumulates from deploy time, so import the 2023 backfill AND any days between the backfill's end and today from the existing archive: `python3 tools/backfill_from_csv.py --yes`, review `tmp/r2_csv_backfill/`, upload the day files. Once HISTORY_BUCKET is bound, functions/api/day-history.js returns 404 for missing past days instead of proxying the fallback, so the bucket must hold every past day the site can serve before binding.
4. Upload `meta/history-range.json` only after the day files are in the bucket: it opens the earlier date range in the picker, and uploading it first would offer empty days.
5. Read back the stored data: list the bucket, compare object count and sizes against the local files, and fetch-sample a busy day and a quiet day. Do not bind before read-back matches.
6. Bind the Pages project: Settings > Bindings > Add > R2 bucket, variable name HISTORY_BUCKET, bucket `oref-history`, for BOTH production and preview, then redeploy: Pages binding changes take effect only after a redeploy (https://developers.cloudflare.com/pages/functions/bindings/). Verify the actually-served deployment afterward.
7. Canary the collector feed: at the next real alert, compare `/api/day-history?date=<today>` against the live feed. Until this check passes on a non-empty feed, treat the collector as unverified.
8. Optional, deferred until abuse controls are reviewed: set the Pages variable `INGEST_WORKER_URL` to enable the browser-ingest relay. That endpoint is unauthenticated by design and writes only to the untrusted `live/` prefix.

## Cutoff and rollback

Non-destructive cutoff (keeps all data): disable the `redmap-ingestion` cron trigger (Settings > Triggers), remove the HISTORY_BUCKET binding from both production and preview, and redeploy. The history functions then serve their no-binding fallbacks and the collector stops writing; nothing in the bucket is touched.

Full teardown, only if removal is actually wanted: also delete `meta/history-range.json` (closes the extended picker; day files stay inert) and `npx wrangler delete redmap-ingestion`. Pre-existing archives are never touched.

## Unmapped place names (open)

102 source names (2,471 rows, 3.3%) do not resolve to a current canonical polygon. Most are industrial zones, small sites, or pre-split names (for example "צפת", which the current polygon set splits into three zones) that are absent from the current polygon set rather than misspelled. They are kept with their raw names in the day files: the timeline skips them, and the archive stays honest. Checked 2026-10-30: the site's polygon set matches the current official zones list (1,449 names, https://www.tzevaadom.co.il/static/cities.json) except the one known Ashdod truncation the backfill tool already reverses, and none of the 102 names appear in that list. They are retired historical zones, not gaps in live alerting. Resolving them would need an official historical zone list; guessing a polygon would misplace alerts on the map.
