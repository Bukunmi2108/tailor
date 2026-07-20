from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from pypdf import PdfReader
from weasyprint import HTML

from .config import get_settings
from .models import CoverLetter, ResumeData
from .util import content_hash

SUPPORTED_RESUME_TEMPLATES = {"resume-v1"}
SUPPORTED_COVER_TEMPLATES = {"cover-v1"}


@lru_cache
def environment() -> Environment:
    return Environment(
        loader=FileSystemLoader(get_settings().template_root),
        autoescape=select_autoescape(["html", "xml"]),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )


def _font_data(path: Path) -> str:
    return "data:font/ttf;base64," + base64.b64encode(path.read_bytes()).decode()


@lru_cache
def font_sources() -> dict[str, str]:
    root = get_settings().template_root / "fonts"
    return {
        "tinos_regular": _font_data(root / "Tinos-Regular.ttf"),
        "tinos_bold": _font_data(root / "Tinos-Bold.ttf"),
        "tinos_italic": _font_data(root / "Tinos-Italic.ttf"),
        "arimo_regular": _font_data(root / "Arimo-Regular.ttf"),
        "arimo_bold": _font_data(root / "Arimo-Bold.ttf"),
    }


def render_resume(resume: ResumeData, template_version: str) -> str:
    if template_version not in SUPPORTED_RESUME_TEMPLATES:
        raise ValueError(f"unsupported template version {template_version!r}")
    return (
        environment()
        .get_template(f"{template_version}/resume.html")
        .render(resume=resume, fonts=font_sources(), content_hash=content_hash(resume))
    )


def render_cover(letter: CoverLetter, template_version: str = "cover-v1") -> str:
    if template_version not in SUPPORTED_COVER_TEMPLATES:
        raise ValueError(f"unsupported template version {template_version!r}")
    return (
        environment()
        .get_template(f"{template_version}/cover.html")
        .render(letter=letter, fonts=font_sources())
    )


def pdf_from_html(html: str) -> tuple[bytes, int, str]:
    pdf = HTML(string=html).write_pdf()
    pages = len(PdfReader(__import__("io").BytesIO(pdf)).pages)
    return pdf, pages, content_hash({"pdf": base64.b64encode(pdf).decode()})
