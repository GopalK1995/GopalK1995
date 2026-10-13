# Trim each raw 2x render to its content and re-pad with 64px (128 device px at 2x) of #f6f7fb.
import sys, os
from PIL import Image, ImageChops
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
BG = (246, 247, 251); PAD = 128
for name in sorted(os.listdir(src)):
    im = Image.open(os.path.join(src, name)).convert("RGB")
    diff = ImageChops.difference(im, Image.new("RGB", im.size, BG)).convert("L").point(lambda v: 255 if v > 1 else 0)
    box = diff.getbbox()
    c = im.crop(box)
    out = Image.new("RGB", (c.width + 2 * PAD, c.height + 2 * PAD), BG)
    out.paste(c, (PAD, PAD))
    out.save(os.path.join(dst, name), optimize=True)
    print(name, out.size)
