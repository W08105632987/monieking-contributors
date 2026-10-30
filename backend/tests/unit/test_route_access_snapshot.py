"""Guard rail: nobody can accidentally open an endpoint.   (phase 2)

Every route is listed with who may call it: 'PUBLIC' (no login), 'ANY LOGIN' (the handler itself must check the role or
the owner), or the exact roles. If a route is added, removed, or its access changes, this test fails until a person
looks at it and re-saves the list:

    python -m tests.unit.test_route_access_snapshot --update

Review the diff in git before committing it. That review is the point.
"""
import json
import sys
import warnings
from pathlib import Path

SNAPSHOT = Path(__file__).with_name("route_access.snapshot.json")


def current_map() -> dict:
    warnings.filterwarnings("ignore")
    from fastapi.routing import APIRoute
    import app.core.dependencies as D
    from app.main import app

    def scan(dep, acc):
        c = dep.call
        if c is D.get_current_user:
            acc["login"] = True
        if getattr(c, "__qualname__", "").startswith("require_role"):
            for cell in (c.__closure__ or []):
                v = cell.cell_contents
                if isinstance(v, tuple):
                    acc["roles"] |= {str(getattr(r, "value", r)) for r in v}
        for d in dep.dependencies:
            scan(d, acc)
        return acc

    out = {}
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        acc = scan(r.dependant, {"login": False, "roles": set()})
        who = ",".join(sorted(acc["roles"])) if acc["roles"] else ("ANY LOGIN" if acc["login"] else "PUBLIC")
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            out[f"{m} {r.path}"] = who
    return dict(sorted(out.items()))


def test_route_access_matches_the_reviewed_snapshot():
    cur = current_map()
    assert SNAPSHOT.exists(), "run: python -m tests.unit.test_route_access_snapshot --update"
    saved = json.loads(SNAPSHOT.read_text())
    added = {k: v for k, v in cur.items() if k not in saved}
    removed = {k: v for k, v in saved.items() if k not in cur}
    changed = {k: (saved[k], cur[k]) for k in cur if k in saved and saved[k] != cur[k]}
    assert not (added or removed or changed), (
        f"Endpoint access changed. NEW: {added}  REMOVED: {removed}  CHANGED: {changed}. "
        "If intended, review it and run: python -m tests.unit.test_route_access_snapshot --update"
    )


def test_only_reviewed_routes_are_public():
    public = sorted(k for k, v in current_map().items() if v == "PUBLIC")
    assert len(public) <= 40, f"Unexpectedly many public endpoints: {public}"


if __name__ == "__main__":
    if "--update" in sys.argv:
        SNAPSHOT.write_text(json.dumps(current_map(), indent=1) + "\n")
        print(f"saved {len(current_map())} routes to {SNAPSHOT}")
