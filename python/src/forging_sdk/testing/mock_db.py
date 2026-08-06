"""In-memory database for plugin testing.

Creates an aiosqlite database with the core Forging schema so that
plugin tests can exercise data operations without a running backend.
"""

from __future__ import annotations

import aiosqlite


async def create_test_db() -> aiosqlite.Connection:
    """Create an in-memory SQLite database with core Forging tables.

    Returns an open connection.  The caller is responsible for closing it.
    """
    db = await aiosqlite.connect(":memory:")
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")

    # Core tables needed for plugin testing
    await db.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE,
            display_name TEXT,
            avatar_url TEXT,
            bio TEXT DEFAULT '',
            is_admin INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT ''
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS token_balances (
            user_id TEXT PRIMARY KEY,
            balance INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            content_type TEXT NOT NULL DEFAULT 'image',
            prompt TEXT NOT NULL DEFAULT '',
            caption TEXT DEFAULT '',
            image_url TEXT,
            video_url TEXT,
            status TEXT DEFAULT 'completed',
            created_at TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS modules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            author_id TEXT NOT NULL,
            manifest TEXT DEFAULT '{}',
            status TEXT DEFAULT 'active',
            runtime_tier TEXT DEFAULT 'sandboxed',
            scope_type TEXT DEFAULT 'personal',
            scope_target_id TEXT,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            generation_id TEXT,
            parent_module_id TEXT,
            token_cost_to_generate INTEGER DEFAULT 0
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS module_intents (
            id TEXT PRIMARY KEY,
            module_id TEXT NOT NULL,
            intent_name TEXT NOT NULL,
            description TEXT DEFAULT '',
            complexity TEXT DEFAULT 'crud',
            input_schema TEXT DEFAULT '{}',
            output_schema TEXT DEFAULT '{}',
            handler_code TEXT,
            required_permission TEXT,
            rate_limit INTEGER DEFAULT 60,
            FOREIGN KEY (module_id) REFERENCES modules(id)
        )
    """)

    await db.execute("""
        CREATE TABLE IF NOT EXISTS plugins (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            version TEXT NOT NULL,
            manifest TEXT NOT NULL DEFAULT '{}',
            trust_level TEXT NOT NULL DEFAULT 'community',
            enabled INTEGER NOT NULL DEFAULT 1,
            author_id TEXT,
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        )
    """)

    await db.commit()
    return db
