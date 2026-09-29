#!/usr/bin/env python3
"""Summarise a streaming Perfetto trace from run-night.sh: CPU time per thread of the app process
(JS thread vs UI/main thread vs RenderThread vs inference), and frame slices (Choreographer#doFrame on
the main thread, DrawFrame on RenderThread). Needs `pip install perfetto` (downloads trace_processor).
usage: perfetto-stream.py <trace.pftrace> [package]"""
import sys
from perfetto.trace_processor import TraceProcessor

trace = sys.argv[1]
pkg = sys.argv[2] if len(sys.argv) > 2 else "team.sopa.aoair.offline"
tp = TraceProcessor(trace=trace)

span = tp.query("select (max(ts + dur) - min(ts)) / 1e9 as s from sched where dur > 0")
win = float(next(iter(span)).s)
print(f"trace window ~{win:.2f} s, package {pkg}\n")

threads = tp.query(f"""
  select thread.name as thread, thread.tid as tid, (thread.tid = process.pid) as is_main,
         sum(sched.dur) / 1e6 as cpu_ms, count(*) as slices
  from sched join thread using (utid) join process using (upid)
  where process.name like '{pkg}%' and sched.dur > 0
  group by utid order by cpu_ms desc limit 15""")
print("| thread | tid | main | CPU ms | % of window (1 core) |")
print("|---|---|---|---|---|")
for r in threads:
    print(f"| {r.thread} | {r.tid} | {'yes' if r.is_main else ''} | {r.cpu_ms:.0f} | {100 * r.cpu_ms / (win * 1000):.0f}% |")

frames = tp.query(f"""
  select case when slice.name like 'Choreographer#doFrame%' then 'Choreographer#doFrame' when slice.name like 'DrawFrame%' then 'DrawFrame' else slice.name end as name, count(*) as n, avg(slice.dur) / 1e6 as avg_ms,
         max(slice.dur) / 1e6 as max_ms, sum(slice.dur > 16.67e6) as over16, sum(slice.dur > 33.3e6) as over33
  from slice join thread_track on slice.track_id = thread_track.id join thread using (utid) join process using (upid)
  where process.name like '{pkg}%' and (slice.name = 'Choreographer#doFrame' or slice.name like 'Choreographer#doFrame %'
        or slice.name = 'DrawFrame' or slice.name like 'DrawFrames%' or slice.name = 'traversal' or slice.name = 'measure' or slice.name = 'layout')
  group by 1 order by n desc""")
print("\n| slice | n | avg ms | max ms | > 16.7 ms | > 33.3 ms |")
print("|---|---|---|---|---|---|")
for r in frames:
    print(f"| {r.name} | {r.n} | {r.avg_ms:.1f} | {r.max_ms:.1f} | {r.over16} | {r.over33} |")
tp.close()
