# R2 history and 2023 backfill

Code preparation only. Inspect existing Cloudflare bindings, storage ownership, and the current collector before activation. No production activation, infrastructure creation, or data upload is authorized by this branch.

Adds an upstream-derived AGPL-3.0 ingestion worker, an isolated browser-ingest relay, a metadata-controlled date range, and a CSV backfill tool. Existing date limits remain until day files and then the range marker are uploaded. Browser-submitted data stays in an untrusted live/ prefix, separate from canonical history; abuse and cost controls must be reviewed before activation. Empty-feed cross-checks detect disagreement, not two feeds failing empty together. Switching to a day with no data now clears the previous day's alert colors from the map.

The local conversion produced 614 daily files, 74,882 entries, about 11 MB for 2023-01-01 through 2026-02-27. Source: https://github.com/yuval-harpaz/alarms. Reuse rights are unestablished; resolve them before redistribution. The source lacks all-clear messages and some alert categories. Historical replay uses its existing one-hour expiry, not an official event-end time. 102 unresolved place names affect 2,471 rows (3.3%); preserve them without guessing a current polygon.

Activation requires separate approval after configuration, source rights, auth, quotas, and total cost are verified. Back up existing archives first; upload validated day files before metadata. Rollback restores the prior configuration and data without deleting pre-existing archives.
