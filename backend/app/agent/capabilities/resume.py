from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.tools import RunContext
from pydantic_ai.toolsets.function import FunctionToolset

from ..deps import AgentDeps


class ResumeAtom(BaseModel):
    id: str
    kind: str
    content: dict[str, Any]


class ResumeSearchResult(BaseModel):
    query: str
    matches: list[ResumeAtom]


class EvidenceResult(BaseModel):
    found: list[ResumeAtom]
    missing_ids: list[str]


class RequirementResult(BaseModel):
    found: list[dict[str, Any]]
    missing_ids: list[str]


@dataclass
class ResumeTools(AbstractCapability[AgentDeps]):
    max_results: int = 12

    def get_instructions(self):
        return (
            "Use the resume tools before asserting evidence or targeting an edit. "
            "Search when you need to discover relevant material. Inspect exact IDs before "
            "citing them. The tools return the complete verified source atoms; never infer "
            "a fact that is absent from those atoms."
        )

    def get_toolset(self) -> FunctionToolset[AgentDeps]:
        toolset = FunctionToolset[AgentDeps](id="resume_tools", strict=False)

        @toolset.tool(name="search_resume", strict=False)
        async def search_resume(
            ctx: RunContext[AgentDeps],
            query: str,
            limit: int = 8,
        ) -> ResumeSearchResult:
            """Search verified resume atoms by words, tags, labels, and IDs."""
            terms = {term.casefold() for term in query.split() if term.strip()}
            scored: list[tuple[int, ResumeAtom]] = []
            for atom in _resume_atoms(ctx.deps.resume):
                haystack = " ".join(_strings(atom.content)).casefold()
                score = sum(term in haystack for term in terms)
                if score:
                    scored.append((score, atom))
            scored.sort(key=lambda item: (-item[0], item[1].id))
            cap = max(1, min(limit, self.max_results))
            return ResumeSearchResult(query=query, matches=[atom for _, atom in scored[:cap]])

        @toolset.tool(name="inspect_resume_evidence", strict=False)
        async def inspect_resume_evidence(
            ctx: RunContext[AgentDeps], evidence_ids: list[str]
        ) -> EvidenceResult:
            """Load exact verified resume atoms for evidence IDs."""
            by_id = {atom.id: atom for atom in _resume_atoms(ctx.deps.resume)}
            return EvidenceResult(
                found=[by_id[item] for item in evidence_ids if item in by_id],
                missing_ids=[item for item in evidence_ids if item not in by_id],
            )

        @toolset.tool(name="inspect_job_requirements", strict=False)
        async def inspect_job_requirements(
            ctx: RunContext[AgentDeps], requirement_ids: list[str]
        ) -> RequirementResult:
            """Load corrected job requirements by their stable IDs."""
            requirements = ctx.deps.analysis.requirements if ctx.deps.analysis else []
            by_id = {item.requirement_id: item for item in requirements}
            return RequirementResult(
                found=[by_id[item].model_dump(mode="json") for item in requirement_ids if item in by_id],
                missing_ids=[item for item in requirement_ids if item not in by_id],
            )

        return toolset


def _resume_atoms(resume) -> list[ResumeAtom]:
    atoms: list[ResumeAtom] = []

    def visit(value: Any, kind: str = "resume") -> None:
        if isinstance(value, dict):
            identifier = value.get("id")
            if isinstance(identifier, str):
                atoms.append(ResumeAtom(id=identifier, kind=kind, content=value))
            for key, child in value.items():
                visit(child, key)
        elif isinstance(value, list):
            for child in value:
                visit(child, kind)

    visit(resume.model_dump(mode="json"))
    return atoms


def _strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _strings(child)
