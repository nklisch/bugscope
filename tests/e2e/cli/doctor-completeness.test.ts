import { describe, expect, it } from "vitest";
import { runCliJson } from "../../helpers/cli-runner.js";

describe("E2E: doctor completeness", () => {
	it("doctor --json returns all 10 registered adapters", async () => {
		const result = await runCliJson<{
			adapters: Array<{ id: string; displayName: string; status: string }>;
		}>(["doctor", "--json"]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const ids = result.data.adapters.map((a) => a.id);
			expect(ids).toContain("python");
			expect(ids).toContain("node");
			expect(ids).toContain("go");
			expect(ids).toContain("rust");
			expect(ids).toContain("java");
			expect(ids).toContain("cpp");
			expect(ids).toContain("ruby");
			expect(ids).toContain("csharp");
			expect(ids).toContain("swift");
			expect(ids).toContain("kotlin");
			expect(result.data.adapters.length).toBe(10);
		}
	});

	it("every missing adapter has an installHint", async () => {
		const result = await runCliJson<{
			adapters: Array<{ id: string; status: string; installHint?: string }>;
		}>(["doctor", "--json"]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const missing = result.data.adapters.filter((a) => a.status === "missing");
			for (const adapter of missing) {
				expect(adapter.installHint, `Adapter '${adapter.id}' is missing but has no installHint`).toBeTruthy();
			}
		}
	});

	it("available adapters have version strings", async () => {
		const result = await runCliJson<{
			adapters: Array<{ id: string; status: string; version?: string }>;
		}>(["doctor", "--json"]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const available = result.data.adapters.filter((a) => a.status === "available");
			for (const adapter of available) {
				expect(adapter.version, `Adapter '${adapter.id}' is available but has no version`).toBeTruthy();
			}
		}
	});
});
