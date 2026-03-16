import type { ChildProcess } from "node:child_process";
import { exec, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { getErrorMessage, LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, CONNECT_SLOW, checkCommand, connectOrKill, detectEarlySpawnFailure, gracefulDispose } from "./helpers.js";
import { downloadAndCacheNetcoredbg, getNetcoredbgBinaryPath, isNetcoredbgCached } from "./netcoredbg.js";

const execAsync = promisify(exec);

/**
 * Resolve the netcoredbg binary path — checking PATH first, then falling back to
 * the cached download. Downloads automatically if not yet cached.
 */
async function resolveNetcoredbgBinary(): Promise<string> {
	const onPath = await checkCommand({ cmd: "netcoredbg", args: ["--version"], missing: ["netcoredbg"], installHint: "" });
	if (onPath.satisfied) return "netcoredbg";
	if (!isNetcoredbgCached()) {
		await downloadAndCacheNetcoredbg();
	}
	return getNetcoredbgBinaryPath();
}

export class CSharpAdapter implements DebugAdapter {
	id = "csharp";
	fileExtensions = [".cs"];
	displayName = "C# (netcoredbg)";

	private adapterProcess: ChildProcess | null = null;
	private socket: Socket | null = null;

	/**
	 * Check for dotnet CLI and netcoredbg availability.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult> {
		const dotnet = await checkCommand({
			cmd: "dotnet",
			args: ["--version"],
			missing: ["dotnet"],
			installHint: "Install .NET SDK from https://dotnet.microsoft.com/download",
		});
		if (!dotnet.satisfied) return dotnet;

		// Check netcoredbg: PATH first, then cache
		const netcoredbg = await checkCommand({
			cmd: "netcoredbg",
			args: ["--version"],
			missing: ["netcoredbg"],
			installHint: "Will be downloaded automatically on first use, or install from https://github.com/Samsung/netcoredbg/releases",
		});
		if (!netcoredbg.satisfied && !isNetcoredbgCached()) return netcoredbg;

		return { satisfied: true };
	}

	/**
	 * Launch a C# program via netcoredbg DAP TCP server.
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const cwd = config.cwd ?? process.cwd();
		const parsed = parseCSharpCommand(config.command);
		let dllPath: string;

		if (parsed.type === "source") {
			// Single .cs file: scaffold a temp project and build it
			dllPath = await compileSingleCsFile(resolvePath(cwd, parsed.path), config.env);
		} else if (parsed.type === "project") {
			// dotnet run / project directory: build and find the DLL
			const projectPath = resolvePath(cwd, parsed.path);
			const outDir = join(tmpdir(), `krometrail-cs-${Date.now()}`);
			mkdirSync(outDir, { recursive: true });
			try {
				await execAsync(`dotnet build "${projectPath}" -o "${outDir}" --nologo -v quiet`, {
					cwd,
					env: { ...process.env, ...config.env },
				});
			} catch (err) {
				throw new LaunchError(`dotnet build failed: ${getErrorMessage(err)}`);
			}
			// Find the main DLL (excludes *.deps.json, *.runtimeconfig.json etc.)
			const { stdout } = await execAsync(`ls "${outDir}"/*.dll | grep -v 'deps\\.json\\|runtimeconfig' | head -1`).catch(() => ({ stdout: "" }));
			const found = stdout.trim();
			if (!found) throw new LaunchError(`No DLL found in build output directory: ${outDir}`);
			dllPath = found;
		} else if (parsed.type === "dll") {
			dllPath = resolvePath(cwd, parsed.path);
		} else {
			// binary
			dllPath = resolvePath(cwd, parsed.path);
		}

		const netcoredbg = await resolveNetcoredbgBinary();
		const port = config.port ?? (await allocatePort());

		// netcoredbg 3.1.3+ does not print a ready message to stdout/stderr,
		// so we spawn directly and use connectOrKill to wait for the TCP port.
		const stderrBuf: string[] = [];
		const adapterProc = spawn(netcoredbg, ["--interpreter=vscode", `--server=${port}`], {
			cwd,
			env: { ...process.env, ...config.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		adapterProc.stderr?.on("data", (d: Buffer) => stderrBuf.push(d.toString()));
		await detectEarlySpawnFailure(adapterProc, "netcoredbg", stderrBuf);

		this.adapterProcess = adapterProc;

		const socket = await connectOrKill(adapterProc, "127.0.0.1", port, CONNECT_SLOW, "netcoredbg");
		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: adapterProc,
			launchArgs: {
				type: "coreclr",
				program: dllPath,
				args: parsed.args,
				cwd,
				env: config.env ?? {},
				stopAtEntry: false,
				console: "internalConsole",
			},
		};
	}

	/**
	 * Attach to a running .NET process via netcoredbg.
	 */
	async attach(config: AttachConfig): Promise<DAPConnection> {
		const netcoredbg = await resolveNetcoredbgBinary();
		const port = config.port ?? (await allocatePort());

		const stderrBuf: string[] = [];
		const adapterProc = spawn(netcoredbg, ["--interpreter=vscode", `--server=${port}`], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		adapterProc.stderr?.on("data", (d: Buffer) => stderrBuf.push(d.toString()));
		await detectEarlySpawnFailure(adapterProc, "netcoredbg", stderrBuf);

		this.adapterProcess = adapterProc;

		const socket = await connectOrKill(adapterProc, "127.0.0.1", port, CONNECT_SLOW, "netcoredbg");
		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: adapterProc,
			launchArgs: {
				type: "coreclr",
				request: "attach",
				processId: config.pid,
			},
		};
	}

	async dispose(): Promise<void> {
		await gracefulDispose(this.socket, this.adapterProcess);
		this.socket = null;
		this.adapterProcess = null;
	}
}

/**
 * Compile a single .cs file by scaffolding a minimal temporary project.
 * Returns the path to the built DLL.
 */
async function compileSingleCsFile(srcPath: string, env?: Record<string, string>): Promise<string> {
	const projectDir = join(tmpdir(), `krometrail-cs-${Date.now()}`);
	mkdirSync(projectDir, { recursive: true });

	const projectName = basename(srcPath, ".cs");
	const { dirname } = await import("node:path");
	const originalDir = dirname(srcPath);

	// Scaffold minimal .csproj with PathMap so the PDB references the original
	// source path. Without this, netcoredbg 3.1.3+ can't match breakpoints set
	// on the original path to the temp-compiled source.
	const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <PathMap>${projectDir}=${originalDir}</PathMap>
  </PropertyGroup>
</Project>`;
	writeFileSync(join(projectDir, `${projectName}.csproj`), csproj);

	// Copy source file into the project
	const { copyFileSync } = await import("node:fs");
	copyFileSync(srcPath, join(projectDir, basename(srcPath)));

	const outDir = join(projectDir, "out");
	mkdirSync(outDir, { recursive: true });

	try {
		await execAsync(`dotnet build "${projectDir}" -o "${outDir}" --nologo -v quiet`, {
			env: { ...process.env, ...env },
		});
	} catch (err) {
		throw new LaunchError(`dotnet build failed for ${srcPath}: ${getErrorMessage(err)}`);
	}

	const dllPath = join(outDir, `${projectName}.dll`);
	const { existsSync } = await import("node:fs");
	if (!existsSync(dllPath)) {
		throw new LaunchError(`Build succeeded but DLL not found at: ${dllPath}`);
	}

	return dllPath;
}

/**
 * Parse a C# command string.
 * Handles: "dotnet run", "dotnet MyApp.dll", "./MyApp", "MyApp.cs"
 */
export function parseCSharpCommand(command: string): {
	type: "source" | "project" | "dll" | "binary";
	path: string;
	args: string[];
} {
	const parts = command.trim().split(/\s+/);
	let i = 0;

	const first = parts[i] ?? "";

	if (first === "dotnet") {
		i++;
		const sub = parts[i] ?? "";

		if (sub === "run") {
			i++;
			// Check for --project flag
			if (parts[i] === "--project" && parts[i + 1]) {
				return { type: "project", path: parts[i + 1] as string, args: parts.slice(i + 2) };
			}
			return { type: "project", path: ".", args: parts.slice(i) };
		}

		// dotnet MyApp.dll
		const path = parts[i] ?? "";
		const ext = extname(path).toLowerCase();
		if (ext === ".dll") {
			return { type: "dll", path, args: parts.slice(i + 1) };
		}
	}

	const path = parts[i] ?? "";
	const ext = extname(path).toLowerCase();

	if (ext === ".cs") {
		return { type: "source", path, args: parts.slice(i + 1) };
	}

	if (ext === ".dll") {
		return { type: "dll", path, args: parts.slice(i + 1) };
	}

	return { type: "binary", path, args: parts.slice(i + 1) };
}
