/**
 * Daily sales ledger.
 * Records individual sales and generates per-day summary reports.
 */

// Module-level state — persists for the lifetime of the module.
// This is the Node.js equivalent of Python's mutable default argument:
// state accumulated here leaks across all calls to dailyReport.
const _ledger = [];

/**
 * Record a single sale in the ledger.
 * @param {string} item - Item name
 * @param {number} price - Sale price
 * @returns {Array} The current ledger contents
 */
export function registerSale(item, price) {
	_ledger.push({ item, price });
	return _ledger;
}

/**
 * Generate a report for each day's sales.
 *
 * @param {Array<Array<[string, number]>>} salesByDay
 *   An array of days; each day is an array of [item, price] pairs.
 * @returns {Array<{count: number, total: number}>}
 */
export function dailyReport(salesByDay) {
	const reports = [];
	for (const daySales of salesByDay) {
		// BUG: _ledger is never cleared between days.
		// Each iteration appends to the same persistent array, so day 2's
		// report includes day 1's sales, day 3 includes days 1+2, etc.
		for (const [item, price] of daySales) {
			registerSale(item, price);
		}
		reports.push({
			count: _ledger.length,
			total: _ledger.reduce((sum, s) => sum + s.price, 0),
		});
	}
	return reports;
}

/**
 * Reset the ledger (e.g. for testing or end-of-period rollover).
 */
export function clearLedger() {
	_ledger.length = 0;
}

/**
 * Return the current number of entries in the ledger.
 * @returns {number}
 */
export function ledgerSize() {
	return _ledger.length;
}
