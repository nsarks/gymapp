# Draws the app icon: dark tile, green dumbbell mark.
import sys
from PIL import Image, ImageDraw

def icon(size, pad):
    s = size * 4
    im = Image.new('RGB', (s, s), '#0B0D0C')
    d = ImageDraw.Draw(im)
    g = '#2BE35A'
    u = (s - 2 * pad * 4) / 100.0
    o = pad * 4
    box = lambda x0, y0, x1, y1, r: d.rounded_rectangle([o + x0 * u, o + y0 * u, o + x1 * u, o + y1 * u], radius=r * u, fill=g)
    box(22, 46, 78, 54, 3)    # bar
    box(10, 30, 21, 70, 4)    # outer plates
    box(79, 30, 90, 70, 4)
    box(23, 22, 34, 78, 4)    # inner plates
    box(66, 22, 77, 78, 4)
    return im.resize((size, size), Image.LANCZOS)

out = sys.argv[1]
icon(192, 26).save(f'{out}/icon-192.png')
icon(512, 70).save(f'{out}/icon-512.png')
icon(512, 120).save(f'{out}/icon-maskable-512.png')
