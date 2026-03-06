/**
 * Product catalog for ShopEasy.
 *
 * Provides product lookup by SKU and category browsing.
 * All prices are in USD.
 */

const PRODUCTS = [
	{ sku: 'WGT-001', name: 'Standard Widget', category: 'widgets', price: 12.99, weightLb: 0.5, inStock: 500 },
	{ sku: 'WGT-002', name: 'Premium Widget', category: 'widgets', price: 24.99, weightLb: 0.8, inStock: 200 },
	{ sku: 'WGT-003', name: 'Heavy-Duty Widget', category: 'widgets', price: 39.99, weightLb: 1.2, inStock: 150 },
	{ sku: 'GAD-001', name: 'Mini Gadget', category: 'gadgets', price: 9.99, weightLb: 0.2, inStock: 1000 },
	{ sku: 'GAD-002', name: 'Pro Gadget', category: 'gadgets', price: 49.99, weightLb: 1.0, inStock: 75 },
	{ sku: 'GAD-003', name: 'Industrial Gadget', category: 'gadgets', price: 89.99, weightLb: 2.5, inStock: 30 },
	{ sku: 'ACC-001', name: 'Mounting Bracket', category: 'accessories', price: 4.99, weightLb: 0.3, inStock: 800 },
	{ sku: 'ACC-002', name: 'Connector Kit', category: 'accessories', price: 7.99, weightLb: 0.1, inStock: 600 },
	{ sku: 'ACC-003', name: 'Carrying Case', category: 'accessories', price: 19.99, weightLb: 0.7, inStock: 250 },
	{ sku: 'TOL-001', name: 'Assembly Tool', category: 'tools', price: 14.99, weightLb: 0.4, inStock: 400 },
	{ sku: 'TOL-002', name: 'Calibration Kit', category: 'tools', price: 34.99, weightLb: 0.6, inStock: 120 },
];

/**
 * Look up a product by SKU.
 *
 * @param {string} sku
 * @returns {Object | null}
 */
export function getProduct(sku) {
	return PRODUCTS.find((p) => p.sku === sku) ?? null;
}

/**
 * Get all products in a category.
 *
 * @param {string} category
 * @returns {Object[]}
 */
export function getByCategory(category) {
	return PRODUCTS.filter((p) => p.category === category);
}

/**
 * Get all products, optionally filtered and sorted.
 *
 * @param {{ category?: string, maxPrice?: number, sortBy?: 'price'|'name' }} options
 * @returns {Object[]}
 */
export function listProducts(options = {}) {
	let products = [...PRODUCTS];
	if (options.category) products = products.filter((p) => p.category === options.category);
	if (options.maxPrice) products = products.filter((p) => p.price <= options.maxPrice);
	if (options.sortBy === 'price') products.sort((a, b) => a.price - b.price);
	if (options.sortBy === 'name') products.sort((a, b) => a.name.localeCompare(b.name));
	return products;
}

/**
 * Check whether a SKU exists in the catalog.
 *
 * @param {string} sku
 * @returns {boolean}
 */
export function productExists(sku) {
	return PRODUCTS.some((p) => p.sku === sku);
}

/**
 * Get the weight of a product by SKU.
 *
 * @param {string} sku
 * @returns {number | null} Weight in lbs
 */
export function getProductWeight(sku) {
	const product = getProduct(sku);
	return product ? product.weightLb : null;
}
