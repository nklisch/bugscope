import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { configToOptions, listConfigurations, parseLaunchJson, stripJsonc } from "../../../src/core/launch-json.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../../fixtures/launch-json");

describe("launch-json parser", () => {
	describe("stripJsonc", () => {
		it("removes line comments", () => {
			const input = `{\n  "name": "test" // this is a comment\n}`;
			const result = stripJsonc(input);
			expect(JSON.parse(result)).toEqual({ name: "test" });
		});

		it("removes block comments", () => {
			const input = `{\n  /* block comment */\n  "name": "test"\n}`;
			const result = stripJsonc(input);
			expect(JSON.parse(result)).toEqual({ name: "test" });
		});

		it("removes trailing commas", () => {
			const input = `{"a": 1, "b": [1, 2,], "c": {"x": 1,},}`;
			const result = stripJsonc(input);
			expect(JSON.parse(result)).toEqual({ a: 1, b: [1, 2], c: { x: 1 } });
		});

		it("preserves strings containing // and /*", () => {
			const input = `{"url": "http://example.com", "pattern": "/* keep */"}`;
			const result = stripJsonc(input);
			expect(JSON.parse(result)).toEqual({ url: "http://example.com", pattern: "/* keep */" });
		});

		it("handles multiline block comments", () => {
			const input = `{\n  /*\n   * multi-line\n   * comment\n   */\n  "name": "test"\n}`;
			const result = stripJsonc(input);
			expect(JSON.parse(result)).toEqual({ name: "test" });
		});

		it("handles escaped quotes in strings", () => {
			const input = `{"name": "test \\"value\\" here"}`;
			const result = stripJsonc(input);
			expect(JSON.parse(result)).toEqual({ name: 'test "value" here' });
		});
	});

	describe("parseLaunchJson", () => {
		it("parses a valid launch.json file", async () => {
			const result = await parseLaunchJson(resolve(FIXTURES_DIR, "python-basic.json"));
			expect(result).not.toBeNull();
			expect(result?.version).toBe("0.2.0");
			expect(result?.configurations).toHaveLength(1);
			expect(result?.configurations[0].name).toBe("Python: Current File");
		});

		it("returns null for non-existent file", async () => {
			const result = await parseLaunchJson("/nonexistent/path/launch.json");
			expect(result).toBeNull();
		});

		it("handles JSONC with comments and trailing commas", async () => {
			const result = await parseLaunchJson(resolve(FIXTURES_DIR, "with-comments.jsonc"));
			expect(result).not.toBeNull();
			expect(result?.configurations).toHaveLength(1);
			expect(result?.configurations[0].name).toBe("Python: Current File");
		});

		it("parses multi-config file", async () => {
			const result = await parseLaunchJson(resolve(FIXTURES_DIR, "multi-config.json"));
			expect(result).not.toBeNull();
			expect(result?.configurations).toHaveLength(3);
		});
	});

	describe("listConfigurations", () => {
		it("returns names, types, and request modes", async () => {
			const launchJson = await parseLaunchJson(resolve(FIXTURES_DIR, "multi-config.json"));
			const configs = listConfigurations(launchJson!);
			expect(configs).toHaveLength(3);
			expect(configs[0]).toEqual({ name: "Python: Current File", type: "debugpy", request: "launch" });
			expect(configs[1]).toEqual({ name: "Python: Attach", type: "debugpy", request: "attach" });
			expect(configs[2]).toEqual({ name: "Node.js: Launch", type: "node", request: "launch" });
		});
	});

	describe("configToOptions", () => {
		it("converts Python debugpy launch config", () => {
			const config = {
				name: "Python: Current File",
				type: "debugpy",
				request: "launch" as const,
				program: "${workspaceFolder}/app.py",
				args: ["--verbose"],
				cwd: "/project",
				env: { DEBUG: "1" },
			};
			const result = configToOptions(config, "/project");
			expect(result.type).toBe("launch");
			expect(result.options).toMatchObject({
				command: "python3 /project/app.py --verbose",
				language: "python",
				cwd: "/project",
				env: { DEBUG: "1" },
			});
		});

		it("converts Python module config", () => {
			const config = {
				name: "Python: Module",
				type: "debugpy",
				request: "launch" as const,
				module: "pytest",
				args: ["tests/", "-x"],
				cwd: "/project",
			};
			const result = configToOptions(config, "/project");
			expect(result.type).toBe("launch");
			if (result.type === "launch") {
				expect(result.options.command).toBe("python3 -m pytest tests/ -x");
				expect(result.options.language).toBe("python");
			}
		});

		it("converts Node.js launch config", () => {
			const config = {
				name: "Node.js: Launch",
				type: "node",
				request: "launch" as const,
				program: "${workspaceFolder}/index.js",
				args: ["--port", "3000"],
				cwd: "/project",
			};
			const result = configToOptions(config, "/project");
			expect(result.type).toBe("launch");
			if (result.type === "launch") {
				expect(result.options.command).toBe("node /project/index.js --port 3000");
				expect(result.options.language).toBe("node");
			}
		});

		it("converts Go launch config", () => {
			const config = {
				name: "Go: Launch",
				type: "go",
				request: "launch" as const,
				program: "${workspaceFolder}/cmd/myapp",
				args: ["--debug"],
				cwd: "/project",
			};
			const result = configToOptions(config, "/project");
			expect(result.type).toBe("launch");
			if (result.type === "launch") {
				expect(result.options.command).toBe("go run /project/cmd/myapp --debug");
				expect(result.options.language).toBe("go");
			}
		});

		it("converts attach config to AttachOptions", () => {
			const config = {
				name: "Python: Attach",
				type: "debugpy",
				request: "attach" as const,
				port: 5678,
				host: "localhost",
			};
			const result = configToOptions(config);
			expect(result.type).toBe("attach");
			if (result.type === "attach") {
				expect(result.options.language).toBe("python");
				expect(result.options.port).toBe(5678);
				expect(result.options.host).toBe("localhost");
			}
		});

		it("replaces ${workspaceFolder} with cwd", () => {
			const config = {
				name: "Test",
				type: "python",
				request: "launch" as const,
				program: "${workspaceFolder}/main.py",
				cwd: "${workspaceFolder}",
			};
			const result = configToOptions(config, "/my/project");
			expect(result.type).toBe("launch");
			if (result.type === "launch") {
				expect(result.options.command).toContain("/my/project/main.py");
				expect(result.options.cwd).toBe("/my/project");
			}
		});

		it("errors on unsupported type", () => {
			const config = {
				name: "Unknown",
				type: "unsupportedDebugger",
				request: "launch" as const,
				program: "app",
			};
			expect(() => configToOptions(config)).toThrow(/unsupported/i);
		});

		it("errors on Python config missing both program and module", () => {
			const config = {
				name: "Python: Bad",
				type: "python",
				request: "launch" as const,
			};
			expect(() => configToOptions(config)).toThrow(/program.*module|module.*program/i);
		});

		it("errors on C++ config missing program", () => {
			const config = {
				name: "C++: Bad",
				type: "cppdbg",
				request: "launch" as const,
			};
			expect(() => configToOptions(config)).toThrow(/program/i);
		});
	});
});
