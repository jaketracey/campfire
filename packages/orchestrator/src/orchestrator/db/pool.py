"""Database connection pool management for the orchestrator service."""

from typing import Optional

import asyncpg
import structlog

from orchestrator.config import get_settings

logger = structlog.get_logger()


class DatabasePool:
    """Singleton database connection pool using asyncpg.

    Provides async PostgreSQL connections for querying routing configuration
    and other database resources.
    """

    _pool: Optional[asyncpg.Pool] = None
    _initialized: bool = False

    @classmethod
    async def get_pool(cls) -> asyncpg.Pool:
        """Get or create the database connection pool.

        Returns:
            asyncpg.Pool: The database connection pool.

        Raises:
            RuntimeError: If pool creation fails.
        """
        if cls._pool is None or cls._pool._closed:
            await cls._initialize_pool()
        return cls._pool  # type: ignore

    @classmethod
    async def _initialize_pool(cls) -> None:
        """Initialize the database connection pool."""
        settings = get_settings()

        # Convert SQLAlchemy-style DSN to asyncpg-compatible format
        # postgresql+asyncpg://user:pass@host:port/db -> postgresql://user:pass@host:port/db
        dsn = str(settings.database_url).replace("+asyncpg", "")

        logger.info(
            "initializing_database_pool",
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
        )

        try:
            cls._pool = await asyncpg.create_pool(
                dsn,
                min_size=5,
                max_size=settings.database_pool_size,
                max_inactive_connection_lifetime=300.0,  # 5 minutes
                command_timeout=60.0,
            )
            cls._initialized = True
            logger.info("database_pool_initialized")
        except Exception as e:
            logger.error("database_pool_initialization_failed", error=str(e))
            raise RuntimeError(f"Failed to initialize database pool: {e}") from e

    @classmethod
    async def close(cls) -> None:
        """Close the database connection pool."""
        if cls._pool is not None and not cls._pool._closed:
            logger.info("closing_database_pool")
            await cls._pool.close()
            cls._pool = None
            cls._initialized = False
            logger.info("database_pool_closed")

    @classmethod
    def is_initialized(cls) -> bool:
        """Check if the pool is initialized and connected.

        Returns:
            bool: True if pool is ready, False otherwise.
        """
        return cls._initialized and cls._pool is not None and not cls._pool._closed

    @classmethod
    async def execute(cls, query: str, *args) -> str:
        """Execute a query and return the status.

        Args:
            query: SQL query string.
            *args: Query parameters.

        Returns:
            str: Query status.
        """
        pool = await cls.get_pool()
        return await pool.execute(query, *args)

    @classmethod
    async def fetch(cls, query: str, *args) -> list[asyncpg.Record]:
        """Fetch multiple rows from the database.

        Args:
            query: SQL query string.
            *args: Query parameters.

        Returns:
            list[asyncpg.Record]: List of records.
        """
        pool = await cls.get_pool()
        return await pool.fetch(query, *args)

    @classmethod
    async def fetchrow(cls, query: str, *args) -> Optional[asyncpg.Record]:
        """Fetch a single row from the database.

        Args:
            query: SQL query string.
            *args: Query parameters.

        Returns:
            Optional[asyncpg.Record]: Single record or None.
        """
        pool = await cls.get_pool()
        return await pool.fetchrow(query, *args)

    @classmethod
    async def fetchval(cls, query: str, *args) -> Optional[any]:
        """Fetch a single value from the database.

        Args:
            query: SQL query string.
            *args: Query parameters.

        Returns:
            Optional[any]: Single value or None.
        """
        pool = await cls.get_pool()
        return await pool.fetchval(query, *args)
