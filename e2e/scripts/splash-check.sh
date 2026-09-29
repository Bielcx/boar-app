#!/usr/bin/env bash
# Android 12+ splash check: record a cold start, extract frames, measure the splash icon box per frame.
# Looks for: background #17110D, icon centered, no seam, no jump when the BootSplash replaces the system splash.
# usage: splash-check.sh <outdir> <tag>
set -uo pipefail
A=$HOME/Library/Android/sdk/platform-tools/adb; PKG=${PKG:-team.sopa.aoair}; O=$1; tag=$2; mkdir -p $O/frames-$tag
$A shell am force-stop $PKG; sleep 3
$A shell "screenrecord --time-limit 7 --bit-rate 8000000 /sdcard/splash.mp4" & rec=$!; sleep 1.5
$A shell am start -n $PKG/.MainActivity >/dev/null; wait $rec
$A pull -q /sdcard/splash.mp4 $O/splash-cold_$tag.mp4; $A shell rm /sdcard/splash.mp4
ffmpeg -loglevel error -y -i $O/splash-cold_$tag.mp4 -vf fps=20 $O/frames-$tag/f%03d.png
python3 - "$O/frames-$tag" <<'P'
import sys,glob
from PIL import Image
BG=(0x17,0x11,0x0D)
def near(c,t,tol=12): return all(abs(a-b)<=tol for a,b in zip(c,t))
prev=None
for f in sorted(glob.glob(sys.argv[1]+"/f*.png")):
    im=Image.open(f).convert("RGB"); w,h=im.size; px=im.load()
    corner=px[20,h//2]
    # bounding box of non-background pixels in the middle band (ignores status/nav bars)
    xs=[];ys=[]
    for y in range(int(h*0.15),int(h*0.85),4):
        for x in range(0,w,4):
            if not near(px[x,y],corner,18): xs.append(x); ys.append(y)
    box=(min(xs),min(ys),max(xs),max(ys)) if xs else None
    cx=cy=None
    if box: cx=(box[0]+box[2])//2; cy=(box[1]+box[3])//2
    tag="bg=#%02X%02X%02X"%corner + (" (Fogueira)" if near(corner,BG,6) else "")
    jump=""
    if prev and box and prev[0]:
        d=max(abs(cx-prev[1]),abs(cy-prev[2]),abs((box[2]-box[0])-(prev[0][2]-prev[0][0])))
        if d>6: jump=f"  <-- change {d}px"
    print(f"{f.split('/')[-1]} {tag} box={box} center={(cx,cy)}{jump}")
    prev=(box,cx,cy)
P
