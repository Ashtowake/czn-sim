"""Build the browser asset manifest for already-extracted, unmodified PNG files."""

from __future__ import annotations

import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "assets"
OUT = ROOT / "data" / "asset-manifest.json"


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Not a PNG file: {path}")
    return struct.unpack(">II", header[16:24])


def main() -> None:
    entries: list[dict[str, object]] = []
    categories = {
        "cards": "card",
        "portraits": "portrait",
        "relics": "equipment",
        "gear": "gear",
        "gods": "god",
    }
    for folder, category in categories.items():
        for path in sorted((ASSET_ROOT / folder).glob("*.png")):
            width, height = png_size(path)
            entries.append({
                "resourceId": path.stem,
                "path": path.relative_to(ROOT).as_posix(),
                "width": width,
                "height": height,
                "category": category,
            })
    payload = {
        "version": 1,
        "format": "AssetManifest",
        "source": "Chaos Zero Nightmare local game archive; PNG bytes are unmodified",
        "entries": entries,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "entries": len(entries), "bytes": OUT.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
