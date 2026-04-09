#!/usr/bin/env python3

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
MASTER_SIZE = 512
ICON_SIZE = 48
BLACK = (0, 0, 0, 255)
TRANSPARENT = (255, 255, 255, 0)


def new_canvas() -> Image.Image:
    return Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), TRANSPARENT)


def draw_rough_loop(draw: ImageDraw.ImageDraw, *, width: int) -> None:
    pts = [
        (168, 86),
        (112, 120),
        (84, 202),
        (88, 308),
        (152, 396),
        (274, 430),
        (376, 406),
        (434, 324),
        (430, 202),
        (358, 106),
        (238, 78),
        (146, 104),
        (122, 140),
    ]
    draw.line(pts, fill=BLACK, width=width, joint="curve")


def draw_inner_square(draw: ImageDraw.ImageDraw, *, width: int) -> None:
    draw.rounded_rectangle((170, 170, 342, 342), radius=20, outline=BLACK, width=width)


def draw_inner_circle(draw: ImageDraw.ImageDraw, *, width: int) -> None:
    draw.ellipse((164, 164, 348, 348), outline=BLACK, width=width)


def draw_inner_triangle(draw: ImageDraw.ImageDraw, *, width: int) -> None:
    tri = [(255, 154), (350, 334), (160, 334)]
    draw.line([tri[0], tri[1], tri[2], tri[0]], fill=BLACK, width=width, joint="curve")


def draw_snap_corner(draw: ImageDraw.ImageDraw, *, width: int) -> None:
    pts = [(150, 154), (150, 236), (236, 236)]
    draw.line(pts, fill=BLACK, width=width, joint="curve")


def draw_circle_spark(draw: ImageDraw.ImageDraw, *, width: int) -> None:
    cx, cy = 356, 154
    half = 26
    draw.line([(cx - half, cy), (cx + half, cy)], fill=BLACK, width=width)
    draw.line([(cx, cy - half), (cx, cy + half)], fill=BLACK, width=width)


def draw_polygon_hint(draw: ImageDraw.ImageDraw, *, width: int) -> None:
    pts = [(255, 146), (340, 204), (308, 330), (202, 330), (170, 204), (255, 146)]
    draw.line(pts, fill=BLACK, width=width, joint="curve")


def concept_loop_square() -> Image.Image:
    image = new_canvas()
    draw = ImageDraw.Draw(image)
    draw_rough_loop(draw, width=48)
    draw_inner_square(draw, width=42)
    return image


def concept_loop_circle() -> Image.Image:
    image = new_canvas()
    draw = ImageDraw.Draw(image)
    draw_rough_loop(draw, width=48)
    draw_inner_circle(draw, width=42)
    return image


def concept_snap_corner() -> Image.Image:
    image = new_canvas()
    draw = ImageDraw.Draw(image)
    draw_rough_loop(draw, width=44)
    draw_snap_corner(draw, width=44)
    draw_polygon_hint(draw, width=36)
    return image


CONCEPTS = {
    "loop-square": concept_loop_square,
    "loop-circle": concept_loop_circle,
    "snap-corner": concept_snap_corner,
}


def save_png(image: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = image if image.size == (size, size) else image.resize((size, size), resample=Image.Resampling.LANCZOS)
    out.save(path)


def save_contact_sheet(images: dict[str, Image.Image], path: Path) -> None:
    tile = 220
    gap = 20
    label_h = 36
    names = list(images.keys())
    sheet = Image.new(
        "RGBA",
        (len(names) * tile + (len(names) + 1) * gap, tile + label_h + 2 * gap),
        (255, 255, 255, 255),
    )
    draw = ImageDraw.Draw(sheet)
    for idx, name in enumerate(names):
        x = gap + idx * (tile + gap)
        y = gap
        icon = images[name].resize((tile, tile), resample=Image.Resampling.LANCZOS)
        sheet.alpha_composite(icon, (x, y))
        draw.text((x, y + tile + 6), name, fill=(0, 0, 0, 255))
    sheet.save(path)


def main() -> None:
    logo_dir = ROOT / "assets" / "logo"
    concepts_dir = logo_dir / "concepts"

    rendered = {name: builder() for name, builder in CONCEPTS.items()}
    for name, image in rendered.items():
        save_png(image, concepts_dir / f"{name}-master.png", MASTER_SIZE)
        save_png(image, concepts_dir / f"{name}-48.png", ICON_SIZE)

    save_contact_sheet(rendered, concepts_dir / "contact-sheet.png")

    final = rendered["loop-square"]
    save_png(final, logo_dir / "master.png", MASTER_SIZE)
    save_png(final, ROOT / "assets" / "icon.png", ICON_SIZE)


if __name__ == "__main__":
    main()
