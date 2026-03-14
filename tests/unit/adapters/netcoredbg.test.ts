import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getNetcoredbgBinaryPath, getNetcoredbgCachePath, getNetcoredbgDownloadUrl, NETCOREDBG_VERSION } from "../../../src/adapters/netcoredbg.js";

describe("getNetcoredbgCachePath", () => {
	it("returns path under ~/.krometrail/adapters/netcoredbg", () => {
		const cachePath = getNetcoredbgCachePath();
		expect(cachePath).toBe(join(homedir(), ".krometrail", "adapters", "netcoredbg"));
	});
});

describe("getNetcoredbgBinaryPath", () => {
	it("returns binary path inside cache dir", () => {
		const binaryPath = getNetcoredbgBinaryPath();
		expect(binaryPath).toContain("netcoredbg");
		expect(binaryPath).toContain(".krometrail");
	});

	it("ends with .exe on Windows, bare name elsewhere", () => {
		const binaryPath = getNetcoredbgBinaryPath();
		if (process.platform === "win32") {
			expect(binaryPath.endsWith(".exe")).toBe(true);
		} else {
			expect(binaryPath.endsWith("netcoredbg")).toBe(true);
		}
	});
});

describe("getNetcoredbgDownloadUrl", () => {
	it("returns a GitHub releases URL containing the version", () => {
		const url = getNetcoredbgDownloadUrl();
		expect(url).toContain("github.com/Samsung/netcoredbg");
		expect(url).toContain(NETCOREDBG_VERSION);
	});

	it("returns a tar.gz URL on Linux", () => {
		if (process.platform === "linux") {
			const url = getNetcoredbgDownloadUrl();
			expect(url).toContain("linux");
			expect(url.endsWith(".tar.gz")).toBe(true);
		}
	});

	it("returns a tar.gz URL on macOS", () => {
		if (process.platform === "darwin") {
			const url = getNetcoredbgDownloadUrl();
			expect(url).toContain("osx");
			expect(url.endsWith(".tar.gz")).toBe(true);
		}
	});

	it("returns arch-specific URL on Linux", () => {
		if (process.platform === "linux") {
			const url = getNetcoredbgDownloadUrl();
			const arch = process.arch === "arm64" ? "arm64" : "amd64";
			expect(url).toContain(arch);
		}
	});
});

describe("NETCOREDBG_VERSION", () => {
	it("is a non-empty version string", () => {
		expect(NETCOREDBG_VERSION).toBeTruthy();
		expect(typeof NETCOREDBG_VERSION).toBe("string");
	});
});
