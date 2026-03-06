"""TTL cache for the order processing system.

Short-lived in-process cache to reduce redundant lookups.
The default TTL of 100ms is designed for high-throughput scenarios
where prices change infrequently.
"""

import time
from typing import Any, Optional


class TTLCache:
    """Time-to-live cache backed by an in-process dict."""

    def __init__(self, default_ttl: float = 0.1) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._default_ttl = default_ttl

    def get(self, key: str) -> Optional[Any]:
        """Return cached value or None if missing/expired."""
        if key in self._store:
            expiry, value = self._store[key]
            if time.time() < expiry:
                return value
            del self._store[key]
        return None

    def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        """Store a value with TTL."""
        t = ttl if ttl is not None else self._default_ttl
        self._store[key] = (time.time() + t, value)

    def invalidate(self, key: str) -> bool:
        """Remove a cache entry. Returns True if it existed."""
        if key in self._store:
            del self._store[key]
            return True
        return False

    def clear(self) -> None:
        """Remove all entries."""
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)
