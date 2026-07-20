import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import { wordDiff } from "./diff";
import type { Decision, Edit, Plan, Resume } from "./types";

type Props = {
  plan: Plan;
  decisions: Decision[];
  resume: Resume;
  activeEditId: string;
  busy: boolean;
  onActiveChange: (editId: string) => void;
  onDecision: (decision: Decision) => void;
  onClose: () => void;
};

function findAtom(value: unknown, targetId: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findAtom(child, targetId);
      if (match) return match;
    }
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.id === targetId) return record;
    for (const child of Object.values(record)) {
      const match = findAtom(child, targetId);
      if (match) return match;
    }
  }
  return undefined;
}

function atomLabel(edit: Edit, resume: Resume): string {
  const atom = findAtom(resume, edit.target_id);
  if (!atom) return edit.target_id === "resume.root" ? "Resume" : "Resume content";
  if (typeof atom.company === "string") return `${atom.company} / Experience`;
  if (typeof atom.name === "string") return `${atom.name} / Project`;
  if (typeof atom.institution === "string") return `${atom.institution} / Education`;
  if (typeof atom.label === "string") return `${atom.label} / Skills`;
  if (typeof atom.title === "string") return atom.title;
  if (typeof atom.language === "string") return `${atom.language} / Languages`;
  if (typeof atom.text === "string") return edit.target_id.split(".").slice(0, -1).join(" / ");
  return "Resume content";
}

function DiffLine({ before, after, side }: { before: string; after: string; side: "removed" | "added" }) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className={`review-diff-line ${side}`}>
      {parts
        .filter((part) => part.kind === "same" || part.kind === side)
        .map((part, index) => (
          <span key={index} className={part.kind === side ? "changed" : undefined}>{part.value}</span>
        ))}
    </p>
  );
}

function TextChange({
  edit,
  editing,
  custom,
  onCustomChange,
  onEditingChange,
}: {
  edit: Edit;
  editing: boolean;
  custom: string;
  onCustomChange: (value: string) => void;
  onEditingChange: (value: boolean) => void;
}) {
  const proposedText = typeof edit.after === "string" ? edit.after : "";
  return (
    <>
      <div className="review-copy-block">
        <span>Current</span>
        <DiffLine before={typeof edit.before === "string" ? edit.before : ""} after={proposedText} side="removed" />
      </div>
      <div className="review-copy-block proposed">
        <span>Proposed</span>
        {editing ? (
          <textarea value={custom} onChange={(event) => onCustomChange(event.target.value)} autoFocus />
        ) : (
          <DiffLine before={typeof edit.before === "string" ? edit.before : ""} after={proposedText} side="added" />
        )}
      </div>
      <button className="review-edit-toggle" onClick={() => onEditingChange(!editing)}>
        <PencilSimple /> {editing ? "Use proposed text" : "Edit wording"}
      </button>
    </>
  );
}

function OperationChange({
  edit,
  editing,
  custom,
  onCustomChange,
  onEditingChange,
}: {
  edit: Edit;
  editing: boolean;
  custom: string;
  onCustomChange: (value: string) => void;
  onEditingChange: (value: boolean) => void;
}) {
  if (edit.op === "rewrite_text") return <TextChange edit={edit} editing={editing} custom={custom} onCustomChange={onCustomChange} onEditingChange={onEditingChange} />;
  if (edit.op === "replace_collection") {
    const before = Array.isArray(edit.before) ? edit.before : [];
    const after = Array.isArray(edit.after) ? edit.after : [];
    return (
      <div className="collection-change">
        <div><span>Current</span>{before.map((item) => <em key={String(item)}>{String(item)}</em>)}</div>
        <ArrowRight />
        <div><span>Proposed</span>{after.map((item) => <em key={String(item)}>{String(item)}</em>)}</div>
      </div>
    );
  }
  if (edit.op === "add_item") {
    const item = edit.item as Record<string, unknown> | undefined;
    return <div className="operation-preview"><span>Add to resume</span><p>{String(item?.text ?? item?.name ?? item?.label ?? "New resume item")}</p></div>;
  }
  if (edit.op === "remove_item" || (edit.op === "set_visibility" && edit.visible === false)) {
    return <div className="operation-preview removal"><span>Omit for this application</span><p>This complete item will be hidden from the tailored resume.</p></div>;
  }
  if (edit.op === "move_item") {
    return <div className="operation-preview"><span>Reorder</span><p>Move this item to position {Number(edit.position) + 1} in {String(edit.destination_collection ?? "its section")}.</p></div>;
  }
  return <div className="operation-preview"><span>{edit.op.replaceAll("_", " ")}</span><p>{edit.rationale}</p></div>;
}

export function ReviewDeck({
  plan,
  decisions,
  resume,
  activeEditId,
  busy,
  onActiveChange,
  onDecision,
  onClose,
}: Props) {
  const activeIndex = Math.max(0, plan.edits.findIndex((edit) => edit.edit_id === activeEditId));
  const edit = plan.edits[activeIndex];
  const proposedText = typeof edit?.after === "string" ? edit.after : "";
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(proposedText);
  const decision = decisions.find((item) => item.edit_id === edit?.edit_id);
  const complete = decisions.length >= plan.edits.length;
  const counts = useMemo(
    () => ({
      approved: decisions.filter((item) => item.decision === "approved").length,
      rejected: decisions.filter((item) => item.decision === "rejected").length,
      modified: decisions.filter((item) => item.decision === "modified").length,
    }),
    [decisions],
  );

  function move(direction: -1 | 1) {
    const next = plan.edits[activeIndex + direction];
    if (next) onActiveChange(next.edit_id);
  }

  function decide(kind: "approved" | "rejected" | "modified") {
    if (!edit || busy) return;
    onDecision({
      edit_id: edit.edit_id,
      decision: kind,
      ...(kind === "modified"
        ? { modified_after: custom || proposedText }
        : {}),
    });
    const next = plan.edits.slice(activeIndex + 1).find((item) => !decisions.some((d) => d.edit_id === item.edit_id));
    if (next) onActiveChange(next.edit_id);
  }

  useEffect(() => {
    setEditing(decision?.decision === "modified");
    setCustom(decision?.modified_after ?? proposedText);
  }, [edit.edit_id, decision?.decision, decision?.modified_after, proposedText]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
      if (event.key.toLowerCase() === "a") decide("approved");
      if (event.key.toLowerCase() === "r") decide("rejected");
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!edit) return null;
  return (
    <section className="review-mode">
      <header className="review-header">
        <div>
          <span>Review changes</span>
          <strong>Edit {activeIndex + 1} of {plan.edits.length}</strong>
        </div>
        <button className="icon-button" aria-label="Close review" onClick={onClose}><X /></button>
      </header>

      <div className="review-progress"><i style={{ width: `${((activeIndex + 1) / plan.edits.length) * 100}%` }} /></div>

      {complete && activeIndex === plan.edits.length - 1 && decision ? (
        <div className="review-complete">
          <Check weight="bold" />
          <h2>Review complete</h2>
          <p>{counts.approved} approved, {counts.modified} modified, {counts.rejected} rejected.</p>
          <button className="primary" onClick={onClose}>Return to conversation</button>
        </div>
      ) : (
        <div className="review-stage">
          <div className="review-card-shadow third" />
          <div className="review-card-shadow second" />
          <article className="review-card">
            <div className="review-card__meta">
              <span>{atomLabel(edit, resume)}</span>
              {edit.risk === "review" && <em>Check claim</em>}
            </div>
            <h2>{edit.rationale}</h2>
            <OperationChange edit={edit} editing={editing} custom={custom} onCustomChange={setCustom} onEditingChange={setEditing} />
            {edit.evidence_ids.length > 0 && (
              <details className="review-evidence">
                <summary>Evidence</summary>
                <p>{edit.evidence_ids.join(", ")}</p>
              </details>
            )}
            <div className="review-decisions">
              <button className={decision?.decision === "rejected" ? "selected reject" : ""} disabled={busy} onClick={() => decide("rejected")}>Reject</button>
              {edit.op === "rewrite_text" && editing && <button disabled={busy || !custom.trim()} onClick={() => decide("modified")}>Use edit</button>}
              <button className={`approve ${decision?.decision === "approved" ? "selected" : ""}`} disabled={busy} onClick={() => decide("approved")}><Check /> {busy ? "Applying" : "Approve"}</button>
            </div>
          </article>
        </div>
      )}

      <footer className="review-navigation">
        <button disabled={activeIndex === 0 || busy} onClick={() => move(-1)}><ArrowLeft /> Previous</button>
        <span>{decisions.length} decided</span>
        <button disabled={activeIndex === plan.edits.length - 1 || busy} onClick={() => move(1)}>Next <ArrowRight /></button>
      </footer>
    </section>
  );
}
