#!/usr/bin/env python3
"""Collect a run-night.sh output dir (copied to the MacBook): prints -> shots/final-v11/<sha>/android/<name>_<sha>.png
(font 1.0 drops the _font100 tag), perf/results.tsv -> markdown table (mean of the reps) on stdout.
usage: night-collect.py <night-dir> <sha> [shots-root]"""
import csv, re, shutil, statistics, sys
from pathlib import Path

night, sha = Path(sys.argv[1]), sys.argv[2]
root = Path(sys.argv[3] if len(sys.argv) > 3 else "/Users/r4to/Script/boar/shots/final-v11")
dst = root / sha / "android"; dst.mkdir(parents=True, exist_ok=True)
(dst / "extra").mkdir(exist_ok=True)
copied = []
for png in sorted(list(night.glob("*/*.png")) + list(night.glob("*/maestro/**/takeScreenshot/*.png"))):
    if not re.match(r"\d\d-", png.name):
        continue  # perf-*, fail.png, final.png stay in the raw dir
    name = png.stem.replace("_font100", "")
    main = re.fullmatch(r"\d\d-[a-z0-9-]+_android_(en|pt)(_font(130|200))?", name)
    out = (dst if main else dst / "extra") / f"{name}_{sha}.png"
    shutil.copy2(png, out); copied.append(out.relative_to(dst))
for f in ("device.txt",):
    if (night / f).exists():
        shutil.copy2(night / f, dst / f)
print(f"copied {len(copied)} PNG to {dst}", file=sys.stderr)
for c in copied:
    print(f"  {c}", file=sys.stderr)

tsv = night / "perf" / "results.tsv"
if not tsv.exists():
    sys.exit("no perf/results.tsv")
rows = list(csv.DictReader(tsv.open(), delimiter="\t"))
by = {}
for r in rows:
    by.setdefault(r["scenario"], []).append(r)

def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def agg(rs, k):
    v = [num(r[k]) for r in rs if num(r[k]) is not None]
    if not v:
        return "UNKNOWN"
    m = statistics.mean(v)
    return f"{m:.1f}" + (f" ({min(v):g}–{max(v):g})" if len(v) > 1 else "")

print("| cenário | build | travados % | p50 ms | p90 ms | p99 ms | frames | s | n |")
print("|---|---|---|---|---|---|---|---|---|")
for sc, rs in by.items():
    print(f"| {sc} | {sha} | {agg(rs,'janky_pct')} | {agg(rs,'p50')} | {agg(rs,'p90')} | {agg(rs,'p99')} | {agg(rs,'frames')} | {agg(rs,'seconds')} | {len(rs)} |")
print()
print("Por repetição:")
print()
print("| cenário | rep | frames | travados % | legacy % | p50 | p90 | p95 | p99 | s | nota |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for r in rows:
    print(f"| {r['scenario']} | {r['rep']} | {r['frames']} | {r['janky_pct']} | {r['legacy_janky_pct']} | {r['p50']} | {r['p90']} | {r['p95']} | {r['p99']} | {r['seconds']} | {r['note']} |")

# streaming answer length: longest text/content-desc in the end-of-stream UI dump; tokens ~ words * 1.33 (EN)
print()
for x in sorted((night / "perf").glob("streaming-*-end.xml")):
    t = x.read_text(errors="ignore")
    texts = [re.sub(r"&#10;|&amp;|&quot;", " ", m) for m in re.findall(r' text="([^"]+)"', t)]
    longest = " ".join(texts)  # every visible text node (the answer is split into one node per block)
    w = len(longest.split())
    cites = len(set(re.findall(r"\[\d+\]", longest)))
    listed = len(re.findall(r"(?:^|\s)\d+\.\s", longest))
    print(f"- {x.stem}: ~{w} palavras (~{round(w*1.33)} tokens), {listed} itens numerados, {cites} citações [n] distintas; todo texto visível na tela ao fim (inclui a pergunta e rótulos; a resposta pode passar da tela)")
