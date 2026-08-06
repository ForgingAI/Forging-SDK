"""Lifecycle hooks for the haiku-poem plugin.

Demonstrates how plugins can react to platform events.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def on_event(event_name: str, payload: dict[str, Any]) -> None:
    """Handle lifecycle events for the haiku-poem plugin."""
    if event_name == "post.created":
        content_type = payload.get("content_type", "")
        if content_type == "haiku":
            post_id = payload.get("post_id", "unknown")
            logger.info(
                "haiku-poem plugin: new haiku created (post_id=%s)",
                post_id,
            )
