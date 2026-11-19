#!/usr/bin/env python3
"""Build data/sign_similarity.js: which sign glyphs look alike.

Method (no ML, deterministic):
  1. Headless Chrome rasterizes every signs/NNN.svg; each glyph is cropped to
     its ink, scaled (keeping aspect ratio) and centred in a SIZE x SIZE box.
  2. Pairwise *chamfer distance*: the average distance from each ink pixel of
     one glyph to the nearest ink pixel of the other, both ways. Small = alike.
     Robust for line drawings (tolerates small shifts / stroke wobble).
  3. Average-linkage clustering, cut at three thresholds (CUTS), gives
     "look-alike groups" at tight / medium / loose strictness.

Usage:  python3 tools/build_similarity.py          (needs Google Chrome + numpy)
"""
import json, os, re, subprocess, sys, tempfile, html as htmlmod
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SIZE, BOX = 48, 42          # canvas size, max glyph extent inside it
TOP_K = 12                  # neighbours kept per sign
# avg-linkage distance cuts (pixels) for the three strictness levels offered in the UI
CUTS = {'tight': 1.0, 'medium': 1.25, 'loose': 1.6}


def rasterize(codes):
    page = """<!doctype html><meta charset=utf-8><body><pre id=OUT></pre><script>
const codes=%s, S=%d, B=%d, root=%s; const out={};
function load(c){return new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=root+'/signs/'+c+'.svg';});}
(async()=>{
 const big=document.createElement('canvas');big.width=big.height=256;const g=big.getContext('2d',{willReadFrequently:true});
 const sm=document.createElement('canvas');sm.width=sm.height=S;const h=sm.getContext('2d',{willReadFrequently:true});
 for(const c of codes){const im=await load(c);if(!im)continue;
  g.fillStyle='#fff';g.fillRect(0,0,256,256);
  const k=240/Math.max(im.naturalWidth||im.width,im.naturalHeight||im.height);
  const w=(im.naturalWidth||im.width)*k,hh=(im.naturalHeight||im.height)*k;g.drawImage(im,(256-w)/2,(256-hh)/2,w,hh);
  const d=g.getImageData(0,0,256,256).data;let x0=256,y0=256,x1=-1,y1=-1;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(d[(y*256+x)*4]<128){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  if(x1<0)continue;const bw=x1-x0+1,bh=y1-y0+1,s=B/Math.max(bw,bh);
  h.fillStyle='#fff';h.fillRect(0,0,S,S);h.imageSmoothingQuality='high';
  h.drawImage(big,x0,y0,bw,bh,(S-bw*s)/2,(S-bh*s)/2,bw*s,bh*s);
  const e=h.getImageData(0,0,S,S).data;let bits='';for(let p=0;p<S*S;p++)bits+=e[p*4]<160?'1':'0';out[c]=bits;}
 document.getElementById('OUT').textContent=JSON.stringify(out);
})();</script>""" % (json.dumps(codes), SIZE, BOX, json.dumps('file://' + ROOT))
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, 'raster.html')
        open(p, 'w').write(page)
        dom = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--allow-file-access-from-files',
                              '--virtual-time-budget=60000', '--dump-dom', 'file://' + p],
                             capture_output=True, text=True, timeout=300).stdout
    m = re.search(r'<pre id="OUT">(.*?)</pre>', dom, re.S)
    if not m or not m.group(1).strip():
        sys.exit('rasterization failed (is Chrome at %s?)' % CHROME)
    raw = json.loads(htmlmod.unescape(m.group(1)))
    return {c: np.frombuffer(b.encode(), dtype=np.uint8).reshape(SIZE, SIZE) - 48 for c, b in raw.items()}


def distance_transforms(masks):
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    grid = np.stack([yy.ravel(), xx.ravel()], 1).astype(np.float32)          # (P,2)
    out = []
    for m in masks:
        ink = grid[m.ravel() > 0]
        d2 = ((grid[:, None, :] - ink[None, :, :]) ** 2).sum(-1)              # (P,n_ink)
        out.append(np.sqrt(d2.min(1)))
    return np.stack(out).astype(np.float64)                                    # (N,P)


def avg_linkage_groups(D, cut):
    n = len(D)
    clusters = {i: [i] for i in range(n)}
    C = D.astype(np.float64).copy()
    np.fill_diagonal(C, np.inf)
    alive = np.ones(n, bool)
    size = np.ones(n)
    while True:
        Cm = np.where(alive[:, None] & alive[None, :], C, np.inf)
        i, j = np.unravel_index(np.argmin(Cm), Cm.shape)
        if Cm[i, j] > cut:
            break
        # merge j into i (average linkage update)
        C[i, :] = (C[i, :] * size[i] + C[j, :] * size[j]) / (size[i] + size[j])
        C[:, i] = C[i, :]
        C[i, i] = np.inf
        size[i] += size[j]
        alive[j] = False
        clusters[i] += clusters.pop(j)
    return [clusters[k] for k in clusters]


def main():
    codes = sorted(f[:-4] for f in os.listdir(os.path.join(ROOT, 'signs')) if re.match(r'^\d{3}\.svg$', f))
    codes = [c for c in codes if c not in ('000', '999')]  # placeholders, not real signs
    bm = rasterize(codes)
    codes = [c for c in codes if c in bm and bm[c].sum() > 0]
    M = np.stack([bm[c].astype(np.float64).ravel() for c in codes])            # (N,P)
    DT = distance_transforms([bm[c] for c in codes])                          # (N,P)
    with np.errstate(all='ignore'):  # macOS Accelerate emits spurious matmul warnings
        A = (M @ DT.T) / M.sum(1, keepdims=True)                                 # mean dist a->b
    D = (A + A.T) / 2                                                          # symmetric chamfer

    neighbours = {}
    for i, c in enumerate(codes):
        order = np.argsort(D[i])
        neighbours[c] = [[codes[j], round(float(D[i, j]), 2)] for j in order if j != i][:TOP_K]

    def medoid_order(g):
        idx = [codes.index(c) for c in g]
        sub = D[np.ix_(idx, idx)]
        med = idx[int(np.argmin(sub.sum(1)))]
        return sorted(g, key=lambda c: D[med, codes.index(c)])
    groups = {}
    for name, cut in CUTS.items():
        gs = [[codes[i] for i in g] for g in avg_linkage_groups(D, cut)]
        gs = [medoid_order(g) for g in gs if len(g) > 1]
        gs.sort(key=lambda g: (-len(g), g[0]))
        groups[name] = gs
        print('%-6s cut %.2f: %d groups covering %d signs' % (name, cut, len(gs), sum(map(len, gs))))

    out = {'method': 'chamfer distance on %dx%d normalised SVG glyphs; avg-linkage groups' % (SIZE, SIZE),
           'cuts': CUTS,
           'groups': groups, 'neighbours': neighbours}
    path = os.path.join(ROOT, 'data', 'sign_similarity.js')
    with open(path, 'w') as f:
        f.write('/* Generated by tools/build_similarity.py — do not edit by hand. */\n')
        f.write('window.SIGN_SIMILARITY = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print('%d signs -> %s' % (len(codes), path))
    pct = np.percentile(D[np.triu_indices(len(D), 1)], [1, 5, 25, 50])
    print('pair distance percentiles 1/5/25/50:', np.round(pct, 2))


if __name__ == '__main__':
    main()
