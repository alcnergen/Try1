"""Vitrin pazarlama sitesi için ürün görsellerini (SVG) üretir.

Her sahne 1000x1250 (4:5) SVG olarak yazılır; render.sh bunları Chromium ile
PNG'ye çevirir, ardından ImageMagick ile "önce" efektleri ve WebP dönüşümü yapılır.
"""
import math
import os
import random

OUT = os.path.join(os.path.dirname(__file__), "svg")
os.makedirs(OUT, exist_ok=True)
W, H = 1000, 1250

# ---------------------------------------------------------------- ortak defs
DEFS = """
<filter id="fabric" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.55 0 0 0 -0.22" result="na"/>
  <feComposite in="na" in2="SourceAlpha" operator="in" result="tex"/>
  <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="tex"/></feMerge>
</filter>
<filter id="knit" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.08 0.45" numOctaves="3" seed="2" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0 0 0 -0.38" result="na"/>
  <feComposite in="na" in2="SourceAlpha" operator="in" result="tex"/>
  <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="tex"/></feMerge>
</filter>
<filter id="leather" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="turbulence" baseFrequency="0.6" numOctaves="2" seed="11" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.35 0 0 0 -0.1" result="na"/>
  <feComposite in="na" in2="SourceAlpha" operator="in" result="tex"/>
  <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="tex"/></feMerge>
</filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="28"/></filter>
<filter id="soft2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
<filter id="blur3" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="blur7" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="hard" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.5"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="4" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0"/>
</filter>
<filter id="creases" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.003 0.007" numOctaves="4" seed="21" result="n"/>
  <feDiffuseLighting in="n" surfaceScale="9" lighting-color="#f4efe6" result="l">
    <feDistantLight azimuth="235" elevation="48"/>
  </feDiffuseLighting>
  <feComposite in="l" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0"/>
</filter>
<linearGradient id="shadeLR" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
  <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".22"/>
</linearGradient>
<linearGradient id="shadeTB" x1="0" x2="0" y1="0" y2="1">
  <stop offset="0" stop-color="#fff" stop-opacity=".10"/>
  <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".16"/>
</linearGradient>
<radialGradient id="vign" cx=".5" cy=".45" r=".75">
  <stop offset=".55" stop-color="#000" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".55"/>
</radialGradient>
<radialGradient id="flash" cx=".5" cy=".42" r=".5">
  <stop offset="0" stop-color="#fffbe8" stop-opacity=".55"/>
  <stop offset=".5" stop-color="#fffbe8" stop-opacity=".12"/>
  <stop offset="1" stop-color="#fffbe8" stop-opacity="0"/>
</radialGradient>
"""


def svg(body, w=W, h=H):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="0 0 {W} {H}"><defs>{DEFS}</defs>{body}</svg>')


def shade(path_id, clip_id, extra=""):
    """Kumaş üzerine sol-sağ ve üst-alt ışık katmanı."""
    return (f'<g clip-path="url(#{clip_id})">'
            f'<rect x="0" y="0" width="{W}" height="{H}" fill="url(#shadeLR)"/>'
            f'<rect x="0" y="0" width="{W}" height="{H}" fill="url(#shadeTB)"/>{extra}</g>')


def folds(spec, clip_id, op=0.13):
    out = []
    for (d, dark) in spec:
        c = "#000" if dark else "#fff"
        out.append(f'<path d="{d}" fill="none" stroke="{c}" stroke-opacity="{op}" '
                   f'stroke-width="9" stroke-linecap="round" filter="url(#blur3)"/>')
    return f'<g clip-path="url(#{clip_id})">{"".join(out)}</g>'


def wrinkles(clip_id, seed, n=26, box=(250, 330, 750, 1040)):
    rnd = random.Random(seed)
    out = []
    x0, y0, x1, y1 = box
    for _ in range(n):
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        a = rnd.uniform(-1.2, 1.2) + math.pi / 2
        L = rnd.uniform(60, 190)
        bx, by = x + math.cos(a) * L, y + math.sin(a) * L
        cx, cy = (x + bx) / 2 + rnd.uniform(-40, 40), (y + by) / 2 + rnd.uniform(-40, 40)
        dark = rnd.random() < .6
        c = "#000" if dark else "#fff"
        out.append(f'<path d="M{x:.0f},{y:.0f} Q{cx:.0f},{cy:.0f} {bx:.0f},{by:.0f}" fill="none" '
                   f'stroke="{c}" stroke-opacity="{.2 if dark else .14}" stroke-width="{rnd.uniform(12, 22):.1f}" '
                   f'stroke-linecap="round" filter="url(#blur7)"/>')
    return f'<g clip-path="url(#{clip_id})">{"".join(out)}</g>'


# ---------------------------------------------------------------- ürünler
SHIRT = ("M440,300 Q370,312 300,345 Q258,560 215,800 L292,816 L330,490 "
         "Q326,770 322,1040 Q500,1068 678,1040 Q674,770 670,490 L708,816 L785,800 "
         "Q742,560 700,345 Q630,312 560,300 Q500,332 440,300 Z")


def hanger(wood=True):
    col = "#a8703f" if wood else "#9aa0a6"
    return (f'<path d="M500,300 L500,250 Q500,215 528,212 Q556,210 556,238" fill="none" stroke="#8d939a" '
            f'stroke-width="7" stroke-linecap="round"/>'
            f'<path d="M318,352 Q410,300 500,296 Q590,300 682,352" fill="none" stroke="{col}" stroke-width="16" '
            f'stroke-linecap="round"/>')


def shirt(color, *, ghost=False, wrinkly=0, uid="s"):
    cid = f"clip-{uid}"
    parts = [f'<clipPath id="{cid}"><path d="{SHIRT}"/></clipPath>']
    if ghost:  # gömleğin iç arka yaka kısmı
        parts.append('<path d="M440,300 Q500,268 560,300 Q500,350 440,300 Z" fill="#000" fill-opacity=".55"/>'
                     f'<path d="M444,300 Q500,276 556,300 Q500,286 444,300 Z" fill="{color}"/>')
    parts.append(f'<path d="{SHIRT}" fill="{color}" filter="url(#fabric)"/>')
    parts.append(shade("", cid))
    parts.append(folds([
        ("M360,520 Q350,760 370,1010", True), ("M640,520 Q655,760 630,1010", True),
        ("M420,640 Q430,820 410,1000", False), ("M585,600 Q575,800 600,1000", False),
        ("M250,560 Q240,690 232,790", True), ("M752,560 Q760,690 768,790", True),
    ], cid))
    if wrinkly:
        parts.append(wrinkles(cid, wrinkly))
    # yaka
    dark = "#000"
    parts.append(f'<path d="M440,300 Q500,284 560,300 Q500,318 440,300 Z" fill="{color}"/>'
                 f'<path d="M440,300 Q500,284 560,300 Q500,318 440,300 Z" fill="{dark}" fill-opacity=".12"/>')
    for sx in (1, -1):
        p = "M440,300 L500,338 L468,395 L422,318 Z" if sx == 1 else "M560,300 L500,338 L532,395 L578,318 Z"
        parts.append(f'<path d="{p}" fill="{color}" filter="url(#fabric)"/>'
                     f'<path d="{p}" fill="#fff" fill-opacity=".08" stroke="#000" stroke-opacity=".18" stroke-width="2"/>')
    # pat, düğmeler, cep, manşet
    parts.append(f'<rect x="489" y="338" width="22" height="712" fill="#000" fill-opacity=".05"/>'
                 '<line x1="489" y1="338" x2="489" y2="1052" stroke="#000" stroke-opacity=".14" stroke-width="2"/>'
                 '<line x1="511" y1="338" x2="511" y2="1052" stroke="#000" stroke-opacity=".10" stroke-width="2"/>')
    for y in (382, 476, 570, 664, 758, 852, 946):
        parts.append(f'<circle cx="500" cy="{y}" r="7.5" fill="#f4efe6" stroke="#000" stroke-opacity=".25"/>')
    parts.append('<path d="M378,455 L452,455 L452,528 Q415,540 378,528 Z" fill="none" stroke="#000" '
                 'stroke-opacity=".16" stroke-width="2.5"/>')
    parts.append(f'<path d="M218,782 L294,798 L292,816 L215,800 Z" fill="#000" fill-opacity=".10"/>'
                 f'<path d="M782,782 L706,798 L708,816 L785,800 Z" fill="#000" fill-opacity=".10"/>')
    return "".join(parts)


SWEATER = ("M430,300 Q350,315 285,350 Q225,420 200,600 Q190,760 205,880 L285,890 "
           "Q300,740 320,560 Q318,820 315,1020 Q500,1046 685,1020 Q682,820 680,560 "
           "Q700,740 715,890 L795,880 Q810,760 800,600 Q775,420 715,350 Q650,315 570,300 "
           "Q500,345 430,300 Z")


def sweater(color, uid="k"):
    cid = f"clip-{uid}"
    p = [f'<clipPath id="{cid}"><path d="{SWEATER}"/></clipPath>',
         f'<path d="{SWEATER}" fill="{color}" filter="url(#knit)"/>', shade("", cid)]
    # örgü desenleri
    ribs = "".join(f'<line x1="{x}" y1="980" x2="{x}" y2="1050" stroke="#000" stroke-opacity=".14" stroke-width="3"/>'
                   for x in range(320, 690, 12))
    cuffs = "".join(f'<line x1="{x}" y1="840" x2="{x - 4}" y2="895" stroke="#000" stroke-opacity=".14" stroke-width="3"/>'
                    for x in list(range(206, 290, 11)) + list(range(718, 800, 11)))
    cable = "".join(
        f'<path d="M{cx - 18},{y} Q{cx},{y + 22} {cx + 18},{y} M{cx - 18},{y + 22} Q{cx},{y} {cx + 18},{y + 22}" '
        f'fill="none" stroke="#000" stroke-opacity=".13" stroke-width="5"/>'
        for cx in (430, 500, 570) for y in range(380, 980, 40))
    p.append(f'<g clip-path="url(#{cid})">{ribs}{cuffs}{cable}</g>')
    p.append(folds([("M330,600 Q345,800 330,990", True), ("M670,600 Q655,800 670,990", True)], cid))
    p.append(f'<path d="M430,300 Q500,345 570,300 Q500,372 430,300 Z" fill="{color}" stroke="#000" '
             f'stroke-opacity=".2" stroke-width="3" filter="url(#knit)"/>'
             '<path d="M445,306 Q500,342 555,306" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="3"/>')
    return "".join(p)


DRESS = ("M440,250 L452,250 Q470,330 500,345 Q530,330 548,250 L560,250 Q600,330 610,430 "
         "Q600,500 585,560 Q650,760 745,1100 Q690,1120 640,1106 Q590,1128 540,1110 Q490,1130 440,1110 "
         "Q390,1128 345,1106 Q300,1122 255,1100 Q350,760 415,560 Q400,500 390,430 Q400,330 440,250 Z")


def dress(color, dot="#f4eee4", uid="d"):
    cid = f"clip-{uid}"
    p = [f'<clipPath id="{cid}"><path d="{DRESS}"/></clipPath>',
         f'<pattern id="dots-{uid}" width="46" height="46" patternUnits="userSpaceOnUse">'
         f'<circle cx="11" cy="11" r="5" fill="{dot}"/><circle cx="34" cy="34" r="5" fill="{dot}"/></pattern>',
         f'<path d="{DRESS}" fill="{color}" filter="url(#fabric)"/>',
         f'<path d="{DRESS}" fill="url(#dots-{uid})" fill-opacity=".9"/>',
         shade("", cid),
         folds([("M440,620 Q400,860 330,1090", True), ("M500,600 Q505,860 500,1100", False),
                ("M560,620 Q600,860 670,1090", True), ("M470,640 Q450,880 420,1100", False),
                ("M530,640 Q550,880 585,1100", True)], cid, op=.18),
         f'<path d="M412,548 Q500,575 588,548 L585,584 Q500,610 415,584 Z" fill="#1c2236"/>',
         '<rect x="486" y="552" width="28" height="34" rx="4" fill="none" stroke="#c9a96b" stroke-width="5"/>',
         f'<path d="M440,250 L452,250" stroke="{color}" stroke-width="8"/>']
    return "".join(p)


BAG = ("M330,520 Q330,500 350,500 L650,500 Q670,500 670,520 L705,880 Q708,915 672,915 "
       "L328,915 Q292,915 295,880 Z")


def bag(color, uid="b"):
    cid = f"clip-{uid}"
    p = [f'<path d="M405,505 Q405,330 500,330 Q595,330 595,505" fill="none" stroke="#5e3519" stroke-width="26" '
         f'stroke-linecap="round"/>'
         f'<path d="M405,505 Q405,330 500,330 Q595,330 595,505" fill="none" stroke="{color}" stroke-width="18" '
         f'stroke-linecap="round"/>',
         f'<clipPath id="{cid}"><path d="{BAG}"/></clipPath>',
         f'<path d="{BAG}" fill="{color}" filter="url(#leather)"/>', shade("", cid),
         f'<path d="M345,525 L655,525 L688,885 L312,885 Z" fill="none" stroke="#f1d9b5" stroke-opacity=".55" '
         f'stroke-width="2.5" stroke-dasharray="9 7"/>',
         f'<path d="M330,520 Q330,500 350,500 L650,500 Q670,500 670,520 L676,610 Q500,680 324,610 Z" '
         f'fill="{color}" filter="url(#leather)"/>'
         f'<path d="M324,610 Q500,680 676,610" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="5"/>'
         f'<path d="M330,520 Q330,500 350,500 L650,500 Q670,500 670,520 L676,610 Q500,680 324,610 Z" '
         f'fill="url(#shadeTB)"/>',
         '<rect x="474" y="628" width="52" height="40" rx="8" fill="#d8b46a" stroke="#8a6a2c" stroke-width="3"/>'
         '<rect x="490" y="640" width="20" height="16" rx="3" fill="#8a6a2c"/>',
         '<path d="M405,505 L405,525 M595,505 L595,525" stroke="#d8b46a" stroke-width="10" stroke-linecap="round"/>']
    return "".join(p)


def sneaker(uid="n"):
    sole = ("M232,800 L798,800 Q806,836 790,858 Q770,880 735,880 L290,880 Q238,880 230,846 Z")
    upper = ("M244,800 L238,650 Q240,592 300,588 Q360,590 392,612 Q430,632 462,598 "
             "Q478,560 520,552 Q560,560 590,598 Q660,660 720,690 Q790,720 798,770 L798,800 Z")
    cid = f"clip-{uid}"
    p = [f'<clipPath id="{cid}"><path d="{upper}"/></clipPath>',
         f'<path d="{upper}" fill="#f5f3ee" filter="url(#leather)"/>', shade("", cid),
         f'<g clip-path="url(#{cid})">'
         f'<path d="M230,560 L330,560 Q350,700 300,820 L230,820 Z" fill="#c9875a"/>'
         f'<path d="M380,800 Q470,690 640,720 Q720,736 800,800 Z" fill="#e7e2d8"/>'
         f'<path d="M420,760 Q540,690 690,735" fill="none" stroke="#e26a3f" stroke-width="16" stroke-linecap="round"/>'
         f'</g>',
         f'<path d="{upper}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>',
         f'<path d="M470,600 Q520,548 580,590" fill="#ece8e0" stroke="#000" stroke-opacity=".1" stroke-width="2"/>']
    for i, t in enumerate((0.0, .2, .4, .6, .8)):
        x = 492 + t * 190
        y = 606 + t * 120 - 40 * t * (1 - t)
        p.append(f'<circle cx="{x:.0f}" cy="{y + 18:.0f}" r="5" fill="#9aa0a6"/>'
                 f'<path d="M{x - 22:.0f},{y + 4:.0f} L{x + 24:.0f},{y + 26:.0f}" stroke="#fff" stroke-width="9" '
                 f'stroke-linecap="round"/><path d="M{x - 22:.0f},{y + 4:.0f} L{x + 24:.0f},{y + 26:.0f}" '
                 f'stroke="#000" stroke-opacity=".12" stroke-width="9" stroke-linecap="round"/>')
    p.append(f'<path d="{sole}" fill="#f7f4ec"/><path d="{sole}" fill="url(#shadeTB)"/>'
             '<path d="M236,832 L800,832" stroke="#000" stroke-opacity=".12" stroke-width="3"/>'
             '<path d="M290,880 L735,880 Q770,880 790,858" fill="none" stroke="#c9875a" stroke-width="8"/>')
    return "".join(p)


JACKET = ("M435,290 Q360,305 290,340 Q250,560 222,830 L300,845 L332,500 "
          "Q330,720 326,930 L674,930 Q670,720 668,500 L700,845 L778,830 Q750,560 710,340 "
          "Q640,305 565,290 Q500,325 435,290 Z")


def jacket(color, uid="j", ghost=True):
    cid = f"clip-{uid}"
    st = 'stroke="#e08a3c" stroke-width="2.5" stroke-dasharray="7 6" fill="none"'
    p = []
    if ghost:
        p.append('<path d="M435,290 Q500,258 565,290 Q500,340 435,290 Z" fill="#1d2a3d"/>')
    p += [f'<clipPath id="{cid}"><path d="{JACKET}"/></clipPath>',
          f'<path d="{JACKET}" fill="{color}" filter="url(#fabric)"/>', shade("", cid),
          wrinkles(cid, 5, n=18, box=(260, 360, 740, 900)),
          f'<rect x="326" y="870" width="348" height="60" fill="#000" fill-opacity=".1"/>',
          f'<path d="M326,872 L674,872" {st}/><path d="M326,920 L674,920" {st}/>',
          f'<path d="M370,470 L470,470 L470,540 L420,560 L370,540 Z" fill="#000" fill-opacity=".07"/>'
          f'<path d="M374,474 L466,474 L466,536 L420,554 L374,536 Z" {st}/>',
          f'<path d="M530,470 L630,470 L630,540 L580,560 L530,540 Z" fill="#000" fill-opacity=".07"/>'
          f'<path d="M534,474 L626,474 L626,536 L580,554 L534,536 Z" {st}/>',
          f'<path d="M486,325 L486,930 M514,325 L514,930" {st}/>',
          f'<path d="M332,500 L332,930" stroke="#000" stroke-opacity=".12" stroke-width="3"/>']
    for y in (380, 505, 630, 755, 880):
        p.append(f'<circle cx="500" cy="{y}" r="10" fill="#b8b2a6" stroke="#5c574e" stroke-width="2"/>')
    for sx, ptxt in ((1, "M435,290 L500,330 L456,400 L398,312 Z"), (-1, "M565,290 L500,330 L544,400 L602,312 Z")):
        p.append(f'<path d="{ptxt}" fill="{color}" filter="url(#fabric)"/>'
                 f'<path d="{ptxt}" fill="#fff" fill-opacity=".07" stroke="#000" stroke-opacity=".2" stroke-width="2"/>')
    p.append(f'<path d="M224,800 L302,815 M776,800 L698,815" stroke="#e08a3c" stroke-width="2.5" '
             f'stroke-dasharray="7 6"/>')
    return "".join(p)


def scarf(uid="e"):
    cid = f"clip-{uid}"
    sq = "M500,250 Q510,250 518,258 L742,482 Q750,490 742,498 L518,722 Q500,738 482,722 L258,498 Q250,490 258,482 L482,258 Q490,250 500,250 Z"
    p = [f'<g transform="translate(-250,-120) scale(1.5)">',
         f'<clipPath id="{cid}"><path d="{sq}"/></clipPath>',
         f'<path d="{sq}" fill="#1f3b4d"/>',
         f'<g clip-path="url(#{cid})">',
         '<path d="M500,282 L718,490 L500,698 L282,490 Z" fill="none" stroke="#e8b04b" stroke-width="10"/>',
         '<path d="M500,318 L682,490 L500,662 L318,490 Z" fill="#f1e6d2"/>',
         '<circle cx="500" cy="490" r="110" fill="#c4553a"/>',
         '<circle cx="500" cy="490" r="78" fill="#f1e6d2"/>',
         '<circle cx="500" cy="490" r="46" fill="#1f3b4d"/>']
    for k in range(12):
        a = k * math.pi / 6
        x, y = 500 + math.cos(a) * 94, 490 + math.sin(a) * 94
        p.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="9" fill="#e8b04b"/>')
    for (x, y) in ((500, 300), (700, 490), (500, 680), (300, 490)):
        p.append(f'<circle cx="{x}" cy="{y}" r="20" fill="#c4553a" stroke="#e8b04b" stroke-width="4"/>')
    p.append('<path d="M258,490 L742,490" stroke="#fff" stroke-opacity=".0"/>'
             '<path d="M300,330 Q500,430 720,380" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="40" filter="url(#soft2)"/>'
             '<path d="M300,610 Q520,520 700,640" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="40" filter="url(#soft2)"/>'
             '</g></g>')
    return "".join(p)


# ---------------------------------------------------------------- sahneler
def bg_studio(c1, c2, floor=None):
    f = floor or c2
    return (f'<radialGradient id="st" cx=".5" cy=".38" r=".85"><stop offset="0" stop-color="{c1}"/>'
            f'<stop offset="1" stop-color="{c2}"/></radialGradient>'
            f'<rect width="{W}" height="{H}" fill="url(#st)"/>'
            f'<linearGradient id="fl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="{f}" stop-opacity="0"/>'
            f'<stop offset="1" stop-color="{f}" stop-opacity=".9"/></linearGradient>'
            f'<rect y="{H * .72}" width="{W}" height="{H * .28}" fill="url(#fl)"/>'
            f'<rect width="{W}" height="{H}" filter="url(#grain)"/>')


def wall_shadow(path, dx=24, dy=30, op=.22):
    return (f'<path d="{path}" transform="translate({dx},{dy})" fill="#000" fill-opacity="{op}" '
            f'filter="url(#soft)"/>')


def plant(x, y, s=1.0):
    rnd = random.Random(3)
    leaves = []
    for k in range(13):
        a = -150 + k * 10 + rnd.uniform(-6, 6)
        L = rnd.uniform(150, 260)
        r = math.radians(a)
        cx, cy = math.cos(r) * L / 2, math.sin(r) * L / 2
        g = rnd.choice(["#4f6b4a", "#5d7b55", "#435f40", "#6b8a5f"])
        leaves.append(f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{L / 2:.0f}" ry="{L / 7:.0f}" '
                      f'transform="rotate({a:.0f} {cx:.0f} {cy:.0f})" fill="{g}"/>')
    return (f'<g transform="translate({x},{y}) scale({s})">{"".join(leaves)}'
            f'<path d="M-70,0 L70,0 L55,150 L-55,150 Z" fill="#c9a483"/>'
            f'<path d="M-70,0 L70,0 L68,18 L-68,18 Z" fill="#b38f6e"/></g>')


def light_rays(op=.16):
    return (f'<g filter="url(#soft2)" fill="#fff8e8" fill-opacity="{op}">'
            '<path d="M120,0 L300,0 L760,1250 L560,1250 Z"/>'
            '<path d="M360,0 L450,0 L930,1250 L820,1250 Z"/></g>')


def bad_door():
    return (f'<rect width="{W}" height="{H}" fill="#c9bea9"/>'
            '<rect x="140" y="80" width="720" height="1300" fill="#d6ccb8" stroke="#b4a88f" stroke-width="8"/>'
            '<rect x="220" y="160" width="560" height="420" fill="none" stroke="#bcb097" stroke-width="10"/>'
            '<rect x="220" y="660" width="560" height="560" fill="none" stroke="#bcb097" stroke-width="10"/>'
            '<rect x="0" y="0" width="140" height="1250" fill="#a39b88"/>'
            '<rect x="800" y="640" width="60" height="22" rx="10" fill="#8e8a80"/>')


def bad_bed(seed=21):
    return (f'<rect width="{W}" height="{H}" fill="#ece5d8" filter="url(#creases)"/>'
            f'<rect width="{W}" height="{H}" fill="#e9dfcc" fill-opacity=".25"/>'
            '<path d="M0,1080 Q300,1040 1000,1110 L1000,1250 L0,1250 Z" fill="#8c7b66" fill-opacity=".35"/>')


def bad_floor():
    tiles = "".join(f'<line x1="{x}" y1="0" x2="{x - 120}" y2="{H}" stroke="#8f887c" stroke-width="4"/>'
                    for x in range(-100, 1300, 240))
    tiles += "".join(f'<line x1="0" y1="{y}" x2="{W}" y2="{y + 40}" stroke="#8f887c" stroke-width="4"/>'
                     for y in range(80, 1300, 260))
    return f'<rect width="{W}" height="{H}" fill="#b9b1a3"/>{tiles}<rect width="{W}" height="{H}" filter="url(#grain)"/>'


def bad_overlay():
    return (f'<rect width="{W}" height="{H}" fill="url(#flash)"/>'
            f'<rect width="{W}" height="{H}" fill="url(#vign)"/>')


def hard_shadow(path, dx=34, dy=22):
    return f'<path d="{path}" transform="translate({dx},{dy})" fill="#000" fill-opacity=".33" filter="url(#hard)"/>'


def write(name, body):
    with open(os.path.join(OUT, name + ".svg"), "w") as f:
        f.write(svg(body))


SAGE = "#9fae86"

# --- hero: aynı gömlek, aynı konum
write("hero-before", bad_door() + hard_shadow(SHIRT) + hanger(wood=False)
      + f'<g transform="rotate(1.2 500 600)">{shirt(SAGE, wrinkly=9, uid="hb")}</g>' + bad_overlay())
write("hero-studio", bg_studio("#ffffff", "#e9e7e3") + wall_shadow(SHIRT, 0, 40, .16) + shirt(SAGE, uid="h1"))
write("hero-warm", bg_studio("#f6ebdc", "#e3cdb0") + wall_shadow(SHIRT, 0, 40, .2) + shirt(SAGE, uid="h2"))
write("hero-lifestyle",
      '<rect width="1000" height="1250" fill="#d9b9a0"/>'
      '<rect y="1080" width="1000" height="170" fill="#9c7454"/>'
      '<rect y="1076" width="1000" height="10" fill="#7f5c41"/>'
      '<rect x="0" y="205" width="1000" height="16" rx="8" fill="#3b3631"/>'
      + plant(860, 930, 1.05) + wall_shadow(SHIRT, 30, 36, .22)
      + '<g transform="translate(0,0)">' + hanger() + shirt(SAGE, uid="h3") + '</g>'
      + light_rays() + '<rect width="1000" height="1250" filter="url(#grain)"/>')
write("hero-ghost", bg_studio("#f4f4f2", "#dedcd8") + wall_shadow(SHIRT, 0, 38, .14)
      + shirt(SAGE, ghost=True, uid="h4"))

# --- galeri (sonra)
ARCH = "M300,1250 L300,520 Q300,300 500,300 Q700,300 700,520 L700,1250 Z"
write("g-elbise",
      '<rect width="1000" height="1250" fill="#e6d3bf"/>'
      f'<path d="{ARCH}" transform="translate(-130,-60) scale(1.26)" fill="#f2e6d8"/>'
      '<rect y="1130" width="1000" height="120" fill="#cdb397"/>'
      + wall_shadow(DRESS, 24, 26, .2) + hanger() + dress("#2b3f6b", uid="g1") + light_rays(.12))
write("g-kazak",
      '<rect width="1000" height="1250" fill="#e9e4dc"/>'
      + "".join(f'<circle cx="{random.Random(i).uniform(0, 1000):.0f}" cy="{random.Random(i + 99).uniform(0, 1250):.0f}" '
                f'r="{random.Random(i + 7).uniform(3, 14):.0f}" fill="{random.Random(i).choice(["#c9b8a3", "#a7a49d", "#d6a68a", "#8f9a8a"])}"/>'
                for i in range(260))
      + wall_shadow(SWEATER, 10, 18, .22) + sweater("#c9744f", uid="g2"))
write("g-canta",
      bg_studio("#3a3640", "#1c1a20", "#141217")
      + '<ellipse cx="500" cy="1010" rx="300" ry="46" fill="#4a444f"/>'
        '<rect x="200" y="1010" width="600" height="240" fill="#3d3842"/>'
        '<ellipse cx="500" cy="1010" rx="300" ry="46" fill="#57505d"/>'
        '<ellipse cx="500" cy="985" rx="230" ry="26" fill="#000" fill-opacity=".45" filter="url(#soft2)"/>'
      + '<g transform="translate(0,90)">' + bag("#a8622f", uid="g3") + '</g>'
      + '<radialGradient id="spot" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffcf99" stop-opacity=".22"/>'
        '<stop offset="1" stop-color="#ffcf99" stop-opacity="0"/></radialGradient>'
        '<ellipse cx="500" cy="700" rx="460" ry="520" fill="url(#spot)"/>')
write("g-sneaker",
      bg_studio("#dde9ee", "#b9cfd8")
      + '<rect x="190" y="880" width="620" height="370" fill="#f1ede6"/>'
        '<rect x="190" y="870" width="620" height="20" fill="#ffffff"/>'
        '<rect x="620" y="760" width="230" height="490" fill="#e6c4ad"/>'
        '<rect x="620" y="752" width="230" height="16" fill="#efd6c4"/>'
        '<ellipse cx="515" cy="878" rx="300" ry="18" fill="#000" fill-opacity=".3" filter="url(#soft2)"/>'
      + '<g transform="translate(0,-4)">' + sneaker(uid="g4") + '</g>')
write("g-ceket", bg_studio("#ffffff", "#e4e5e8") + wall_shadow(JACKET, 0, 40, .15)
      + '<g transform="translate(0,60)">' + jacket("#4d6e99", uid="g5") + '</g>')
leafsh = "".join(f'<ellipse cx="{x}" cy="{y}" rx="120" ry="34" transform="rotate({r} {x} {y})"/>'
                 for (x, y, r) in ((90, 140, 30), (210, 90, -20), (170, 260, 60), (860, 1060, 25),
                                   (930, 960, -40), (780, 1160, 70), (120, 1130, 10)))
write("g-esarp",
      '<rect width="1000" height="1250" fill="#e5ddcf" filter="url(#fabric)"/>'
      f'<rect width="1000" height="1250" fill="#e5ddcf" fill-opacity=".6"/>'
      + '<g transform="translate(-250,-120) scale(1.5)">' + wall_shadow("M500,250 L750,490 L500,730 L250,490 Z", 8, 14, .28) + '</g>'
      + scarf(uid="g6")
      + f'<g fill="#3d3326" fill-opacity=".22" filter="url(#soft2)">{leafsh}</g>')

# --- galeri (önce) küçük resimler
write("b-elbise", bad_door() + hard_shadow(DRESS) + hanger(False) + dress("#2b3f6b", uid="c1") + bad_overlay())
write("b-kazak", bad_bed() + hard_shadow(SWEATER, 20, 14)
      + f'<g transform="rotate(-6 500 640)">{sweater("#c9744f", uid="c2")}</g>' + bad_overlay())
write("b-canta", bad_floor() + f'<g transform="translate(0,120)">{hard_shadow(BAG)}{bag("#a8622f", uid="c3")}</g>' + bad_overlay())
write("b-sneaker", bad_floor() + f'<g transform="rotate(-8 500 750)">{sneaker(uid="c4")}</g>' + bad_overlay())
write("b-ceket", bad_door() + hard_shadow(JACKET) + hanger(False)
      + f'<g transform="translate(0,20)">{jacket("#4d6e99", uid="c5", ghost=False)}</g>' + bad_overlay())
write("b-esarp", bad_bed() + f'<g transform="rotate(14 500 630)">{scarf(uid="c6")}</g>' + bad_overlay())
print("ok", sorted(os.listdir(OUT)))
