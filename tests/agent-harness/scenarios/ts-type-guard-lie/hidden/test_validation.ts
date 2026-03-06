/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Notification } from "./notification-router.ts";
import { routeBatch, routeNotification } from "./notification-router.ts";

const email: Notification = {
	kind: "email",
	to: "user@example.com",
	subject: "Hello",
	body: "World",
};

const sms: Notification = {
	kind: "sms",
	phone: "+15559876543",
	message: "Hi there",
};

const push: Notification = {
	kind: "push",
	deviceToken: "device-token-clean",
	title: "Alert",
	payload: { severity: "low" },
};

// Enriched push: has phone+message from contact lookup but kind is still "push"
const enrichedPush = {
	kind: "push" as const,
	deviceToken: "device-token-enriched",
	title: "Order shipped",
	payload: { orderId: "ORD-999" },
	phone: "+15551112222",
	message: "Your order shipped",
} as unknown as Notification;

test("email routes to email address", () => {
	const result = routeNotification(email);
	assert.equal(result.channel, "email");
	assert.equal(result.recipient, "user@example.com");
});

test("sms routes to phone number", () => {
	const result = routeNotification(sms);
	assert.equal(result.channel, "sms");
	assert.equal(result.recipient, "+15559876543");
});

test("push routes to device token", () => {
	const result = routeNotification(push);
	assert.equal(result.channel, "push");
	assert.equal(result.recipient, "device-token-clean");
});

test("enriched push routes to device token, not phone", () => {
	const result = routeNotification(enrichedPush);
	assert.equal(result.channel, "push");
	assert.equal(result.recipient, "device-token-enriched", "should use deviceToken, not the enrichment phone field");
	assert.notEqual(result.recipient, "+15551112222", "should not use the contact enrichment phone number");
});

test("batch routing handles all types correctly", () => {
	const results = routeBatch([email, sms, push, enrichedPush]);
	assert.equal(results[0].channel, "email");
	assert.equal(results[1].channel, "sms");
	assert.equal(results[2].channel, "push");
	assert.equal(results[3].channel, "push");
});

test("batch routing uses correct recipient for each type", () => {
	const results = routeBatch([email, sms, push]);
	assert.equal(results[0].recipient, "user@example.com");
	assert.equal(results[1].recipient, "+15559876543");
	assert.equal(results[2].recipient, "device-token-clean");
});

test("sms notification with no extra fields still routes correctly", () => {
	const result = routeNotification(sms);
	assert.equal(result.recipient, "+15559876543");
});
