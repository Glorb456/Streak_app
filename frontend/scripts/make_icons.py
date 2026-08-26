#!/usr/bin/env python3
"""Generate the favicon / PWA / apple-touch icon set from public/streak.png.

Run manually after changing streak.png:

    python3 frontend/scripts/make_icons.py

The outputs are committed on purpose. frontend/Dockerfile only copies
index.html, vite.config.js, public/ and src/, so `vite build` stays a pure
copy of public/ and the image never has to be generated at build time.

The source is opaque RGB (white artwork on black), which is what Apple wants:
iOS composites any transparency onto black and applies its own rounded-rect
mask, so the icons here are deliberately full-bleed squares with no rounding.
"""
from pathlib import Path

from PIL import Image

# Pillow 9.0.1 has no Image.Resampling enum; Image.LANCZOS is the portable name.
RESAMPLE = Image.LANCZOS

FRONTEND = Path(__file__).resolve().parent.parent
PUBLIC = FRONTEND / "public"
SRC = PUBLIC / "streak.png"
ICONS = PUBLIC / "icons"

# 16/32/48 tab favicon, 152/167/180 apple-touch (iPad, iPad Pro, iPhone @3x),
# 192/512 the two sizes a web app manifest is expected to provide.
SQUARE_SIZES = (16, 32, 48, 152, 167, 180, 192, 512)
MASKABLE_SIZES = (192, 512)

# Android shrinks a maskable icon into a circle, so the artwork has to sit
# inside the middle 80% or its edges get clipped.
SAFE_ZONE = 0.8


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)

    src = Image.open(SRC).convert("RGB")
    # The source carries a Photoshop EXIF block that Pillow's PNG writer would
    # otherwise copy into every output.
    src.info.pop("exif", None)
    background = src.getpixel((0, 0))

    for size in SQUARE_SIZES:
        src.resize((size, size), RESAMPLE).save(
            ICONS / f"icon-{size}.png", optimize=True
        )

    for size in MASKABLE_SIZES:
        inner = round(size * SAFE_ZONE)
        canvas = Image.new("RGB", (size, size), background)
        canvas.paste(src.resize((inner, inner), RESAMPLE), ((size - inner) // 2,) * 2)
        canvas.save(ICONS / f"icon-{size}-maskable.png", optimize=True)

    src.resize((256, 256), RESAMPLE).save(
        PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    # iOS probes /apple-touch-icon.png directly in contexts that never parsed
    # the page's <link> tags.
    src.resize((180, 180), RESAMPLE).save(
        PUBLIC / "apple-touch-icon.png", optimize=True
    )

    print(f"wrote {len(SQUARE_SIZES) + len(MASKABLE_SIZES)} icons to {ICONS}")
    print(f"wrote {PUBLIC / 'favicon.ico'} and {PUBLIC / 'apple-touch-icon.png'}")


if __name__ == "__main__":
    main()
