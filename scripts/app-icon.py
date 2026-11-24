"""Boolaa app icon (option A): curious grape mascot + coral and mint friends on cream.
One geometry, emitted as an SVG (any size), Android adaptive-icon vectors and a favicon."""
import sys, os
OUT = sys.argv[1]
G = {"grape": ("#9B86FF", "#7357F6", "#5B3FD9"), "coral": ("#FF9A82", "#FF6B5C", "#E8503F"), "mint": ("#6BE6C6", "#1EC8A0", "#12A683")}
# geometry on a 108 box (Android adaptive canvas; safe circle r33 around 54,54)
MAIN = (52.0, 57.0, 21.5); CORAL = (73.0, 35.0, 8.0); MINT = (34.5, 76.0, 5.5)
CREAM = ("#FFF6E6", "#FFE7C2")

def face(cx, cy, r):
    """Curious face (design-system 8.4) on the orb at (cx,cy,r): list of (kind, attrs) in canvas units."""
    s = 2 * r / 100; ox, oy = cx - r, cy - r
    P = lambda x, y: (ox + x * s, oy + y * s)
    out = []
    for ex in (35, 65):
        x, y = P(ex, 52); out.append(("ellipse", x, y, 5.8 * s, 7.6 * s, "#FFFFFF", 1))
        x, y = P(ex + 1.6, 49.6); out.append(("ellipse", x, y, 2 * s, 2 * s, "#5B3FD9", 1))
    x, y = P(50, 69); out.append(("ellipse", x, y, 4.4 * s, 5 * s, "#FFFFFF", 1))
    for chx in (25, 75):
        x, y = P(chx, 64); out.append(("ellipse", x, y, 6 * s, 3.5 * s, "#FF4F8B", 0.45))
    return out

def shine(cx, cy, r):  # soft highlight upper-left
    return (cx - r * 0.42, cy - r * 0.48, r * 0.24, r * 0.14)

def svg(size, background=True, box=108):
    """box: the part of the 108 canvas shown (centred). Android 108, iOS 80 (fills more), favicon 72."""
    k = size / box
    off = -(108 - box) / 2
    T = lambda v: (v + off) * k
    defs = "".join(f'<radialGradient id="{n}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="{a}"/><stop offset=".5" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></radialGradient>' for n, (a, b, c) in G.items())
    defs += f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{CREAM[0]}"/><stop offset="1" stop-color="{CREAM[1]}"/></linearGradient>'
    body = f'<rect width="{size}" height="{size}" fill="url(#bg)"/>' if background else ""
    for name, (cx, cy, r) in (("coral", CORAL), ("mint", MINT), ("grape", MAIN)):
        body += f'<circle cx="{T(cx):.2f}" cy="{T(cy):.2f}" r="{r*k:.2f}" fill="url(#{name})"/>'
        if name != "mint":
            sx, sy, rx, ry = shine(cx, cy, r)
            body += f'<ellipse cx="{T(sx):.2f}" cy="{T(sy):.2f}" rx="{rx*k:.2f}" ry="{ry*k:.2f}" fill="#fff" opacity=".55" transform="rotate(-35 {T(sx):.2f} {T(sy):.2f})"/>'
    for _, x, y, rx, ry, col, op in face(*MAIN):
        body += f'<ellipse cx="{T(x):.2f}" cy="{T(y):.2f}" rx="{rx*k:.2f}" ry="{ry*k:.2f}" fill="{col}" opacity="{op}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}"><defs>{defs}</defs>{body}</svg>\n'

def svg_tinted(size, box=80):
    """iOS tinted appearance: grayscale on transparent; iOS colours it by luminance.
    Orbs are light-to-mid gray, the face is cut out (no cheeks or shine)."""
    k = size / box; off = -(108 - box) / 2
    T = lambda v: (v + off) * k
    defs = '<radialGradient id="g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#9A9A9A"/></radialGradient>'
    body = ""
    for (cx, cy, r) in (CORAL, MINT):
        body += f'<circle cx="{T(cx):.2f}" cy="{T(cy):.2f}" r="{r*k:.2f}" fill="url(#g)" opacity=".75"/>'
    cx, cy, r = MAIN
    d = f"M{T(cx-r):.2f},{T(cy):.2f}a{r*k:.2f},{r*k:.2f} 0 1,0 {2*r*k:.2f},0a{r*k:.2f},{r*k:.2f} 0 1,0 {-2*r*k:.2f},0Z"
    for kind, fx, fy, rx, ry, col, op in face(*MAIN):
        if col == "#FFFFFF":
            d += f"M{T(fx-rx):.2f},{T(fy):.2f}a{rx*k:.2f},{ry*k:.2f} 0 1,0 {2*rx*k:.2f},0a{rx*k:.2f},{ry*k:.2f} 0 1,0 {-2*rx*k:.2f},0Z"
    body += f'<path fill="url(#g)" fill-rule="evenodd" d="{d}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}"><defs>{defs}</defs>{body}</svg>\n'

def ell(cx, cy, rx, ry):  # ellipse as path data
    return f"M{cx-rx:.2f},{cy:.2f}a{rx:.2f},{ry:.2f} 0 1,0 {2*rx:.2f},0a{rx:.2f},{ry:.2f} 0 1,0 {-2*rx:.2f},0Z"

def grad(name, cx, cy, r):
    a, b, c = G[name]
    gx, gy = cx - r * 0.3, cy - r * 0.4
    return (f'<aapt:attr name="android:fillColor"><gradient android:type="radial" android:centerX="{gx:.2f}" android:centerY="{gy:.2f}" '
            f'android:gradientRadius="{r*1.5:.2f}"><item android:offset="0" android:color="{a}"/><item android:offset="0.5" android:color="{b}"/>'
            f'<item android:offset="1" android:color="{c}"/></gradient></aapt:attr>')

HEAD = ('<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated: Boolaa app icon (curious mascot, design-system 8.4). -->\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt"\n'
        '    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n')

def android_fg():
    x = HEAD
    for name, (cx, cy, r) in (("coral", CORAL), ("mint", MINT), ("grape", MAIN)):
        x += f'    <path android:pathData="{ell(cx, cy, r, r)}">{grad(name, cx, cy, r)}</path>\n'
        if name != "mint":
            sx, sy, rx, ry = shine(cx, cy, r)
            x += f'    <group android:rotation="-35" android:pivotX="{sx:.2f}" android:pivotY="{sy:.2f}"><path android:fillColor="#FFFFFF" android:fillAlpha="0.55" android:pathData="{ell(sx, sy, rx, ry)}"/></group>\n'
    for _, fx, fy, rx, ry, col, op in face(*MAIN):
        x += f'    <path android:fillColor="{col}" android:fillAlpha="{op}" android:pathData="{ell(fx, fy, rx, ry)}"/>\n'
    return x + "</vector>\n"

def android_bg():
    return (HEAD + f'    <path android:pathData="M0,0h108v108h-108z"><aapt:attr name="android:fillColor"><gradient android:type="linear" android:startX="54" android:startY="0" android:endX="54" android:endY="108">'
            f'<item android:offset="0" android:color="{CREAM[0]}"/><item android:offset="1" android:color="{CREAM[1]}"/></gradient></aapt:attr></path>\n</vector>\n')

def android_mono():
    # Themed icon: one colour; the face is cut out of the main orb (evenOdd), no cheeks or shine.
    cx, cy, r = MAIN
    holes = "".join(ell(fx, fy, rx, ry) for kind, fx, fy, rx, ry, col, op in face(*MAIN) if col == "#FFFFFF")
    x = HEAD
    x += f'    <path android:fillColor="#FFFFFF" android:fillType="evenOdd" android:pathData="{ell(cx, cy, r, r)}{holes}"/>\n'
    for (ccx, ccy, cr) in (CORAL, MINT):
        x += f'    <path android:fillColor="#FFFFFF" android:pathData="{ell(ccx, ccy, cr, cr)}"/>\n'
    return x + "</vector>\n"

os.makedirs(OUT, exist_ok=True)
open(f"{OUT}/icon-1024.svg", "w").write(svg(1024, box=80))
open(f"{OUT}/icon-1024-dark.svg", "w").write(svg(1024, background=False, box=80))  # iOS dark: system draws the dark backdrop
open(f"{OUT}/icon-1024-tinted.svg", "w").write(svg_tinted(1024))
open(f"{OUT}/icon-192.svg", "w").write(svg(192, box=80))
open(f"{OUT}/favicon.svg", "w").write(svg(64, background=False, box=72))
open(f"{OUT}/ic_launcher_foreground.xml", "w").write(android_fg())
open(f"{OUT}/ic_launcher_background.xml", "w").write(android_bg())
open(f"{OUT}/ic_launcher_monochrome.xml", "w").write(android_mono())
print("ok")
