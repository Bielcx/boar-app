#!/usr/bin/env bash
# Boot timing on the simulator, measured from a screen recording, for the
# splash decision (Iris/Loom). React Native Release builds drop console.info,
# so the App.tsx "[boot] js-start / hide after=ms" lines never reach the log;
# the video gives the user-visible times instead:
#   splash_ms  = first splash frame -> first app-content frame
#   launch_ms  = launch command     -> first app-content frame
#
#   scripts/ios-boot-timing.sh <device-udid> <BOAR.app> [runs]   # default 3 cold + 3 warm
#
# cold = first launch right after a fresh install (no caches, the app opens on
# setup); warm = the process is terminated and launched again (caches warm).
# Both go through the splash. Reinstalls the app: run it last. Output: one line
# per run plus the medians, also appended to $IOS_BOOT_OUT if set. With a build
# made with IOS_RN_LOG_INFO=1, the app's "[boot] ..." console lines of each run
# are appended to $IOS_BOOT_LINES; IOS_BOOT_WAIT (s, default 5) sets how long
# each launch is recorded.
set -euo pipefail
DEV="${1:?simulator udid}"; APP="${2:?path to the .app}"; RUNS="${3:-3}"
BUNDLE=team.sopa.aoair
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

run() {  # run <cold|warm> <n>
  local kind=$1 n=$2 mp4="$TMP/$1-$2.mp4"
  xcrun simctl terminate "$DEV" "$BUNDLE" 2>/dev/null || true
  if [[ "$kind" == cold ]]; then
    xcrun simctl uninstall "$DEV" "$BUNDLE" 2>/dev/null || true
    xcrun simctl install "$DEV" "$APP"
  fi
  sleep 2
  # JS console lines (needs a build with IOS_RN_LOG_INFO=1 for console.info):
  # every "[boot]" line of this launch goes to $IOS_BOOT_LINES as "<kind> <n> <line>".
  xcrun simctl spawn "$DEV" log stream --style compact --level info \
    --predicate 'eventMessage CONTAINS "[boot]"' > "$TMP/$kind-$n.log" 2>/dev/null & local lg=$!
  xcrun simctl io "$DEV" recordVideo --codec h264 --force "$mp4" >/dev/null 2>&1 & local rec=$!
  sleep 1.5
  local t_launch; t_launch=$(python3 -c 'import time; print(time.time())')
  xcrun simctl launch "$DEV" "$BUNDLE" >/dev/null
  sleep "${IOS_BOOT_WAIT:-5}"; kill -INT "$rec"; wait "$rec" 2>/dev/null || true
  kill "$lg" 2>/dev/null || true
  grep -o '\[boot\].*' "$TMP/$kind-$n.log" | sed "s/^/$kind $n /" >> "${IOS_BOOT_LINES:-/dev/null}" || true
  # The recording's first frame is ~when recordVideo started; its start time is
  # taken from the file's creation (ffprobe) relative to the launch timestamp.
  python3 - "$mp4" "$t_launch" "$kind" "$n" <<'EOF'
import subprocess, sys, json, os
mp4, t_launch, kind, n = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
fps = 30
raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", mp4, "-vf", f"fps={fps},scale=131:284",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
W, H = 131, 284; n_frames = len(raw) // (W * H * 3)
px = lambda f, x, y: tuple(raw[(f * W * H + y * W + x) * 3:(f * W * H + y * W + x) * 3 + 3])
acc = lambda c: c[0] > 220 and 90 < c[1] < 160 and c[2] < 110
dark_edges = lambda f: all(max(px(f, x, y)) < 60 for x, y in [(1, H // 3), (W - 2, H // 3), (1, 2 * H // 3), (W - 2, 2 * H // 3)])
accent = lambda f: any(acc(px(f, x, y)) for y in list(range(int(H * .04), int(H * .08))) + list(range(int(H * .85), int(H * .95))) for x in range(0, W, 2))
# splash = full-screen dark frame without the setup/chat accent; content = accent shows up.
first_splash = next((f for f in range(n_frames) if dark_edges(f) and not accent(f)), None)
content = None if first_splash is None else next((f for f in range(first_splash, n_frames) if accent(f)), None)
start = os.path.getmtime(mp4) - n_frames / fps  # approx wall time of frame 0
ms = lambda i: None if i is None else round((i / fps) * 1000)
launch_ms = None if content is None else round((start + content / fps - t_launch) * 1000)
splash_ms = None if first_splash is None or content is None else ms(content - first_splash)
print(json.dumps({"kind": kind, "run": int(n), "splash_ms": splash_ms, "launch_ms": launch_ms}))
EOF
}

{
  for i in $(seq 1 "$RUNS"); do run cold "$i"; done
  for i in $(seq 1 "$RUNS"); do run warm "$i"; done
} | tee "$TMP/runs.jsonl"
python3 - "$TMP/runs.jsonl" <<'EOF' | tee -a "${IOS_BOOT_OUT:-/dev/null}"
import json, sys, statistics
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
for kind in ("cold", "warm"):
    for key in ("splash_ms", "launch_ms"):
        v = [r[key] for r in rows if r["kind"] == kind and r[key] is not None]
        print(f"{kind} {key}: median {statistics.median(v) if v else 'n/a'} ms  runs {v}")
EOF
