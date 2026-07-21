from __future__ import annotations

from copy import deepcopy
from typing import Any

from pydantic import TypeAdapter, ValidationError

from .models import (
    AddItem,
    Certification,
    CoverLetter,
    Edit,
    EditDecision,
    Language,
    Leadership,
    Project,
    ResumeData,
    SkillGroup,
    TailorPlan,
    TextAtom,
)
from .tree import find_node
from .util import content_hash


class EditConflict(ValueError):
    pass


PROTECTED_FIELDS = {"name", "email", "phone", "company", "dates", "institution"}
ITEM_ADAPTERS = {
    "text_atom": TypeAdapter(TextAtom),
    "project": TypeAdapter(Project),
    "skill_group": TypeAdapter(SkillGroup),
    "certification": TypeAdapter(Certification),
    "leadership": TypeAdapter(Leadership),
    "language": TypeAdapter(Language),
}


def _resolve_collection(root: dict[str, Any], target_id: str, field: str) -> list[Any]:
    if target_id == "resume.root":
        collection = root.get(field)
    else:
        found = find_node(root, target_id)
        if not found:
            raise EditConflict(f"target {target_id!r} does not exist")
        collection = found[0].get(field)
    if not isinstance(collection, list):
        raise EditConflict(f"{target_id}.{field} is not a collection")
    return collection


def _apply(root: dict[str, Any], edit: Edit) -> None:
    if edit.op == "add_item":
        assert isinstance(edit, AddItem)
        try:
            item = ITEM_ADAPTERS[edit.item_type].validate_python(edit.item).model_dump(mode="json")
        except (KeyError, ValidationError) as exc:
            raise EditConflict(f"invalid {edit.item_type} payload: {exc}") from exc
        if find_node(root, item["id"]):
            raise EditConflict(f"item ID {item['id']!r} already exists")
        collection = _resolve_collection(root, edit.target_id, edit.collection)
        position = len(collection) if edit.position is None else min(edit.position, len(collection))
        collection.insert(position, item)
        return

    found = find_node(root, edit.target_id)
    if not found:
        raise EditConflict(f"target {edit.target_id!r} does not exist")
    item, parent, key = found

    if edit.op == "rewrite_text":
        if edit.field in PROTECTED_FIELDS:
            raise EditConflict(f"field {edit.field!r} is protected")
        if item.get(edit.field) != edit.before:
            raise EditConflict(f"stale before value for {edit.target_id}.{edit.field}")
        item[edit.field] = edit.after
    elif edit.op == "remove_item":
        if not isinstance(parent, list):
            raise EditConflict("only list items can be removed")
        parent.pop(key)
    elif edit.op == "set_visibility":
        item["visible"] = edit.visible
    elif edit.op == "replace_collection":
        current = item.get(edit.field)
        if current != edit.before:
            raise EditConflict(f"stale collection for {edit.target_id}.{edit.field}")
        item[edit.field] = edit.after
    elif edit.op == "move_item":
        if not isinstance(parent, list):
            raise EditConflict("only list items can be moved")
        moving = parent.pop(key)
        destination = _resolve_collection(
            root, edit.destination_parent_id or "resume.root", edit.destination_collection
        )
        destination.insert(min(edit.position, len(destination)), moving)
    else:
        raise EditConflict(f"unsupported operation {edit.op}")


def derive_resume(
    snapshot: ResumeData,
    plan: TailorPlan,
    decisions: list[EditDecision],
    expected_snapshot_hash: str,
) -> tuple[ResumeData, list[str]]:
    actual_hash = content_hash(snapshot)
    if expected_snapshot_hash != actual_hash or plan.base_snapshot_hash != actual_hash:
        raise EditConflict("plan targets a different resume snapshot")
    decision_map = {decision.edit_id: decision for decision in decisions}
    root = deepcopy(snapshot.model_dump(mode="json"))
    warnings: list[str] = []
    for edit in plan.edits:
        decision = decision_map.get(edit.edit_id)
        if not decision or decision.decision == "rejected":
            continue
        effective = edit.model_copy(deep=True)
        if decision.decision == "modified":
            if effective.op != "rewrite_text":
                raise EditConflict("only rewrite operations accept modified text")
            effective.after = decision.modified_after or ""
        _apply(root, effective)
        warnings.extend(effective.warnings)
    return ResumeData.model_validate(root), warnings


def validate_cover_evidence(letter: CoverLetter, resume: ResumeData) -> None:
    root = resume.model_dump(mode="json")
    missing = sorted(
        {
            evidence
            for paragraph in letter.paragraphs
            for evidence in paragraph.evidence_ids
            if not find_node(root, evidence)
        }
    )
    if missing:
        raise EditConflict(f"unknown cover-letter evidence IDs: {', '.join(missing)}")
