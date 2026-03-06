/**
 * Sales ledger module.
 * Records sales transactions and generates daily summary reports.
 */

export interface SaleEntry {
	item: string;
	price: number;
	category: string;
}

export interface DailyReport {
	count: number;
	total: number;
	topCategory: string | null;
}

// Module-level state — persists across all calls to registerSale and dailyReport.
// BUG: this array is never cleared between processing runs, so each call to
// dailyReport accumulates entries from previous calls.
const _ledger: SaleEntry[] = [];

/**
 * Record a single sale in the ledger.
 * Returns the current ledger state (for inspection/debugging).
 */
export function registerSale(item: string, price: number, category: string): SaleEntry[] {
	_ledger.push({ item, price, category });
	return _ledger;
}

/**
 * Generate a report for each day's sales.
 * Each inner array represents one day's sales as [item, price, category] tuples.
 *
 * BUG: _ledger is never cleared between days. By day N, the ledger contains
 * entries from all previous days. The report for day 2 will include day 1's
 * entries, day 3 will include day 1 and day 2's entries, etc.
 */
export function dailyReport(salesByDay: Array<[string, number, string][]>): DailyReport[] {
	const reports: DailyReport[] = [];

	for (const daySales of salesByDay) {
		for (const [item, price, category] of daySales) {
			registerSale(item, price, category);
		}

		const count = _ledger.length;
		const total = _ledger.reduce((sum, s) => sum + s.price, 0);

		// Find the most common category
		const categoryCounts: Record<string, number> = {};
		for (const entry of _ledger) {
			categoryCounts[entry.category] = (categoryCounts[entry.category] ?? 0) + 1;
		}
		const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

		reports.push({ count, total, topCategory });
	}

	return reports;
}

/**
 * Clear all entries from the ledger. Used for cleanup between test runs.
 */
export function clearLedger(): void {
	_ledger.length = 0;
}
