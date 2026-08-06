import pathlib

import pytest

from forging_sdk.toolgroups import (
    SubagentDefinition,
    available_group_names,
    resolve_group,
    validate_definitions,
)

MANIFEST = """
name = "{name}"
version = "1.0"
intents = ["{name} intent"]
top_level_entry = "pkg.{name}:register_top_level"
subagent_entry = "pkg.{name}:register_as_subagent"
"""


@pytest.fixture()
def groups_root(tmp_path: pathlib.Path) -> pathlib.Path:
    for name in ("gamma", "alpha"):
        d = tmp_path / name
        d.mkdir()
        (d / "toolgroup.toml").write_text(MANIFEST.format(name=name))
    return tmp_path


def test_available_group_names_sorted(groups_root: pathlib.Path) -> None:
    assert available_group_names(groups_root) == ["alpha", "gamma"]


def test_resolve_valid_candidate(groups_root: pathlib.Path) -> None:
    assert resolve_group("gamma", groups_root) == "gamma"


def test_resolve_hostile_candidate_falls_back(groups_root: pathlib.Path) -> None:
    assert resolve_group("../../etc/passwd", groups_root, fallback="gamma") == "gamma"
    assert resolve_group("<script>", groups_root) == "alpha"  # first sorted
    assert resolve_group(None, groups_root) == "alpha"


def _definition(subset: tuple[str, ...]) -> SubagentDefinition:
    return SubagentDefinition(
        name="worker",
        description="d",
        system_prompt="p",
        tool_subset=subset,
        model="test/model",
    )


def test_validate_definitions_bans_recursion() -> None:
    with pytest.raises(ValueError, match="recursion is banned"):
        validate_definitions(
            [_definition(("spawn_subagent", "done"))],
            spawn_tools=frozenset({"spawn_subagent"}),
            done_tool="done",
        )


def test_validate_definitions_requires_done_tool() -> None:
    with pytest.raises(ValueError, match="missing termination tool"):
        validate_definitions(
            [_definition(("read_file",))], spawn_tools=frozenset(), done_tool="done"
        )


def test_validate_definitions_passes_clean_set() -> None:
    validate_definitions(
        [_definition(("read_file", "done"))], spawn_tools=frozenset({"spawn"}), done_tool="done"
    )
