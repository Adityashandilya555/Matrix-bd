"""Minimal JsonLogic evaluator.

Deliberately dependency-free — the point of the PoC is that turning an approval
gate into data costs ~80 lines, not a rules-engine procurement.

Scope is the operator set an approval precondition actually needs. When a rule
wants a loop or more than three levels of nesting it should become a
``function_ref`` instead of growing this file (V3 §6).
"""

from __future__ import annotations

from typing import Any

_MISSING = object()


def _var(args: Any, data: dict) -> Any:
    """``{"var": "path"}`` or ``{"var": ["path", default]}``. Supports a.b.c."""
    default = None
    if isinstance(args, list):
        path = args[0] if args else ""
        if len(args) > 1:
            default = args[1]
    else:
        path = args

    if path == "" or path is None:
        return data

    cur: Any = data
    for part in str(path).split("."):
        if isinstance(cur, dict):
            cur = cur.get(part, _MISSING)
        elif isinstance(cur, (list, tuple)):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                cur = _MISSING
        else:
            cur = _MISSING
        if cur is _MISSING:
            return default
    return cur


def _truthy(value: Any) -> bool:
    # JsonLogic follows JavaScript truthiness: [] and "" are falsy.
    if value is None or value is False:
        return False
    if value == 0 and not isinstance(value, bool):
        return False
    if isinstance(value, (str, list, dict, tuple)) and len(value) == 0:
        return False
    return bool(value)


def _cmp(op: str, a: Any, b: Any) -> bool:
    # Comparing None to anything with an ordering operator is False rather than
    # a TypeError — a pending column must not crash gate evaluation.
    if a is None or b is None:
        return False
    if op == ">":
        return a > b
    if op == ">=":
        return a >= b
    if op == "<":
        return a < b
    return a <= b


def apply(rule: Any, data: dict | None = None) -> Any:
    """Evaluate a JsonLogic rule against ``data``."""
    data = data if data is not None else {}

    if not isinstance(rule, dict):
        return rule
    if len(rule) != 1:
        raise ValueError(f"a JsonLogic rule takes exactly one operator, got {list(rule)}")

    op, args = next(iter(rule.items()))

    if op == "var":
        return _var(args, data)

    if not isinstance(args, list):
        args = [args]

    # short-circuiting operators evaluate lazily
    if op == "and":
        result: Any = True
        for arg in args:
            result = apply(arg, data)
            if not _truthy(result):
                return result
        return result

    if op == "or":
        result = False
        for arg in args:
            result = apply(arg, data)
            if _truthy(result):
                return result
        return result

    if op == "if":
        for i in range(0, len(args) - 1, 2):
            if _truthy(apply(args[i], data)):
                return apply(args[i + 1], data)
        return apply(args[-1], data) if len(args) % 2 else None

    values = [apply(a, data) for a in args]

    if op == "==":
        return values[0] == values[1]
    if op == "!=":
        return values[0] != values[1]
    if op in (">", ">=", "<", "<="):
        return _cmp(op, values[0], values[1])
    if op == "!":
        return not _truthy(values[0])
    if op == "!!":
        return _truthy(values[0])
    if op == "in":
        needle, haystack = values[0], values[1]
        return needle in haystack if haystack is not None else False
    if op == "none_of":
        return values[0] not in (values[1] or [])

    raise ValueError(f"unsupported JsonLogic operator: {op!r}")
