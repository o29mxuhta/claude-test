# pmtiles_slim (DRAFT: local tooling, not used by the site, not yet reviewed)

Builds a smaller copy of `middle-east.pmtiles` by dropping features that no
style layer in the app's final MapLibre style draws. Appearance must be pixel
identical; features are dropped, never changed.

Pipeline (pure Python 3 stdlib, run inside this directory):
1. `python3 dl.py` - download the source archive (18 range reads) to `full-orig.pmtiles`.
2. Dump the REAL final style layers from the running page for every theme
   (`oref-theme` = dark and light in localStorage, NOT prefers-color-scheme) and language,
   union them into `layers.json` (keys: id, type, sl = source-layer, filter, minzoom, maxzoom).
   `node dump_style_layers.mjs <pageUrl> layers.json` (Node >= 22 + Chrome) does this and fails if the theme was not applied. Verified 2026-11-02: re-running it against the dev page reproduced the committed layers.json exactly (72 layers). Dark has 71 protomaps layers, light has 72
   (extra `landcover` fill), so both themes MUST be dumped.
3. `python3 full.py` - rewrite every tile with `slim.py` rules, rebuild directories, keep
   header fields and metadata JSON byte-identical (only offsets/counts change).
4. `python3 verify.py` - integrity: all tiles parse, kept features are byte-identical subsets
   in original order, layer tables identical, directory/IDs/runs identical.
Review fixes (after Sourcery review of the first version): a blob shared by tiles at different zooms is slimmed per
zoom; the zoom check evaluates every style zoom bound in the tile's display range (`slim.MAP_MAX_ZOOM`, currently 12, must
match the site map's maxZoom); `int_value` is read as signed; `==`, `!=` and `in` are type-strict like MapLibre; fixed-width unknown
protobuf fields are copied and unknown wire types stop the build (never a truncated tile); `pm.py` reads the remote header
only on first use; `dl.py` records the ETag and fails if it changes mid-download; gzip uses mtime=0 so rebuilds are byte-identical.
Tests: `python3 -m unittest discover -s tests -v` (no network).
Fail-open: boundaries are always kept; any filter operator the evaluator does not
support keeps the feature (`ana.ev` raises, `slim.keepfeat` catches).

Dependencies on the current style: map maxZoom 12 (tiles z10 are overzoomed to 12), the
layer list in `layers.json`, and the kinds those layers match. Regenerate after ANY style,
theme, flavor, maxZoom or layer change, then re-run pixel diffs (dark and light, several
views) before use.
Result at 2026-11-02: 75,316,759 B -> 55,735,690 B (-26%); local emulated 4G load -1.3 to -2.2 s.

## Source, license and transform (factual notes, not legal advice)
- Input: `middle-east.pmtiles`, a Protomaps basemap extract ("Protomaps Basemap v4.14.4", built with planetiler 0.10.1). Its metadata carries the attribution string "(c) OpenStreetMap". Per https://docs.protomaps.com/basemaps/downloads the basemap is built from OpenStreetMap data (ODbL, https://www.openstreetmap.org/copyright) plus Natural Earth (public domain, https://www.naturalearthdata.com/about/terms-of-use/).
- Transform: this tool only removes whole features that no style layer draws and rewrites the tile directories. It does not edit, merge or add any feature. Header fields and the metadata JSON (including the attribution string) are kept byte-identical; `verify.py` checks that kept features are byte-identical subsets in the original order.
- The output is still a derived copy of the source data. Keep the metadata as is and review the OSM/ODbL attribution requirements (https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) for wherever the map is shown. This README makes no licence conclusion.
