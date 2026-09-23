"""
Request timing instrumentation.

Tracks, per request, how much wall-clock time was spent inside the database
versus everything else (JWT verification, Supabase calls, plain Python).
Attach TimingMiddleware in main.py and watch your terminal while you click
around the app.
"""
import time
from contextvars import ContextVar

from sqlalchemy import event
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# Starlette's BaseHTTPMiddleware runs the wrapped app in a separate task
# (via call_next), which gets a COPY of the current context. A ContextVar
# .set() from inside that child task — e.g. from the SQLAlchemy event
# listener below, which fires while handling the request — only rebinds
# the variable in the child's copy of the context; it's never visible back
# in dispatch()'s own context once call_next() returns. A plain float/int
# ContextVar therefore always read back as its original starting value
# here, which is why every summary line used to print "db=0.0ms (0
# queries)" even on requests that were clearly dominated by slow queries.
#
# The fix: hold a single mutable dict and mutate it in place (`stats["time"]
# += ...`) instead of rebinding the ContextVar. A dict is passed by
# reference, so the same object is shared between the parent (dispatch)
# and child (request handling) contexts — mutations to its contents are
# visible on both sides, the same reason the query list below already
# worked correctly via .append().
db_stats_var: ContextVar[dict] = ContextVar("db_stats_var", default=None)


def instrument_engine(engine) -> None:
    """Call once with your SQLAlchemy AsyncEngine to start tracking query time."""

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        context._query_start_time = time.perf_counter()

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        elapsed = time.perf_counter() - context._query_start_time
        stats = db_stats_var.get()
        if stats is not None:
            stats["time"] += elapsed
            stats["count"] += 1
            # Keep it short — first 120 chars is enough to identify the query
            stats["queries"].append((elapsed, " ".join(statement.split())[:120]))


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        db_stats_var.set({"time": 0.0, "count": 0, "queries": []})

        start = time.perf_counter()
        response = await call_next(request)
        total = time.perf_counter() - start

        stats = db_stats_var.get()
        db_time = stats["time"]
        db_count = stats["count"]
        queries = stats["queries"]
        other_time = max(total - db_time, 0)

        # Flag anything slow so it's easy to spot in a busy terminal
        marker = "  <<< SLOW" if total > 0.5 else ""
        n1_marker = "  <<< POSSIBLE N+1 (many small queries)" if db_count >= 8 else ""
        # If "other" time dwarfs the logged queries, the bottleneck is
        # something the query timer can't see — most commonly the DB
        # CONNECTION itself being (re)established, since that happens
        # before any query runs. Worth calling out explicitly rather
        # than letting it silently hide inside "other".
        conn_marker = "  <<< likely connection setup, not query time" if (total > 1 and other_time > db_time * 2 and db_count > 0) else ""

        print(
            f"[TIMING] {request.method:6s} {request.url.path:40s} "
            f"total={total*1000:7.1f}ms  db={db_time*1000:7.1f}ms ({db_count} queries)  "
            f"other={other_time*1000:7.1f}ms{marker}{n1_marker}{conn_marker}"
        )

        # Show the 3 slowest individual queries for this request — this is
        # what tells us WHICH query to fix, not just that something was slow
        if total > 0.3 and queries:
            slowest = sorted(queries, key=lambda q: -q[0])[:3]
            for elapsed, sql in slowest:
                print(f"           |-- {elapsed*1000:7.1f}ms  {sql}")

        response.headers["X-Response-Time-ms"] = f"{total*1000:.1f}"
        response.headers["X-DB-Time-ms"] = f"{db_time*1000:.1f}"
        response.headers["X-DB-Query-Count"] = str(db_count)
        return response