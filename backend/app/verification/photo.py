"""Pull the portrait out of a Techhub slip PDF.

Techhub returns the photo only inside the PDF. We pick the embedded image that
looks like a portrait (taller than wide, not tiny, not a page-wide banner),
shrink it and re-encode it as JPEG. If nothing plausible is found we return
None and the screen shows the person's initials instead — never an error.

Heuristic, verified only against synthetic PDFs until the live probe has been
run (see README). Everything is wrapped so a malformed PDF can never raise."""
import io
import logging

logger = logging.getLogger(__name__)

MAX_SIDE = 480
MIN_SIDE = 60
# height / width window for "portrait photo"; passport photos are ~1.25-1.4
MIN_RATIO = 1.05
MAX_RATIO = 1.8


def _score(w: int, h: int) -> float | None:
    if min(w, h) < MIN_SIDE:
        return None
    ratio = h / w
    if not (MIN_RATIO <= ratio <= MAX_RATIO):
        return None
    # Prefer the larger candidate, with a mild preference for ~1.3 ratio.
    return (w * h) * (1.0 - min(abs(ratio - 1.3), 0.5))


def extract_portrait(pdf_bytes: bytes) -> bytes | None:
    try:
        from pypdf import PdfReader
        from PIL import Image
    except Exception:  # libraries missing: degrade to initials
        logger.warning("photo extraction unavailable (pypdf/Pillow missing)")
        return None
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        best = None
        best_score = 0.0
        for page in reader.pages[:3]:
            try:
                images = list(page.images)
            except Exception:
                continue
            for img in images:
                try:
                    pil = img.image
                    if pil is None:
                        continue
                    sc = _score(pil.width, pil.height)
                    if sc is not None and sc > best_score:
                        best, best_score = pil, sc
                except Exception:
                    continue
        if best is None:
            return None
        pil = best.convert("RGB")
        pil.thumbnail((MAX_SIDE, MAX_SIDE))
        out = io.BytesIO()
        pil.save(out, format="JPEG", quality=85)
        return out.getvalue()
    except Exception:
        logger.warning("photo extraction failed")
        return None
