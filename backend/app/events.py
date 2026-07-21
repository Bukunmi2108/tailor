import asyncio
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

EventType = Literal[
    "model.selected",
    "model.fallback",
    "tool.started",
    "tool.result",
    "reasoning.delta",
    "message.delta",
    "analysis.completed",
    "edits.proposed",
    "cover_letter.drafted",
    "message.completed",
    "error",
]


class Event(BaseModel):
    event_id: str = Field(default_factory=lambda: f"evt_{uuid4().hex}")
    type: EventType
    sequence: int
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    provider: str | None = None
    model: str | None = None
    url: str | None = None
    tool: str | None = None
    input: dict[str, Any] | None = None
    output: dict[str, Any] | None = None
    text: str | None = None
    analysis: dict[str, Any] | None = None
    plan: dict[str, Any] | None = None
    cover_letter: dict[str, Any] | None = None
    message: str | None = None
    code: str | None = None
    reason: str | None = None
    latency_ms: int | None = None
    message_history: list[dict[str, Any]] | None = None


class EventSender:
    def __init__(self, send_json: Any):
        self._send_json = send_json
        self._sequence = 0
        self._lock = asyncio.Lock()

    async def send(self, event_type: EventType, **kwargs: Any) -> None:
        async with self._lock:
            self._sequence += 1
            event = Event(type=event_type, sequence=self._sequence, **kwargs)
            await self._send_json(event.model_dump(exclude_none=True))
