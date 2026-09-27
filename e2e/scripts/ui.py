#!/usr/bin/env python3
"""adb-only UI helper (no Maestri portal).
  ui.py dump                       -> list visible labels with centers
  ui.py tap <regex> [--nth N]      -> tap element whose text/content-desc matches
  ui.py wait <regex> [timeout_s]   -> wait until it is on screen; prints seconds
  ui.py gone <regex> [timeout_s]   -> wait until it disappears
  ui.py has <regex>                -> exit 0 if present
"""
import os, re, subprocess, sys, time
ADB = os.environ.get("ADB", os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"))

def dump():
    for _ in range(3):
        try:
            out = subprocess.run([ADB, "exec-out", "uiautomator", "dump", "/dev/tty"],
                                 capture_output=True, text=True, timeout=20).stdout
        except subprocess.TimeoutExpired:
            continue
        if "<hierarchy" in out:
            return out
        time.sleep(1)
    return ""

NODE = re.compile(r'<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')

def nodes(xml):
    for m in NODE.finditer(xml):
        t, d, x1, y1, x2, y2 = m.groups()
        label = (t or d).replace("&#10;", " ").replace("&amp;", "&").replace("&quot;", '"').replace("&apos;", "'")
        if label:
            yield label, (int(x1) + int(x2)) // 2, (int(y1) + int(y2)) // 2

def find(rx, nth=0):
    r = re.compile(rx, re.I)
    hits = [n for n in nodes(dump()) if r.search(n[0])]
    return hits[nth] if len(hits) > nth else None

cmd = sys.argv[1]
if cmd == "dump":
    for l, x, y in nodes(dump()): print(f"{x:5d},{y:5d}  {l[:110]}")
elif cmd == "tap":
    nth = int(sys.argv[sys.argv.index("--nth") + 1]) if "--nth" in sys.argv else 0
    h = find(sys.argv[2], nth)
    if not h: print(f"not found: {sys.argv[2]}", file=sys.stderr); sys.exit(1)
    subprocess.run([ADB, "shell", "input", "tap", str(h[1]), str(h[2])]); print(f"tapped {h[0][:60]!r} @ {h[1]},{h[2]}")
elif cmd in ("wait", "gone"):
    lim = float(sys.argv[3]) if len(sys.argv) > 3 else 600; t0 = time.time()
    while True:
        present = find(sys.argv[2]) is not None
        if present == (cmd == "wait"): print(f"{time.time()-t0:.1f}"); sys.exit(0)
        if time.time() - t0 > lim: print(f"timeout {cmd} {sys.argv[2]}", file=sys.stderr); sys.exit(1)
        time.sleep(1.5)
elif cmd == "has":
    sys.exit(0 if find(sys.argv[2]) else 1)
