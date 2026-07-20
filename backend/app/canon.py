from functools import lru_cache
from typing import Any

import yaml

from .config import get_settings
from .models import ResumeData
from .util import content_hash


@lru_cache
def load_canon() -> ResumeData:
    path = get_settings().canon_path
    return ResumeData.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def canon_payload() -> dict[str, Any]:
    resume = load_canon()
    return {
        "version_id": f"repository-{content_hash(resume)[:12]}",
        "schema_version": resume.schema_version,
        "resume_snapshot": resume.model_dump(mode="json"),
        "content_hash": content_hash(resume),
        "template_version": resume.template_version,
        "source": "repository_import",
    }


def serialize_resume(resume: ResumeData) -> str:
    return yaml.safe_dump(
        resume.model_dump(mode="json", exclude_none=True),
        sort_keys=False,
        allow_unicode=True,
        width=110,
    )
