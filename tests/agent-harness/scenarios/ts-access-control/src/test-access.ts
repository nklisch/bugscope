import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAccess } from "./evaluator.ts";

test("viewer can read reports (own role, not inherited)", () => {
	const result = checkAccess({ role: "viewer", resource: "reports", action: "read" });
	assert.equal(result.granted, true, `Viewer should be able to read reports. Effective: ${JSON.stringify(result.effectivePermissions)}`);
});

test("viewer cannot delete users", () => {
	const result = checkAccess({ role: "viewer", resource: "users", action: "delete" });
	assert.equal(result.granted, false, `Viewer should not be able to delete users. Effective: ${JSON.stringify(result.effectivePermissions)}`);
});
