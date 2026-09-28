"""
Generate UI art for the system:
- assets/ui/paper.webp       tileable memo-paper texture
- assets/ui/paper-dark.webp  tileable dark folder texture
- assets/ui/seal.svg         Laundry seal (hexagram in warding circle)
- assets/ui/stamp-classified.svg
"""
import os, random
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "system", "assets", "ui")
os.makedirs(OUT, exist_ok=True)
random.seed(7)


def noise_tile(size, base, spread, fibres, path):
    img = Image.new("RGB", (size, size), base)
    px = img.load()
    for y in range(size):
        for x in range(size):
            n = random.randint(-spread, spread)
            r, g, b = base
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n - 2)))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    # faint fibres
    from PIL import ImageDraw
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(fibres):
        x, y = random.randint(0, size), random.randint(0, size)
        l = random.randint(6, 22)
        dx, dy = random.choice([(1, 0), (0, 1), (1, 1), (1, -1)])
        c = random.randint(0, 40)
        d.line([(x, y), (x + dx * l, y + dy * l)], fill=(c, c, c, 18), width=1)
    img.save(path, "WEBP", quality=88)


noise_tile(256, (239, 231, 206), 6, 140, os.path.join(OUT, "paper.webp"))
noise_tile(256, (38, 46, 41), 5, 90, os.path.join(OUT, "paper-dark.webp"))

import math
def hexagram(cx, cy, r):
    pts = [(cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a))) for a in range(0, 360, 60)]
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in pts[0::2]), " ".join(f"{x:.1f},{y:.1f}" for x, y in pts[1::2]), pts

t1, t2, pts = hexagram(100, 100, 46)
seal = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<defs><path id="c" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>
<circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" stroke-width="5"/>
<circle cx="100" cy="100" r="64" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="100" cy="100" r="58" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4"/>
<text font-family="Special Elite, Courier New, monospace" font-size="17" letter-spacing="3" fill="currentColor">
<textPath href="#c" startOffset="2%">CAPITAL LAUNDRY SERVICES · Q DIVISION · SOE ·</textPath></text>
<polygon points="{t1}" fill="none" stroke="currentColor" stroke-width="3"/>
<polygon points="{t2}" fill="none" stroke="currentColor" stroke-width="3"/>
{''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="currentColor"/>' for x, y in pts)}
<circle cx="100" cy="100" r="9" fill="currentColor"/>
</svg>'''
open(os.path.join(OUT, "seal.svg"), "w", encoding="utf8").write(seal)

stamp = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 90">
<g transform="rotate(-4 160 45)" fill="none" stroke="#9b1c1c" stroke-width="5" opacity="0.85">
<rect x="10" y="12" width="300" height="66" rx="6"/>
<rect x="18" y="20" width="284" height="50" rx="3" stroke-width="2"/>
<text x="160" y="58" text-anchor="middle" font-family="Special Elite, Courier New, monospace" font-size="34" letter-spacing="6" fill="#9b1c1c" stroke="none">CLASSIFIED</text>
</g></svg>'''
open(os.path.join(OUT, "stamp-classified.svg"), "w", encoding="utf8").write(stamp)
print("ui assets done")
