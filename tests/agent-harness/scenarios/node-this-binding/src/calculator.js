/**
 * Tax calculation engine.
 * Applies region-specific tax rates to invoice line items.
 */

class TaxCalculator {
	/**
	 * @param {string} region - "US" or "EU"
	 */
	constructor(region) {
		this.region = region;
		this.rates = {
			US: { sales: 0.08, luxury: 0.12 },
			EU: { sales: 0.20, luxury: 0.25 },
		};
		this.multiplier = 1.0;
	}

	/**
	 * Adjust tax by a multiplier (e.g. 0.5 for a half-tax promotion).
	 * @param {number} m
	 */
	setMultiplier(m) {
		this.multiplier = m;
	}

	/**
	 * Calculate tax for a single item.
	 * @param {number} price
	 * @param {string} category - "sales" or "luxury"
	 * @returns {number} Tax amount rounded to 2 decimal places
	 */
	calculateTax(price, category) {
		const regionRates = this.rates[this.region];
		if (!regionRates) return 0;
		const rate = regionRates[category] ?? regionRates.sales;
		return Math.round(price * rate * this.multiplier * 100) / 100;
	}
}

/**
 * Compute tax for every item on an invoice.
 *
 * @param {Array<{name: string, price: number, category: string}>} items
 * @param {string} region - "US" or "EU"
 * @returns {Array<{name: string, price: number, tax: number, total: number}>}
 */
export function computeInvoiceTax(items, region) {
	const calc = new TaxCalculator(region);

	// BUG: extracting the method into a variable loses the `this` binding.
	// When getTax is called as a plain function, `this` is undefined (strict mode)
	// so this.rates and this.multiplier are undefined, producing NaN.
	const getTax = calc.calculateTax;

	return items.map(item => ({
		name: item.name,
		price: item.price,
		tax: getTax(item.price, item.category),
		total: item.price + getTax(item.price, item.category),
	}));
}

/**
 * Compute the total tax across all items.
 * @param {Array<{name: string, price: number, category: string}>} items
 * @param {string} region
 * @returns {number}
 */
export function totalTax(items, region) {
	const taxed = computeInvoiceTax(items, region);
	return Math.round(taxed.reduce((sum, item) => sum + item.tax, 0) * 100) / 100;
}
