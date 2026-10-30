#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp"]
# ///
"""
Backfill R2 day-history from Yuval Harpaz's alarms.csv dump.

Source: https://github.com/yuval-harpaz/alarms/blob/master/data/alarms.csv
(columns: time,cities,threat,id,description,origin,rid; covers 2019-06
through the dump's last update, Israel-local times).

NOTE: the repo has no explicit reuse license. Verify redistribution rights
before uploading derived files to the bucket. See docs/r2-history-migration.md.

Known source-data issues handled here:
- Canonical polygon names containing ", " were split into fragments
  ("שדרות, איבים" -> rows "שדרות" and "איבים"); reversed via FRAGMENT map.
- Some multi-zone names were truncated at inner commas
  ("אשדוד -יא,יב,טו,יז,מרינה,סיט" for "...סיטי"); fixed via OVERRIDES.
- Dash/space spelling variants ("בת-ים" vs "בת ים"); normalized.
- Geresh/gershayim vs ASCII apostrophes ("ניר ח''ן"); normalized to the
  ASCII form the canonical polygon names and the client both use.
- rid is empty for older events and is per-ALERT (shared by all cities of
  one event), not per-city; dedupe therefore uses (data, minute, desc).
- The dump has NO all-clear ("האירוע הסתיים") entries and misses some
  warning categories (e.g. "איום מלבנון - התקרבו למרחב מוגן"). Backfilled
  days will show alerts without their resolution markers. Never fabricate
  all-clears; merge with oref-API-derived files where both exist instead.

Rows whose city still does not resolve to a canonical polygon name are kept
with their original name (the timeline skips unresolvable locations, but the
archive stays honest) and listed in the run report. Use --drop-unmapped to
exclude them from the output instead.

Usage:
    uv run tools/backfill_from_csv.py                     # 2023-01-01..2026-02-27, dry-run
    uv run tools/backfill_from_csv.py --yes               # write files + upload script
    uv run tools/backfill_from_csv.py --merge             # also merge into days that exist remotely
    uv run tools/backfill_from_csv.py --csv path.csv --from-date 2019-06-13 --to-date 2026-02-27
"""

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import aiohttp

CSV_URL = "https://raw.githubusercontent.com/yuval-harpaz/alarms/master/data/alarms.csv"
CANONICAL_PATH = Path("web/oref_points.json")
REMOTE_DAY_URL = "{base}/api/day-history?date={d}"
OUT_DIR = Path("tmp/r2_csv_backfill")
BUCKET = "oref-history"

# First day covered by the existing oref-API-derived archive (2026-02-28).
# Default range fills everything from 2023 up to (not including) that day.
DEFAULT_FROM = "2023-01-01"
DEFAULT_TO = "2026-02-27"
ARCHIVE_START = "2026-02-28"

# Hand-verified renames/truncations that no rule catches. Every value must be
# a canonical polygon name.
OVERRIDES = {
    "אשדוד - אזור תעשייה צפוני ונ": "אשדוד - איזור תעשייה צפוני",  # truncated + אזור/איזור spelling
    "אשדוד -יא,יב,טו,יז,מרינה,סיט": "אשדוד -יא,יב,טו,יז,מרינה,סיטי",  # truncated final letter
    "אשדוד - יא": "אשדוד -יא,יב,טו,יז,מרינה,סיטי",  # comma-split fragment
    "אשדוד סיטי": "אשדוד -יא,יב,טו,יז,מרינה,סיטי",
    "מרינה": "אשדוד -יא,יב,טו,יז,מרינה,סיטי",  # comma-split fragment
    "קריית ארבע": "קרית ארבע",  # קריית/קרית spelling
}

# Rows that are not locations at all: dropped with a note in the report.
NON_LOCATION = {"ברחבי הארץ", "בחלק מהאזורים בארץ"}


def r2_date_key(alert_date: str) -> str:
    """Map alert time to R2 file date key. 23:xx → next day.
    Mirrors tools/backfill_history.py and ingestion/src/index.js."""
    d = date.fromisoformat(alert_date[:10])
    if int(alert_date[11:13]) >= 23:
        d += timedelta(days=1)
    return d.isoformat()


def to_ascii_apostrophes(name: str) -> str:
    """Normalize geresh/gershayim to ASCII apostrophes. The canonical polygon
    names (web/oref_points.json) use ASCII, and the client's normalizeName()
    folds everything to this form too."""
    return name.replace("״", "''").replace("׳", "'")


def build_fragment_map(names: set[str]) -> dict[str, str]:
    """{fragment → canonical} for canonical names containing ", " or ",".
    Fragments shorter than 2 letters or mapping to more than one canonical
    name are skipped (left for OVERRIDES / the unmapped report)."""
    frag_to_canonicals: dict[str, set[str]] = defaultdict(set)
    for k in names:
        if "," in k:
            for frag in [p.strip() for p in k.split(",")]:
                if len(frag) >= 2 and frag not in names:
                    frag_to_canonicals[frag].add(k)
    return {f: next(iter(cs)) for f, cs in frag_to_canonicals.items() if len(cs) == 1}


def build_prefix_map(names: set[str]) -> callable:
    def resolve(c: str) -> str | None:
        cands = [k for k in names if k.startswith(c) and (len(k) == len(c) or k[len(c)] in ", ")]
        return cands[0] if len(cands) == 1 else None
    return resolve


def make_resolver(names: set[str]):
    frag_map = build_fragment_map(names)
    prefix_resolve = build_prefix_map(names)

    def resolve(raw: str) -> str | None:
        c = to_ascii_apostrophes(raw.strip())
        if c in names:
            return c
        if c in OVERRIDES:
            return OVERRIDES[c]
        if c in frag_map:
            return frag_map[c]
        for variant in (c.replace("-", " "), c.replace(" ", "-")):
            if variant in names:
                return variant
        for variant in (c.replace(" ו", ", "), c.replace(" ", ", ")):
            if variant in names:
                return variant
        return prefix_resolve(c)

    return resolve


async def fetch_remote_day(session, base: str, d: str) -> list[dict] | None:
    """Existing day entries, or None when the day does not exist remotely."""
    url = REMOTE_DAY_URL.format(base=base, d=d)
    async with session.get(url, headers={"User-Agent": "redmap-backfill/1.0"}) as resp:
        if resp.status == 404:
            return None
        resp.raise_for_status()
        return await resp.json(content_type=None)


def entry_key_minute(e: dict) -> tuple:
    return (e["data"], e["alertDate"][:16], e["category_desc"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default="tmp/alarms.csv", help="Path to alarms.csv (downloaded if missing)")
    ap.add_argument("--from-date", default=DEFAULT_FROM)
    ap.add_argument("--to-date", default=DEFAULT_TO)
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--remote-base", default="https://redmap.me", help="Base URL for existing day-history")
    ap.add_argument("--merge", action="store_true", help="Merge into days that already exist remotely")
    ap.add_argument("--drop-unmapped", action="store_true", help="Drop unresolvable cities instead of keeping raw names")
    ap.add_argument("--yes", action="store_true", help="Write output files (default is dry-run)")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"Downloading {CSV_URL} -> {csv_path}")
        import urllib.request
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(CSV_URL, csv_path)

    names = set(json.loads(CANONICAL_PATH.read_text(encoding="utf-8")).keys())
    resolve = make_resolver(names)

    import csv as csv_mod
    from_date, to_date = args.from_date, args.to_date
    by_bucket: dict[str, list[dict]] = defaultdict(list)
    seen: dict[str, set[tuple]] = defaultdict(set)
    unmapped: dict[str, int] = defaultdict(int)
    dropped_non_location = 0
    remapped = 0
    skipped_out_of_range = 0

    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv_mod.DictReader(f):
            raw_city = row["cities"]
            if raw_city in NON_LOCATION:
                dropped_non_location += 1
                continue
            bucket = r2_date_key(row["time"])
            if bucket < from_date or bucket > to_date:
                skipped_out_of_range += 1
                continue

            resolved = resolve(raw_city)
            if resolved is None:
                unmapped[raw_city] += 1
                if args.drop_unmapped:
                    continue
                resolved = to_ascii_apostrophes(raw_city.strip())
            elif resolved != raw_city:
                remapped += 1

            alert_date = row["time"].replace(" ", "T")
            key = (resolved, alert_date, row["description"])
            if key in seen[bucket]:
                continue
            seen[bucket].add(key)

            rid_raw = (row.get("rid") or "").strip()
            by_bucket[bucket].append({
                "data": resolved,
                "alertDate": alert_date,
                "category_desc": row["description"],
                "rid": int(rid_raw) if rid_raw.isdigit() else 0,
            })

    print(f"CSV: in-range {sum(len(v) for v in by_bucket.values())} entries "
          f"across {len(by_bucket)} days, {remapped} remapped, "
          f"{skipped_out_of_range} out of range, {dropped_non_location} non-location dropped")
    if unmapped:
        total = sum(unmapped.values())
        print(f"UNMAPPED cities: {len(unmapped)} names / {total} rows "
              f"({'dropped' if args.drop_unmapped else 'kept with raw names'}):")
        for c, n in sorted(unmapped.items(), key=lambda x: -x[1])[:30]:
            print(f"  {n:6d}  {c}")
        if len(unmapped) > 30:
            print(f"  ... and {len(unmapped) - 30} more")

    if not args.yes:
        print("\nDry run. Re-run with --yes to write files and the upload script.")
        return 0

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    async def write_all():
        written, merged_days, skipped_existing = 0, 0, 0
        async with aiohttp.ClientSession() as session:
            for d in sorted(by_bucket):
                entries = sorted(by_bucket[d], key=lambda e: e["alertDate"])
                # Days before the known archive start cannot exist remotely;
                # skip the HTTP check for them.
                if d < ARCHIVE_START and not args.merge:
                    remote = None
                else:
                    remote = await fetch_remote_day(session, args.remote_base, d)
                if remote is not None and not args.merge:
                    skipped_existing += 1
                    continue
                if remote:
                    existing_keys = {entry_key_minute(e) for e in remote}
                    new_entries = [e for e in entries if entry_key_minute(e) not in existing_keys]
                    combined = remote + new_entries
                    combined.sort(key=lambda e: e["alertDate"])
                    entries = combined
                    merged_days += 1
                    print(f"{d}: merged {len(new_entries)} new into {len(remote)} existing")
                text = "".join(json.dumps(e, ensure_ascii=False) + ",\n" for e in entries)
                (out_dir / f"{d}.jsonl").write_text(text, encoding="utf-8")
                written += 1
        return written, merged_days, skipped_existing

    written, merged_days, skipped_existing = asyncio.run(write_all())

    # The client gates its date picker on meta/history-range.json, so the
    # import only becomes browsable once this object is uploaded too.
    earliest = min(by_bucket)
    range_file = out_dir / "history-range.json"
    range_file.write_text(json.dumps({"minDate": earliest}) + "\n", encoding="utf-8")

    lines = [
        "#!/bin/sh",
        "# Upload the backfilled day files to R2. Requires wrangler auth to the",
        "# account that owns the oref-history bucket. Review the files first.",
        "# The last line publishes the new earliest date to the date picker -",
        "# run it only after the day files are verified in the bucket.",
        "# Usage: sh tmp/r2_csv_backfill/upload.sh",
        "set -e",
    ]
    for p in sorted(out_dir.glob("*.jsonl")):
        lines.append(f"npx wrangler r2 object put {BUCKET}/{p.name} --file={p} --remote")
    lines.append(f"npx wrangler r2 object put {BUCKET}/meta/history-range.json --file={range_file} --remote")
    upload_script = out_dir / "upload.sh"
    upload_script.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\nWrote {written} day files to {out_dir}/ "
          f"({merged_days} merged, {skipped_existing} existing days skipped)")
    print(f"Upload script: {upload_script}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
