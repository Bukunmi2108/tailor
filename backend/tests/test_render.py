from io import BytesIO

from pypdf import PdfReader

from app.rendering import _pdf_from_html_cached, pdf_from_html, render_resume


def test_resume_preview_is_script_free_and_pdf_renders(resume):
    html = render_resume(resume, "resume-v1")
    assert "<script" not in html.lower()
    assert resume.meta.name.upper() in html
    assert 'data-resume-id="profile.main"' in html
    assert 'data-resume-id="exp.qanooni"' in html
    assert 'data-resume-section="experience"' in html
    assert "margin: 11mm 14mm" in html
    assert "color: #0563c1" in html
    pdf_html = render_resume(resume, "resume-v1", embed_fonts=False)
    pdf, pages, digest = pdf_from_html(pdf_html)
    assert pdf.startswith(b"%PDF")
    assert pages == 2
    assert len(digest) == 64
    assert sum(len(page.get("/Annots", [])) for page in PdfReader(BytesIO(pdf)).pages) >= 1
    before = _pdf_from_html_cached.cache_info().hits
    assert pdf_from_html(pdf_html)[0] == pdf
    assert _pdf_from_html_cached.cache_info().hits == before + 1
