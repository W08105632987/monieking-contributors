"""
Generates the "Verification Reference" PDF for a completed identity_services
request (round 19).

This is deliberately NOT trying to look like an official government
document — see IdentityService.official_document_note and the seed data in
scripts/seed_identity_services.py for why. It's a plain, clearly-labeled
MonieKing receipt: what was checked, when, and the (already-masked,
already-photo-stripped) result. It is built from request_row.response_summary
— the same masked dict already stored and shown in the app — never from a
raw provider response, so this can't leak anything the summary itself
doesn't already show.
"""
import io
from datetime import datetime, timezone

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

from app.models.identity_service import IdentityService, IdentityServiceRequest

_NAVY = colors.HexColor("#12233d")
_GREY = colors.HexColor("#5a5a5a")
_LIGHT = colors.HexColor("#f4f1ea")


def _humanize_key(key: str) -> str:
    # camelCase / snake_case provider field names -> "Camel Case" for display.
    spaced = "".join(f" {c}" if c.isupper() else c for c in key.replace("_", " "))
    return spaced.strip().title()


def _flatten_for_table(data: dict, prefix: str = "") -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for key, value in data.items():
        label = f"{prefix}{_humanize_key(key)}"
        if isinstance(value, dict):
            rows.extend(_flatten_for_table(value, prefix=f"{label} — "))
        else:
            rows.append((label, "" if value is None else str(value)))
    return rows


def build_verification_reference_pdf(
    request_row: IdentityServiceRequest,
    service: IdentityService,
    customer_name: str,
) -> bytes:
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="MKTitle", fontName="Helvetica-Bold", fontSize=17,
                               textColor=_NAVY, spaceAfter=2))
    styles.add(ParagraphStyle(name="MKSub", fontName="Helvetica", fontSize=10,
                               textColor=_GREY, spaceAfter=10))
    styles.add(ParagraphStyle(name="MKNotice", fontName="Helvetica-Bold", fontSize=9.5,
                               textColor=_NAVY, backColor=_LIGHT, borderPadding=8, spaceAfter=12,
                               leading=13))
    styles.add(ParagraphStyle(name="MKCell", fontName="Helvetica", fontSize=9.3, leading=12))
    styles.add(ParagraphStyle(name="MKCellBold", fontName="Helvetica-Bold", fontSize=9.3, leading=12))
    styles.add(ParagraphStyle(name="MKFooter", fontName="Helvetica-Oblique", fontSize=7.5,
                               textColor=_GREY, spaceBefore=16))

    story = []
    story.append(Paragraph("MonieKing — Verification Reference", styles["MKTitle"]))
    story.append(Paragraph(
        "A record of a verification check run through MonieKing. This is not an official government "
        "document and does not replace one.", styles["MKSub"]))
    story.append(HRFlowable(width="100%", thickness=0.8, color=_NAVY, spaceAfter=10))

    if service.official_document_note:
        story.append(Paragraph(service.official_document_note, styles["MKNotice"]))

    meta_rows = [
        ["Service", service.name],
        ["Customer", customer_name],
        ["Status", request_row.status.value.replace("_", " ").title()],
        ["Reference", str(request_row.id)],
        ["Requested", request_row.created_at.strftime("%d %b %Y, %H:%M UTC") if request_row.created_at else "—"],
        ["Completed", request_row.completed_at.strftime("%d %b %Y, %H:%M UTC") if request_row.completed_at else "—"],
    ]
    meta_table = Table(
        [[Paragraph(k, styles["MKCellBold"]), Paragraph(v, styles["MKCell"])] for k, v in meta_rows],
        colWidths=[4 * cm, 11.5 * cm],
    )
    meta_table.setStyle(TableStyle([
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Result details", styles["MKCellBold"]))
    story.append(Spacer(1, 4))

    detail_rows = _flatten_for_table(request_row.response_summary or {})
    if detail_rows:
        table_data = [[Paragraph(k, styles["MKCellBold"]), Paragraph(v, styles["MKCell"])] for k, v in detail_rows]
        detail_table = Table(table_data, colWidths=[6 * cm, 9.5 * cm], repeatRows=0)
        detail_table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, _LIGHT]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(detail_table)
    else:
        story.append(Paragraph(
            request_row.failure_reason or "No result details are available for this request.",
            styles["MKCell"],
        ))

    story.append(Paragraph(
        f"Generated by MonieKing on {datetime.now(timezone.utc).strftime('%d %b %Y, %H:%M UTC')}. "
        "This document reflects a check run at a point in time and is not a certified or official record.",
        styles["MKFooter"],
    ))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                             leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                             title=f"MonieKing Verification Reference — {service.name}")
    doc.build(story)
    return buf.getvalue()
