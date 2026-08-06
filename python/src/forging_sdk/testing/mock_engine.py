"""Mock engine client for plugin testing.

Returns deterministic responses so that plugin tests don't require
a running Engine instance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class MockEngineResponse:
    """A canned response from the mock engine."""

    status: str = "completed"
    artifacts: list[dict[str, Any]] = field(
        default_factory=lambda: [
            {"kind": "inline_text", "data": "Mock generated content"},
        ]
    )
    pipeline_id: str = ""
    execution_ms: int = 100


class MockEngineClient:
    """Mock engine client that returns deterministic responses.

    Tracks all calls for assertion in tests.

    Example::

        engine = MockEngineClient()
        result = await engine.generate("social-image-gen-v1", {"prompt": "hello"})
        assert result.status == "completed"
        assert len(engine.calls) == 1
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._responses: dict[str, MockEngineResponse] = {}

    def set_response(self, pipeline_id: str, response: MockEngineResponse) -> None:
        """Configure a custom response for a specific pipeline."""
        self._responses[pipeline_id] = response

    async def generate(
        self,
        pipeline_id: str,
        params: dict[str, Any],
    ) -> MockEngineResponse:
        """Simulate an engine generation call."""
        self.calls.append(
            {
                "pipeline_id": pipeline_id,
                "params": params,
            }
        )

        if pipeline_id in self._responses:
            return self._responses[pipeline_id]

        return MockEngineResponse(pipeline_id=pipeline_id)

    async def reason(
        self,
        prompt: str,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Simulate an engine reasoning call."""
        self.calls.append(
            {
                "type": "reason",
                "prompt": prompt,
                "context": context,
            }
        )
        return {"result": "Mock reasoning output", "tokens_used": 10}
