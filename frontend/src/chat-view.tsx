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
  onReviewEdits: (messageId: string, partId: string) => void;
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
