/**
 * Transaction batch processor.
 * Normalizes and aggregates transactions from multiple API sources.
 */

export interface Transaction {
	id: string;
	amount: number;
	currency: string;
	type: "credit" | "debit" | "refund";
	timestamp: Date;
}

export interface ProcessedBatch {
	transactions: Transaction[];
	totalAmount: number;
	avgAmount: number;
	currencies: string[];
	byType: Record<string, number>;
}

/**
 * Normalize a raw record from any API source into a typed Transaction.
 *
 * BUG: the parameter is typed as `any`, which silences the type checker.
 * Some API sources return `amount` as a string (e.g., "150.00") rather
 * than a number. This function copies the raw value through without coercion,
 * so the resulting Transaction has `amount: "150.00"` (a string) even though
 * the interface declares `amount: number`. TypeScript trusts the `any` cast
 * and never warns about the mismatch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(record: any): Transaction {
	return {
		id: String(record.id),
		amount: record.amount, // BUG: not coerced — may be string "150.00"
		currency: (record.currency ?? "USD").toUpperCase(),
		type: record.type ?? "credit",
		timestamp: new Date(record.timestamp ?? record.date ?? Date.now()),
	};
}

/**
 * Process a batch of raw transaction records from one or more API sources.
 */
export function processBatch(records: any[]): ProcessedBatch {
	const transactions = records.map(normalizeRecord);

	// BUG: when the first string-amount record is encountered, `0 + "150.00"`
	// produces the string "0150.00" (JS coercion). Subsequent additions
	// continue as string concatenation.
	const totalAmount = transactions.reduce(
		(sum: number, t: Transaction) => sum + t.amount,
		0,
	);

	const byType: Record<string, number> = {};
	for (const t of transactions) {
		byType[t.type] = (byType[t.type] ?? 0) + 1;
	}

	return {
		transactions,
		totalAmount,
		avgAmount: transactions.length > 0
			? Math.round((totalAmount / transactions.length) * 100) / 100
			: 0,
		currencies: [...new Set(transactions.map((t: Transaction) => t.currency))],
		byType,
	};
}

/**
 * Generate a human-readable summary report for a batch.
 */
export function generateReport(records: any[]): { batch: ProcessedBatch; summary: string } {
	const batch = processBatch(records);
	const total = typeof batch.totalAmount === "number"
		? batch.totalAmount.toFixed(2)
		: String(batch.totalAmount);
	return {
		batch,
		summary: `Processed ${batch.transactions.length} transactions totalling $${total}`,
	};
}
