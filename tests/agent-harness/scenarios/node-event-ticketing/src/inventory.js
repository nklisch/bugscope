/**
 * Seat locking and inventory management for ShowTime ticketing.
 *
 * Provides time-limited seat locks during checkout. A lock reserves
 * a seat for a specific session while payment is being processed.
 * Locks expire after a configurable timeout.
 */

// Active seat locks: seatId → { sessionId, lockedAt, expiresAt }
const _locks = new Map();

// Lock timeout in milliseconds (default: 10 minutes)
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Lock a seat for a checkout session.
 *
 * @param {string} seatId
 * @param {string} sessionId
 * @param {number} [timeoutMs] - Lock duration in milliseconds
 * @returns {{ success: boolean, error?: string }}
 */
export function lockSeat(seatId, sessionId, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS) {
	const existing = _locks.get(seatId);
	if (existing && existing.expiresAt > Date.now()) {
		if (existing.sessionId !== sessionId) {
			return { success: false, error: `Seat ${seatId} is locked by another session` };
		}
	}
	_locks.set(seatId, {
		sessionId,
		lockedAt: Date.now(),
		expiresAt: Date.now() + timeoutMs,
	});
	return { success: true };
}

/**
 * Lock multiple seats for a session, releasing all if any lock fails.
 *
 * @param {Array<string>} seatIds
 * @param {string} sessionId
 * @returns {{ success: boolean, locked: string[], failed: string[], error?: string }}
 */
export function lockSeats(seatIds, sessionId) {
	const locked = [];
	for (const seatId of seatIds) {
		const result = lockSeat(seatId, sessionId);
		if (!result.success) {
			// Roll back already-locked seats
			for (const id of locked) releaseSeat(id, sessionId);
			return { success: false, locked: [], failed: [seatId], error: result.error };
		}
		locked.push(seatId);
	}
	return { success: true, locked, failed: [] };
}

/**
 * Release a seat lock.
 *
 * @param {string} seatId
 * @param {string} sessionId - Must match the session that created the lock
 * @returns {boolean} True if lock was released
 */
export function releaseSeat(seatId, sessionId) {
	const lock = _locks.get(seatId);
	if (!lock) return false;
	if (lock.sessionId !== sessionId) return false;
	_locks.delete(seatId);
	return true;
}

/**
 * Release all locks held by a session.
 *
 * @param {string} sessionId
 * @returns {number} Number of locks released
 */
export function releaseSessionLocks(sessionId) {
	let count = 0;
	for (const [seatId, lock] of _locks) {
		if (lock.sessionId === sessionId) {
			_locks.delete(seatId);
			count++;
		}
	}
	return count;
}

/**
 * Check whether a seat is currently locked (by any session).
 *
 * @param {string} seatId
 * @returns {boolean}
 */
export function isSeatLocked(seatId) {
	const lock = _locks.get(seatId);
	return lock !== undefined && lock.expiresAt > Date.now();
}

/**
 * Get the session holding a lock, or null.
 *
 * @param {string} seatId
 * @returns {string|null}
 */
export function getLockOwner(seatId) {
	const lock = _locks.get(seatId);
	if (!lock || lock.expiresAt <= Date.now()) return null;
	return lock.sessionId;
}

/**
 * Remove all expired locks. Called periodically by the server.
 *
 * @returns {number} Number of expired locks removed
 */
export function evictExpiredLocks() {
	const now = Date.now();
	let count = 0;
	for (const [seatId, lock] of _locks) {
		if (lock.expiresAt <= now) {
			_locks.delete(seatId);
			count++;
		}
	}
	return count;
}

/**
 * Reset all locks (used in testing).
 */
export function resetLockedSeats() {
	_locks.clear();
}
