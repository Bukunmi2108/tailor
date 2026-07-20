import pytest

from app.engine import EditConflict, derive_resume
from app.models import EditDecision, RewriteText, TailorPlan
from app.util import content_hash


def plan_for(resume, edit):
    return TailorPlan(
        plan_id="plan-test",
        base_snapshot_hash=content_hash(resume),
        edits=[edit],
        keyword_coverage={},
    )


def test_reject_all_returns_exact_snapshot(resume):
    edit = RewriteText(
        edit_id="edit-1",
        target_id="profile.main",
        op="rewrite_text",
        field="text",
        before=resume.profile.text,
        after="A grounded replacement.",
        rationale="Match the role",
        jd_requirement_ids=["req-ai"],
        evidence_ids=["profile.main"],
    )
    plan = plan_for(resume, edit)
    result, _ = derive_resume(
        resume,
        plan,
        [EditDecision(edit_id="edit-1", decision="rejected")],
        content_hash(resume),
    )
    assert result == resume


def test_modified_rewrite_is_applied_from_plan_base(resume):
    edit = RewriteText(
        edit_id="edit-1",
        target_id="profile.main",
        op="rewrite_text",
        before=resume.profile.text,
        after="Model wording",
        rationale="Match the role",
        jd_requirement_ids=["req-ai"],
        evidence_ids=["profile.main"],
    )
    result, _ = derive_resume(
        resume,
        plan_for(resume, edit),
        [EditDecision(edit_id="edit-1", decision="modified", modified_after="Human wording")],
        content_hash(resume),
    )
    assert result.profile.text == "Human wording"
    assert resume.profile.text != "Human wording"


def test_stale_snapshot_is_rejected(resume):
    edit = RewriteText(
        edit_id="edit-1",
        target_id="profile.main",
        op="rewrite_text",
        before=resume.profile.text,
        after="Replacement",
        rationale="Match role",
        jd_requirement_ids=[],
        evidence_ids=["profile.main"],
    )
    with pytest.raises(EditConflict, match="different resume snapshot"):
        derive_resume(resume, plan_for(resume, edit), [], "stale")


def test_protected_field_is_rejected(resume):
    edit = RewriteText(
        edit_id="edit-1",
        target_id="exp.qanooni",
        op="rewrite_text",
        field="company",
        before="Qanooni AI",
        after="Different employer",
        rationale="Bad edit",
        jd_requirement_ids=[],
        evidence_ids=["exp.qanooni"],
    )
    with pytest.raises(EditConflict, match="protected"):
        derive_resume(
            resume,
            plan_for(resume, edit),
            [EditDecision(edit_id="edit-1", decision="approved")],
            content_hash(resume),
        )
