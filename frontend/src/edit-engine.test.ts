import { describe, expect, it } from "vitest";
import { deriveResumeLocal } from "./edit-engine";
import type { Plan, Resume } from "./types";

const base = {
  profile: { id: "profile.main", text: "Original", visible: true },
  experience: [], projects: [], education: [], skills: [], certifications: [], leadership: [], languages: [],
} as unknown as Resume;

function plan(edit: Plan["edits"][number]): Plan {
  return {
    plan_id: "plan-1",
    base_snapshot_hash: "base-hash",
    edits: [edit],
    keyword_coverage: {},
    notes: [],
    created_at: new Date(0).toISOString(),
  };
}

const rewrite = {
  edit_id: "edit-1",
  target_id: "profile.main",
  op: "rewrite_text",
  field: "text",
  before: "Original",
  after: "Proposed",
  rationale: "Match the role",
  jd_requirement_ids: [],
  evidence_ids: ["profile.main"],
  risk: "safe",
  warnings: [],
} satisfies Plan["edits"][number];

describe("deriveResumeLocal", () => {
  it("applies approved rewrites without mutating the base", () => {
    const result = deriveResumeLocal(base, plan(rewrite), [{ edit_id: "edit-1", decision: "approved" }]);
    expect(result.profile.text).toBe("Proposed");
    expect(base.profile.text).toBe("Original");
  });

  it("uses human-modified wording", () => {
    const result = deriveResumeLocal(base, plan(rewrite), [
      { edit_id: "edit-1", decision: "modified", modified_after: "Human wording" },
    ]);
    expect(result.profile.text).toBe("Human wording");
  });

  it("leaves rejected edits unapplied", () => {
    const result = deriveResumeLocal(base, plan(rewrite), [{ edit_id: "edit-1", decision: "rejected" }]);
    expect(result).toEqual(base);
  });
});
