from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import AsyncAdaptedQueuePool
from app.core.config import settings


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
    poolclass=AsyncAdaptedQueuePool,
    pool_size=5,
    max_overflow=5,
    # Recycle before Supabase/pgbouncer's own idle-connection timeout can
    # silently drop a pooled connection out from under us.
    pool_recycle=900,
    # Cheaply validates a pooled connection is still alive before handing
    # it to a request; replaces it transparently if pgbouncer already
    # closed it server-side, instead of failing the request.
    pool_pre_ping=True,
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
