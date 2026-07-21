import { describe, expect, it } from "vitest";
import { createStreamEventBatcher, stopAssistantMessage } from "./chat";
import type { ChatMessage, ServerEvent } from "./types";

describe("stopAssistantMessage", () => {
  it("stops only the active assistant and settles its streaming parts", () => {
    const messages: ChatMessage[] = [
      {
        id: "assistant-active",
        role: "assistant",
        createdAt: "2026-07-20T00:00:00Z",
        status: "streaming",
        parts: [
          { id: "reasoning", type: "reasoning", text: "Working", status: "streaming" },
          { id: "tool", type: "tool", tool: "propose_edits", status: "running" },
        ],
      },
      {
        id: "assistant-old",
        role: "assistant",
        createdAt: "2026-07-20T00:00:00Z",
        status: "complete",
      },
    ];

    const result = stopAssistantMessage(messages, "assistant-active");

    expect(result[0].status).toBe("stopped");
    expect(result[0].parts?.[0]).toMatchObject({ type: "reasoning", status: "complete" });
    expect(result[0].parts?.[1]).toMatchObject({ type: "tool", status: "complete" });
    expect(result[1]).toBe(messages[1]);
  });
});

describe("createStreamEventBatcher", () => {
  it("commits a burst of text deltas once per animation frame", () => {
    let scheduled: FrameRequestCallback | undefined;
    const commits: ServerEvent[][] = [];
    const batcher = createStreamEventBatcher(
      (events) => commits.push(events),
      (callback) => {
        scheduled = callback;
        return 1;
      },
      () => undefined,
    );
    const delta = (text: string): ServerEvent => ({
      type: "message.delta",
      event_id: crypto.randomUUID(),
      sequence: 1,
      timestamp: new Date(0).toISOString(),
      text,
    });

    batcher.push(delta("one"));
    batcher.push(delta("two"));
    batcher.push(delta("three"));

    expect(commits).toEqual([]);
    scheduled?.(0);
    expect(commits).toHaveLength(1);
    expect(commits[0].map((event) => event.type)).toEqual([
      "message.delta",
      "message.delta",
      "message.delta",
    ]);
  });

  it("flushes pending text before an ordering-sensitive completion event", () => {
    const commits: ServerEvent[][] = [];
    const batcher = createStreamEventBatcher(
      (events) => commits.push(events),
      () => 1,
      () => undefined,
    );
    batcher.push({
      type: "message.delta",
      event_id: "delta",
      sequence: 1,
      timestamp: new Date(0).toISOString(),
      text: "done",
    });
    batcher.push({
      type: "message.completed",
      event_id: "complete",
      sequence: 2,
      timestamp: new Date(0).toISOString(),
      text: "done",
      message_history: [],
    });

    expect(commits.map((events) => events.map((event) => event.type))).toEqual([
      ["message.delta"],
      ["message.completed"],
    ]);
  });
});
