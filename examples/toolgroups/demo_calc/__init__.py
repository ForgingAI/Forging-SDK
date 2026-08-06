"""Demo tool group: a safe arithmetic calculator (AST-based, no eval)."""

from __future__ import annotations

import ast
import operator

from forging_sdk.toolgroups import ToolDefinition

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
}


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval_node(node.operand))
    raise ValueError(f"unsupported expression element: {ast.dump(node)}")


async def _calculate(expression: str) -> dict:
    tree = ast.parse(expression, mode="eval")
    return {"expression": expression, "result": _eval_node(tree.body)}


def register(registry, config=None) -> None:
    registry.register(
        ToolDefinition(
            name="calculate",
            description="Evaluate an arithmetic expression (+, -, *, /, **, %).",
            input_schema={
                "type": "object",
                "required": ["expression"],
                "properties": {
                    "expression": {"type": "string", "description": "e.g. '(3 + 4) * 2'"}
                },
            },
            handler=_calculate,
            read_only=True,
        )
    )
