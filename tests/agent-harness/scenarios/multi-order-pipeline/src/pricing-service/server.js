/**
 * Pricing Engine — Express HTTP server.
 *
 * Endpoints:
 *   POST /price        — batch pricing for multiple cart items
 *   POST /price/single — price a single item (used by order service for re-pricing)
 *   GET  /promotions   — list active promotions
 *   GET  /health
 */

import express from "express";
import { priceBatch, priceItem } from "./pricing.js";
import { listPromotions } from "./promotions.js";
import { clearCache, cacheStats } from "./cache.js";

const app = express();

// Parse JSON and URL-encoded bodies — both middleware are active.
// BUG 6: When Go's priceSingle sends Content-Type: application/x-www-form-urlencoded
// with a JSON body, express.urlencoded() parses the JSON bytes as form data,
// producing garbled keys. req.body.productId will be undefined.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
	res.json({ status: "ok", cache: cacheStats() });
});

app.post("/price", async (req, res) => {
	try {
		const items = req.body?.items;
		if (!Array.isArray(items) || items.length === 0) {
			return res.status(400).json({ error: "items must be a non-empty array" });
		}
		const pricedItems = await priceBatch(items);
		res.json({ items: pricedItems });
	} catch (err) {
		console.error("[pricing] batch error:", err.message);
		res.status(500).json({ error: err.message });
	}
});

app.post("/price/single", async (req, res) => {
	try {
		// When Content-Type is wrong (application/x-www-form-urlencoded with JSON body),
		// express.urlencoded() will parse the raw JSON bytes as URL-encoded form data.
		// The result: req.body has mangled keys, productId is undefined.
		const productId = req.body?.productId;
		const quantity = parseInt(req.body?.quantity) || 1;

		if (!productId) {
			// Fallback for garbled requests — return zero pricing
			return res.json({
				productId: null,
				quantity,
				basePrice: 0,
				discount: 0,
				finalPrice: 0,
				tax: 0,
			});
		}

		const priced = await priceItem({ productId, quantity });
		res.json(priced);
	} catch (err) {
		console.error("[pricing] single error:", err.message);
		res.status(500).json({ error: err.message });
	}
});

app.get("/promotions", (req, res) => {
	res.json({ promotions: listPromotions() });
});

// Cache management (dev/test utility)
app.delete("/cache", (req, res) => {
	clearCache();
	res.json({ cleared: true });
});

const PORT = parseInt(process.env.PORT || "5002");
app.listen(PORT, () => {
	console.log(`Pricing Engine listening on :${PORT}`);
});
