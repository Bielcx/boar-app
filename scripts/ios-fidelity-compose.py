#!/usr/bin/env python3
"""Mockup | app | 50% overlay for the fidelity sprint (review/ui-qa/FIDELITY.md).

  python3 scripts/ios-fidelity-compose.py <screens_dir> <shots_dir> <out_dir> [label]

For each <name>.png in <shots_dir> that has a mockup <screens_dir>/<name>.png,
writes <out_dir>/<name>_side.png. The mockup PNGs are 818x1784 renders of a
393x852 pt phone at 2 px/pt inside a black bezel; the screen is found from the
bezel and the app shot (393x852 pt @3x from the iPhone 16 simulator) is scaled
to the same 2 px/pt, so a point in one panel is the same point in the other.
A 10 pt grid on the overlay makes the +-4 pt acceptance readable.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

PT = 2  # mockup pixels per point
W_PT, H_PT = 393, 852
PAD, TOP = 24, 56
BG, INK = "#E8DFD2", "#17110D"


def mockup_screen(im: Image.Image) -> Image.Image:
    """Crop the 393x852 pt screen out of the bezel-framed mockup."""
    im = im.convert("RGB")
    w, h = im.size
    dark = lambda c: max(c) < 12
    x = w // 2
    # Bottom bezel: first dark row scanning up from the bottom edge that ends the screen.
    y = h - 1
    while y > h // 2 and dark(im.getpixel((x, y))):
        y -= 1
    bottom = y + 1  # first bezel row below the screen
    left = 0
    while left < w // 4 and dark(im.getpixel((left, h // 2))):
        left += 1
    top = bottom - H_PT * PT
    return im.crop((left, top, left + W_PT * PT, bottom))


def grid(img: Image.Image) -> Image.Image:
    g = img.copy()
    d = ImageDraw.Draw(g)
    for p in range(0, W_PT + 1, 10):
        d.line([(p * PT, 0), (p * PT, g.height)], fill=(255, 255, 255) if p % 50 == 0 else (90, 90, 90), width=1)
    for p in range(0, H_PT + 1, 10):
        d.line([(0, p * PT), (g.width, p * PT)], fill=(255, 255, 255) if p % 50 == 0 else (90, 90, 90), width=1)
    return Image.blend(img, g, 0.25)


def compose(mock: Path, shot: Path, out: Path, label: str) -> None:
    m = mockup_screen(Image.open(mock))
    a = Image.open(shot).convert("RGB").resize((W_PT * PT, H_PT * PT), Image.LANCZOS)
    o = grid(Image.blend(m, a, 0.5))
    diff = ImageChops.difference(m, a).convert("L").point(lambda v: 255 if v > 48 else 0)
    changed = 1 - diff.histogram()[0] / (diff.width * diff.height)
    c = Image.new("RGB", (m.width * 3 + PAD * 4, m.height + TOP + PAD), BG)
    for i, (img, cap) in enumerate([(m, "MOCKUP"), (a, "APP (iPhone 16 sim, 393x852)"), (o, "OVERLAY 50% + 10 pt grid")]):
        c.paste(img, (PAD + i * (m.width + PAD), TOP))
        ImageDraw.Draw(c).text((PAD + i * (m.width + PAD), 12), cap, fill=INK)
    ImageDraw.Draw(c).text((PAD, 32), f"{label}  {mock.stem}  pixels differing: {changed:.0%}", fill=INK)
    c.save(out)
    print(f"{out}  diff={changed:.0%}")


def main() -> None:
    screens, shots, out = (Path(p) for p in sys.argv[1:4])
    label = sys.argv[4] if len(sys.argv) > 4 else ""
    out.mkdir(parents=True, exist_ok=True)
    for shot in sorted(shots.glob("*.png")):
        mock = screens / shot.name
        if mock.exists():
            compose(mock, shot, out / f"{shot.stem}_side.png", label)


if __name__ == "__main__":
    main()
