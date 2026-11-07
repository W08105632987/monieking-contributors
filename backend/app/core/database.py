from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool
from app.core.config import settings


# Celery processes open a connection per job and give it back (NullPool); the API keeps a small reusable pool.
_POOL_ARGS = (
    {"poolclass": NullPool}
    if settings.DB_USE_NULL_POOL
    else {"poolclass": AsyncAdaptedQueuePool, "pool_size": settings.DB_POOL_SIZE, "max_overflow": settings.DB_MAX_OVERFLOW,
          "pool_timeout": 10, "pool_recycle": 900, "pool_pre_ping": True}
)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    # NullPool (the previous setting) discards the physical connection at
    # the end of every request and opens a brand-new one next time —
    # meaning every single request paid a full fresh TCP+TLS+Postgres
    # handshake to aws-0-eu-west-1 before it could run even one query.
    # The [TIMING] logs showed this directly: a request logging 34.7s
    # total with only 6.9s of that inside its two actual queries — the
    # other ~28s was connection setup, which happens before query
    # execution starts and so never shows up in the query timer at all.
    # NullPool makes sense for short-lived/serverless callers; this is a
    # long-running uvicorn process, so it should hold a small pool of
    # already-open connections and reuse them across requests instead.
    # API: pool_timeout=10 fails fast under overload; pool_recycle=900 drops connections before pgbouncer's idle timeout;
    # pool_pre_ping replaces a connection pgbouncer already closed. (All set in _POOL_ARGS above.)
    **_POOL_ARGS,
    connect_args={
        # Required for Supabase's pgbouncer pooler in transaction mode —
        # a prepared statement created on one backend connection can be
        # invalid on the next transaction's backend connection, so
        # asyncpg's client-side prepared-statement cache has to stay
        # off. This is independent of the pool setting above and stays
        # either way.
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    },
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
