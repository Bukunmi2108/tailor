from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from pydantic import BeforeValidator
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.exceptions import ModelRetry
from pydantic_ai.tools import RunContext
from pydantic_ai.toolsets.function import FunctionToolset

from ...engine import EditConflict, validate_cover_evidence
from ...models import Coverage, CoverLetter, Edit, JDAnalysis, TailorPlan
from ...util import content_hash
from ..deps import AgentDeps
from ..model_trace import get_model_trace


def _coerce_string_list(value: Any) -> Any:
    """Some models stringify simple list arguments (e.g. '["a", "b"]') instead of
    emitting a native JSON array, even with schema-conformant tool calls elsewhere
    in the same call. Accept both."""
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return [value]
        return parsed if isinstance(parsed, list) else [value]
    return value


StringList = Annotated[list[str], BeforeValidator(_coerce_string_list)]


@dataclass
class TailoringTools(AbstractCapability[AgentDeps]):
    def get_instructions(self):
        return (
            "Use analyze_job_description once per new job description before proposing edits. "
            "Use propose_edits to surface typed, evidence-linked resume changes for the user to "
            "approve, reject, or modify — never claim an edit was applied, only proposed. "
            "Use draft_cover_letter only when the user asks for a cover letter."
        )

    def get_toolset(self) -> FunctionToolset[AgentDeps]:
        toolset = FunctionToolset[AgentDeps](id="tailoring_tools", strict=False)

        @toolset.tool(name="analyze_job_description", strict=False)
        async def analyze_job_description(ctx: RunContext[AgentDeps], analysis: JDAnalysis) -> JDAnalysis:
            """Record the corrected job-description analysis for this conversation."""
            await ctx.deps.events.send("tool.started", tool="analyze_job_description", input={})
            ctx.deps.analysis = analysis
            await ctx.deps.events.send("analysis.completed", analysis=analysis.model_dump(mode="json"))
            return analysis

        @toolset.tool(name="propose_edits", strict=False)
        async def propose_edits(
            ctx: RunContext[AgentDeps],
            edits: list[Edit],
            keyword_coverage: dict[str, Coverage],
            notes: StringList | None = None,
        ) -> TailorPlan:
            """Propose typed, evidence-linked resume edits for the user to approve, reject, or modify."""
            await ctx.deps.events.send("tool.started", tool="propose_edits", input={"edit_count": len(edits)})
            normalized = [
                edit.model_copy(update={"edit_id": f"edit-{uuid.uuid4().hex[:10]}"}) for edit in edits
            ]
            trace = get_model_trace()
            plan = TailorPlan(
                plan_id=f"plan-{uuid.uuid4().hex[:12]}",
                base_snapshot_hash=content_hash(ctx.deps.resume),
                edits=normalized,
                keyword_coverage=keyword_coverage,
                notes=notes or [],
                model_id=trace.selected.model if trace and trace.selected else None,
            )
            await ctx.deps.events.send("edits.proposed", plan=plan.model_dump(mode="json"))
            return plan

        @toolset.tool(name="draft_cover_letter", strict=False)
        async def draft_cover_letter(ctx: RunContext[AgentDeps], cover_letter: CoverLetter) -> CoverLetter:
            """Return an evidence-linked cover letter draft for the user to review."""
            await ctx.deps.events.send("tool.started", tool="draft_cover_letter", input={})
            try:
                validate_cover_evidence(cover_letter, ctx.deps.resume)
            except EditConflict as exc:
                raise ModelRetry(str(exc)) from exc
            await ctx.deps.events.send(
                "cover_letter.drafted", cover_letter=cover_letter.model_dump(mode="json")
            )
            return cover_letter

        return toolset
