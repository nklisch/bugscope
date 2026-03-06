import { describe, expect, it } from "vitest";
import { deriveMainClass, KotlinAdapter, parseKotlinCommand } from "../../../src/adapters/kotlin.js";

describe("parseKotlinCommand", () => {
	it("parses 'Main.kt' as source", () => {
		const result = parseKotlinCommand("Main.kt");
		expect(result.type).toBe("source");
		expect(result.path).toBe("Main.kt");
		expect(result.args).toEqual([]);
	});

	it("parses 'kotlinc Main.kt' as source", () => {
		const result = parseKotlinCommand("kotlinc Main.kt");
		expect(result.type).toBe("source");
		expect(result.path).toBe("Main.kt");
	});

	it("parses 'java -jar app.jar' as jar", () => {
		const result = parseKotlinCommand("java -jar app.jar");
		expect(result.type).toBe("jar");
		expect(result.path).toBe("app.jar");
	});

	it("parses 'kotlin -jar app.jar' as jar", () => {
		const result = parseKotlinCommand("kotlin -jar app.jar");
		expect(result.type).toBe("jar");
		expect(result.path).toBe("app.jar");
	});

	it("parses 'app.jar' as jar", () => {
		const result = parseKotlinCommand("app.jar");
		expect(result.type).toBe("jar");
		expect(result.path).toBe("app.jar");
	});

	it("parses 'MainKt' as class", () => {
		const result = parseKotlinCommand("MainKt");
		expect(result.type).toBe("class");
		expect(result.path).toBe("MainKt");
	});

	it("parses 'Main.kt arg1' with args", () => {
		const result = parseKotlinCommand("Main.kt arg1");
		expect(result.type).toBe("source");
		expect(result.args).toEqual(["arg1"]);
	});

	it("parses 'kotlin MainKt arg1' as class with args", () => {
		const result = parseKotlinCommand("kotlin MainKt arg1");
		expect(result.type).toBe("class");
		expect(result.path).toBe("MainKt");
		expect(result.args).toEqual(["arg1"]);
	});

	it("parses 'java -cp classes MainKt' as class", () => {
		const result = parseKotlinCommand("java -cp classes MainKt");
		expect(result.type).toBe("class");
		expect(result.path).toBe("MainKt");
	});
});

describe("deriveMainClass", () => {
	it("derives 'MainKt' from 'Main.kt'", () => {
		expect(deriveMainClass("Main.kt")).toBe("MainKt");
	});

	it("derives 'Hello_worldKt' from 'hello-world.kt'", () => {
		expect(deriveMainClass("hello-world.kt")).toBe("Hello_worldKt");
	});

	it("derives 'AppKt' from 'app.kt'", () => {
		expect(deriveMainClass("app.kt")).toBe("AppKt");
	});

	it("handles filename without extension", () => {
		expect(deriveMainClass("Main")).toBe("MainKt");
	});

	it("derives 'My_fileKt' from 'my_file.kt'", () => {
		expect(deriveMainClass("my_file.kt")).toBe("My_fileKt");
	});

	it("handles multiple hyphens 'a-b-c.kt' => 'A_b_cKt'", () => {
		expect(deriveMainClass("a-b-c.kt")).toBe("A_b_cKt");
	});
});

describe("KotlinAdapter", () => {
	it("has correct adapter properties", () => {
		const adapter = new KotlinAdapter();
		expect(adapter.id).toBe("kotlin");
		expect(adapter.fileExtensions).toEqual([".kt"]);
		expect(adapter.displayName).toBe("Kotlin (java-debug-adapter)");
	});
});
