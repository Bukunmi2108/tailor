from app.rendering import pdf_from_html, render_resume


def test_resume_preview_is_script_free_and_pdf_renders(resume):
    html = render_resume(resume, "resume-v1")
    assert "<script" not in html.lower()
    assert resume.meta.name.upper() in html
    assert 'data-resume-id="profile.main"' in html
    assert 'data-resume-id="exp.qanooni"' in html
    assert 'data-resume-section="experience"' in html
    pdf, pages, digest = pdf_from_html(html)
    assert pdf.startswith(b"%PDF")
    assert pages == 3
    assert len(digest) == 64
