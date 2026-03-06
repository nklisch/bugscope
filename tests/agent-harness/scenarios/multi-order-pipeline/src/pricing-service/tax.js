/**
 * Tax computation by jurisdiction.
 *
 * Rates are a simplified flat percentage per region code.
 * For orders without a known jurisdiction, the default rate applies.
 */

const TAX_RATES = {
	US_CA: 0.0975,
	US_NY: 0.08875,
	US_TX: 0.0625,
	US_WA: 0.065,
	US_OR: 0.0,   // Oregon has no sales tax
	GB:    0.20,   // UK VAT
	DE:    0.19,   // German VAT
	AU:    0.10,   // Australian GST
	DEFAULT: 0.08,
};

const EXEMPT_CATEGORIES = new Set(["groceries", "medicine"]);

/**
 * Compute tax amount for a subtotal.
 * @param {number} subtotal
 * @param {string} [jurisdiction]
 * @param {string} [category]
 * @returns {number} tax amount (rounded to 2 decimal places)
 */
export function computeTax(subtotal, jurisdiction = "DEFAULT", category = "") {
	if (EXEMPT_CATEGORIES.has(category)) {
		return 0;
	}
	const rate = TAX_RATES[jurisdiction] ?? TAX_RATES.DEFAULT;
	return Math.round(subtotal * rate * 100) / 100;
}

export function listJurisdictions() {
	return Object.keys(TAX_RATES).filter(k => k !== "DEFAULT");
}
