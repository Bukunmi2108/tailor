import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CaretDown,
  Check,
  CircleNotch,
  Warning,
  Wrench,
} from "@phosphor-icons/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { wordDiff } from "./diff";
import type {
  Analysis,
  ChatMessage,
  CoverLetter,
  Decision,
  Edit,
  MessagePart,
} from "./types";

function Diff({ edit }: { edit: Edit }) {
  const parts = useMemo(
    () =>
      typeof edit.before === "string" && typeof edit.after === "string"
        ? wordDiff(edit.before, edit.after)
        : undefined,
    [edit.before, edit.after],
  );
  if (!parts) return <p className="operation">{edit.op.replaceAll("_", " ")}</p>;
  return (
    <p className="diff">
      {parts.map((part, index) => (
        <span key={index} className={part.kind}>
          {part.value}
        </span>
      ))}
    </p>
  );
}

const EditCard = memo(function EditCard({
  edit,
  decision,
  onDecision,
}: {
  edit: Edit;
  decision?: Decision;
  onDecision: (decision: Decision) => void;
}) {
  const [custom, setCustom] = useState(decision?.modified_after ?? edit.after ?? "");
  const selected = decision?.decision;
  return (
    <article className={`edit-card ${edit.risk}`}>
      <header>
        <div>
          <span className="target">{edit.target_id}</span>
          <h3>{edit.rationale}</h3>
        </div>
        <span className={`risk ${edit.risk}`}>{edit.risk}</span>
      </header>
      <Diff edit={edit} />
      {edit.warnings?.map((warning) => (
        <p className="warning" key={warning}>
          <Warning /> {warning}
        </p>
      ))}
      <div className="evidence">
        {edit.evidence_ids.map((item) => (
          <code key={item}>{item}</code>
        ))}
      </div>
      {selected === "modified" && (
        <textarea
          aria-label="Modified replacement"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() =>
            onDecision({ edit_id: edit.edit_id, decision: "modified", modified_after: custom })
          }
        />
      )}
      <div className="decision-row">
        <button
          className={selected === "approved" ? "selected" : ""}
          onClick={() => onDecision({ edit_id: edit.edit_id, decision: "approved" })}
        >
          <Check />
          Approve
        </button>
        {typeof edit.after === "string" && (
          <button
            className={selected === "modified" ? "selected" : ""}
            onClick={() =>
              onDecision({ edit_id: edit.edit_id, decision: "modified", modified_after: custom })
            }
          >
            Edit
          </button>
        )}
        <button
          className={selected === "rejected" ? "selected reject" : ""}
          onClick={() => onDecision({ edit_id: edit.edit_id, decision: "rejected" })}
        >
          Reject
        </button>
      </div>
    </article>
  );
});

function AnalysisView({
  analysis,
  onChange,
}: {
  analysis: Analysis;
  onChange: (value: Analysis) => void;
}) {
  return (
    <section className="analysis">
      <div className="analysis-title">
        <h3>Role analysis</h3>
        <span>{analysis.seniority}</span>
      </div>
      <p>{analysis.summary}</p>
      <div className="requirements">
        {analysis.requirements.map((requirement, index) => (
          <div key={requirement.requirement_id} className="requirement">
            <select
              aria-label="Coverage"
              value={requirement.coverage}
              onChange={(event) => {
                const requirements = [...analysis.requirements];
                requirements[index] = {
                  ...requirement,
                  coverage: event.target.value as typeof requirement.coverage,
                };
                onChange({ ...analysis, requirements });
              }}
            >
              <option value="covered">Covered</option>
              <option value="partial">Partial</option>
              <option value="missing">Missing</option>
            </select>
            <textarea
              aria-label="Requirement"
              value={requirement.text}
              onChange={(event) => {
                const requirements = [...analysis.requirements];
                requirements[index] = { ...requirement, text: event.target.value };
                onChange({ ...analysis, requirements });
              }}
            />
          </div>
        ))}
      </div>
      {analysis.red_flags.length > 0 && (
        <div className="red-flags">
          <strong>Review before applying</strong>
          {analysis.red_flags.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function CoverEditor({
  letter,
  onChange,
}: {
  letter: CoverLetter;
  onChange: (letter: CoverLetter) => void;
}) {
  return (
    <div className="cover-editor">
      <label>
        Greeting
        <input value={letter.greeting} onChange={(e) => onChange({ ...letter, greeting: e.target.value })} />
      </label>
      {letter.paragraphs.map((paragraph, index) => (
        <label key={paragraph.paragraph_id}>
          Paragraph {index + 1}
          <textarea
            value={paragraph.text}
            onChange={(e) => {
              const paragraphs = [...letter.paragraphs];
              paragraphs[index] = { ...paragraph, text: e.target.value };
              onChange({ ...letter, paragraphs });
            }}
          />
          <span className="citations">Evidence: {paragraph.evidence_ids.join(", ")}</span>
        </label>
      ))}
      <label>
        Closing
        <textarea value={letter.close} onChange={(e) => onChange({ ...letter, close: e.target.value })} />
      </label>
    </div>
  );
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="message-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
      {streaming && <span className="stream-caret" />}
    </div>
  );
}

function ReasoningPanel({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const autoOpened = useRef(streaming);
  useEffect(() => {
    if (streaming && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [streaming]);
  return (
    <div className="reasoning-panel">
      <button className="reasoning-toggle" onClick={() => setOpen((v) => !v)}>
        <CaretDown className={open ? "open" : ""} />
        {streaming ? "Thinking…" : "Thinking"}
      </button>
      {open && <p className="reasoning-text">{text}</p>}
    </div>
  );
}

type ToolPart = Extract<MessagePart, { type: "tool" }>;

function ToolTrace({ tools }: { tools: ToolPart[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((tool) => tool.status === "running");
  return (
    <details className="tool-trace" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {running ? <CircleNotch className="spin" /> : <Wrench />}
        {running ? "Checking resume evidence…" : `Used ${tools.length} resume tool${tools.length === 1 ? "" : "s"}`}
      </summary>
      <ol>
        {tools.map((tool) => (
          <li key={tool.id}>
            <span className={`tool-status ${tool.status}`}>
              {tool.status === "running" ? <CircleNotch className="spin" /> : <Check />}
            </span>
            <code>{tool.tool}</code>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ModelBadge({ part }: { part: Extract<MessagePart, { type: "model" }> }) {
  if (!part.fallback) return null;
  return (
    <p className="model-fallback-note">
      <Warning /> Fell back to {part.model} ({part.reason ?? "primary unavailable"})
    </p>
  );
}

type Grouped =
  | { kind: "tools"; tools: ToolPart[] }
  | { kind: "part"; part: Exclude<MessagePart, ToolPart> };

function groupParts(parts: MessagePart[]): Grouped[] {
  const groups: Grouped[] = [];
  for (const part of parts) {
    if (part.type === "tool") {
      const last = groups[groups.length - 1];
      if (last?.kind === "tools") last.tools.push(part);
      else groups.push({ kind: "tools", tools: [part] });
    } else {
      groups.push({ kind: "part", part });
    }
  }
  return groups;
}

export type ChatActions = {
  onEditDecision: (messageId: string, partId: string, decision: Decision) => void;
  onApproveSafeEdits: (messageId: string, partId: string) => void;
  onAnalysisChange: (messageId: string, partId: string, analysis: Analysis) => void;
  onCoverLetterChange: (messageId: string, partId: string, coverLetter: CoverLetter) => void;
};

const MessageBubble = memo(function MessageBubble({
  message,
  actions,
}: {
  message: ChatMessage;
  actions: ChatActions;
}) {
  const parts = message.parts ?? [];
  const reasoning = parts.find((part) => part.type === "reasoning");
  const groups = useMemo(() => groupParts(parts.filter((part) => part.type !== "reasoning")), [parts]);
  const streaming = message.status === "streaming";

  return (
    <article className={`message-bubble ${message.role}`}>
      {message.role === "assistant" && reasoning?.type === "reasoning" && reasoning.text && (
        <ReasoningPanel text={reasoning.text} streaming={reasoning.status === "streaming"} />
      )}
      {groups.map((group, index) => {
        if (group.kind === "tools") return <ToolTrace key={index} tools={group.tools} />;
        const part = group.part;
        switch (part.type) {
          case "text":
            return (
              <Markdown
                key={part.id}
                text={part.text}
                streaming={streaming && index === groups.length - 1}
              />
            );
          case "model":
            return <ModelBadge key={part.id} part={part} />;
          case "analysis":
            return (
              <AnalysisView
                key={part.id}
                analysis={part.analysis}
                onChange={(analysis) => actions.onAnalysisChange(message.id, part.id, analysis)}
              />
            );
          case "edits_proposed":
            return (
              <section className="proposed-edits" key={part.id}>
                <div className="proposed-edits__heading">
                  <h4>{part.plan.edits.length} proposed edit{part.plan.edits.length === 1 ? "" : "s"}</h4>
                  <button className="quiet" onClick={() => actions.onApproveSafeEdits(message.id, part.id)}>
                    Approve safe
                  </button>
                </div>
                {part.plan.edits.map((edit) => (
                  <EditCard
                    key={edit.edit_id}
                    edit={edit}
                    decision={part.decisions.find((d) => d.edit_id === edit.edit_id)}
                    onDecision={(decision) => actions.onEditDecision(message.id, part.id, decision)}
                  />
                ))}
              </section>
            );
          case "cover_letter":
            return (
              <CoverEditor
                key={part.id}
                letter={part.coverLetter}
                onChange={(letter) => actions.onCoverLetterChange(message.id, part.id, letter)}
              />
            );
          default:
            return null;
        }
      })}
      {message.role === "user" && <p className="message-text">{message.content}</p>}
    </article>
  );
});

export function ChatThread({ messages, actions }: { messages: ChatMessage[]; actions: ChatActions }) {
  return (
    <div className="chat-thread">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} actions={actions} />
      ))}
    </div>
  );
}
