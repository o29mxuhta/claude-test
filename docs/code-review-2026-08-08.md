# redlive — architecture walkthrough and code review

Review date: 2026-08-08. Reviewed against the working tree as mounted (no `.git`, so no
history to consult). Every finding below was verified by reading the cited lines.

> **Status: fixes applied 2026-08-08.** Everything below except the prediction-mode items
> (O1, and the bearing half of O4) has been fixed in the tree. Original files are preserved
> under `.review-backup-2026-08-08/`. Line references point at the code as it was *before*
> the fix. See "What was changed" at the end.

The repo as mounted is the **Pages/static half only**. `worker/`, `ingestion/`, and
`history-proxy/` are documented at length in `docs/architecture.md` but are not present,
so claims about them are taken from the docs and could not be checked against code.

---

## Part 1 — How the system actually works

### Shape of the thing

A single-page vanilla-JS map. `web/index.html` is 6,193 lines with all JS and CSS inline
and no build step. MapLibre GL JS renders a Protomaps basemap from a self-hosted PMTiles
file on Cloudflare R2, fetched client-side via the `pmtiles://` protocol with no Worker in
the path. On top of that sits one GeoJSON source, `alerts-source`, holding ~1,450
pre-computed Voronoi-ish polygons — one per Oref location. Alert state is expressed purely
as per-feature properties (`fillColor`, `fillOpacity`, `lineColor`, `lineOpacity`) updated
in place, so adjacent same-colour polygons visually merge into contiguous threat zones
because their strokes match.

The polygon file itself is gitignored and served in production by a Pages Function
(`functions/locations_polygons.json.js`); `./web-dev` downloads it if missing.

### Data flow

Three upstream sources, all from Pikud HaOref, all geo-blocked to Israeli IPs with HTTP 403:

- **Live alerts**, polled every 1s. `data` is an **array** of location strings. Returns a
  BOM-only body when nothing is active. This is a snapshot of *now*.
- **History**, polled every 10s. `data` is a **string** (one location). Covers ~1 hour.
  This exists because all-clears are short-lived and the 1s live poll misses them — the
  history feed is the authoritative source for transitions to green.
- **Extended history**, ~3,000 entries. Consumed by the ingestion worker to populate R2,
  not by the UI.

Client requests go to `PROXY_BASE = 'https://api.redmap.dev'` (`web/index.html:1355`) —
a **different origin** from the page, which matters for CORS (see F6).

### The intended proxy design, and what is actually deployed

`docs/architecture.md` describes a two-tier proxy: Pages Functions at `/api/*` inspect
`request.cf.colo`, serve TLV users directly, and 303-redirect everyone else to `/api2/*`,
handled by a Worker pinned to `region = "azure:israelcentral"`. The rationale is well
documented and evidently hard-won — a table of five failed placement strategies, plus the
discovery that **cron triggers ignore placement entirely**, which is why ingestion calls a
proxy on a *different* Cloudflare account (same-account Worker-to-Worker fetch returns
Cloudflare error 1042).

That design is sound. It is also **not what the live alert path does any more**. See C2.

### State machine

`locationStates[name] = { state, since }` is the single source of truth, mutated through
`setLocationState` (`web/index.html:709`). Priority is `red 4 > brown 3 > purple 2 >
yellow 1 > green 0`; a lower-priority alert cannot overwrite a higher one, and green
overrides anything. Greens fade over `GREEN_FADE_MS` then the location is removed.

Alerts are classified by **title text**, because category numbers are reused for different
meanings across the two APIs. `classifyTitle` (`web/index.html:2839`) is the chokepoint.
Three parallel paths call it: live (`:3881`), history (`:4132`), and day-history/timeline
(`:4291`).

Two extra mechanisms exist that the docs do not mention: `loadCachedAlerts`
(`web/index.html:2874`) restores active alerts from `localStorage` on load, and a sweep at
`web/index.html:866` auto-expires stale alerts.

---

## Part 2 — Findings

Ordered by how badly each one could mislead someone during an attack.

### C1. A stale all-clear erases a live alert — the map turns green mid-attack

`web/index.html:714-726`

In `setLocationState`, the priority and timestamp logic sits entirely inside
`if (state !== 'green')`. When the incoming state **is** green, every guard is skipped and
the assignment at `:727` runs unconditionally. **Green has no recency check at all.**

This is reachable on a normal polling cycle, not a rare race:

1. 14:00:05 — live poll delivers a rocket alert. Location goes red.
2. 14:00:10 — history poll returns the last hour, which still ends at ~14:00:00 and
   therefore does *not* include the new red, but *does* include an all-clear from 13:58.
3. `processHistoryEntries` (`:4174`) replays it. `setLocationState(loc, 'green', 13:58)`
   overwrites the active red.
4. Because `since` is 13:58, `elapsed` already exceeds `GREEN_FADE_MS`, so the fade sweep
   at `:878` **removes the polygon entirely**.

The location shows all-clear, then blank, while a live rocket alert is active. It self-heals
on the next history poll that includes the new alert — a window of ~10s, repeating.

Compounding it: `processedHistoryKeys` (`:4127`) is declared and **never used anywhere** —
verified, it appears exactly once in the file. There is no dedup, so the full hour of
history including every old green is replayed every 10 seconds forever.

Fix: require `effectiveSince >= existing.since` before letting green win, and honour the
declared dedup set.

### C2. The geo-block mitigation is bypassed on both live endpoints

`functions/api/alerts.js:1`, `functions/api/history.js:1`

Both files `import { orefProxy } from './_proxy.js'` — and **never call it**. Each fetches
`oref.org.il` directly from whatever colo happens to serve the request. The colo check, the
TLV branch, the 303 to `/api2/*`, the placement-pinned Worker — none of it is in the path
for live alerts or history. `alarms-history.js:4` is the only remaining caller, and per
`docs/architecture.md:45` that endpoint is ingestion-only.

So a user routed through FRA or ZRH gets Oref's 403 on every poll — the exact failure the
architecture was built to prevent. What that 403 then looks like is C3.

The comment style in these two files ("The magic Cloudflare object", "The ultimate
cache-killing header combo") differs sharply from the rest of the codebase, and
`alerts.js:4` is a placeholder comment `// ... preflight OPTIONS handling ...` where real
code should be. This looks like a hand-edit that replaced a working `orefProxy` call.

### C3. Failures are laundered into "no alerts" at two independent layers

`functions/api/history.js:40-48` and `web/index.html:1372-1383`

Server side: the `catch` returns `"[]"` with **status 200** and a JSON content-type. The
comment says "Graceful fail: Return empty array so the frontend doesn't crash."

Client side: `apiFetch` is worse, because it does this for *every* endpoint —

```js
if (!resp.ok) return createEmptyResponse();   // any 4xx/5xx -> 200 "[]"
...
.catch(function(err) { return createEmptyResponse(); });  // network error -> 200 "[]"
```

A 403 geo-block, a 500, a DNS failure, and a genuinely quiet sky are **indistinguishable**
to every downstream consumer. And `fetchHistory` then actively asserts health on that
fabricated payload (`:4198-4203`):

```js
historyErrors = 0;
initialized = true;      // "🚨 BRUTE-FORCE UI WAKE-UP"
updateLiveStatus();
```

The status indicator shows connected and green, the map is empty, and nothing is wrong as
far as the user can tell. For a system whose stated first principle is that missing events
destroy trust, this is the most consequential design defect in the repo. The `catch` at
`:4237` that increments `historyErrors` and shows a Hebrew error toast is effectively dead
for transport failures, because `apiFetch` already swallowed them.

### C4. The history endpoint URL is missing a path segment

`functions/api/history.js:17`

Code fetches:

```
https://www.oref.org.il/WarningMessages/History/AlertsHistory.json
```

All three docs independently specify:

```
https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json
```

(`docs/architecture.md:32`, `docs/oref-sources.md:14`, `CLAUDE.md:111`). The `alert/`
segment is absent from the code. Case differences are harmless on IIS; a missing path
segment is not.

If this 404s, the history feed is dead — which means **all-clears never arrive**, since the
live API is explicitly unreliable for them. Every alert would then linger until the C6
auto-expiry timer fabricates a green. The 404 would be invisible thanks to C3.

I could not confirm this against the live host: outbound network from this sandbox is
restricted to an allowlist. **Please verify this URL first** — it is a one-line fix with
disproportionate impact, and the fact that C6 exists at all makes me suspect all-clears
have been arriving unreliably for some time.

### C5. `classifyTitle` contradicts its own specification in six ways

`web/index.html:2839-2872`. CLAUDE.md documents the intended behaviour precisely; the
implementation departs from it in both directions. In severity order:

**(a) `'עדכון'` ("update") is treated as an all-clear.** `:2844` puts it in `greenTerms`.
It is not in the spec, and it is not an all-clear — it is a generic prefix. Any title
containing it, e.g. an "update: rocket fire" message, classifies as **green**. This
inverts an active threat into a safe state on a substring match.

**(b) Category numbers are used for classification**, `:2850-2853`:

```js
if (catStr === '14' || catStr === '11') return 'yellow';
if (catStr === '2') return 'purple';
if (catStr === '3') return 'brown';
```

CLAUDE.md and `docs/architecture.md` both state, emphatically, that `cat`/`category` must
never drive classification because the same number means different things across the two
APIs. This block runs **before** the text checks, so it wins. `cat` is passed from both the
live path (`:3881`) and the history path (`:4132`, as `entry.cat || entry.category`) — the
two feeds whose numbering disagrees. A red rocket alert carrying `cat=14` renders yellow.

**(c) Real all-clears fall through to red.** The spec says match the substring `הסתיים`;
the code requires `האירוע הסתיים` (`:2844`). Consequences:

| Title | Spec | Actual |
|---|---|---|
| `אירוע חדירת מחבלים הסתיים` | green | **brown** — matches `חדירת מחבלים` at `:2856` |
| `השוהים במרחב המוגן יכולים לצאת...` | green | **red** (default) |
| `תושבי האזורים הבאים אינם צריכים לשהות יותר...` | green | **red** — `לשהות בסמיכות` is not contiguous here |
| `סיום שהייה בסמיכות למרחב המוגן` | green | **red** |

An all-clear for a terrorist infiltration displays as an *active* terrorist infiltration.
The spec explicitly notes the green check must run first so `<threat> - האירוע הסתיים`
stays green; with the narrower literal, the variant phrasings miss it.

**(d) The `להישאר בקרבתו` exclusion is missing.** `ניתן לצאת מהמרחב המוגן אך יש להישאר
בקרבתו` — "you may leave but stay near it" — is specified yellow. `ניתן לצאת` matches at
`:2844` and returns green. A partial stand-down reads as fully safe.

**(e) A shelter-entry command is downgraded to yellow.** `בזמן ההתגוננות העומד לרשותכם` is
in `yellowTerms` (`:2864`), but the spec classifies `יש להיכנס למרחב מוגן בזמן ההתגוננות...`
as inherit-or-red. This turns "enter the shelter now" into a mild advisory.

**(f) Inherit-state is not implemented.** `היכנסו למרחב המוגן` and variants should preserve
an existing red/purple/brown. They fall through to `return 'red'` (`:2871`), so a drone
alert (purple) followed by a shelter command flips to red. Fails safe on severity, but
misreports threat type.

### C6. Stale alerts are converted into fabricated all-clears

`web/index.html:866-875`

An alert older than 30 minutes (or 6 hours for purple/brown) is not cleared — it is
rewritten to `'green'` with `since = now`, painting a green "event ended" polygon Oref
never sent. A timeout is being rendered as positive confirmation of safety.

The same 30-minute / 6-hour rule in `loadCachedAlerts` (`:2882`) republishes alerts from
`localStorage` on page load. Reopening the tab can resurrect a drone alert up to **six
hours** old as currently active, and if the all-clear arrived while the tab was closed —
or if history is broken per C3/C4 — nothing corrects it.

Clearing to normal is defensible. Asserting green is not.

### H1. Terrorist alerts vanish from timeline reconstruction

`web/index.html:4369`

```js
var PRIORITY = { red: 3, purple: 2, yellow: 1, green: 0 };   // no brown
```

Three other tables in the same file (`:712`, `:4442`, `:4954`) all include `brown: 3`.
Here it is absent, so `PRIORITY['brown'] || 0` evaluates to `0` — tied with green. In
`reconstructStateAt`, a brown alert arriving at a location already yellow satisfies neither
`e.state === existing.state` nor `0 > 1`, so **it is silently discarded**. Scrubbing the
timeline over a terrorist-infiltration event can show nothing happened.

### H2. Untitled history entries are dropped

`web/index.html:4129`

```js
if (!entry || !entry.data || !entry.title) return;
```

`processLiveAlert` deliberately handles missing titles — `:3859` comments "Drones often
omit it" and reconstructs from `cat` or `desc`. The history path has no such fallback and
discards the entry outright. Same pattern at `:4288` for day-history
(`if (!e.data || !e.category_desc) continue`). Any alert Oref publishes without a title is
absent from history, the timeline, and page-load state reconstruction — a straight
violation of the no-gaps rule, in the one feed that is supposed to be authoritative.

### H3. Day-history JSONL conversion has no validation

`functions/api/day-history.js:27`

```js
const json = '[' + text.trimEnd().slice(0, -1) + ']';
```

Correct for well-formed input, and an empty object correctly yields `[]`. But a truncated
final line, a producer that omits the trailing comma, or a leading BOM all produce
malformed JSON returned as **200 `application/json`**. The client's `resp.json()` throws
into a `.catch` (`:4352`) that logs and sets `dayHistoryReady = true` — an entire day
disappears from the timeline while the UI reports success.

### H4. The unknown-title monitor never runs

`functions/api/_proxy.js:66, 208-210`

`checkAndNotifyUnknownTitles` is called only from `fetchOrefDirect`, which `orefProxy`
reaches only when `debugapi === 'oref-direct'`. On the normal path the function returns a
303 first. Combined with C2 — where the live endpoints don't call `orefProxy` at all — the
Pushover alerting for new Oref titles is dead. Given C5, unrecognised titles default to red
silently, so drift accumulates unobserved.

Related: `isKnownTitle` (`_proxy.js:72-110`) claims to mirror `classifyTitle` and does not,
in both directions. It knows all-clears that `classifyTitle` renders red, and lacks titles
`classifyTitle` handles.

### M1. Both proxy pools point at the same host

`functions/api/_proxy.js:7, 15`

`NON_TLV_PROXY_HOSTS[0]` and `TLV_PROXY_HOSTS[0]` are both
`https://oref-proxy.xanagis.workers.dev`. The comment at `:12-13` describes two isolated
pools; there is one host. Also, the TLV branch (`:224-236`) issues a 303 rather than
serving directly, contradicting `docs/architecture.md:65` and adding a round trip to a 1s
poll for Israeli users.

### M2. The 303 drops the query string

`functions/api/_proxy.js:218, 227, 235`

`redirectSuffix` is a bare path, so `?date=`, `?debugapi=`, and the `?_=` cache-buster are
lost across the redirect. The target is also a different origin, and the 303 carries no
`Access-Control-Allow-Origin`.

### M3. CORS is inconsistent and points at a retired origin

`day-history.js` sets no CORS headers at all, yet is fetched cross-origin from
`api.redmap.dev` (`web/index.html:4257`). `analytics.js:11,26,35` and
`analytics-daily.js:6,12` hardcode `https://oref-map.org`, which no longer matches the
deployed origin. Separately `analytics.js:3` exports only `onRequestGet` while the client
POSTs to it (`web/index.html:5304`, `:5461`) — that is a 405.

### M4. Cache key defeats the cache it populates

`functions/api/_proxy.js:39, 55` — the key includes the client's `?_=<timestamp>`, so
`cache.match` can never hit. Write-only, 0% hit rate. Debug path only, given C2.

### M5. `cache.put` on an off-zone URL disables notifications

`functions/api/_proxy.js:177` builds a key against `https://oref-map.org/_internal/...`
while the project deploys to `redmap.dev`. Cloudflare rejects `cache.put` outside the
worker's zone, and the `try` at `:182` wraps only the Pushover fetch, so the rejection
aborts the loop before notifying. Inside `waitUntil`, so it cannot break responses.

### M6. Doc/config drift

- `GREEN_FADE_MS` is 120000 (`web/index.html:1396`); README and `docs/architecture.md` both
  say 60 seconds.
- `docs/architecture.md:53` claims Functions and page share an origin so CORS is
  unnecessary. They do not — `PROXY_BASE` is `api.redmap.dev`.
- `CLAUDE.md` documents `worker/`, `ingestion/`, `web/cities_geo.json`, and
  `docs/map-requirements.md`, none of which exist here; it omits `ellipses-server/`,
  `web/ellipse-mode.js`, `web/sw.js`, `docs/driving-mode.md`, and `functions/api/analytics*`.
- The PMTiles snippet in `CLAUDE.md` extracts `20260409.pmtiles` but the prose says replace
  `20260404`; both are ~4 months stale.
- The alert-title table is marked "as of March 2026" and is due for re-verification —
  especially given C5.

---

## Part 3 — Overlay modes (`f-` gated, optional)

Reviewed via subagent; the structural claims below were spot-verified, the numeric ones
were reported as measured in Node and are marked accordingly.

**Good news first, and it is the part that matters most:** neither overlay mutates
`AppState.featureMap` or `locationStates`, neither writes to the shared `alerts-source`,
and both correctly reuse canonical `locationStates[name].state === 'red'` rather than
re-implementing title matching. There are no stray intervals or leaked listeners. Failure
isolation from the base map is broadly intact.

- **O1 — `web/prediction-mode.js:190-205` (verified).** `clusterByAdjacency` is O(n²·V²)
  with no bounding-box pre-filter and no early rejection; non-adjacent pairs run the full
  nested vertex loop. It runs synchronously on `app:stateChanged`, i.e. off the 1s poll,
  with no render-key check. A 400-location salvo with 40-vertex polygons is ~10⁸ operations
  per update on the main thread — stalling repaint and click handling precisely during a
  mass-casualty event. `web/ellipse-mode.js:832-873` has the same shape but a bbox fast
  path and per-pair cache, so it is milder.
- **O2 — `web/ellipse-mode.js:760-762` (verified).** `polygonTouchCache` is written `false`
  when `featureMap` is empty and is never invalidated. Since `app:ready` fires before
  polygons load, and `loadCachedAlerts` can supply red alerts immediately, pairs can be
  poisoned as non-adjacent for the page's lifetime — clusters over-fragment below the
  20-location threshold and the overlay renders nothing.
- **O3 — `web/ellipse-mode.js:1844-1851` (verified).** Unlike `prediction-mode.js:455-459`,
  the `map.once('load')` handler does not re-sync, while `lastRenderKey` is assigned during
  the discarded first draw — so the overlay stays missing until the alert set changes.
- **O4 — reported, not independently re-derived.** The alg-C service returns real
  kilometres, but `web/ellipse-mode.js:1918-1948` treats them as Web Mercator units,
  drawing the ellipse ~15% small (measured 30.98 km against an intended 36.6 km), and
  reconstructs the rotation axis in mixed spaces, skewing `angle_deg` by up to ~5°.
  Similarly `web/prediction-mode.js:282-330` computes a bearing in raw degree space and
  feeds it to a true great-circle destination; the reported bucket flip (52° → 56.3°,
  changing line length 4.5×) is worth confirming.
- **O5 — `web/ellipse-mode.js:1826-1836`.** Double-tapping a red ellipse POSTs the live
  cluster list off-origin and then calls `fitBounds`, yanking the camera during an attack.
  Double-tap is an ordinary mobile zoom gesture.
- **O6 — the two overlays disagree on adjacency.** `ellipse-mode.js:274` uses ~1.1 mm
  exact-vertex matching; `prediction-mode.js:189` uses ~500 m. Same input, different
  clusters.
- **O7 — no divergence in the shared algorithm.** `buildEllipseGeometry` in
  `web/ellipse-mode.js:457-527` and `tools/lib/ellipse-algorithms.js:664-745` are
  algorithmically identical with identical constants. The library clamps latitude to
  ±85.0511 and the browser copy does not.

`web/sw.js` is sound: `/api/` and `/api2/` are excluded so alert data is never served from
cache, non-GET passes through, network-first with cache fallback. Minor: `CACHE_NAME` is
pinned at `oref-map-v1` and never bumped, so the activate-time purge never removes
anything; `caches.match` lacks `{ignoreSearch: true}`, so an offline load of `/?f-log`
misses the cached shell.

---

## Suggested order of work

1. **C4** — verify the history URL against the live host. One line, and if it is wrong,
   nothing else in the all-clear path can work.
2. **C2** — restore the `orefProxy` calls in `alerts.js` and `history.js`.
3. **C3** — stop synthesising `200 "[]"`. Let `apiFetch` reject, and make the status
   indicator reflect transport failure. This is what makes every other failure visible.
4. **C1** — add the recency guard on green; wire up `processedHistoryKeys`.
5. **C5** — rewrite `classifyTitle` from the CLAUDE.md table: drop `עדכון`, delete the
   `cat` block, widen to the `הסתיים` substring, add the `להישאר בקרבתו` exclusion. Worth
   a table-driven test fixture covering every documented title.
6. **C6, H1, H2** — fabricated greens, the missing `brown`, and dropped untitled entries.

Items 1–4 are all in the "user cannot tell the system is broken" class, which for this
product is the most dangerous class there is.

Then reconcile `CLAUDE.md` with the tree, or split it: the doc currently describes a
superset repo, and a reader would reasonably assume `worker/` and `ingestion/` are here.

---

## What was changed (2026-08-08)

Applied in this order, each verified before moving on. Backups of every touched file are in
`.review-backup-2026-08-08/`.

### Pages Functions

`alerts.js`, `history.js`, `alarms-history.js` were rewritten to actually call `orefProxy`,
which restores the colo check and the `/api2/` fallback for non-TLV users (**C2**). Each now
also exports `onRequestOptions` for CORS preflight.

`orefProxy` now serves TLV traffic directly via `fetchOrefDirect` instead of 303-ing it to a
Worker, which is what `docs/architecture.md` always described and removes a round trip from a
1s poll (**M1**). Non-TLV still redirects. The 303 `Location` now carries the caller's query
string (**M2**), and every response — including redirects and errors — carries CORS headers,
since the client calls these from `api.redmap.dev` while the page is on `redmap.dev`.

The fabricated `200 "[]"` in `history.js`'s catch is gone (**C3**). Upstream status is
propagated honestly, with `X-Upstream-Status` exposed for debugging.

The history URL now tries the documented path first and falls back to the previous one only
on a 404 (**C4**). **This still needs verifying against the live host** — I could not reach
`oref.org.il` from this sandbox. If the documented path is right, delete the fallback.

Edge-cache keys now strip `_` and `debugapi`, so `cache.match` can hit rather than being a
write-only path (**M4**). `Cache-Control` on success is `s-maxage=1, max-age=0` — the edge
cache still collapses simultaneous polls, but the browser no longer holds a live alert for 2s
against a 1s poll.

The unknown-title dedup key is built from the request's own origin rather than a hardcoded
`oref-map.org`, and the `cache.put` is wrapped so a rejection cannot abort the notification
loop (**M5**). `isKnownTitle` was rewritten from the same table as the client classifier, and
the two now agree (**H4**).

`day-history.js` validates the JSONL-to-JSON conversion and falls back to a line-by-line parse
that salvages intact entries instead of returning malformed JSON as 200 (**H3**). Tested
against six inputs: empty, well-formed, missing trailing comma, BOM prefix, truncated final
line, garbage line mid-file — all six now yield valid JSON. An R2 failure returns 502 rather
than being indistinguishable from a quiet day. CORS headers added.

`analytics.js` gained `onRequestPost` (the client POSTs to it and was getting 405) and both
analytics endpoints now send `Access-Control-Allow-Origin: *` instead of the retired
`oref-map.org` (**M3**). `locations_polygons.json.js` guards its `fetch` so a network throw
returns 502 rather than an opaque 500.

### Client (`web/index.html`)

**C1, the most serious one.** `setLocationState` now requires an all-clear to be newer than
the state it replaces. Previously every guard sat inside `if (state !== 'green')`, so a
stale green from the 10s history replay would overwrite a live red from the 1s poll — and
because its `since` was already older than `GREEN_FADE_MS`, the polygon was then removed
outright. Verified with a seven-case simulation: the stale-green race now holds red, a
genuine newer all-clear still turns green, and every priority rule is unchanged.

`processedHistoryKeys` — declared but never referenced — is now wired up, so the ~1 hour of
history returned every 10s is applied once per distinct event instead of ~360 times. Bounded
at 20k keys.

`apiFetch` no longer manufactures a `200 "[]"` from a failed or errored response (**C3**). It
rejects, and the existing error handlers in `fetchLiveAlerts`/`fetchHistory` — previously
unreachable for transport failures — now actually fire. The "BRUTE-FORCE UI WAKE-UP" block
that asserted `initialized = true` on that fabricated payload now runs only on a real
response.

`classifyTitle` was rewritten from the CLAUDE.md table (**C5**). `'עדכון'` is out of the green
list; the `cat`-based branch is deleted, restoring the documented invariant that
classification is by title text only; green matches the `הסתיים` substring so
`אירוע חדירת מחבלים הסתיים` is green rather than an active brown alert;
`ניתן לצאת ... אך יש להישאר בקרבתו` is yellow. Generic shelter commands now return a new
`'inherit'` state that `resolveInheritedState()` resolves against the location's current
red/purple/brown, defaulting to red. Unknown titles still default to red, now warning once per
distinct title instead of on every poll. **Tested 24/24 against every title in the CLAUDE.md
table**, plus inherit resolution and four regression cases for the specific old bugs.

The expiry sweep no longer paints stale alerts green (**C6**) — it clears them. A local
timeout is not an Oref all-clear, and asserting one is worse than showing nothing.
`removeLocation` now also clears the `localStorage` entry, so a cleared alert cannot be
restored as active on the next page load. A dead duplicate `loadCachedAlerts` declaration
(shadowed by a later one) was removed.

The timeline replay's PRIORITY table regained `brown` (**H1**) — without it
`PRIORITY['brown']` fell back to `0`, tying with green, so terrorist-infiltration alerts were
silently dropped during reconstruction whenever another state was already active.

`processHistoryEntry` no longer discards entries that lack a title (**H2**); it reconstructs
one the same way the live path already did. Same for the day-history path.

### Ellipse overlay and service worker

`polygonTouchCache` no longer writes `false` when `featureMap` is empty (**O2**). Because
`app:ready` fires before polygons load, an early pass could permanently mark every pair
non-adjacent, over-fragmenting clusters below the 20-location threshold so the overlay
rendered nothing at all.

The `map.once('load')` handler now re-syncs when enabled (**O3**), so the first draw — whose
features are dropped because the source does not exist yet, while `lastRenderKey` is recorded
anyway — no longer leaves the overlay blank until the alert set changes.

The alg-C ellipse now uses the server's degree-space axes and converts degrees directly to
Web Mercator units (**O4**, ellipse half). It previously treated real kilometres as Mercator
units, drawing ~15% small at Israeli latitudes. The rotation math was left alone: offsetting
in degree space and projecting both endpoints is correct, because `angle_deg` is defined in
degree space and Mercator stretches latitude.

`fitBounds` after an alg-C request is now opt-in rather than opt-out (**O5**), so an
accidental double-tap — an ordinary mobile zoom gesture — no longer yanks the camera during
an active alert.

`sw.js`: cache name bumped to `v2` so the activate-time purge does something, `cache.put`
given a `.catch`, and `caches.match` given `{ignoreSearch: true}` so an offline load of
`/?f-log` matches the cached shell.

### Not done

Prediction mode is untouched, as requested: the O(n²·V²) synchronous clustering (**O1**) and
the degree-space bearing (**O4**, prediction half) are both still there.

Also left alone deliberately: the two overlays still disagree on what "adjacent" means
(**O6** — ~1.1 mm vertex matching versus ~500 m), since reconciling them changes clustering
output and wants a decision about which definition is correct. The **M6** documentation drift
is reported but not rewritten.

### Verification performed

Every modified file passes `node --check`, including all four inline `<script>` blocks in
`index.html` extracted and checked separately. The classifier was extracted and run against
the full documented title table (24/24) with inherit resolution (5/5) and four old-bug
regressions. `setLocationState` was extracted and run through seven state-transition
scenarios (7/7). `jsonlToArray` was run against six malformed-input cases (6/6).

Not verified, and worth doing before deploy: no browser run, no live Oref call (sandbox
egress is allowlisted), and the history URL question in **C4** is still open.
