from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Link(StrictModel):
    id: str
    label: str
    url: HttpUrl


class Contact(StrictModel):
    location: str
    phone: str
    email: str
    links: list[Link]


class Meta(StrictModel):
    name: str
    headline: str
    contact: Contact


class TextAtom(StrictModel):
    id: str
    text: str
    tags: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    visible: bool = True


class Experience(StrictModel):
    id: str
    company: str
    title: str
    location: str = ""
    dates: str
    tagline: TextAtom | None = None
    bullets: list[TextAtom]
    visible: bool = True
    page_break_before: bool = False


class Project(StrictModel):
    id: str
    name: str
    links: list[Link] = Field(default_factory=list)
    text: str
    tags: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    visible: bool = True


class Education(StrictModel):
    id: str
    institution: str
    qualification: str
    dates: str
    details: TextAtom
    visible: bool = True


class SkillGroup(StrictModel):
    id: str
    label: str
    items: list[str]
    visible: bool = True


class Certification(StrictModel):
    id: str
    text: str
    visible: bool = True
    page_break_before: bool = False


class Leadership(StrictModel):
    id: str
    title: str
    text: str
    visible: bool = True


class Language(StrictModel):
    id: str
    language: str
    proficiency: str
    visible: bool = True


class ResumeData(StrictModel):
    schema_version: int = 1
    base_version: int = 1
    template_version: str = "resume-v1"
    section_order: list[
        Literal[
            "profile",
            "experience",
            "projects",
            "education",
            "skills",
            "certifications",
            "leadership",
            "languages",
        ]
    ]
    meta: Meta
    profile: TextAtom
    experience: list[Experience]
    projects: list[Project]
    education: list[Education]
    skills: list[SkillGroup]
    certifications: list[Certification]
    leadership: list[Leadership]
    languages: list[Language]

    @model_validator(mode="after")
    def unique_ids(self) -> ResumeData:
        ids: list[str] = []

        def visit(value: Any) -> None:
            if isinstance(value, dict):
                if isinstance(value.get("id"), str):
                    ids.append(value["id"])
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(self.model_dump(mode="json"))
        duplicates = sorted({item for item in ids if ids.count(item) > 1})
        if duplicates:
            raise ValueError(f"duplicate IDs: {', '.join(duplicates)}")
        return self


Coverage = Literal["covered", "partial", "missing"]


class JDRequirement(StrictModel):
    requirement_id: str
    text: str
    priority: Literal["must_have", "nice_to_have"]
    keywords: list[str] = Field(default_factory=list)
    coverage: Coverage = "missing"
    evidence_ids: list[str] = Field(default_factory=list)


class JDAnalysis(StrictModel):
    company: str | None = None
    role_title: str
    seniority: Literal["junior", "mid", "senior", "lead", "unclear"] = "unclear"
    requirements: list[JDRequirement]
    culture_signals: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    summary: str


class EditBase(StrictModel):
    edit_id: str
    target_id: str
    rationale: str
    jd_requirement_ids: list[str]
    evidence_ids: list[str]
    risk: Literal["safe", "review"] = "safe"
    warnings: list[str] = Field(default_factory=list)


class RewriteText(EditBase):
    op: Literal["rewrite_text"]
    field: str = "text"
    before: str
    after: str


class RemoveItem(EditBase):
    op: Literal["remove_item"]
    expected_parent_id: str | None = None


class MoveItem(EditBase):
    op: Literal["move_item"]
    expected_parent_id: str | None = None
    destination_parent_id: str | None = None
    destination_collection: str
    position: int = Field(ge=0)


class AddItem(EditBase):
    op: Literal["add_item"]
    target_id: str
    collection: str
    position: int | None = Field(default=None, ge=0)
    item_type: Literal["text_atom", "project", "skill_group", "certification", "leadership", "language"]
    item: TextAtom | Project | SkillGroup | Certification | Leadership | Language

    @model_validator(mode="after")
    def item_matches_declared_type(self) -> AddItem:
        expected_type = {
            "text_atom": TextAtom,
            "project": Project,
            "skill_group": SkillGroup,
            "certification": Certification,
            "leadership": Leadership,
            "language": Language,
        }[self.item_type]
        if not isinstance(self.item, expected_type):
            raise ValueError(f"item must match item_type {self.item_type!r}")
        return self


class ReplaceCollection(EditBase):
    op: Literal["replace_collection"]
    field: str
    before: list[str]
    after: list[str]


class SetVisibility(EditBase):
    op: Literal["set_visibility"]
    visible: bool


Edit = Annotated[
    RewriteText | RemoveItem | MoveItem | AddItem | ReplaceCollection | SetVisibility,
    Field(discriminator="op"),
]


class TailorPlan(StrictModel):
    plan_id: str
    base_snapshot_hash: str
    edits: list[Edit]
    keyword_coverage: dict[str, Coverage]
    notes: list[str] = Field(default_factory=list)
    model_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class EditDecision(StrictModel):
    edit_id: str
    decision: Literal["approved", "rejected", "modified"]
    modified_after: str | None = None

    @model_validator(mode="after")
    def modified_has_text(self) -> EditDecision:
        if self.decision == "modified" and not self.modified_after:
            raise ValueError("modified decisions require modified_after")
        return self


class CoverParagraph(StrictModel):
    paragraph_id: str
    text: str
    evidence_ids: list[str]


class CoverLetter(StrictModel):
    greeting: str
    paragraphs: list[CoverParagraph] = Field(min_length=3, max_length=6)
    close: str
    signoff: str = "Sincerely,"
    name: str

    @model_validator(mode="after")
    def grounded(self) -> CoverLetter:
        if any(not paragraph.evidence_ids for paragraph in self.paragraphs):
            raise ValueError("every cover-letter paragraph requires evidence_ids")
        return self
