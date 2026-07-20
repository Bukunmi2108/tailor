from __future__ import annotations

import base64
import hashlib
from functools import lru_cache
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
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
def font_sources(embedded: bool = True) -> dict[str, str]:
    root = get_settings().template_root / "fonts"
    source = _font_data if embedded else lambda path: path.resolve().as_uri()
    return {
        "tinos_regular": source(root / "Tinos-Regular.ttf"),
        "tinos_bold": source(root / "Tinos-Bold.ttf"),
        "tinos_italic": source(root / "Tinos-Italic.ttf"),
        "arimo_regular": source(root / "Arimo-Regular.ttf"),
        "arimo_bold": source(root / "Arimo-Bold.ttf"),
    }


def render_resume(resume: ResumeData, template_version: str, *, embed_fonts: bool = True) -> str:
    if template_version not in SUPPORTED_RESUME_TEMPLATES:
        raise ValueError(f"unsupported template version {template_version!r}")
    return (
        environment()
        .get_template(f"{template_version}/resume.html")
        .render(resume=resume, fonts=font_sources(embed_fonts), content_hash=content_hash(resume))
    )


def render_cover(letter: CoverLetter, template_version: str = "cover-v1", *, embed_fonts: bool = True) -> str:
    if template_version not in SUPPORTED_COVER_TEMPLATES:
        raise ValueError(f"unsupported template version {template_version!r}")
    return (
        environment()
        .get_template(f"{template_version}/cover.html")
        .render(letter=letter, fonts=font_sources(embed_fonts))
    )


@lru_cache(maxsize=12)
def _pdf_from_html_cached(html: str) -> tuple[bytes, int, str]:
    document = HTML(string=html, base_url=str(get_settings().template_root)).render()
    pdf = document.write_pdf()
    return pdf, len(document.pages), hashlib.sha256(pdf).hexdigest()


def pdf_from_html(html: str) -> tuple[bytes, int, str]:
    return _pdf_from_html_cached(html)
