#!/usr/bin/env python3
"""Render the Nomi orb (DESIGN.md tokens) to public/icon/{size}.png.
Pure stdlib — no Pillow — so anyone can regenerate icons anywhere."""

import math
import os
import struct
import zlib

SIZES = [16, 32, 48, 96, 128]
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'icon')

LAVENDER = (196, 181, 253)
TEAL = (94, 234, 212)
EYE = (28, 28, 40)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def capsule_dist(px, py, cx, cy, half_h):
    """Distance from point to a vertical segment centered at (cx, cy)."""
    dy = max(abs(py - cy) - half_h, 0.0)
    return math.hypot(px - cx, dy)


def render(size):
    c = size / 2.0
    radius = c - max(1.0, size * 0.04)
    eye_dx = size * 0.15
    eye_w = size * 0.045   # capsule radius
    eye_hh = size * 0.085  # capsule half-height (minus caps)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            dist = math.hypot(px - c, py - c)
            cover = max(0.0, min(1.0, radius - dist + 0.5))
            if cover == 0.0:
                row += b'\x00\x00\x00\x00'
                continue
            # Diagonal lavender→teal gradient.
            t = (px + py) / (2.0 * size)
            r, g, b = lerp(LAVENDER, TEAL, t)
            # Soft light-from-above highlight.
            glow = max(0.0, 1.0 - math.hypot(px - c * 0.75, py - c * 0.6) / (size * 0.9))
            r, g, b = (min(255, v + 60 * glow * glow) for v in (r, g, b))
            # Slightly brighter rim.
            if dist > radius - max(1.0, size * 0.05):
                r, g, b = (min(255, v + 30) for v in (r, g, b))
            # Eyes.
            eye_cover = 0.0
            for ex in (c - eye_dx, c + eye_dx):
                d = capsule_dist(px, py, ex, c, eye_hh)
                eye_cover = max(eye_cover, max(0.0, min(1.0, eye_w - d + 0.5)))
            if eye_cover > 0.0:
                r = r + (EYE[0] - r) * eye_cover
                g = g + (EYE[1] - g) * eye_cover
                b = b + (EYE[2] - b) * eye_cover
            row += struct.pack('4B', int(r), int(g), int(b), int(255 * cover))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag, data):
        payload = tag + data
        return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in SIZES:
        out = os.path.join(OUT_DIR, f'{s}.png')
        write_png(out, s, render(s))
        print(f'wrote {out}')
