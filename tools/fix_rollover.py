#!/usr/bin/env python3
"""Shift GPS-week-rollover dates in logged CSV files 1024 weeks forward.

    python3 tools/fix_rollover.py <file.csv|dir> [-o outdir]

Rows dated before 2019-04-06 get +7168 days; the file is rewritten under its
corrected date (20070126.csv -> 20260911.csv). Files are never modified in place.
"""
import argparse
import csv
import datetime
import pathlib
import sys

ROLLOVER = datetime.timedelta(weeks=1024)
EPOCH = datetime.datetime(2019, 4, 6)


def fix_file(path, outdir):
    rows = list(csv.DictReader(open(path, newline="")))
    if not rows:
        print(f"{path.name}: empty, skipped")
        return
    fields = list(rows[0])
    shifted = 0
    for row in rows:
        t = datetime.datetime.strptime(row["utc"], "%Y-%m-%dT%H:%M:%SZ")
        if t < EPOCH:
            row["utc"] = (t + ROLLOVER).strftime("%Y-%m-%dT%H:%M:%SZ")
            shifted += 1
    if not shifted:
        print(f"{path.name}: no rollover dates, skipped")
        return

    by_day = {}
    for row in rows:
        by_day.setdefault(row["utc"][:10].replace("-", ""), []).append(row)
    for day, dayRows in by_day.items():
        out = outdir / f"{day}.csv"
        with open(out, "w", newline="") as f:
            writer = csv.DictWriter(f, fields)
            writer.writeheader()
            writer.writerows(dayRows)
        print(f"{path.name}: {len(dayRows)} rows -> {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="CSV file or directory of CSV files")
    ap.add_argument("-o", "--outdir", default="fixed", help="output directory (default: ./fixed)")
    args = ap.parse_args()

    target = pathlib.Path(args.target)
    files = sorted(target.glob("*.csv")) if target.is_dir() else [target]
    if not files:
        sys.exit(f"no CSV files in {target}")
    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for path in files:
        fix_file(path, outdir)


main()
