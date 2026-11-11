"""Synthetic sink-counter photos: any surface, coin reference, glare that moves between shots, hairs leaving the frame."""
import numpy as np, cv2, json, zlib, os, sys
PX = 10.0                      # world px per mm
WW, WH = 300, 380              # world size in mm
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test', 'free')
SURF = {'white': (232, 228, 225), 'beige': (150, 180, 200), 'dark': (50, 46, 44), 'green': (120, 150, 60)}

def hair_curve(rng, start, L, curl):
    pts = [np.array(start, float)]; ang = rng.uniform(0, 2*np.pi); k = rng.normal(0, curl); s = 0; ds = 0.4
    while s < L:
        k = np.clip(k + rng.normal(0, curl*0.25)*np.sqrt(ds), -1/6, 1/6); ang += k*ds
        pts.append(pts[-1] + ds*np.array([np.cos(ang), np.sin(ang)])); s += ds
    return np.array(pts)

def scene(rng, n, mode, surf, n_out=3, white_frac=0.1):
    img = np.zeros((int(WH*PX), int(WW*PX), 3), np.float32); img[:] = SURF[surf]
    # faint veins / mottling
    tex = cv2.GaussianBlur(rng.normal(0, 1, img.shape[:2]).astype(np.float32), (0, 0), 60)
    img *= (1 + 0.03*tex/tex.std())[..., None]
    coin_c = np.array([62.0, 300.0]); coin_d = 26.5
    hairs = []
    cen = np.array([150.0, 180.0]); rad = {'spread': 85, 'loose': 55, 'clump': 38}[mode]
    tries = 0
    while len(hairs) < n and tries < 50000:
        tries += 1
        out = len(hairs) < n_out
        if out: start = (rng.choice([35.0, 265.0]) + rng.uniform(-3, 3), rng.uniform(80, 250))   # near left/right frame edge
        else:
            a, r = rng.uniform(0, 2*np.pi), rad*np.sqrt(rng.uniform()); start = cen + r*np.array([np.cos(a), np.sin(a)])
        L = rng.uniform(70, 170); c = hair_curve(rng, start, L, rng.uniform(0.02, 0.08))
        if (c[:, 0] < 5).any() or (c[:, 0] > WW-5).any() or (c[:, 1] < 5).any() or (c[:, 1] > WH-5).any(): continue
        if (np.linalg.norm(c - coin_c, axis=1) < coin_d/2 + 6).any(): continue
        inside = (c[:, 0] > 34) & (c[:, 0] < 266) & (c[:, 1] > 34) & (c[:, 1] < 346)
        if out and (inside.all() or inside.sum()*0.4 < 25): continue
        if not out and not ((c[:, 0] > 42) & (c[:, 0] < 258) & (c[:, 1] > 42) & (c[:, 1] < 338)).all(): continue
        hairs.append((c, 1 if rng.uniform() < white_frac else 0, L, float(inside.sum()*0.4)))
    dark = (28, 30, 36); white = (225, 225, 222)
    for c, col, L, _ in hairs:
        cov = np.zeros(img.shape[:2], np.uint8)
        cv2.polylines(cov, [np.round(c*PX*16).astype(np.int32).reshape(-1, 1, 2)], False, 255, 1, cv2.LINE_AA, shift=4)
        a = cov.astype(np.float32)[..., None]/255*0.85
        img = img*(1-a) + np.array(white if col else dark, np.float32)*a
    # coin with soft shadow
    cc = tuple(int(v) for v in (coin_c*PX)); r = int(coin_d/2*PX)
    sh = np.zeros(img.shape[:2], np.float32); cv2.circle(sh, (cc[0]+14, cc[1]+16), r, 1, -1); sh = cv2.GaussianBlur(sh, (0, 0), 12)
    img *= (1 - 0.25*sh)[..., None]
    cv2.circle(img, cc, r, (150, 190, 205), -1, cv2.LINE_AA); cv2.circle(img, cc, r-4, (120, 165, 185), 6, cv2.LINE_AA)
    cv2.circle(img, cc, int(r*0.62), (165, 200, 215), -1, cv2.LINE_AA)
    cv2.rectangle(img, (cc[0]-int(r*0.4), cc[1]-8), (cc[0]+int(r*0.4), cc[1]+8), (110, 150, 170), -1, cv2.LINE_AA)
    return img, hairs, coin_c, coin_d, cen

def shot(world, rng, k, cen, glare=True, ow=3024, oh=4032, noise=2.5):
    # camera sees the central 240x320 mm region; shots 1,2 are tilted left/right and shifted
    x0, y0, x1, y1 = 30*PX, 30*PX, 270*PX, 350*PX
    src = np.float32([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    j = rng.uniform(-0.012, 0.012, (4, 2))*np.array([x1-x0, y1-y0])
    if k == 1: j += np.float32([[0, 0.05], [0, -0.03], [0, 0.03], [0, -0.05]])*np.array([1, y1-y0]) + np.array([18, 10])
    if k == 2: j += np.float32([[0, -0.03], [0, 0.05], [0, -0.05], [0, 0.03]])*np.array([1, y1-y0]) + np.array([-22, -14])
    src = src + j.astype(np.float32)
    dst = np.float32([[0, 0], [ow, 0], [ow, oh], [0, oh]])
    M = cv2.getPerspectiveTransform(src, dst)
    img = cv2.warpPerspective(world, M, (ow, oh), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REFLECT)
    yy, xx = np.mgrid[0:oh, 0:ow].astype(np.float32)
    img *= (0.93 + 0.09*xx/ow)[..., None]
    gpos = None
    if glare:
        off = [(-12, 8), (38, -30), (-45, 42)][k]              # glare sits on the clump in shot 0, elsewhere in 1 and 2
        g = cv2.perspectiveTransform(np.float32([[[(cen[0]+off[0])*PX, (cen[1]+off[1])*PX]]]), M)[0, 0]
        d2 = (xx-g[0])**2 + (yy-g[1])**2
        img += (330*np.exp(-d2/(2*170.0**2)))[..., None]
        gpos = [float(g[0]/ow), float(g[1]/oh)]
    img = cv2.GaussianBlur(img, (0, 0), 0.9); img += rng.normal(0, noise, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8), M, gpos

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    cases = [('w_loose30', 30, 'loose', 'white', 0.0), ('w_clump40', 40, 'clump', 'white', 0.0), ('w_spread20', 20, 'spread', 'white', 0.0),
             ('g_loose30', 30, 'loose', 'green', 0.15), ('d_loose20', 20, 'loose', 'dark', 1.0), ('b_loose25', 25, 'loose', 'beige', 0.1)]
    truth = {}
    for name, n, mode, surf, wf in cases:
        rng = np.random.default_rng(zlib.crc32(name.encode()))
        world, hairs, cc, cd, cen = scene(rng, n, mode, surf, white_frac=wf)
        for k in range(3):
            img, M, gpos = shot(world, rng, k, cen)
            cv2.imwrite(f'{OUT}/{name}_{k}.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 88])
            if k == 0:
                c = cv2.perspectiveTransform(np.float32([[cc*PX]]), M)[0, 0]
                truth[name] = {'n': len(hairs), 'white': sum(h[1] for h in hairs), 'totalMm': float(sum(h[2] for h in hairs)), 'visibleMm': float(sum(h[3] for h in hairs)),
                               'coinMm': cd, 'coinTap': [float(c[0]/3024), float(c[1]/4032)], 'surface': surf, 'glare': gpos, 'lengths': [round(h[2]) for h in hairs]}
        print(name, len(hairs))
    json.dump(truth, open(f'{OUT}/truth.json', 'w'), indent=1)
