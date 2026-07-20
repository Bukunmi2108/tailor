from __future__ import annotations

from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError
from pydantic_ai import AgentRunResultEvent
from pydantic_ai.messages import (
    FunctionToolResultEvent,
    ModelMessagesTypeAdapter,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)

from ..agent.deps import AgentDeps
from ..agent.factory import build_chat_agent
from ..agent.model_trace import ModelTrace, reset_model_trace, start_model_trace
from ..auth import InvalidToken, verify_token
from ..config import Settings, get_settings
from ..events import EventSender
from ..models import JDAnalysis, ResumeData

router = APIRouter()


class ClientChatMessage(BaseModel):
    token: str
    message: str = Field(min_length=1, max_length=20_000)
    message_history: list[dict[str, Any]] | None = None
    resume: ResumeData
    analysis: JDAnalysis | None = None


@router.websocket("/ws/chat")
async def chat_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    settings: Settings = get_settings()

    try:
        raw = await websocket.receive_json()
        payload = ClientChatMessage.model_validate(raw)
    except (ValidationError, ValueError) as exc:
        await websocket.send_json({"type": "error", "code": "invalid_message", "message": str(exc)})
        await websocket.close(code=4400)
        return

    try:
        verify_token(payload.token, settings)
    except InvalidToken as exc:
        await websocket.send_json({"type": "error", "code": "unauthorized", "message": str(exc)})
        await websocket.close(code=4401)
        return

    events = EventSender(websocket.send_json)
    await events.send("session.started")

    try:
        history = ModelMessagesTypeAdapter.validate_python(payload.message_history or [])
    except ValidationError as exc:
        await events.send("error", code="invalid_message_history", message=str(exc))
        await websocket.close(code=4400)
        return

    trace, trace_token = start_model_trace()
    try:
        agent = build_chat_agent(settings)
        deps = AgentDeps(resume=payload.resume, events=events, analysis=payload.analysis)

        await events.send("agent.started")

        model_selection_sent = False
        result = None
        async with agent.run_stream_events(payload.message, message_history=history, deps=deps) as stream:
            async for event in stream:
                if trace.selected and not model_selection_sent:
                    await _send_model_selection(events, trace)
                    model_selection_sent = True
                if isinstance(event, AgentRunResultEvent):
                    result = event.result
                    continue
                await _handle_event(event, events)

        if trace.selected and not model_selection_sent:
            await _send_model_selection(events, trace)

        message_history = ModelMessagesTypeAdapter.dump_python(
            result.all_messages() if result is not None else history, mode="json"
        )
        final_text = result.output if result is not None else ""
        await events.send("message.completed", text=final_text, message_history=message_history)
        await events.send("session.completed")
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001 - surface any run failure to the client as an error event
        await events.send("error", code="agent_run_failed", message=str(exc))
    finally:
        reset_model_trace(trace_token)


async def _handle_event(event: Any, events: EventSender) -> None:
    if isinstance(event, FunctionToolResultEvent):
        # Every tool call resolves here regardless of which tool ran, so no tool call can
        # ever leave its activity indicator stuck in "running" on the frontend.
        await events.send("tool.result", tool=event.part.tool_name)
        return
    if isinstance(event, PartStartEvent):
        if isinstance(event.part, ThinkingPart) and event.part.content:
            await events.send("reasoning.delta", text=event.part.content)
        if isinstance(event.part, TextPart) and event.part.content:
            await events.send("message.delta", text=event.part.content)
        return
    if isinstance(event, PartDeltaEvent):
        if isinstance(event.delta, ThinkingPartDelta) and event.delta.content_delta:
            await events.send("reasoning.delta", text=event.delta.content_delta)
        if isinstance(event.delta, TextPartDelta) and event.delta.content_delta:
            await events.send("message.delta", text=event.delta.content_delta)


async def _send_model_selection(events: EventSender, trace: ModelTrace) -> None:
    if trace.selected is None:
        return
    if trace.failures and trace.fallback_reason:
        await events.send(
            "model.fallback",
            provider=trace.selected.provider,
            model=trace.selected.model,
            url=trace.selected.url,
            reason=trace.fallback_reason,
            latency_ms=trace.selected_latency_ms,
        )
    await events.send(
        "model.selected",
        provider=trace.selected.provider,
        model=trace.selected.model,
        url=trace.selected.url,
        latency_ms=trace.selected_latency_ms,
    )
