#!/usr/bin/env python3
"""Compare run-night perf/results.tsv across builds: one markdown row per scenario with janky % / p90 / p99 / n
per build (reps with 0 frames are dropped: nothing rendered, e.g. an answer held back), plus the streaming frame
totals. usage: gfx-compare.py <label>=<night-dir> [<label>=<night-dir> ...]"""
import csv, statistics, sys
from pathlib import Path

runs = []
for arg in sys.argv[1:]:
    label, d = arg.split("=", 1)
    rows = list(csv.DictReader((Path(d) / "perf" / "results.tsv").open(), delimiter="\t"))
    runs.append((label, rows))

def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def cell(rows, sc):
    rs = [r for r in rows if r["scenario"] == sc and (f(r["frames"]) or 0) > 0]
    if not rs:
        return "—"
    m = lambda k: statistics.mean(f(r[k]) for r in rs)
    return f"{m('janky_pct'):.1f}% · {m('p90'):.0f} · {m('p99'):.0f} · n={len(rs)}"

scenarios = []
for _, rows in runs:
    for r in rows:
        if r["scenario"] not in scenarios:
            scenarios.append(r["scenario"])
print("| cenário | " + " | ".join(f"{l} (travados · p90 · p99 · n)" for l, _ in runs) + " |")
print("|---|" + "---|" * len(runs))
for sc in scenarios:
    print(f"| {sc} | " + " | ".join(cell(rows, sc) for _, rows in runs) + " |")

print("\n| build | frames por rep (streaming) | janela s | frames/s | total frames | total s |")
print("|---|---|---|---|---|---|")
for l, rows in runs:
    rs = [r for r in rows if r["scenario"] == "streaming"]
    fr = [int(r["frames"]) for r in rs]; se = [float(r["seconds"]) for r in rs]
    fps = [a / b for a, b in zip(fr, se) if b]
    print(f"| {l} | {' / '.join(map(str, fr))} | {' / '.join(f'{x:g}' for x in se)} | {' / '.join(f'{x:.1f}' for x in fps)} | **{sum(fr)}** | {sum(se):g} |")
