#!/usr/bin/env python3
"""Render the Nomi ball (3D glowing purple-blue glass orb with two small white
eyes) to public/icon/{size}.png. Pure stdlib — no Pillow."""

import math
import os
import struct
import zlib

SIZES = [16, 32, 48, 96, 128]
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'icon')


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def render(size):
    c = size / 2.0
    radius = c * 0.86
    # eye geometry
    eye_dx = size * 0.15
    eye_dy = size * 0.06
    eye_r = max(1.0, size * 0.055)
    # colour stops for the sphere (top-light -> deep purple-blue)
    HILIGHT = (244, 240, 255)
    MID = (168, 150, 255)
    DEEP = (108, 92, 210)
    EDGE = (86, 70, 190)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            dist = math.hypot(px - c, py - c)
            # soft anti-aliased alpha at the rim + a glow halo outside
            if dist <= radius:
                cover = min(1.0, radius - dist + 0.8)
                alpha = 235 * cover
                # sphere shading: light from top-left (~34%,30%)
                lx, ly = c - radius * 0.32, c - radius * 0.4
                ld = math.hypot(px - lx, py - ly) / (radius * 1.7)
                ld = max(0.0, min(1.0, ld))
                if ld < 0.28:
                    r, g, b = lerp(HILIGHT, MID, ld / 0.28)
                elif ld < 0.7:
                    r, g, b = lerp(MID, DEEP, (ld - 0.28) / 0.42)
                else:
                    r, g, b = lerp(DEEP, EDGE, (ld - 0.7) / 0.3)
                # bottom inner shadow for depth
                if py > c:
                    sh = min(1.0, (py - c) / radius) * 0.28
                    r, g, b = (v * (1 - sh) for v in (r, g, b))
                # eyes (two white dots, upper-centre)
                for ex in (c - eye_dx, c + eye_dx):
                    ed = math.hypot(px - ex, py - (c + eye_dy))
                    if ed < eye_r:
                        k = min(1.0, eye_r - ed + 0.6)
                        r = r + (255 - r) * k
                        g = g + (255 - g) * k
                        b = b + (255 - b) * k
                row += struct.pack('4B', int(r), int(g), int(b), int(alpha))
            else:
                # glow halo fading out
                halo = max(0.0, 1.0 - (dist - radius) / (size * 0.14))
                if halo > 0:
                    a = int(120 * halo * halo)
                    row += struct.pack('4B', 150, 130, 255, a)
                else:
                    row += b'\x00\x00\x00\x00'
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
