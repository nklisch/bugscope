/**
 * Hidden oracle validation for multi-order-pipeline.
 * Copied into workspace after agent finishes; run with: node --test test_validation.js
 *
 * Tests each of the 6 bugs independently, plus integration checks.
 * All 6 bugs must be fixed for this suite to pass.
 */

import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { before, after, it, describe } from "node:test";

const CATALOG = "http://localhost:5001";
const PRICING  = "http://localhost:5002";
const ORDERS   = "http://localhost:5003";

async function waitForHealth(url, timeoutMs = 25_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`${url}/health`);
			if (r.ok) return;
		} catch { /* not ready */ }
		await new Promise(r => setTimeout(r, 300));
	}
	throw new Error(`${url} did not become healthy within ${timeoutMs}ms`);
}

async function placeOrder(items) {
	const r = await fetch(`${ORDERS}/orders`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ items }),
	});
	if (!r.ok) {
		const body = await r.text();
		throw new Error(`POST /orders ${r.status}: ${body}`);
	}
	return r.json();
}

let services = [];

before(async () => {
	for (const cmd of ["python app.py", "node server.js", "./order-service"]) {
		try { spawn("pkill", ["-f", cmd]); } catch { /* ignore */ }
	}
	await new Promise(r => setTimeout(r, 500));

	services.push(spawn("python", ["app.py"], {
		cwd: "catalog-service",
		stdio: "pipe",
		env: { ...process.env, PORT: "5001" },
	}));
	services.push(spawn("node", ["server.js"], {
		cwd: "pricing-service",
		stdio: "pipe",
		env: { ...process.env, PORT: "5002" },
	}));
	services.push(spawn("./order-service", [], {
		cwd: "order-service",
		stdio: "pipe",
		env: { ...process.env, PORT: "5003" },
	}));

	await Promise.all([
		waitForHealth(CATALOG),
		waitForHealth(PRICING),
		waitForHealth(ORDERS),
	]);
}, { timeout: 35_000 });

after(() => {
	for (const svc of services) {
		try { svc.kill("SIGTERM"); } catch { /* ignore */ }
	}
});

// ── Bug 1: String weight_kg in catalog → $0 shipping ─────────────────────────

describe("Bug 1: electronics shipping (string weight_kg)", () => {
	it("catalog returns numeric weight_kg for ELEC-001", async () => {
		const r = await fetch(`${CATALOG}/products/ELEC-001`);
		const product = await r.json();
		assert.equal(typeof product.weight_kg, "number",
			`ELEC-001 weight_kg should be a number, got ${typeof product.weight_kg} (${JSON.stringify(product.weight_kg)})`);
		assert.ok(product.weight_kg > 0,
			`ELEC-001 weight_kg should be > 0, got ${product.weight_kg}`);
	});

	it("catalog returns numeric weight_kg for ELEC-002", async () => {
		const r = await fetch(`${CATALOG}/products/ELEC-002`);
		const product = await r.json();
		assert.equal(typeof product.weight_kg, "number",
			`ELEC-002 weight_kg should be a number, got ${typeof product.weight_kg}`);
	});

	it("electronics order has non-zero shipping cost", async () => {
		const order = await placeOrder([
			{ productId: "ELEC-001", quantity: 1 },
			{ productId: "ELEC-002", quantity: 1 },
		]);
		assert.ok(order.shippingCost > 0,
			`Expected shippingCost > $0 for electronics, got $${order.shippingCost}`);
	});

	it("ELEC-001 shipping matches expected weight (0.15kg × $8 + $3 base = $4.20)", async () => {
		// Only ELEC-001 in the order so we can isolate its shipping contribution
		const order = await placeOrder([
			{ productId: "ELEC-001", quantity: 1 },
			{ productId: "HOME-001", quantity: 1 }, // known-good non-electronics
		]);
		// Total shipping = ELEC-001 + HOME-001
		// ELEC-001: 3.00 + 0.15*8.0 = 4.20
		// HOME-001: 3.00 + 1.2*8.0  = 12.60
		// Total: 16.80
		assert.ok(Math.abs(order.shippingCost - 16.80) < 0.05,
			`Expected $16.80 shipping, got $${order.shippingCost}`);
	});
});

// ── Bug 2: Discount fraction treated as dollar amount ─────────────────────────

describe("Bug 2: volume discount as fraction vs dollar", () => {
	it("5-unit order applies 7% discount (not $0.07 off)", async () => {
		// qty=5 → 7% discount → $79.99 * 0.93 = $74.39
		const order = await placeOrder([
			{ productId: "ELEC-004", quantity: 5 },
			{ productId: "HOME-001", quantity: 1 },
		]);
		const item = order.items.find(i => i.productId === "ELEC-004");
		assert.ok(item, "ELEC-004 should be in the order");
		assert.ok(Math.abs(item.unitPrice - 74.39) < 0.05,
			`ELEC-004 × 5 should be $74.39 (7% off $79.99), got $${item.unitPrice}`);
	});

	it("10-unit order applies 10% discount correctly", async () => {
		// qty=10 → 10% discount → $79.99 * 0.90 = $71.99
		const order = await placeOrder([
			{ productId: "ELEC-004", quantity: 10 },
			{ productId: "HOME-001", quantity: 1 },
		]);
		const item = order.items.find(i => i.productId === "ELEC-004");
		assert.ok(Math.abs(item.unitPrice - 71.99) < 0.05,
			`ELEC-004 × 10 should be $71.99 (10% off $79.99), got $${item.unitPrice}`);
	});

	it("order total uses pricing service finalPrice, not buggy recomputation", async () => {
		// If Bug 2 is fixed, the Go handler should trust finalPrice from the pricing service.
		// subtotal for 5 × $74.39 = $371.95
		const order = await placeOrder([
			{ productId: "ELEC-004", quantity: 5 },
			{ productId: "HOME-001", quantity: 1 },
		]);
		const elec = order.items.find(i => i.productId === "ELEC-004");
		assert.ok(
			Math.abs(elec.lineTotal - elec.unitPrice * 5) < 0.05,
			`lineTotal should equal unitPrice × 5`,
		);
	});
});

// ── Bug 3: Concurrent goroutine ordering ─────────────────────────────────────

describe("Bug 3: concurrent item pricing order", () => {
	it("ELEC-001 in mixed order has its own price ($29.99)", async () => {
		const order = await placeOrder([
			{ productId: "ELEC-001",   quantity: 1 }, // $29.99, slower
			{ productId: "HOME-001",   quantity: 1 }, // $45.00, faster
			{ productId: "OFFICE-001", quantity: 1 }, // $12.99, faster
		]);
		const elec = order.items.find(i => i.productId === "ELEC-001");
		assert.ok(elec, "ELEC-001 missing from order");
		assert.ok(Math.abs(elec.unitPrice - 29.99) < 0.01,
			`ELEC-001 should cost $29.99, got $${elec.unitPrice}`);
	});

	it("OFFICE-001 in mixed order has its own price ($12.99)", async () => {
		const order = await placeOrder([
			{ productId: "ELEC-001",   quantity: 1 },
			{ productId: "HOME-001",   quantity: 1 },
			{ productId: "OFFICE-001", quantity: 1 },
		]);
		const office = order.items.find(i => i.productId === "OFFICE-001");
		assert.ok(office, "OFFICE-001 missing from order");
		assert.ok(Math.abs(office.unitPrice - 12.99) < 0.01,
			`OFFICE-001 should cost $12.99, got $${office.unitPrice}`);
	});

	it("all items in 4-item mixed order have correct prices (10 repeated requests)", async () => {
		// Run 10 times to catch intermittent concurrency bugs
		for (let trial = 0; trial < 10; trial++) {
			const order = await placeOrder([
				{ productId: "ELEC-001",   quantity: 1 }, // $29.99
				{ productId: "HOME-001",   quantity: 1 }, // $45.00
				{ productId: "OFFICE-001", quantity: 1 }, // $12.99
				{ productId: "ELEC-002",   quantity: 1 }, // $39.99
			]);
			const expected = { "ELEC-001": 29.99, "HOME-001": 45.00, "OFFICE-001": 12.99, "ELEC-002": 39.99 };
			for (const [productId, expectedPrice] of Object.entries(expected)) {
				const item = order.items.find(i => i.productId === productId);
				assert.ok(item, `${productId} missing from trial ${trial}`);
				assert.ok(Math.abs(item.unitPrice - expectedPrice) < 0.01,
					`Trial ${trial}: ${productId} should be $${expectedPrice}, got $${item.unitPrice}`);
			}
		}
	});
});

// ── Bug 4: Pagination drops category filter ───────────────────────────────────

describe("Bug 4: catalog pagination preserves category filter", () => {
	it("page 1 of electronics returns only electronics", async () => {
		const data = await fetch(`${CATALOG}/products?category=electronics`).then(r => r.json());
		for (const p of data.products) {
			assert.equal(p.category, "electronics",
				`Page 1 returned non-electronics: ${p.name} (${p.category})`);
		}
	});

	it("next_page URL includes category parameter", async () => {
		const data = await fetch(`${CATALOG}/products?category=electronics`).then(r => r.json());
		assert.ok(data.next_page, "Electronics should have a next page");
		assert.ok(data.next_page.includes("category=electronics"),
			`next_page "${data.next_page}" should contain "category=electronics"`);
	});

	it("page 2 of electronics returns only electronics", async () => {
		const page1 = await fetch(`${CATALOG}/products?category=electronics`).then(r => r.json());
		assert.ok(page1.next_page, "Electronics should have page 2");
		const page2 = await fetch(`${CATALOG}${page1.next_page}`).then(r => r.json());
		assert.ok(page2.products.length > 0, "Page 2 should have products");
		for (const p of page2.products) {
			assert.equal(p.category, "electronics",
				`Page 2 returned non-electronics: ${p.name} (${p.category})`);
		}
	});

	it("total electronics across all pages matches 12", async () => {
		const allElec = [];
		let url = `${CATALOG}/products?category=electronics`;
		while (url) {
			const data = await fetch(url).then(r => r.json());
			allElec.push(...data.products);
			url = data.next_page ? `${CATALOG}${data.next_page}` : null;
		}
		assert.equal(allElec.length, 12,
			`Expected 12 electronics products across pages, got ${allElec.length}`);
		for (const p of allElec) {
			assert.equal(p.category, "electronics",
				`Non-electronics product in paginated result: ${p.name}`);
		}
	});
});

// ── Bug 5: Cache ignores quantity tier ───────────────────────────────────────
//
// Tests call the PRICING service directly (not the order gateway) to isolate Bug 5
// from Bug 2 (discount misinterpretation). We check the returned `basePrice` field,
// which is what the cache stores and returns — unaffected by discount computation.

async function getPricedBasePrice(productId, quantity) {
	const r = await fetch(`${PRICING}/price`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ items: [{ productId, quantity }] }),
	});
	const data = await r.json();
	return data.items[0].basePrice;
}

describe("Bug 5: price cache respects quantity tiers", () => {
	before(async () => {
		await fetch(`${PRICING}/cache`, { method: "DELETE" });
	});

	it("pricing service returns $12.99 base price for 1 unit of OFFICE-001", async () => {
		const basePrice = await getPricedBasePrice("OFFICE-001", 1);
		assert.ok(Math.abs(basePrice - 12.99) < 0.01,
			`1 unit base price should be $12.99, got $${basePrice}`);
	});

	it("pricing service returns $9.99 base price for 30 units of OFFICE-001 (tier 3)", async () => {
		// Cache was warmed with $12.99 by previous test.
		// Bug 5: cache key is productId only — returns $12.99 instead of $9.99.
		const basePrice = await getPricedBasePrice("OFFICE-001", 30);
		assert.ok(Math.abs(basePrice - 9.99) < 0.01,
			`30 units base price should be $9.99 (tier 3: 25+), got $${basePrice} (cached single-unit price)`);
	});

	it("pricing service returns $11.49 base price for 10 units of OFFICE-001 (tier 2)", async () => {
		// Warm cache with qty=1 first, then check qty=10 gets tier-2 price
		await fetch(`${PRICING}/cache`, { method: "DELETE" });
		await getPricedBasePrice("OFFICE-001", 1); // warm cache: $12.99
		const basePrice = await getPricedBasePrice("OFFICE-001", 10);
		assert.ok(Math.abs(basePrice - 11.49) < 0.01,
			`10 units base price should be $11.49 (tier 2: 10-24), got $${basePrice}`);
	});

	it("sequential requests with different quantities return different base prices", async () => {
		await fetch(`${PRICING}/cache`, { method: "DELETE" });
		const base1  = await getPricedBasePrice("OFFICE-001", 1);
		const base30 = await getPricedBasePrice("OFFICE-001", 30);
		// base1 = $12.99 (tier 1), base30 should be $9.99 (tier 3)
		// With Bug 5: base30 = $12.99 (cached) so they are equal — assertion fails
		assert.ok(base30 < base1,
			`Tier-3 base price ($${base30}) should be less than tier-1 price ($${base1})`);
	});
});

// ── Bug 6: Content-Type mismatch on single-item endpoint ─────────────────────

describe("Bug 6: priceSingle Content-Type header", () => {
	it("reprice endpoint returns non-zero price for ELEC-001", async () => {
		const order = await placeOrder([
			{ productId: "ELEC-001", quantity: 1 },
			{ productId: "HOME-001", quantity: 1 },
		]);
		const r = await fetch(`${ORDERS}/orders/${order.orderId}/reprice`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ productId: "ELEC-001", quantity: 1 }),
		});
		const repriced = await r.json();
		assert.ok(repriced.unitPrice > 0,
			`Reprice should return positive price, got $${repriced.unitPrice}`);
	});

	it("reprice price matches batch pricing for the same item", async () => {
		const batchOrder = await placeOrder([
			{ productId: "HOME-001", quantity: 1 },
			{ productId: "HOME-002", quantity: 1 },
		]);
		const batchPrice = batchOrder.items.find(i => i.productId === "HOME-001").unitPrice;

		const repriceOrder = await placeOrder([
			{ productId: "HOME-001", quantity: 1 },
			{ productId: "HOME-002", quantity: 1 },
		]);
		const r = await fetch(`${ORDERS}/orders/${repriceOrder.orderId}/reprice`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ productId: "HOME-001", quantity: 1 }),
		});
		const repriced = await r.json();
		assert.ok(Math.abs(repriced.unitPrice - batchPrice) < 0.01,
			`Reprice ($${repriced.unitPrice}) should match batch price ($${batchPrice})`);
	});

	it("reprice for ELEC-001 returns ~$29.99", async () => {
		const order = await placeOrder([
			{ productId: "ELEC-001", quantity: 1 },
			{ productId: "HOME-001", quantity: 1 },
		]);
		const r = await fetch(`${ORDERS}/orders/${order.orderId}/reprice`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ productId: "ELEC-001", quantity: 1 }),
		});
		const repriced = await r.json();
		assert.ok(Math.abs(repriced.unitPrice - 29.99) < 0.01,
			`ELEC-001 reprice should be ~$29.99, got $${repriced.unitPrice}`);
	});
});

// ── Integration: full pipeline correctness ───────────────────────────────────

describe("Integration: full order pipeline", () => {
	before(async () => {
		await fetch(`${PRICING}/cache`, { method: "DELETE" });
	});

	it("order total = subtotal + shipping + tax for a mixed order", async () => {
		const order = await placeOrder([
			{ productId: "ELEC-001", quantity: 2 }, // $29.99 × 2
			{ productId: "HOME-001", quantity: 1 }, // $45.00
			{ productId: "OFFICE-001", quantity: 1 }, // $12.99
		]);
		const expectedSubtotal = Math.round(
			(order.items.reduce((s, i) => s + i.lineTotal, 0)) * 100,
		) / 100;
		assert.ok(Math.abs(order.subtotal - expectedSubtotal) < 0.02,
			`subtotal mismatch: ${order.subtotal} vs ${expectedSubtotal}`);
		const expectedTotal = Math.round((order.subtotal + order.shippingCost + order.tax) * 100) / 100;
		assert.ok(Math.abs(order.total - expectedTotal) < 0.02,
			`total mismatch: ${order.total} vs ${expectedTotal}`);
	});
});
