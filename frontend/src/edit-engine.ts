import type { Decision, Edit, Plan, Resume } from "./types";

type JsonRecord = Record<string, unknown>;

// Keep in sync with PROTECTED_FIELDS in backend/app/engine.py. The client derives
// optimistically, so it must reject exactly what the server's derive_resume rejects —
// otherwise the UI shows an edit the backend will refuse.
const PROTECTED_FIELDS = new Set(["name", "email", "phone", "company", "dates", "institution"]);

function find(value: unknown, targetId: string, parent?: unknown, key?: string | number): {
  item: JsonRecord;
  parent?: unknown;
  key?: string | number;
} | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = find(value[index], targetId, value, index);
      if (match) return match;
    }
  } else if (value && typeof value === "object") {
    const record = value as JsonRecord;
    if (record.id === targetId) return { item: record, parent, key };
    for (const [childKey, child] of Object.entries(record)) {
      const match = find(child, targetId, record, childKey);
      if (match) return match;
    }
  }
  return undefined;
}

function collection(root: JsonRecord, targetId: string, field: string): unknown[] {
  const target = targetId === "resume.root" ? root : find(root, targetId)?.item;
  const value = target?.[field];
  if (!Array.isArray(value)) throw new Error(`${targetId}.${field} is not a collection`);
  return value;
}

function apply(root: JsonRecord, edit: Edit, decision: Decision) {
  if (edit.op === "add_item") {
    const target = collection(root, edit.target_id, String(edit.collection));
    const position = typeof edit.position === "number" ? Math.min(edit.position, target.length) : target.length;
    target.splice(position, 0, structuredClone(edit.item));
    return;
  }

  const match = find(root, edit.target_id);
  if (!match) throw new Error(`Resume target ${edit.target_id} is missing`);
  const { item, parent, key } = match;

  if (edit.op === "rewrite_text") {
    const field = String(edit.field ?? "text");
    if (PROTECTED_FIELDS.has(field)) throw new Error(`Field ${field} is protected`);
    if (item[field] !== edit.before) throw new Error(`Stale text at ${edit.target_id}`);
    item[field] = decision.decision === "modified" ? decision.modified_after ?? "" : edit.after;
  } else if (edit.op === "remove_item") {
    if (!Array.isArray(parent) || typeof key !== "number") throw new Error("Only list items can be removed");
    parent.splice(key, 1);
  } else if (edit.op === "set_visibility") {
    item.visible = edit.visible;
  } else if (edit.op === "replace_collection") {
    const field = String(edit.field);
    if (JSON.stringify(item[field]) !== JSON.stringify(edit.before)) throw new Error(`Stale collection at ${edit.target_id}`);
    item[field] = structuredClone(edit.after);
  } else if (edit.op === "move_item") {
    if (!Array.isArray(parent) || typeof key !== "number") throw new Error("Only list items can be moved");
    const [moving] = parent.splice(key, 1);
    const destination = collection(
      root,
      typeof edit.destination_parent_id === "string" ? edit.destination_parent_id : "resume.root",
      String(edit.destination_collection),
    );
    const position = typeof edit.position === "number" ? Math.min(edit.position, destination.length) : destination.length;
    destination.splice(position, 0, moving);
  }
}

export function deriveResumeLocal(base: Resume, plan: Plan, decisions: Decision[]): Resume {
  const root = structuredClone(base) as unknown as JsonRecord;
  const decisionMap = new Map(decisions.map((decision) => [decision.edit_id, decision]));
  for (const edit of plan.edits) {
    const decision = decisionMap.get(edit.edit_id);
    if (!decision || decision.decision === "rejected") continue;
    apply(root, edit, decision);
  }
  return root as unknown as Resume;
}
