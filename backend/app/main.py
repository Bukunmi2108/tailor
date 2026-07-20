from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .canon import load_canon
from .config import get_settings
from .rendering import environment


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_canon()
    environment().get_template("resume-v1/resume.html")
    environment().get_template("cover-v1/cover.html")
    yield


settings = get_settings()
app = FastAPI(title="Tailor API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition", "X-Page-Count", "X-Content-Hash"],
)
app.include_router(router)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    checks = {
        "canonical_resume": get_settings().canon_path.is_file(),
        "templates": get_settings().template_root.is_dir(),
        "authentication": settings.configured,
        "provider": bool(settings.modelscope_api_token),
    }
    return {"status": "ready" if all(checks.values()) else "degraded", "checks": checks}
