"""
Generate The Laundry custom d6 faces.

- system/assets/dice/face-N.svg   : chat faces (paper card + ink), crisp at any size
- system/assets/dice/dsn/label-N.png : transparent labels for Dice So Nice
- system/assets/dice/dsn/bump-N.png  : bump maps for Dice So Nice

Theme: Laundry memo paper, green ledger ink. 1 = eldritch eye with tentacles (red,
mishap risk). 6 = six pips set as a Dho-Na summoning hexagram inside a warding circle.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), "..", "system", "assets", "dice")
DSN = os.path.join(ROOT, "dsn")
os.makedirs(DSN, exist_ok=True)

INK = "#1d3b2a"
RED = "#9b1c1c"
PAPER = "#efe6cc"
EDGE = "#b8a97c"

PIPS = {
    2: [(30, 30), (70, 70)],
    3: [(28, 28), (50, 50), (72, 72)],
    4: [(30, 30), (70, 30), (30, 70), (70, 70)],
    5: [(28, 28), (72, 28), (50, 50), (28, 72), (72, 72)],
}


def hexagram_points(cx=50, cy=50, r=27):
    return [(cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a))) for a in range(0, 360, 60)]


def tentacle_path(x0, y0, angle, length, amp, waves=1.25, steps=32):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        d = t * length
        off = amp * math.sin(t * waves * 2 * math.pi) * (1 - t * 0.6)
        ca, sa = math.cos(angle), math.sin(angle)
        pts.append((x0 + ca * d - sa * off, y0 + sa * d + ca * off))
    return pts


TENTACLES = [
    (50, 66, math.radians(100), 26, 4),
    (40, 63, math.radians(125), 24, 4),
    (60, 63, math.radians(55), 24, 4),
    (33, 58, math.radians(150), 20, 3),
    (67, 58, math.radians(30), 20, 3),
]


# ---------------------------------------------------------------- SVG (chat)

def svg_face(n):
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
        f'<rect x="3" y="3" width="94" height="94" rx="16" fill="{PAPER}" stroke="{EDGE}" stroke-width="3"/>',
        f'<rect x="9" y="9" width="82" height="82" rx="11" fill="none" stroke="{INK}" stroke-opacity="0.15" stroke-width="1.5" stroke-dasharray="3 3"/>',
    ]
    if n == 1:
        for x0, y0, a, ln, amp in TENTACLES:
            pts = tentacle_path(x0, y0, a, ln, amp)
            d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
            parts.append(f'<path d="{d}" fill="none" stroke="{RED}" stroke-width="4.5" stroke-linecap="round"/>')
        parts += [
            f'<ellipse cx="50" cy="44" rx="27" ry="16" fill="{PAPER}" stroke="{RED}" stroke-width="4.5"/>',
            f'<circle cx="50" cy="44" r="11" fill="{RED}"/>',
            f'<ellipse cx="50" cy="44" rx="2.8" ry="9" fill="{PAPER}"/>',
        ]
    elif n == 6:
        pts = hexagram_points()
        tri1 = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts[0::2])
        tri2 = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts[1::2])
        parts += [
            f'<circle cx="50" cy="50" r="38" fill="none" stroke="{INK}" stroke-width="2.5"/>',
            f'<circle cx="50" cy="50" r="34" fill="none" stroke="{INK}" stroke-width="1" stroke-dasharray="2 2.5"/>',
            f'<polygon points="{tri1}" fill="none" stroke="{INK}" stroke-width="2"/>',
            f'<polygon points="{tri2}" fill="none" stroke="{INK}" stroke-width="2"/>',
        ]
        for x, y in pts:
            parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7.5" fill="{INK}"/>')
    else:
        for x, y in PIPS[n]:
            parts.append(f'<circle cx="{x}" cy="{y}" r="9" fill="{INK}"/>')
    parts.append("</svg>")
    return "\n".join(parts)


# ---------------------------------------------------------------- PNG (Dice So Nice)

S = 256            # output size
K = 4              # supersampling


def sc(v):
    return v * S * K / 100


def draw_symbol(draw, n, color, red, clear=(0, 0, 0, 0)):
    w = lambda x: max(1, int(sc(x)))
    if n == 1:
        for x0, y0, a, ln, amp in TENTACLES:
            pts = [(sc(x), sc(y)) for x, y in tentacle_path(x0, y0, a, ln, amp)]
            draw.line(pts, fill=red, width=w(5), joint="curve")
            r = sc(2.4)
            draw.ellipse([pts[-1][0] - r, pts[-1][1] - r, pts[-1][0] + r, pts[-1][1] + r], fill=red)
        draw.ellipse([sc(23), sc(28), sc(77), sc(60)], outline=red, width=w(5))
        draw.ellipse([sc(39), sc(33), sc(61), sc(55)], fill=red)
        draw.ellipse([sc(47.2), sc(35), sc(52.8), sc(53)], fill=clear)
    elif n == 6:
        draw.ellipse([sc(12), sc(12), sc(88), sc(88)], outline=color, width=w(3))
        pts = [(sc(x), sc(y)) for x, y in hexagram_points()]
        draw.polygon(pts[0::2], outline=color, width=w(2.2))
        draw.polygon(pts[1::2], outline=color, width=w(2.2))
        for x, y in pts:
            r = sc(8)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)
    else:
        for x, y in PIPS[n]:
            r = sc(10)
            draw.ellipse([sc(x) - r, sc(y) - r, sc(x) + r, sc(y) + r], fill=color)


def png_label(n, path, color, red):
    img = Image.new("RGBA", (S * K, S * K), (0, 0, 0, 0))
    draw_symbol(ImageDraw.Draw(img), n, color, red)
    img = img.resize((S, S), Image.LANCZOS)
    img.save(path)


def png_bump(n, path):
    img = Image.new("L", (S * K, S * K), 0)
    d = ImageDraw.Draw(img)
    draw_symbol(d, n, 255, 255, clear=0)
    img = img.resize((S, S), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    Image.merge("RGBA", (img, img, img, Image.new("L", (S, S), 255))).save(path)


def main():
    for n in range(1, 7):
        with open(os.path.join(ROOT, f"face-{n}.svg"), "w", encoding="utf8") as f:
            f.write(svg_face(n))
        png_label(n, os.path.join(DSN, f"label-{n}.png"), (29, 59, 42, 255), (155, 28, 28, 255))
        png_label(n, os.path.join(DSN, f"label-light-{n}.png"), (239, 230, 204, 255), (230, 70, 60, 255))
        png_bump(n, os.path.join(DSN, f"bump-{n}.png"))
    print("dice generated in", os.path.abspath(ROOT))


if __name__ == "__main__":
    main()
