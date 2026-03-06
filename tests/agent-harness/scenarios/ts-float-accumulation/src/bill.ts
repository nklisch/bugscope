/**
 * Restaurant bill splitting utility.
 * Splits a bill evenly among diners, including tip.
 */

export interface BillSplit {
	perPerson: number;
	shares: number[];
	totalWithTip: number;
	totalShares: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Split a restaurant bill evenly among `numPeople` diners.
 *
 * BUG: floating-point arithmetic means that `perPerson * numPeople` is
 * rarely exactly equal to `billWithTip`. The exact `!==` comparison almost
 * always triggers the "correction" branch, which adds the floating-point
 * residual to the last share BEFORE rounding. After rounding all shares,
 * the last share ends up a cent off, making `totalShares !== totalWithTip`.
 */
export function splitBill(total: number, numPeople: number, tipPct = 0.18): BillSplit {
	const tip = total * tipPct;
	const billWithTip = total + tip;
	const perPerson = billWithTip / numPeople;

	const shares: number[] = Array(numPeople).fill(perPerson);
	const totalShares = shares.reduce((a: number, b: number) => a + b, 0);

	// BUG: exact float comparison — almost always true due to IEEE 754
	if (totalShares !== billWithTip) {
		// "Correction" adds the float residual to the last share before rounding.
		// After rounding, the last share absorbs the epsilon and may shift by $0.01.
		shares[numPeople - 1] += billWithTip - totalShares;
	}

	const roundedShares = shares.map(round2);

	return {
		perPerson: round2(perPerson),
		shares: roundedShares,
		totalWithTip: round2(billWithTip),
		totalShares: round2(roundedShares.reduce((a: number, b: number) => a + b, 0)),
	};
}

/**
 * Format a bill split as a human-readable breakdown.
 */
export function formatBillSummary(split: BillSplit): string {
	const lines = [
		`Total with tip: $${split.totalWithTip.toFixed(2)}`,
		`Per person: $${split.perPerson.toFixed(2)}`,
		`Shares: ${split.shares.map(s => `$${s.toFixed(2)}`).join(", ")}`,
		`Sum of shares: $${split.totalShares.toFixed(2)}`,
	];
	return lines.join("\n");
}
