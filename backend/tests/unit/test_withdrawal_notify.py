"""Every call to _notify_customers_officer must pass only arguments the function accepts.
It used to be called with deep_link_url, which it did not accept, so approving or rejecting
a withdrawal raised TypeError every time. Checked from source so it needs no web stack."""
import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "app" / "api" / "v1" / "routes" / "withdrawals.py"


def _tree():
    return ast.parse(SRC.read_text())


def test_all_call_sites_match_signature():
    tree = _tree()
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "_notify_customers_officer")
    accepted = {a.arg for a in fn.args.args + fn.args.kwonlyargs}
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and getattr(n.func, "id", None) == "_notify_customers_officer"]
    assert len(calls) == 2  # approve (mark-paid) and reject
    for c in calls:
        passed = {k.arg for k in c.keywords}
        assert passed <= accepted, f"unexpected arguments: {passed - accepted}"


def test_helper_cannot_break_the_caller():
    tree = _tree()
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "_notify_customers_officer")
    assert any(isinstance(n, ast.Try) for n in ast.walk(fn)), "notification failures must be swallowed"
