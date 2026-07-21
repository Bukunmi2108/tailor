from __future__ import annotations

import io
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from .auth import LoginRequest, LoginResponse, authenticate, require_auth
from .canon import canon_payload
from .config import Settings, get_settings
from .engine import EditConflict, derive_resume
from .models import CoverLetter, EditDecision, ResumeData, TailorPlan
from .provider import endpoints
from .rendering import pdf_from_html, render_cover, render_resume
from .util import content_hash, safe_slug

router = APIRouter(prefix="/api")


class SnapshotRequest(BaseModel):
    resume: ResumeData
    template_version: str = "resume-v1"


class DeriveRequest(BaseModel):
    snapshot: ResumeData
    plan: TailorPlan
    decisions: list[EditDecision]
    expected_snapshot_hash: str


class CoverPreviewRequest(BaseModel):
    cover_letter: CoverLetter
    template_version: str = "cover-v1"


class ResumeExportRequest(SnapshotRequest):
    company: str = ""
    role_title: str = ""


class CoverExportRequest(CoverPreviewRequest):
    company: str = ""
    role_title: str = ""


class BothExportRequest(BaseModel):
    resume: ResumeData
    cover_letter: CoverLetter
    resume_template_version: str = "resume-v1"
    cover_template_version: str = "cover-v1"
    company: str = ""
    role_title: str = ""


@router.post("/auth/login", response_model=LoginResponse)
def login(request: Request, payload: LoginRequest, settings: Settings = Depends(get_settings)):
    return authenticate(request, payload, settings)


@router.post("/auth/logout", dependencies=[Depends(require_auth)])
def logout():
    return {"ok": True}


@router.get("/config/public")
def public_config(settings: Settings = Depends(get_settings)):
    return {
        "app_name": settings.app_name,
        "app_env": settings.app_env,
        "authentication_required": True,
        "resume_template_versions": ["resume-v1"],
        "cover_template_versions": ["cover-v1"],
        "persistence": "browser-memory",
    }


@router.get("/provider/status", dependencies=[Depends(require_auth)])
def provider_status(settings: Settings = Depends(get_settings)):
    return {
        "configured": bool(settings.modelscope_api_token),
        "models": [
            {"model": item.model, "endpoint": item.base_url, "ready": bool(item.api_key)}
            for item in endpoints(settings)
        ],
    }


@router.get("/base/current", dependencies=[Depends(require_auth)])
def current_base():
    return canon_payload()


@router.post("/resume/derive", dependencies=[Depends(require_auth)])
def derive_route(payload: DeriveRequest):
    try:
        resume, warnings = derive_resume(
            payload.snapshot, payload.plan, payload.decisions, payload.expected_snapshot_hash
        )
    except EditConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"resume": resume, "content_hash": content_hash(resume), "warnings": warnings}


@router.post("/render/resume-preview", dependencies=[Depends(require_auth)])
def resume_preview(payload: SnapshotRequest):
    try:
        return Response(render_resume(payload.resume, payload.template_version), media_type="text/html")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/render/cover-preview", dependencies=[Depends(require_auth)])
def cover_preview(payload: CoverPreviewRequest):
    try:
        return Response(render_cover(payload.cover_letter, payload.template_version), media_type="text/html")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _pdf_response(pdf: bytes, pages: int, digest: str, filename: str) -> Response:
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Page-Count": str(pages),
            "X-Content-Hash": digest,
            "Access-Control-Expose-Headers": "X-Page-Count, X-Content-Hash, Content-Disposition",
        },
    )


@router.post("/export/resume", dependencies=[Depends(require_auth)])
def export_resume(payload: ResumeExportRequest):
    pdf, pages, digest = pdf_from_html(
        render_resume(payload.resume, payload.template_version, embed_fonts=False)
    )
    name = safe_slug(f"{payload.company}-{payload.role_title}-resume")
    return _pdf_response(pdf, pages, digest, f"{name}.pdf")


@router.post("/export/cover-letter", dependencies=[Depends(require_auth)])
def export_cover(payload: CoverExportRequest):
    pdf, pages, digest = pdf_from_html(
        render_cover(payload.cover_letter, payload.template_version, embed_fonts=False)
    )
    name = safe_slug(f"{payload.company}-{payload.role_title}-cover-letter")
    return _pdf_response(pdf, pages, digest, f"{name}.pdf")


@router.post("/export/both", dependencies=[Depends(require_auth)])
def export_both(payload: BothExportRequest):
    resume_pdf, resume_pages, resume_hash = pdf_from_html(
        render_resume(payload.resume, payload.resume_template_version, embed_fonts=False)
    )
    cover_pdf, cover_pages, cover_hash = pdf_from_html(
        render_cover(payload.cover_letter, payload.cover_template_version, embed_fonts=False)
    )
    stem = safe_slug(f"{payload.company}-{payload.role_title}")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{stem}-resume.pdf", resume_pdf)
        archive.writestr(f"{stem}-cover-letter.pdf", cover_pdf)
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}-application.zip"',
            "X-Resume-Page-Count": str(resume_pages),
            "X-Cover-Page-Count": str(cover_pages),
            "X-Resume-Hash": resume_hash,
            "X-Cover-Hash": cover_hash,
            "Access-Control-Expose-Headers": "X-Resume-Page-Count, X-Cover-Page-Count, X-Resume-Hash, X-Cover-Hash, Content-Disposition",
        },
    )
