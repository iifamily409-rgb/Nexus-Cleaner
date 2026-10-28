"""Generates the NEXUS Cleaner icon set (PNG sizes + multi-resolution ICO).

The mark: a hexagonal HUD shield with concentric scanner rings and a cyan core,
rendered procedurally so the assets are reproducible from source.
"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'resources')
os.makedirs(OUT, exist_ok=True)

CYAN = (34, 230, 255)
CYAN_DIM = (14, 127, 146)
GREEN = (46, 230, 168)
BG = (5, 7, 11)


def hexagon(cx, cy, r, rot=0.0):
    return [
        (cx + r * math.cos(rot + math.pi / 3 * i), cy + r * math.sin(rot + math.pi / 3 * i))
        for i in range(6)
    ]


def render(size):
    scale = 4
    s = size * scale
    cx = cy = s / 2

    plate = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pad = s * 0.045
    pd.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.22, fill=BG + (255,))

    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - s * 0.36, cy - s * 0.36, cx + s * 0.36, cy + s * 0.36], fill=CYAN_DIM + (120,))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.07))

    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    img = Image.alpha_composite(img, glow)
    mask = Image.new('L', (s, s), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.22, fill=255)
    img.paste(plate, (0, 0), mask)
    img.paste(Image.alpha_composite(img, glow), (0, 0), mask)

    d = ImageDraw.Draw(img)

    outer = hexagon(cx, cy, s * 0.33, rot=math.pi / 6)
    d.line(outer + [outer[0]], fill=CYAN + (235,), width=max(2, int(s * 0.021)), joint='curve')
    inner = hexagon(cx, cy, s * 0.285, rot=math.pi / 6)
    d.line(inner + [inner[0]], fill=CYAN_DIM + (170,), width=max(1, int(s * 0.009)), joint='curve')

    for i, r in enumerate((0.225, 0.17)):
        rr = s * r
        box = [cx - rr, cy - rr, cx + rr, cy + rr]
        start = 18 + i * 40
        d.arc(box, start=start, end=start + 250, fill=(CYAN if i == 0 else GREEN) + (210,), width=max(2, int(s * 0.016)))
        d.arc(box, start=start + 265, end=start + 300, fill=CYAN + (150,), width=max(2, int(s * 0.012)))

    for i in range(12):
        a = math.pi / 6 * i + math.pi / 12
        r1 = s * 0.345
        r2 = s * 0.375 if i % 3 == 0 else s * 0.36
        d.line(
            [(cx + r1 * math.cos(a), cy + r1 * math.sin(a)), (cx + r2 * math.cos(a), cy + r2 * math.sin(a))],
            fill=CYAN + (150 if i % 3 == 0 else 90,),
            width=max(1, int(s * 0.008)),
        )

    wedge = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wedge)
    wd.pieslice([cx - s * 0.24, cy - s * 0.24, cx + s * 0.24, cy + s * 0.24], start=-64, end=-6, fill=CYAN + (58,))
    img = Image.alpha_composite(img, wedge)
    d = ImageDraw.Draw(img)

    core_r = s * 0.082
    d.ellipse([cx - core_r, cy - core_r, cx + core_r, cy + core_r], fill=CYAN + (70,), outline=CYAN + (255,), width=max(2, int(s * 0.012)))
    core_r2 = s * 0.032
    d.ellipse([cx - core_r2, cy - core_r2, cx + core_r2, cy + core_r2], fill=(240, 254, 255, 255))

    d.line(
        [(cx - s * 0.040, cy + s * 0.004), (cx - s * 0.012, cy + s * 0.032), (cx + s * 0.044, cy - s * 0.030)],
        fill=(4, 20, 26, 255),
        width=max(2, int(s * 0.016)),
        joint='curve',
    )

    return img.resize((size, size), Image.LANCZOS)


sizes = [16, 24, 32, 48, 64, 128, 256, 512]
images = {sz: render(sz) for sz in sizes}
for sz, im in images.items():
    im.save(os.path.join(OUT, 'icon-%d.png' % sz))
images[512].save(os.path.join(OUT, 'icon.png'))
images[256].save(os.path.join(OUT, 'icon.ico'), format='ICO', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icons written to', os.path.abspath(OUT))
