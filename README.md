# RedMap - Live Pikud HaOref Alert Map

Live map of Israel showing [Pikud HaOref](https://www.oref.org.il) (Home Front Command) alerts as colored area polygons per location. Running at [redmap.me](https://redmap.me).


> **Disclaimer:** This is an unofficial civic project. Always follow the official [Home Front Command](https://www.oref.org.il) instructions and do not rely on this app as your only source of alerts.

## Features

- Colored area polygons per location, merged into contiguous alert zones
- Timeline slider to scrub through recent alert history, plus a day-by-day history view (התרעות קודמות)
- Heat map of the last 24 hours (מפת חום)
- Sound alerts for new alerts (muted by default, toggle in the menu)
- Click any area to see its alert history
- Dark/light themes, share button, about modal (ⓘ)

| Color | Meaning |
|-------|---------|
| 🔴 Red | Rocket/missile fire |
| 🟣 Purple | Hostile aircraft / drone |
| 🟤 Brown | Terrorist infiltration |
| 🟡 Yellow | Early warning / preparedness - go near your shelter, sirens may follow |
| 🩵 Teal | Hazardous materials |
| 🟠 Orange | Earthquake |
| 🟢 Green | Event ended (fades out after 2 minutes) |

When two threats are active at the same location, the area fill shows the higher-priority one (rocket fire above all others) and the border shows the other. Hazardous-materials and earthquake alerts can be prolonged events, so they stay on the map until an official "event ended" message (older than 30 minutes they are shown dimmed, as a stale cue) - the 30-minute rocket/yellow and 6-hour drone/terrorist expiry rules are unchanged. The exact official alert payloads for these two categories have not been verified against a live event yet; an unrecognized alert still falls back to red.

The developer tools panel (enable `oref-dev-tools` in localStorage) includes a local test button for each alert type, including the two new ones. Test buttons inject local simulated payloads only - they never send public or external notifications.

### Experimental features

Enabled from the experimental section of the in-app menu (feature flags):

- **Launch direction estimation** (כיוון שיגור) - looks at the pattern of alerted zones and draws an indicative ellipse and corridor of where a launch may have come from. This is a rough heuristic visualization only. It is not verified information and must not be relied on for safety decisions.
- **Driving mode** (מצב נהיגה) - map camera behavior for following your position while driving.


## Development

```sh
./web-dev        # start dev server at http://localhost:8788
./web-dev-r2     # dev server with R2-backed day history
```

Requires [Node.js](https://nodejs.org) and `npx` (comes with npm). Uses [Wrangler](https://developers.cloudflare.com/workers/wrangler/) to serve `web/` and run the API proxy functions locally.

The polygon data file (`locations_polygons.json`) is not in the repo; `./web-dev` downloads it automatically from the live site if missing.

Run the prediction algorithm test suite:

```sh
node tests/prediction.test.js
```

## Deploy

Deployed to [Cloudflare Pages](https://pages.cloudflare.com) (static assets + API proxy functions):

```sh
./deploy
```

## Structure

```
web/
  index.html            # single-file map app (most JS/CSS inline)
  prediction-mode.js    # launch direction estimation (experimental)
  ellipse-mode.js       # ellipse tooling
  about.html            # about page
functions/api/
  alerts.js             # proxies live alerts API
  history.js            # proxies history API
  alarms-history.js     # proxies extended history API
  day-history.js        # day-by-day history
  analytics.js          # Cloudflare analytics summary for visitor counts
  analytics-daily.js    # daily analytics
tests/
  prediction.test.js    # prediction algorithm test suite
docs/                   # architecture, oref-sources.md (data sources), feature notes
tools/                  # data backfill and analysis scripts
ellipses-server/        # ellipse estimation backend service
```

## Contributing

Contributions are welcome! This is a civic project built for anyone in Israel who wants better situational awareness during alerts.

Ways to help:
- **Bug reports** - open an issue if something looks wrong
- **Location data** - if a polygon is missing or misplaced, open an issue with the location name
- **Features & fixes** - PRs are very welcome! Please keep each PR focused on a single feature or fix. For anything beyond a small bug fix, open an issue first so we can discuss the approach before you invest the effort
- **Feature flags** - beta/experimental features are gated behind `f-` URL params (e.g. `?f-log`). To add a new flag, check `FF.<name>` in JS or use the `f-gated` CSS class for visibility toggling. See `CLAUDE.md` for details.

To run locally, see the [Development](#development) section above.

## Author

Originally created by [Maor Conforti](https://github.com/maorcc).

## Contributors

Thanks to [@maorcc](https://github.com/maorcc) for the original project, [@uripeer3](https://github.com/uripeer3), [@tomerkon](https://github.com/tomerkon), [@michalrymland](https://github.com/michalrymland), [@ravitzm21](https://github.com/ravitzm21), [@tomeras91](https://github.com/tomeras91), and [@talmiller2](https://github.com/talmiller2) for contributing to this project.

## Data

Polls the Oref APIs:

- **Live alerts** (`/api/alerts`) - every 1 second
- **History** (`/api/history`) - every 10 seconds

See [docs/oref-sources.md](docs/oref-sources.md) for the full data-source documentation.

## License

[GNU AGPL v3](LICENSE)
