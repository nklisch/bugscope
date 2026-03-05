/**
 * Array pagination utilities.
 * Provides page-by-page access to large arrays.
 */

/**
 * Return a single page of items from an array.
 * @param {Array} items - The full array to paginate
 * @param {number} page - 1-based page number
 * @param {number} pageSize - Number of items per page
 * @returns {{ items: Array, page: number, totalPages: number, totalItems: number }}
 */
export function paginate(items, page, pageSize) {
	const totalPages = Math.ceil(items.length / pageSize);
	const start = (page - 1) * pageSize;

	// BUG: splice mutates the array, removing elements from it.
	// Should be slice(start, start + pageSize).
	const pageItems = items.splice(start, pageSize);

	return {
		items: pageItems,
		page,
		totalPages,
		totalItems: items.length, // wrong: items.length is now reduced by splice
	};
}

/**
 * Return all pages of an array.
 * @param {Array} items
 * @param {number} pageSize
 * @returns {Array<{ items: Array, page: number, totalPages: number, totalItems: number }>}
 */
export function paginateAll(items, pageSize) {
	const pages = [];
	const totalPages = Math.ceil(items.length / pageSize);
	for (let i = 1; i <= totalPages; i++) {
		pages.push(paginate(items, i, pageSize));
	}
	return pages;
}

/**
 * Return the total number of pages for a given array and page size.
 * @param {Array} items
 * @param {number} pageSize
 * @returns {number}
 */
export function pageCount(items, pageSize) {
	return Math.ceil(items.length / pageSize);
}
