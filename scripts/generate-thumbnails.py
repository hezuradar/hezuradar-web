#!/usr/bin/env python3
"""Genera la miniatura (~500px) de cada foto de producto que aun no la tenga.

Backfill de una sola vez para las fotos que ya existian antes de que admin.js
empezara a generar la miniatura en cada subida nueva. Uso:
    python3 scripts/generate-thumbnails.py
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS_PATH = os.path.join(ROOT, "data", "products.json")
THUMB_MAX_WIDTH = 500
QUALITY = 78


def thumb_path(path):
    base, ext = os.path.splitext(path)
    return base + "-thumb" + ext


def main():
    with open(PRODUCTS_PATH, encoding="utf-8") as f:
        products = json.load(f)

    generated = 0
    skipped_existing = 0
    missing = 0

    for product in products:
        for rel in product.get("images", []):
            src_path = os.path.join(ROOT, rel.replace("/", os.sep))
            dst_path = thumb_path(src_path)

            if os.path.exists(dst_path):
                skipped_existing += 1
                continue
            if not os.path.exists(src_path):
                missing += 1
                continue

            im = Image.open(src_path).convert("RGB")
            w, h = im.size
            if w > THUMB_MAX_WIDTH:
                new_h = round(h * THUMB_MAX_WIDTH / w)
                im = im.resize((THUMB_MAX_WIDTH, new_h), Image.LANCZOS)
            im.save(dst_path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            generated += 1

    print(f"Miniaturas generadas: {generated}")
    print(f"Ya existian: {skipped_existing}")
    if missing:
        print(f"Fotos referenciadas que no se encontraron en disco: {missing}")


if __name__ == "__main__":
    main()
