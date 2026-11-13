"""Draw the app icons (pwa/icons/*.png): ivory hair strands and a gold coin on deep blue-green."""
import math, os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', 'pwa', 'icons')
IVORY, GOLD, GOLD_EDGE, GOLD_LINE = (247, 242, 230), (214, 188, 124), (160, 124, 51), (201, 170, 104)


def bezier(p0, p1, p2, p3, n=80):
    pts = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        pts.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return pts


def stroke(d, pts, w, fill):
    d.line(pts, fill=fill, width=w, joint='curve')
    r = w / 2
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def icon(size, maskable=False):
    S = size * 4; im = Image.new('RGB', (S, S)); px = im.load()
    for y in range(S):          # soft light from the upper left
        for x in range(0, S):
            t = min(1.0, math.hypot(x - S * 0.32, y - S * 0.26) / (S * 0.95))
            px[x, y] = (round(22 - 14 * t), round(118 - 62 * t), round(113 - 58 * t))
    d = ImageDraw.Draw(im)
    k = 0.78 if maskable else 1.0          # a maskable icon keeps everything inside the safe zone
    def P(x, y): return (S / 2 + (x - 0.5) * S * k, S / 2 + (y - 0.5) * S * k)
    if not maskable:
        m = S * 0.055; d.rounded_rectangle((m, m, S - m, S - m), radius=S * 0.17, outline=GOLD_LINE, width=max(2, round(S * 0.008)))
    w = round(S * 0.026 * k)
    stroke(d, bezier(P(0.44, 0.22), P(0.10, 0.26), P(0.20, 0.72), P(0.50, 0.64)), w, IVORY)
    stroke(d, bezier(P(0.50, 0.64), P(0.66, 0.60), P(0.60, 0.34), P(0.44, 0.36)), w, IVORY)
    stroke(d, bezier(P(0.47, 0.30), P(0.78, 0.30), P(0.78, 0.66), P(0.44, 0.82)), w, IVORY)
    stroke(d, bezier(P(0.36, 0.44), P(0.44, 0.56), P(0.62, 0.48), P(0.70, 0.40)), round(w * 0.8), IVORY)
    cx, cy = P(0.74, 0.74); r = S * 0.098 * k
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=GOLD, outline=GOLD_EDGE, width=max(2, round(S * 0.012 * k)))
    d.ellipse((cx - r * 0.62, cy - r * 0.62, cx + r * 0.62, cy + r * 0.62), outline=GOLD_EDGE, width=max(1, round(S * 0.005 * k)))
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    icon(192).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    icon(512).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    icon(512, True).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    print('icons written')
