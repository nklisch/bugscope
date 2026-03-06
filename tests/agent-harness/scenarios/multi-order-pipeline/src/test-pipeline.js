/**
 * Visible integration tests for the order pipeline.
 *
 * These tests verify the service contracts and non-buggy paths.
 * They pass with the current code and serve as a regression guard.
 *
 * Run with: node --test test-pipeline.js
 */

import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { before, after, it } from "node:test";

const CATALOG = "http://localhost:5001";
const PRICING  = "http://localhost:5002";
const ORDERS   = "http://localhost:5003";

async function waitForHealth(url, timeoutMs = 20_000) {
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

let services = [];

before(async () => {
	for (const cmd of ["python app.py", "node server.js", "./order-service"]) {
		try { spawn("pkill", ["-f", cmd]); } catch { /* ignore */ }
	}
	await new Promise(r => setTimeout(r, 400));

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
}, { timeout: 30_000 });

after(() => {
	for (const svc of services) {
		try { svc.kill("SIGTERM"); } catch { /* ignore */ }
	}
});

// All three services respond to health checks
it("all services are healthy", async () => {
	const [c, p, o] = await Promise.all([
		fetch(`${CATALOG}/health`).then(r => r.json()),
		fetch(`${PRICING}/health`).then(r => r.json()),
		fetch(`${ORDERS}/health`).then(r => r.json()),
	]);
	assert.equal(c.status, "ok");
	assert.equal(p.status, "ok");
	assert.equal(o.status, "ok");
});

// Catalog returns a paginated product list with expected shape
it("catalog returns product list with correct shape", async () => {
	const data = await fetch(`${CATALOG}/products`).then(r => r.json());
	assert.ok(Array.isArray(data.products), "products should be an array");
	assert.ok(data.products.length > 0, "products array should be non-empty");
	const first = data.products[0];
	assert.ok(first.id, "product should have id");
	assert.ok(first.name, "product should have name");
	assert.ok(first.category, "product should have category");
	assert.ok(typeof first.base_price === "number", "base_price should be a number");
});

// Catalog returns individual product details
it("catalog returns single product by id", async () => {
	const product = await fetch(`${CATALOG}/products/HOME-001`).then(r => r.json());
	assert.equal(product.id, "HOME-001");
	assert.equal(product.name, "Desk Lamp");
	assert.equal(product.category, "home");
	assert.equal(typeof product.weight_kg, "number");
});

// Order for a single home item returns a valid order structure
// Home items have numeric weight_kg so shipping works; qty=1 means no discount so applyDiscount is correct
it("placing a home item order returns a valid order", async () => {
	const r = await fetch(`${ORDERS}/orders`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ items: [{ productId: "HOME-001", quantity: 1 }] }),
	});
	assert.equal(r.status, 200);
	const order = await r.json();
	assert.ok(order.orderId, "order should have orderId");
	assert.equal(order.status, "confirmed");
	assert.ok(Array.isArray(order.items), "items should be an array");
	assert.equal(order.items.length, 1);
	assert.ok(typeof order.subtotal === "number", "subtotal should be a number");
	assert.ok(typeof order.shippingCost === "number", "shippingCost should be a number");
	assert.ok(typeof order.total === "number", "total should be a number");
	assert.ok(order.shippingCost > 0, "home item should have positive shipping cost");
});

// Promotions endpoint returns the active promotions list
it("pricing service returns active promotions list", async () => {
	const data = await fetch(`${PRICING}/promotions`).then(r => r.json());
	assert.ok(Array.isArray(data.promotions), "promotions should be an array");
});
