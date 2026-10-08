"""Regenerate apps/web/src/lib/__fixtures__/templateRules.vectors.json (see service_template_vectors.py)."""
import json
from pathlib import Path

from app.services.service_template_vectors import build_vectors

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "backend" / "tests" / "unit" / "golden" / "live_price_map_2026_10_07.json"
OUT = ROOT / "apps" / "web" / "src" / "lib" / "__fixtures__" / "templateRules.vectors.json"

if __name__ == "__main__":
    vectors = build_vectors(json.loads(LIVE.read_text(encoding="utf-8")))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(vectors, sort_keys=True), encoding="utf-8")
    print(f"wrote {len(vectors['cases'])} cases for {len(vectors['schemas'])} schemas -> {OUT}")
