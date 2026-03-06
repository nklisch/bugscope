/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-router.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { routeBatch } from "./notification-router.ts";

// Middleware enriches push notifications with contact info (phone, message text)
// for display in the notification center. The `kind` field is still "push".
const enrichedPushNotification = {
	kind: "push" as const,
	deviceToken: "device-token-abc123",
	title: "Your order has shipped",
	payload: { orderId: "ORD-001", trackingUrl: "https://track.example.com/ORD-001" },
	// Fields added by contact-enrichment middleware:
	phone: "+15551234567",
	message: "Your order has shipped. Track at https://track.example.com/ORD-001",
};

test("push notification is routed to device token, not phone number", () => {
	// TypeScript won't flag the extra fields here since enrichedPushNotification
	// is a superset of PushNotification — the as-cast is valid structurally.
	const results = routeBatch([enrichedPushNotification as unknown as import("./notification-router.ts").Notification]);
	assert.equal(results[0].channel, "push", `channel should be 'push', got '${results[0].channel}'`);
	assert.equal(
		results[0].recipient,
		"device-token-abc123",
		`Expected recipient to be device token, got '${results[0].recipient}'`,
	);
});

test("plain push notification (no enrichment) routes correctly", () => {
	const push = {
		kind: "push" as const,
		deviceToken: "device-xyz-789",
		title: "Alert",
		payload: { severity: "high" },
	};
	const results = routeBatch([push]);
	assert.equal(results[0].recipient, "device-xyz-789");
});
