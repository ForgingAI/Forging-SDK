"""Minimal FastAPI dev server for plugin development.

Loads a plugin from the current working directory and exposes the
core Forging API endpoints needed for testing.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from forging_sdk.manifest import parse_manifest

logger = logging.getLogger(__name__)


def create_dev_app() -> FastAPI:
    """Create a minimal FastAPI app for plugin development."""
    app = FastAPI(
        title="Forging Dev Server",
        version="0.1.0-dev",
    )

    # Local plugin testing only: allow any localhost origin (any port), no
    # credentialed cross-origin requests. Wildcard origins + credentials is
    # both spec-invalid and unnecessary here.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Load the plugin manifest from CWD
    manifest_path = Path.cwd() / "forging-plugin.toml"
    manifest = None

    if manifest_path.exists():
        try:
            manifest = parse_manifest(manifest_path)
            logger.info("Loaded plugin: %s v%s", manifest.name, manifest.version)
        except Exception:
            logger.exception("Failed to parse plugin manifest")

    # Health check
    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "mode": "dev"}

    # Plugin listing
    @app.get("/api/plugins")
    async def list_plugins() -> list[dict]:
        if manifest is None:
            return []
        return [
            {
                "id": manifest.name,
                "name": manifest.name,
                "version": manifest.version,
                "description": manifest.description,
                "author": manifest.author,
                "trust_level": "community",
                "enabled": True,
                "content_types": list(manifest.content_types.keys()),
                "has_builder_tools": manifest.builder_tools is not None,
                "has_frontend": manifest.frontend is not None,
                "has_hooks": manifest.hooks is not None,
                "created_at": "",
            }
        ]

    # Content types
    @app.get("/api/content-types")
    async def list_content_types() -> list[dict]:
        if manifest is None:
            return []
        types = []
        for key, entry in manifest.content_types.items():
            types.append(
                {
                    "type_key": key,
                    "pipeline_id": entry.pipeline_id,
                    "token_cost": entry.token_cost,
                    "max_generation_time_s": entry.max_generation_time_s,
                    "artifact_kinds": entry.artifact_kinds,
                    "description": entry.description,
                    "source": "plugin",
                }
            )
        return types

    # Mock generation endpoint
    @app.post("/api/generate")
    async def mock_generate(request: dict) -> dict:
        content_type = request.get("content_type", "unknown")
        prompt = request.get("prompt", "")
        return {
            "status": "completed",
            "content_type": content_type,
            "prompt": prompt,
            "artifacts": [
                {"kind": "inline_text", "data": f"[DEV] Mock generation for: {prompt}"},
            ],
            "execution_ms": 100,
            "note": "This is a dev server mock response",
        }

    return app
