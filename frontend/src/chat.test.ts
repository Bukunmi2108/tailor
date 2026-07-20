import { describe, expect, it } from "vitest";
import { stopAssistantMessage } from "./chat";
import type { ChatMessage } from "./types";

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
