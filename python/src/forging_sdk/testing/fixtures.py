"""Pytest fixtures for Forging plugin development.

Register these fixtures by adding to your ``conftest.py``::

    pytest_plugins = ["forging_sdk.testing.fixtures"]

Or import individually::

    from forging_sdk.testing.fixtures import forging_db
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

from forging_sdk.testing.mock_auth import TestUser, create_test_user
from forging_sdk.testing.mock_db import create_test_db
from forging_sdk.testing.mock_engine import MockEngineClient


@pytest_asyncio.fixture
async def forging_db() -> AsyncIterator:
    """In-memory aiosqlite database with core Forging tables.

    Yields an open ``aiosqlite.Connection``.  Automatically closed
    after the test.
    """
    db = await create_test_db()
    yield db
    await db.close()


@pytest_asyncio.fixture
async def forging_user(forging_db) -> TestUser:
    """Pre-created test user with 1000 credits."""
    return await create_test_user(forging_db)


@pytest_asyncio.fixture
async def forging_admin(forging_db) -> TestUser:
    """Pre-created admin test user."""
    return await create_test_user(
        forging_db,
        email="admin@test.com",
        username="admin",
        display_name="Admin",
        is_admin=True,
    )


@pytest.fixture
def forging_engine() -> MockEngineClient:
    """Mock engine client with deterministic responses.

    Tracks all calls in ``engine.calls`` for assertions.
    """
    return MockEngineClient()
