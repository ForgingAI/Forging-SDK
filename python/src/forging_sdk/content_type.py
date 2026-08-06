"""Content type helpers for plugin authors.

Re-exports the core ``ContentTypeConfig`` and provides a decorator for
convenient registration.

Example::

    from forging_sdk.content_type import content_type

    @content_type(
        type_key="panoramic_image",
        pipeline_id="panoramic-image-gen-v1",
        token_cost=8,
        max_generation_time_s=90,
    )
    def panoramic_image():
        pass
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ContentTypeConfig:
    """Configuration for a single content type.

    Mirrors ``social-api/src/registry/content_types.ContentTypeConfig``
    so that plugin authors can develop without importing the backend
    directly.
    """

    type_key: str
    pipeline_id: str
    token_cost: int
    max_generation_time_s: int
    artifact_kinds: list[str] = field(default_factory=list)
    description: str = ""


# Internal registry for decorator-based content types
_REGISTERED: list[ContentTypeConfig] = []


def content_type(
    *,
    type_key: str,
    pipeline_id: str,
    token_cost: int = 5,
    max_generation_time_s: int = 60,
    artifact_kinds: list[str] | None = None,
    description: str = "",
) -> Callable[[Any], Any]:
    """Decorator that registers a content type definition.

    The decorated function is not modified — it serves only as an
    anchor for the metadata.
    """

    def decorator(fn: Any) -> Any:
        config = ContentTypeConfig(
            type_key=type_key,
            pipeline_id=pipeline_id,
            token_cost=token_cost,
            max_generation_time_s=max_generation_time_s,
            artifact_kinds=artifact_kinds or [],
            description=description or fn.__doc__ or "",
        )
        _REGISTERED.append(config)
        return fn

    return decorator


def get_registered_content_types() -> list[ContentTypeConfig]:
    """Return all content types registered via the ``@content_type`` decorator."""
    return list(_REGISTERED)
