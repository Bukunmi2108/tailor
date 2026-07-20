import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, Check, Copy, PencilSimple, Warning } from "@phosphor-icons/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatMessage,
  CoverLetter,
  MessagePart,
} from "./types";

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

const TOOL_LABELS: Record<string, string> = {
  search_resume: "Searching resume evidence",
  inspect_resume_evidence: "Checking evidence",
  inspect_job_requirements: "Checking requirements",
  analyze_job_description: "Analyzing the role",
  propose_edits: "Proposing edits",
  draft_cover_letter: "Drafting cover letter",
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? "Working…";
}

function summaryLabel(tools: ToolPart[]): string {
  const running = tools.filter((tool) => tool.status === "running");
  const active = running.length ? running : tools;
  const labels = new Set(active.map((tool) => toolLabel(tool.tool)));
  return labels.size === 1 ? [...labels][0] : "Working…";
}

function ToolTrace({ tools }: { tools: ToolPart[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((tool) => tool.status === "running");
  return (
    <details className="tool-trace" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <CaretDown className={open ? "open" : ""} />
        <span className={`tool-trace__dot ${running ? "running" : "complete"}`} />
        <span className="tool-trace__label">{summaryLabel(tools)}</span>
        <span className="tool-trace__count">{tools.length}</span>
      </summary>
      <ol className="tool-trace__timeline">
        {tools.map((tool) => (
          <li key={tool.id}>
            <span className={`tool-status ${tool.status}`} />
            <span>{toolLabel(tool.tool)}</span>
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
  onReviewEdits: (messageId: string, partId: string) => void;
  onCoverLetterChange: (messageId: string, partId: string, coverLetter: CoverLetter) => void;
  onEditMessage: (messageId: string, text: string) => void;
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
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content ?? "");

  const assistantText = useMemo(() => {
    if (message.content) return message.content;
    return parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n");
  }, [message.content, parts]);
  const copyText = message.role === "user" ? message.content ?? "" : assistantText;

  async function copy() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard access denied; nothing else to fall back to
    }
  }

  function startEdit() {
    setEditText(message.content ?? "");
    setEditing(true);
  }

  function saveEdit() {
    const text = editText.trim();
    setEditing(false);
    if (text && text !== message.content) actions.onEditMessage(message.id, text);
  }

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
          case "edits_proposed":
            const decided = part.decisions.length;
            const reviewCount = part.plan.edits.filter((edit) => edit.risk === "review").length;
            return (
              <section className="proposal-summary" key={part.id}>
                <div>
                  <span>Resume review</span>
                  <h4>{part.plan.edits.length} proposed edit{part.plan.edits.length === 1 ? "" : "s"}</h4>
                  <p>{decided} decided{reviewCount ? `, ${reviewCount} need a closer look` : ""}</p>
                </div>
                <button className="primary" onClick={() => actions.onReviewEdits(message.id, part.id)}>
                  {decided ? "Continue review" : "Review edits"}
                </button>
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
      {message.role === "user" && (
        editing ? (
          <div className="message-edit">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              autoFocus
              rows={1}
            />
            <div className="message-edit__actions">
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="message-text">{message.content}</p>
        )
      )}
      {!editing && (message.role === "user" || assistantText) && (
        <div className="message-actions">
          <button type="button" className="icon-button" title="Copy" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
          </button>
          {message.role === "user" && (
            <button type="button" className="icon-button" title="Edit" onClick={startEdit}>
              <PencilSimple />
            </button>
          )}
        </div>
      )}
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
