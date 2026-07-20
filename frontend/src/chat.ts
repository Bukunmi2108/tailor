import { token } from "./api";
import type { Analysis, ChatMessage, MessagePart, Resume, ServerEvent } from "./types";

const API = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "https://bukunmi2108-tailor.hf.space"
).replace(/\/$/, "");

function wsUrl(): string {
  return API.replace(/^http/, "ws") + "/ws/chat";
}

export type ConnectChatPayload = {
  message: string;
  message_history: unknown[] | null;
  resume: Resume;
  analysis: Analysis | null;
};

export function connectChat(
  payload: ConnectChatPayload,
  onEvent: (event: ServerEvent) => void,
  onClose: () => void,
  onError: (message: string) => void,
): WebSocket {
  const socket = new WebSocket(wsUrl());
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ token: token.get() ?? "", ...payload }));
  });
  socket.addEventListener("message", (message) => {
    try {
      onEvent(JSON.parse(message.data as string) as ServerEvent);
    } catch {
      onError("Received an unreadable event from Tailor.");
    }
  });
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", () => onError("Connection to Tailor was interrupted."));
  return socket;
}

const partId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

function withParts(
  messages: ChatMessage[],
  messageId: string,
  update: (parts: MessagePart[]) => MessagePart[],
): ChatMessage[] {
  return messages.map((message) =>
    message.id === messageId ? { ...message, parts: update(message.parts ?? []) } : message,
  );
}

function appendTextPart(
  messages: ChatMessage[],
  messageId: string,
  kind: "reasoning" | "text",
  text: string,
): ChatMessage[] {
  return withParts(messages, messageId, (parts) => {
    const last = parts[parts.length - 1];
    if (last?.type === kind) {
      return [...parts.slice(0, -1), { ...last, text: last.text + text, status: "streaming" }];
    }
    return [...parts, { id: partId(kind), type: kind, text, status: "streaming" }];
  });
}

function startTool(messages: ChatMessage[], messageId: string, tool: string, input?: Record<string, unknown>) {
  return withParts(messages, messageId, (parts) => [
    ...parts,
    { id: partId("tool"), type: "tool", tool, status: "running", input },
  ]);
}

function completeTool(messages: ChatMessage[], messageId: string, tool: string, output?: Record<string, unknown>) {
  return withParts(messages, messageId, (parts) => {
    const index = [...parts].reverse().findIndex((part) => part.type === "tool" && part.tool === tool && part.status === "running");
    if (index === -1) return parts;
    const realIndex = parts.length - 1 - index;
    const part = parts[realIndex];
    if (part.type !== "tool") return parts;
    const updated = [...parts];
    updated[realIndex] = { ...part, status: "complete", output };
    return updated;
  });
}

export function applyServerEvent(
  messages: ChatMessage[],
  assistantId: string,
  event: ServerEvent,
): ChatMessage[] {
  switch (event.type) {
    case "reasoning.delta":
      return appendTextPart(messages, assistantId, "reasoning", event.text);
    case "message.delta":
      return appendTextPart(messages, assistantId, "text", event.text);
    case "tool.started":
      return startTool(messages, assistantId, event.tool, event.input);
    case "tool.result":
      return completeTool(messages, assistantId, event.tool, event.output);
    case "edits.proposed":
      return withParts(messages, assistantId, (parts) => [
        ...parts,
        { id: partId("edits"), type: "edits_proposed", plan: event.plan, decisions: [] },
      ]);
    case "cover_letter.drafted":
      return withParts(messages, assistantId, (parts) => [
        ...parts,
        { id: partId("cover"), type: "cover_letter", coverLetter: event.cover_letter },
      ]);
    case "model.selected":
      return withParts(messages, assistantId, (parts) => [
        ...parts,
        { id: partId("model"), type: "model", provider: event.provider, model: event.model },
      ]);
    case "model.fallback":
      return withParts(messages, assistantId, (parts) => [
        ...parts,
        {
          id: partId("model"),
          type: "model",
          provider: event.provider,
          model: event.model,
          fallback: true,
          reason: event.reason,
        },
      ]);
    case "message.completed":
      return messages.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: event.text,
              status: "complete",
              parts: (message.parts ?? []).map((part) =>
                part.type === "reasoning" || part.type === "text"
                  ? { ...part, status: "complete" }
                  : part,
              ),
            }
          : message,
      );
    case "error":
      return messages.map((message) =>
        message.id === assistantId ? { ...message, status: "error", content: event.message } : message,
      );
    default:
      return messages;
  }
}

export function decisionsForPlan(messages: ChatMessage[], planId: string) {
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type === "edits_proposed" && part.plan.plan_id === planId) return part;
    }
  }
  return undefined;
}
