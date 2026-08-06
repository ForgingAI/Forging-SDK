"""Testing utilities for Forging plugin development.

Provides pytest fixtures for mocking the database, auth, and engine
so that plugins can be tested in isolation.

Usage in ``conftest.py``::

    pytest_plugins = ["forging_sdk.testing.fixtures"]

Or import fixtures directly::

    from forging_sdk.testing.fixtures import forging_db, forging_user
"""

from __future__ import annotations
