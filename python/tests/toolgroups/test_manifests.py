import pathlib

import pytest

from forging_sdk.toolgroups import ToolGroupManifestError, discover_tool_groups


def _write(root: pathlib.Path, name: str, body: str) -> None:
    d = root / name
    d.mkdir()
    (d / "toolgroup.toml").write_text(body)


BASE = """
name = "{name}"
version = "1.0"
intents = [{intents}]
top_level_entry = "pkg.{name}:register_top_level"
subagent_entry = "pkg.{name}:register_as_subagent"
{extra}
"""


def _manifest(name: str, intents: str = '"x"', extra: str = "") -> str:
    return BASE.format(name=name, intents=intents, extra=extra)


def test_discovery_sorts_and_validates(tmp_path: pathlib.Path) -> None:
    _write(tmp_path, "beta", _manifest("beta", '"b intent"'))
    _write(tmp_path, "alpha", _manifest("alpha", '"a intent"', 'custom_field = "kept"'))
    manifests = discover_tool_groups(tmp_path)
    assert [m.name for m in manifests] == ["alpha", "beta"]
    assert manifests[0].metadata == {"custom_field": "kept"}


def test_missing_required_field(tmp_path: pathlib.Path) -> None:
    (tmp_path / "bad").mkdir()
    (tmp_path / "bad" / "toolgroup.toml").write_text('name = "bad"\nversion = "1"\n')
    with pytest.raises(ToolGroupManifestError, match="missing field 'intents'"):
        discover_tool_groups(tmp_path)


def test_duplicate_intents_rejected(tmp_path: pathlib.Path) -> None:
    _write(tmp_path, "one", _manifest("one", '"same"'))
    _write(tmp_path, "two", _manifest("two", '"same"'))
    with pytest.raises(ToolGroupManifestError, match="duplicate intent"):
        discover_tool_groups(tmp_path)


def test_inheritance_resolves_parent(tmp_path: pathlib.Path) -> None:
    _write(tmp_path, "base", _manifest("base", '"base intent"'))
    _write(tmp_path, "child", _manifest("child", '"child intent"', 'inherits = "base"'))
    manifests = {m.name: m for m in discover_tool_groups(tmp_path)}
    assert manifests["child"].parent_manifest is not None
    assert manifests["child"].parent_manifest.name == "base"
    assert manifests["base"].parent_manifest is None


def test_unknown_parent_rejected(tmp_path: pathlib.Path) -> None:
    _write(tmp_path, "child", _manifest("child", '"c"', 'inherits = "ghost"'))
    with pytest.raises(ToolGroupManifestError, match="unknown parent"):
        discover_tool_groups(tmp_path)


def test_deep_inheritance_chain_rejected(tmp_path: pathlib.Path) -> None:
    _write(tmp_path, "a", _manifest("a", '"ia"'))
    _write(tmp_path, "b", _manifest("b", '"ib"', 'inherits = "a"'))
    _write(tmp_path, "c", _manifest("c", '"ic"', 'inherits = "b"'))
    with pytest.raises(ToolGroupManifestError, match="single-level"):
        discover_tool_groups(tmp_path)


def test_missing_root_rejected(tmp_path: pathlib.Path) -> None:
    with pytest.raises(ToolGroupManifestError, match="does not exist"):
        discover_tool_groups(tmp_path / "nowhere")
