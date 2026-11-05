# Deployed Cloudflare workers (live proxies)

Source of the Oref live proxies as deployed on 2026-11-03.
- `redmap-live-api` serves api2.redmap.me
- `redmap-live-backup` serves api.redmap.me

History upstream path is case-sensitive. `/WarningMessages/alert/History/AlertsHistory.json`
returns 404 on oref.org.il; the documented `/warningMessages/alert/History/AlertsHistory.json` works.
The worker tries the documented path first and falls through only on an upstream 404.
All other statuses pass through unchanged. No empty fallback. `X-Upstream-Target` reports which path answered.
