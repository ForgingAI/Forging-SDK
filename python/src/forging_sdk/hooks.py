"""Event hook helpers for plugin authors.

Provides a decorator to declare lifecycle event handlers.

Example::

    from forging_sdk.hooks import on_event

    @on_event("post.created")
    async def handle_post_created(event):
        print(f"New post: {event.payload}")

    @on_event("generation.completed")
    async def handle_generation(event):
        print(f"Generation done: {event.payload}")
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EventSubscription:
    """An event subscription declared by a plugin."""

    event_name: str
    handler: Callable[..., Coroutine[Any, Any, None]]


# Internal registry for decorator-based event handlers
_SUBSCRIPTIONS: list[EventSubscription] = []


def on_event(
    event_name: str,
) -> Callable[..., Any]:
    """Decorator that registers an async function as an event handler.

    Parameters
    ----------
    event_name:
        Dot-separated event name, e.g. ``"post.created"``.
        Use ``"*"`` to handle all events.
    """

    def decorator(
        fn: Callable[..., Coroutine[Any, Any, None]],
    ) -> Callable[..., Coroutine[Any, Any, None]]:
        _SUBSCRIPTIONS.append(EventSubscription(event_name=event_name, handler=fn))
        return fn

    return decorator


def get_event_subscriptions() -> list[EventSubscription]:
    """Return all event subscriptions registered via ``@on_event``."""
    return list(_SUBSCRIPTIONS)
