#!/usr/bin/env python3
"""Generate the web brand assets from the masters in assets/brand/.

The masters are large, opaque exports (white or navy background, generous padding). Web surfaces need trimmed,
transparent, correctly sized files, so every derived asset is produced here rather than hand-edited:

    assets/brand/dhanvi-logo.png       -> frontend/apps/*/public/brand/logo.png        (transparent lockup, light surfaces)
    assets/brand/dhanvi-logo-dark.png  -> frontend/apps/*/public/brand/logo-dark.png   (transparent lockup, dark sidebar)
    assets/brand/dhanvi-app-icon.png   -> frontend/apps/*/public/brand/mark.png        (rounded tile, transparent corners)
    assets/brand/dhanvi-app-icon.png   -> frontend/apps/*/src/app/apple-icon.png       (180x180 opaque, iOS applies its own mask)
    assets/brand/dhanvi-favicon.png    -> frontend/apps/*/src/app/icon.png             (256x256, keeps its white ground so the
                                                                               tab icon stays legible in dark tab strips)

Requires Pillow (`pip install pillow`). Run from anywhere:  python3 tools/generate-brand-assets.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover - tooling guard
    sys.exit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "assets" / "brand"
APPS = [ROOT / "frontend" / "apps" / "user-web", ROOT / "frontend" / "apps" / "admin-web"]
# The app icon's tile is a rounded square whose radius measures ~20.5% of its side.
TILE_RADIUS_RATIO = 0.205
SUPERSAMPLE = 4


def content_box(image: Image.Image, tolerance: int = 24) -> tuple[int, int, int, int]:
    """Bounding box of everything that differs from the (flat) corner colour."""
    from PIL import ImageChops

    flat = Image.new("RGB", image.size, image.getpixel((0, 0)))
    difference = ImageChops.difference(image.convert("RGB"), flat).convert("L")
    return difference.point(lambda value: 255 if value > tolerance else 0).getbbox()


def trimmed(image: Image.Image, padding_ratio: float) -> Image.Image:
    """Crop to the artwork, then re-add a uniform margin so CSS controls the spacing, not the export."""
    left, top, right, bottom = content_box(image)
    padding = round((bottom - top) * padding_ratio)
    return image.crop((left - padding, top - padding, right + padding, bottom + padding))


def keyed(image: Image.Image, tolerance: int = 34) -> Image.Image:
    """Make the flat background transparent by flood-filling inwards from the border.

    Filling from the border (rather than replacing every pixel of that colour) keeps white artwork — the reversed
    wordmark, the figures inside the tile — fully opaque. A one-pixel blur softens the resulting edge.
    """
    rgb = image.convert("RGB")
    sentinel = (255, 0, 255)
    width, height = rgb.size
    seeds = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1), (width // 2, 0), (width // 2, height - 1)]
    for seed in seeds:
        ImageDraw.floodfill(rgb, seed, sentinel, thresh=tolerance)
    alpha = Image.new("L", rgb.size, 255)
    alpha.putdata([0 if pixel == sentinel else 255 for pixel in rgb.getdata()])
    result = image.convert("RGBA")
    result.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.6)))
    return result


def rounded(image: Image.Image, size: int) -> Image.Image:
    """Square tile with synthetic rounded corners — an exact, halo-free edge the source's white surround cannot give."""
    tile = image.convert("RGB").crop(content_box(image)).resize((size * SUPERSAMPLE, size * SUPERSAMPLE), Image.LANCZOS)
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile.size[0] - 1, tile.size[1] - 1), radius=round(tile.size[0] * TILE_RADIUS_RATIO), fill=255)
    tile.putalpha(mask)
    return tile.resize((size, size), Image.LANCZOS)


def to_height(image: Image.Image, height: int) -> Image.Image:
    return image.resize((round(image.width * height / image.height), height), Image.LANCZOS)


def save(image: Image.Image, *paths: Path, colours: int = 96) -> None:
    """The artwork is a handful of flat brand colours, so a quantised palette keeps it identical but far smaller."""
    quantised = image.quantize(colors=colours, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        quantised.save(path, "PNG", optimize=True)
        print(f"  {path.relative_to(ROOT)}  {image.width}x{image.height}  {path.stat().st_size // 1024} KB")


def main() -> None:
    if not MASTERS.is_dir():
        sys.exit(f"Masters not found: {MASTERS}")
    logo = Image.open(MASTERS / "dhanvi-logo.png")
    logo_dark = Image.open(MASTERS / "dhanvi-logo-dark.png")
    app_icon = Image.open(MASTERS / "dhanvi-app-icon.png")
    favicon = Image.open(MASTERS / "dhanvi-favicon.png")

    print("Lockups (transparent, 128px tall — about 4x the largest on-screen size):")
    save(to_height(keyed(trimmed(logo, 0.06)), 128), *[app / "public" / "brand" / "logo.png" for app in APPS])
    save(to_height(keyed(trimmed(logo_dark, 0.06)), 128), *[app / "public" / "brand" / "logo-dark.png" for app in APPS])

    print("Mark (rounded tile, transparent corners):")
    save(rounded(app_icon, 192), *[app / "public" / "brand" / "mark.png" for app in APPS])

    print("Tab and home-screen icons (Next.js app-directory conventions):")
    save(rounded(app_icon, 180).convert("RGB"), *[app / "src" / "app" / "apple-icon.png" for app in APPS])
    tab = trimmed(favicon, 0.04).convert("RGB")
    save(tab.resize((256, 256), Image.LANCZOS), *[app / "src" / "app" / "icon.png" for app in APPS])


if __name__ == "__main__":
    main()
