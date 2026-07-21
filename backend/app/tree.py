from __future__ import annotations

from collections.abc import Iterator
from typing import Any

WalkedNode = tuple[dict[str, Any], Any, str | int | None, str]


def walk(
    value: Any,
    parent: Any = None,
    key: str | int | None = None,
    section: str = "resume",
) -> Iterator[WalkedNode]:
    """Depth-first pre-order walk over every dict node in a resume-like tree.

    Yields ``(node, parent, key, section)`` where ``section`` is the nearest
    ancestor dict key — i.e. the resume collection the node lives in. This is the
    one traversal shared by id lookup, atom collection, and duplicate-id checks.
    """
    if isinstance(value, dict):
        yield value, parent, key, section
        for child_key, child in value.items():
            yield from walk(child, value, child_key, child_key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, value, index, section)


def find_node(root: Any, target_id: str) -> tuple[dict[str, Any], Any, Any] | None:
    """Return ``(node, parent, key)`` for the first dict whose ``id`` matches ``target_id``.

    ``key`` is intentionally untyped: callers narrow it against ``parent`` (list index vs
    dict field) before mutating, and a tighter type only fights that at the mutation sites.
    """
    for node, parent, key, _ in walk(root):
        if node.get("id") == target_id:
            return node, parent, key
    return None
