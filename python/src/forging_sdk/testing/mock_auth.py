"""Mock auth helpers for plugin testing.

Creates test users and tokens so that plugin tests can exercise
authenticated endpoints without a running auth service.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import aiosqlite


@dataclass(frozen=True)
class TestUser:
    """A pre-created test user with credentials."""

    id: str
    email: str
    username: str
    display_name: str
    is_admin: bool
    token: str  # Fake JWT for test requests


async def create_test_user(
    db: aiosqlite.Connection,
    *,
    email: str = "test@example.com",
    username: str = "testuser",
    display_name: str = "Test User",
    is_admin: bool = False,
    initial_credits: int = 1000,
) -> TestUser:
    """Create a test user in the database and return credentials.

    Parameters
    ----------
    db:
        Database connection (from :func:`create_test_db`).
    email:
        User email.
    username:
        Username.
    display_name:
        Display name.
    is_admin:
        Whether the user should have admin privileges.
    initial_credits:
        Starting credit balance.

    Returns
    -------
    TestUser
        The created user with a fake auth token.
    """
    user_id = str(uuid4())
    now = datetime.now(UTC).isoformat()

    await db.execute(
        """
        INSERT INTO users (id, email, username, display_name, is_admin, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, email, username, display_name, int(is_admin), now),
    )

    await db.execute(
        "INSERT INTO token_balances (user_id, balance) VALUES (?, ?)",
        (user_id, initial_credits),
    )

    await db.commit()

    fake_token = f"test-token-{user_id}"

    return TestUser(
        id=user_id,
        email=email,
        username=username,
        display_name=display_name,
        is_admin=is_admin,
        token=fake_token,
    )


async def create_admin_user(
    db: aiosqlite.Connection,
    *,
    email: str = "admin@example.com",
) -> TestUser:
    """Convenience wrapper to create an admin test user."""
    return await create_test_user(
        db,
        email=email,
        username="admin",
        display_name="Admin User",
        is_admin=True,
    )
