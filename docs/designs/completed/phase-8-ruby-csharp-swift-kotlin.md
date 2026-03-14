# Design: Phase 8 — Ruby, C#, Swift, Kotlin Adapters

## Overview

Add four new debug adapters to extend language coverage. All adapters implement the existing `DebugAdapter` interface and follow established patterns from Phase 4+ adapters.

| Language | Debugger | Transport | Auto-download? |
|----------|----------|-----------|----------------|
| Ruby | rdbg (debug gem) | TCP | No (gem install) |
| C# | netcoredbg | TCP | Yes (GitHub releases) |
| Swift | lldb-dap (Swift toolchain) | stdin/stdout | No (Xcode / swift.org toolchain) |
| Kotlin | java-debug-adapter (reuse Java JAR) | TCP | Yes (already cached by Java adapter) |

Files created:
- `src/adapters/ruby.ts` — new
- `src/adapters/csharp.ts` — new
- `src/adapters/swift.ts` — new
- `src/adapters/kotlin.ts` — new
- `src/adapters/netcoredbg.ts` — new (download/cache manager)
- `tests/helpers/ruby-check.ts` — new
- `tests/helpers/csharp-check.ts` — new
- `tests/helpers/swift-check.ts` — new
- `tests/helpers/kotlin-check.ts` — new
- `tests/fixtures/ruby/simple-loop.rb` — new
- `tests/fixtures/csharp/SimpleLoop.cs` — new
- `tests/fixtures/swift/simple-loop.swift` — new
- `tests/fixtures/kotlin/SimpleLoop.kt` — new
- `tests/integration/adapters/ruby.test.ts` — new
- `tests/integration/adapters/csharp.test.ts` — new
- `tests/integration/adapters/swift.test.ts` — new
- `tests/integration/adapters/kotlin.test.ts` — new

Files modified:
- `src/adapters/registry.ts` — register 4 new adapters
- `src/cli/commands/doctor.ts` — add version detection for all 4
- `src/core/value-renderer.ts` — add Ruby/C#/Swift/Kotlin internal variable sets

No existing interfaces are changed. All changes are additive.

---

## Implementation Units

### Unit 1: Ruby Adapter

**File**: `src/adapters/ruby.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type { Socket } from "node:net";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, connectTCP, gracefulDispose } from "./helpers.js";

export class RubyAdapter implements DebugAdapter {
	id = "ruby";
	fileExtensions = [".rb"];
	displayName = "Ruby (rdbg)";

	private process: ChildProcess | null = null;
	private socket: Socket | null = null;

	checkPrerequisites(): Promise<PrerequisiteResult>;
	launch(config: LaunchConfig): Promise<DAPConnection>;
	attach(config: AttachConfig): Promise<DAPConnection>;
	dispose(): Promise<void>;
}

/**
 * Parse a Ruby command string, stripping "ruby" prefix if present.
 * E.g., "ruby app.rb --verbose" => { script: "app.rb", args: ["--verbose"] }
 */
export function parseRubyCommand(command: string): { script: string; args: string[] };
```

**Implementation Notes**:

- **`checkPrerequisites()`** — Spawn `rdbg --version`, check exit code. If missing, return:
  ```typescript
  { satisfied: false, missing: ["rdbg"], installHint: "gem install debug (requires Ruby 3.1+)" }
  ```
  Also check `ruby --version` to ensure Ruby is present.

- **`launch(config)`**:
  1. Allocate port via `allocatePort()` if not set
  2. Parse command with `parseRubyCommand(config.command)`
  3. Validate script exists (same pattern as `PythonAdapter`)
  4. Spawn rdbg in DAP TCP server mode:
     ```
     rdbg --open=dap --port={port} --host=127.0.0.1 -- ruby {script} {args}
     ```
     The `--open=dap` flag makes rdbg speak DAP over a TCP socket. The `--` separates debugger args from program args.
  5. Wait for readiness. rdbg prints to stderr when it starts listening — look for pattern `/DEBUGGER: wait for debugger connection/i`
  6. Connect TCP with `connectTCP("127.0.0.1", port, 25, 200)`
  7. Return `DAPConnection` with TCP socket as reader/writer

  **DAP launch args**: rdbg in TCP DAP mode handles the program launch itself (similar to debugpy). The debugger starts the Ruby script internally. No `_dapFlow` override is needed — the standard flow (initialize → initialized event → configurationDone → then breakpoints hit) should work. If rdbg requires `launch` before `initialized`, set `_dapFlow: "launch-first"`.

  ```typescript
  const launchArgs: Record<string, unknown> = {
  	type: "rdbg",
  	cwd,
  	env: config.env ?? {},
  	// rdbg handles the script launch internally via the -- args
  };
  ```

  **Important**: Unlike debugpy.adapter which needs the `program` in the DAP launch request, rdbg already has the script path from its CLI args. The DAP `launch` request may need minimal args or none. Test this during implementation — if rdbg expects `script` in the launch request, add it:
  ```typescript
  launchArgs.script = absScript;
  launchArgs.command = "ruby";
  launchArgs.args = args;
  ```

- **`attach(config)`**:
  Connect to a running rdbg instance. The user would have started their Ruby app with `rdbg --open=dap --port=PORT -- ruby script.rb`. Connect TCP and return the socket. No launchArgs needed (attach mode).

- **`dispose()`**: Same `gracefulDispose(socket, process)` pattern.

- **`parseRubyCommand(command)`**: Strip "ruby" prefix. Handle `ruby -e` inline eval (return as-is). Handle bare script paths.

**Acceptance Criteria**:
- [ ] `checkPrerequisites()` returns satisfied when `rdbg` and Ruby 3.1+ are installed
- [ ] `checkPrerequisites()` returns unsatisfied with install hint when `rdbg` or Ruby is missing
- [ ] `launch()` starts rdbg DAP server and returns working DAPConnection
- [ ] DAP messages can be sent/received through the connection
- [ ] `dispose()` kills the rdbg process
- [ ] `parseRubyCommand("ruby app.rb --verbose")` returns `{ script: "app.rb", args: ["--verbose"] }`
- [ ] `parseRubyCommand("app.rb")` returns `{ script: "app.rb", args: [] }`

---

### Unit 2: C# Adapter — netcoredbg Download Manager

**File**: `src/adapters/netcoredbg.ts`

Manage downloading, caching, and locating the netcoredbg binary.

```typescript
/**
 * Pinned netcoredbg version.
 */
export const NETCOREDBG_VERSION: string; // e.g., "3.1.2-1050"

/**
 * Returns the path to the netcoredbg cache directory.
 */
export function getNetcoredbgCachePath(): string;
// Returns: ~/.krometrail/adapters/netcoredbg/

/**
 * Returns the path to the netcoredbg binary.
 */
export function getNetcoredbgBinaryPath(): string;
// Returns: ~/.krometrail/adapters/netcoredbg/netcoredbg (or .exe on Windows)

/**
 * Check if netcoredbg is already cached.
 */
export function isNetcoredbgCached(): boolean;

/**
 * Download and cache netcoredbg from Samsung/netcoredbg GitHub releases.
 * Detects platform (linux-amd64, linux-arm64, osx-amd64, osx-arm64, win64).
 * Downloads tarball/zip, extracts to cache dir.
 * Returns path to binary.
 */
export async function downloadAndCacheNetcoredbg(): Promise<string>;

/**
 * Returns the GitHub release asset URL for the current platform.
 * Pattern: netcoredbg-{platform}.tar.gz (or .zip for Windows)
 */
export function getNetcoredbgDownloadUrl(): string;
```

**Implementation Notes**:
- Follow the exact same download/cache pattern as `src/adapters/rust.ts` (CodeLLDB download manager)
- Cache location: `~/.krometrail/adapters/netcoredbg/`
- Platform detection same as Rust adapter: `platform()` + `process.arch`
- Asset URL format: `https://github.com/nicedoc/netcoredbg/releases/download/v${VERSION}/netcoredbg-${platform}.tar.gz`
  - Actually use `Samsung/netcoredbg` as the repo
  - `linux-amd64`, `linux-arm64`, `osx-amd64`, `osx-arm64`, `win64`
- Extract with `tar xzf` on Unix, `unzip` on Windows (same as Rust adapter's unzip approach)
- Binary is at `netcoredbg/netcoredbg` inside the extracted directory
- Make binary executable with `chmod +x` on Unix
- Check `existsSync` after extraction to verify

**Acceptance Criteria**:
- [ ] `getNetcoredbgBinaryPath()` returns a valid platform-specific path
- [ ] `downloadAndCacheNetcoredbg()` downloads and extracts the binary
- [ ] `isNetcoredbgCached()` reflects presence/absence correctly
- [ ] Subsequent calls skip download
- [ ] Download failure produces clear error with manual install hint

---

### Unit 3: C# Adapter

**File**: `src/adapters/csharp.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import { exec, spawn } from "node:child_process";
import type { Socket } from "node:net";
import { extname, resolve as resolvePath, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, connectTCP, gracefulDispose } from "./helpers.js";
import { downloadAndCacheNetcoredbg, getNetcoredbgBinaryPath, isNetcoredbgCached } from "./netcoredbg.js";

export class CSharpAdapter implements DebugAdapter {
	id = "csharp";
	fileExtensions = [".cs"];
	displayName = "C# (netcoredbg)";

	private adapterProcess: ChildProcess | null = null;
	private socket: Socket | null = null;

	checkPrerequisites(): Promise<PrerequisiteResult>;
	launch(config: LaunchConfig): Promise<DAPConnection>;
	attach(config: AttachConfig): Promise<DAPConnection>;
	dispose(): Promise<void>;
}

/**
 * Parse a C# command string.
 * Handles: "dotnet run", "dotnet MyApp.dll", "./MyApp", "MyApp.cs"
 */
export function parseCSharpCommand(command: string): {
	type: "source" | "project" | "dll" | "binary";
	path: string;
	args: string[];
};
```

**Implementation Notes**:

- **`checkPrerequisites()`**:
  1. Check for `dotnet` CLI: spawn `dotnet --version`, parse exit code
  2. Check for netcoredbg: first check if `netcoredbg` is on PATH, then check cache
  3. If `dotnet` missing: `{ missing: ["dotnet"], installHint: "Install .NET SDK from https://dotnet.microsoft.com" }`
  4. If netcoredbg missing: `{ missing: ["netcoredbg"], installHint: "Will be downloaded automatically on first use, or install from https://github.com/Samsung/netcoredbg/releases" }`

- **`launch(config)`**:
  1. Parse command with `parseCSharpCommand(config.command)`
  2. Handle source file: compile first with `dotnet-script` or create a temporary project
     - **Simpler approach**: For `.cs` files, create a temp project, copy file, `dotnet build`, find DLL
     - Actually simplest: use `dotnet run --project {dir}` if there's a `.csproj`, or compile standalone `.cs` with `dotnet publish` via temp project
     - **Decision**: For single `.cs` files, scaffold a temp csproj, run `dotnet build -o {outDir}`, use the produced DLL. For `dotnet run` / `.csproj` projects, use `dotnet build -o {outDir}` and find the DLL.
  3. Handle `dotnet run` / project: `dotnet build` the project, locate the output DLL
  4. Handle pre-built DLL: use directly
  5. Ensure netcoredbg is available (download if needed)
  6. Allocate port
  7. Spawn netcoredbg in DAP TCP mode:
     ```
     netcoredbg --interpreter=vscode --server --server-port={port}
     ```
  8. Connect TCP to netcoredbg
  9. Return `DAPConnection` with launch args:
     ```typescript
     const launchArgs: Record<string, unknown> = {
     	type: "coreclr",
     	program: dllPath,
     	args: programArgs,
     	cwd,
     	env: config.env ?? {},
     	stopAtEntry: false,
     };
     ```

- **`attach(config)`**:
  1. Ensure netcoredbg available
  2. Allocate port, spawn netcoredbg TCP server
  3. Connect TCP
  4. Return with `launchArgs: { request: "attach", processId: config.pid }`

- **`dispose()`**: Same `gracefulDispose(socket, adapterProcess)` pattern.

- **`parseCSharpCommand(command)`**:
  - `"dotnet run"` → `{ type: "project", path: ".", args: [] }`
  - `"dotnet run --project MyApp"` → `{ type: "project", path: "MyApp", args: [] }`
  - `"dotnet MyApp.dll"` → `{ type: "dll", path: "MyApp.dll", args: [] }`
  - `"MyApp.cs"` → `{ type: "source", path: "MyApp.cs", args: [] }`
  - `"./MyApp"` → `{ type: "binary", path: "./MyApp", args: [] }`

- **Compiling single .cs files**: Create a temporary directory, scaffold minimal `.csproj`:
  ```xml
  <Project Sdk="Microsoft.NET.Sdk">
    <PropertyGroup>
      <OutputType>Exe</OutputType>
      <TargetFramework>net8.0</TargetFramework>
    </PropertyGroup>
  </Project>
  ```
  Copy the `.cs` file into it, run `dotnet build -o {outDir}`, find the DLL. This avoids requiring `dotnet-script` as a dependency.

**Acceptance Criteria**:
- [ ] `checkPrerequisites()` returns satisfied when dotnet and netcoredbg are available
- [ ] `checkPrerequisites()` returns unsatisfied with install hints when missing
- [ ] `launch()` compiles if needed and starts netcoredbg with working DAPConnection
- [ ] Single `.cs` files are compiled via temp project scaffolding
- [ ] `dotnet run` projects are built and DLL is located
- [ ] DAP messages can be sent/received through the connection
- [ ] `dispose()` kills netcoredbg process
- [ ] `parseCSharpCommand("dotnet run")` returns `{ type: "project", path: ".", args: [] }`
- [ ] `parseCSharpCommand("MyApp.cs")` returns `{ type: "source", path: "MyApp.cs", args: [] }`

---

### Unit 4: Swift Adapter

**File**: `src/adapters/swift.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import { exec, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { gracefulDispose } from "./helpers.js";

const execAsync = promisify(exec);

export class SwiftAdapter implements DebugAdapter {
	id = "swift";
	fileExtensions = [".swift"];
	displayName = "Swift (lldb-dap)";

	private debuggerProcess: ChildProcess | null = null;

	checkPrerequisites(): Promise<PrerequisiteResult>;
	launch(config: LaunchConfig): Promise<DAPConnection>;
	attach(config: AttachConfig): Promise<DAPConnection>;
	dispose(): Promise<void>;
}

/**
 * Parse a Swift command string.
 * Handles: "swift run", "swiftc main.swift", "main.swift", "./binary"
 */
export function parseSwiftCommand(command: string): {
	type: "source" | "spm" | "binary";
	path: string;
	args: string[];
};

/**
 * Find the lldb-dap binary, checking PATH first, then macOS-specific locations.
 * On macOS, tries `xcrun -f lldb-dap` as fallback.
 * Returns the full path or null if not found.
 */
export async function findLldbDap(): Promise<string | null>;
```

**Implementation Notes**:

- **This adapter is very similar to the C/C++ adapter** (`src/adapters/cpp.ts`) since both use lldb-dap with stdin/stdout transport. Key differences: Swift compilation uses `swiftc` instead of `gcc`/`g++`, and we need to find the Swift-toolchain-bundled `lldb-dap` (not a system LLVM one).

- **`checkPrerequisites()`**:
  1. Check for `swiftc`: spawn `swiftc --version`, parse exit code
  2. Check for `lldb-dap`: call `findLldbDap()`
  3. If `swiftc` missing: `{ missing: ["swiftc"], installHint: "macOS: xcode-select --install. Linux: install from https://swift.org/download" }`
  4. If `lldb-dap` missing: `{ missing: ["lldb-dap"], installHint: "Install Xcode (macOS) or Swift toolchain (Linux) from https://swift.org" }`

- **`findLldbDap()`**:
  1. Try `lldb-dap --version` (PATH check)
  2. If not found and `process.platform === "darwin"`, try `xcrun -f lldb-dap`
  3. Return the found path or null
  4. **Important**: Only accept `lldb-dap` from a Swift toolchain. A system LLVM `lldb-dap` may not have Swift debugging support. For now, accept any `lldb-dap` and document this caveat — detecting Swift support requires actually trying to debug.

- **`launch(config)`**:
  1. Parse command with `parseSwiftCommand(config.command)`
  2. If source file: compile with `swiftc -g -Onone {source} -o {outPath}` (temp dir output)
  3. If SPM project (`swift run`): build with `swift build`, locate binary in `.build/debug/`
  4. If pre-built binary: use directly
  5. Find lldb-dap binary via `findLldbDap()`
  6. Spawn lldb-dap with **stdin/stdout transport** (same as C/C++ adapter):
     ```
     {lldb-dap-path}    (no args = stdin/stdout mode)
     ```
  7. Wait for early spawn failure (same 500ms check as C/C++ adapter)
  8. Return `DAPConnection` with `child.stdout` as reader, `child.stdin` as writer:
     ```typescript
     return {
     	reader: child.stdout!,
     	writer: child.stdin!,
     	process: child,
     	launchArgs: {
     		_dapFlow: "launch-first",
     		program: binaryPath,
     		cwd,
     		env: config.env ?? {},
     	},
     };
     ```

- **`attach(config)`**: Spawn lldb-dap (stdin/stdout), return with `launchArgs: { request: "attach", pid: config.pid }`. Same pattern as C/C++ adapter attach.

- **`dispose()`**: `gracefulDispose(null, debuggerProcess)` — no socket (stdin/stdout transport).

- **`parseSwiftCommand(command)`**:
  - `"swift run"` → `{ type: "spm", path: ".", args: [] }`
  - `"swift run MyTarget"` → `{ type: "spm", path: "MyTarget", args: [] }`
  - `"main.swift"` or `"swiftc main.swift"` → `{ type: "source", path: "main.swift", args: [] }`
  - `"./mybinary --flag"` → `{ type: "binary", path: "./mybinary", args: ["--flag"] }`

**Acceptance Criteria**:
- [ ] `checkPrerequisites()` returns satisfied when `swiftc` and `lldb-dap` are available
- [ ] `checkPrerequisites()` returns unsatisfied with install hints when missing
- [ ] `findLldbDap()` finds the binary in PATH or via `xcrun` on macOS
- [ ] `launch()` compiles Swift source if needed and returns working DAPConnection
- [ ] SPM projects are built and binary is located in `.build/debug/`
- [ ] DAP messages can be sent/received through stdin/stdout
- [ ] `dispose()` kills the lldb-dap process
- [ ] `parseSwiftCommand("main.swift")` returns `{ type: "source", path: "main.swift", args: [] }`
- [ ] `parseSwiftCommand("swift run")` returns `{ type: "spm", path: ".", args: [] }`

---

### Unit 5: Kotlin Adapter

**File**: `src/adapters/kotlin.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import { exec, spawn } from "node:child_process";
import type { Socket } from "node:net";
import { basename, resolve as resolvePath, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, connectTCP, gracefulDispose, spawnAndWait } from "./helpers.js";
import { downloadAndCacheJavaDebugAdapter, getJavaDebugAdapterCachePath } from "./java.js";

const execAsync = promisify(exec);

export class KotlinAdapter implements DebugAdapter {
	id = "kotlin";
	fileExtensions = [".kt"];
	displayName = "Kotlin (java-debug-adapter)";

	private adapterProcess: ChildProcess | null = null;
	private socket: Socket | null = null;

	checkPrerequisites(): Promise<PrerequisiteResult>;
	launch(config: LaunchConfig): Promise<DAPConnection>;
	attach(config: AttachConfig): Promise<DAPConnection>;
	dispose(): Promise<void>;
}

/**
 * Parse a Kotlin command string.
 * Handles: "kotlinc Main.kt", "kotlin MainKt", "java -jar app.jar", "Main.kt"
 */
export function parseKotlinCommand(command: string): {
	type: "source" | "jar" | "class";
	path: string;
	args: string[];
};

/**
 * Derive the JVM main class name from a .kt filename.
 * "Main.kt" => "MainKt", "hello-world.kt" => "Hello_worldKt"
 * Files with @file:JvmName override cannot be auto-detected.
 */
export function deriveMainClass(filename: string): string;
```

**Implementation Notes**:

- **Reuses the same `java-debug-adapter` JAR** as the Java adapter. The JAR debugs at the JVM/JDWP level, so Kotlin (which compiles to JVM bytecode) works identically.

- **`checkPrerequisites()`**:
  1. Check `kotlinc -version` (note: outputs to stderr). Parse exit code.
  2. Check `javac -version` for JDK 17+ (same check as JavaAdapter)
  3. Check java-debug-adapter JAR cached (reuse `isJavaDebugAdapterCached()` from java.ts)
  4. Missing kotlinc: `{ missing: ["kotlinc"], installHint: "Install Kotlin from https://kotlinlang.org/docs/command-line.html or via SDKMAN: sdk install kotlin" }`
  5. Missing JDK: delegate to same hints as Java adapter

- **`launch(config)`**:
  1. Parse command with `parseKotlinCommand(config.command)`
  2. If source file (`.kt`):
     - Compile: `kotlinc {source} -include-runtime -d {outDir}/program.jar`
     - The `-include-runtime` flag bundles kotlin-stdlib into the JAR, eliminating classpath issues
     - Compilation can take 10-20 seconds (Kotlin compiler is slow) — set timeout appropriately
  3. If pre-built JAR: use directly
  4. Ensure java-debug-adapter JAR is cached (reuse from Java adapter)
  5. Allocate port
  6. Spawn java-debug-adapter server (identical to Java adapter):
     ```
     java -jar {jarPath} --port {port}
     ```
  7. Connect TCP
  8. Return `DAPConnection` with launch args:
     ```typescript
     const launchArgs: Record<string, unknown> = {
     	mainClass: "",  // empty for JAR mode
     	classPaths: [jarPath],
     	jarPath: compiledJarPath,
     	cwd,
     	env: config.env ?? {},
     };
     ```

  **Note**: The launch sequence is identical to `JavaAdapter.launch()` once we have a JAR path. The only difference is the compilation step (kotlinc vs javac).

- **`attach(config)`**: Identical to `JavaAdapter.attach()`. Spawn java-debug-adapter, connect TCP, return with JDWP attach args.

- **`dispose()`**: Same `gracefulDispose(socket, adapterProcess)` pattern.

- **`parseKotlinCommand(command)`**:
  - `"Main.kt"` or `"kotlinc Main.kt"` → `{ type: "source", path: "Main.kt", args: [] }`
  - `"java -jar app.jar"` or `"kotlin -jar app.jar"` → `{ type: "jar", path: "app.jar", args: [] }`
  - `"kotlin MainKt"` → `{ type: "class", path: "MainKt", args: [] }`
  - Strip `kotlinc`/`kotlin`/`java` prefix, detect `.kt`/`.jar` extensions

- **`deriveMainClass(filename)`**: Strip extension, capitalize first letter, append `Kt`. Handle hyphens → underscores. E.g., `"hello-world.kt"` → `"Hello_worldKt"`. This is the JVM convention for top-level Kotlin functions.

**Acceptance Criteria**:
- [ ] `checkPrerequisites()` returns satisfied when `kotlinc` and JDK 17+ are available
- [ ] `checkPrerequisites()` returns unsatisfied with install hints when missing
- [ ] `launch()` compiles `.kt` file with `-include-runtime` and returns working DAPConnection
- [ ] Pre-built JARs work without compilation
- [ ] DAP messages can be sent/received through the connection
- [ ] `dispose()` kills the java-debug-adapter process
- [ ] `parseKotlinCommand("Main.kt")` returns `{ type: "source", path: "Main.kt", args: [] }`
- [ ] `deriveMainClass("Main.kt")` returns `"MainKt"`
- [ ] `deriveMainClass("hello-world.kt")` returns `"Hello_worldKt"`

---

### Unit 6: Adapter Registration

**File**: `src/adapters/registry.ts`

Add imports and registration for all 4 new adapters:

```typescript
import { CSharpAdapter } from "./csharp.js";
import { KotlinAdapter } from "./kotlin.js";
import { RubyAdapter } from "./ruby.js";
import { SwiftAdapter } from "./swift.js";

export function registerAllAdapters(): void {
	// ... existing 6 adapters ...
	registerAdapter(new RubyAdapter());
	registerAdapter(new CSharpAdapter());
	registerAdapter(new SwiftAdapter());
	registerAdapter(new KotlinAdapter());
}
```

**File**: `src/cli/commands/doctor.ts`

Add version detection functions and wire them into the doctor check loop:

```typescript
// In the version check switch:
} else if (adapter.id === "ruby") {
	version = await getRdbgVersion();
} else if (adapter.id === "csharp") {
	version = await getNetcoredbgVersion();
} else if (adapter.id === "swift") {
	version = await getSwiftcVersion();
} else if (adapter.id === "kotlin") {
	version = await getKotlincVersion();
}

async function getRdbgVersion(): Promise<string | undefined>;
// Spawn `rdbg --version`, parse output like "rdbg 1.9.0"

async function getNetcoredbgVersion(): Promise<string | undefined>;
// Spawn `netcoredbg --version`, parse output like "3.1.0-1031"
// If not on PATH, check cached binary

async function getSwiftcVersion(): Promise<string | undefined>;
// Spawn `swiftc --version`, parse "Swift version 5.10" from output

async function getKotlincVersion(): Promise<string | undefined>;
// Spawn `kotlinc -version` (outputs to stderr)
// Parse "kotlinc-jvm 2.0.0" from output
```

**Acceptance Criteria**:
- [ ] `registerAllAdapters()` registers all 10 adapters
- [ ] `krometrail doctor` shows Ruby, C#, Swift, Kotlin adapter status
- [ ] Version strings are correctly parsed for each language
- [ ] Missing adapters show install hints

---

### Unit 7: Value Renderer Extensions

**File**: `src/core/value-renderer.ts`

Add internal variable sets for the new languages:

```typescript
/**
 * Ruby internal variable names to filter.
 * rdbg exposes Ruby runtime internals.
 */
export const RUBY_INTERNAL_NAMES: ReadonlySet<string> = new Set([
	"self",       // always present, rarely useful for debugging
	"__method__",
	"__dir__",
	"__LINE__",
	"__FILE__",
	"__ENCODING__",
]);

/**
 * C# internal variable names to filter.
 * netcoredbg exposes .NET runtime internals.
 */
export const CSHARP_INTERNAL_NAMES: ReadonlySet<string> = new Set([
	"$exception",
	"$returnvalue",
	"$stowedexception",
]);

/**
 * Swift internal variable names to filter.
 * lldb-dap exposes LLDB internals.
 */
export const SWIFT_INTERNAL_NAMES: ReadonlySet<string> = new Set([
	"$__lldb_injected_self",
]);

// Kotlin uses the same JVM runtime as Java — no additional internal names needed.
// The existing Java/Go internal name filtering covers JVM internals.
```

Update `isInternalVariable()`:

```typescript
export function isInternalVariable(name: string): boolean {
	return (
		PYTHON_INTERNAL_NAMES.has(name) ||
		JS_INTERNAL_NAMES.has(name) ||
		GO_INTERNAL_NAMES.has(name) ||
		RUBY_INTERNAL_NAMES.has(name) ||
		CSHARP_INTERNAL_NAMES.has(name) ||
		SWIFT_INTERNAL_NAMES.has(name) ||
		/^__\w+__$/.test(name)
	);
}
```

**Implementation Notes**:
- Ruby `self` filtering is debatable — keep it filterable but consider making it opt-in based on user feedback
- C# `$exception` / `$returnvalue` are synthetic DAP variables from netcoredbg
- Swift internals are minimal since lldb-dap is relatively clean
- Kotlin shares the Java internal variable set (same JVM runtime)
- Type rendering: Ruby types (`Integer`, `String`, `Array`, `Hash`, `NilClass`, `Symbol`), C# types (`int`, `string`, `bool`, `List<T>`, `Dictionary<K,V>`), Swift types (`Int`, `String`, `Bool`, `Array`, `Dictionary`, `Optional<T>`) — add patterns as needed during implementation

**Acceptance Criteria**:
- [ ] Ruby internal variables are filtered
- [ ] C# internal variables are filtered
- [ ] Swift internal variables are filtered
- [ ] Existing Python/JS/Go filtering is unchanged

---

### Unit 8: Test Fixtures

**File**: `tests/fixtures/ruby/simple-loop.rb`

```ruby
def sum_range(n)
  total = 0
  (0...n).each do |i|
    total += i
  end
  total
end

result = sum_range(10)
puts "Sum: #{result}"
```

**File**: `tests/fixtures/csharp/SimpleLoop.cs`

```csharp
class SimpleLoop
{
    static int SumRange(int n)
    {
        int total = 0;
        for (int i = 0; i < n; i++)
        {
            total += i;
        }
        return total;
    }

    static void Main()
    {
        int result = SumRange(10);
        System.Console.WriteLine($"Sum: {result}");
    }
}
```

**File**: `tests/fixtures/swift/simple-loop.swift`

```swift
func sumRange(_ n: Int) -> Int {
    var total = 0
    for i in 0..<n {
        total += i
    }
    return total
}

let result = sumRange(10)
print("Sum: \(result)")
```

**File**: `tests/fixtures/kotlin/SimpleLoop.kt`

```kotlin
fun sumRange(n: Int): Int {
    var total = 0
    for (i in 0 until n) {
        total += i
    }
    return total
}

fun main() {
    val result = sumRange(10)
    println("Sum: $result")
}
```

**Acceptance Criteria**:
- [ ] All fixture programs run and output `Sum: 45`
- [ ] Ruby: `ruby tests/fixtures/ruby/simple-loop.rb`
- [ ] C#: compile and run produces correct output
- [ ] Swift: `swiftc -g tests/fixtures/swift/simple-loop.swift -o /tmp/simple-loop && /tmp/simple-loop`
- [ ] Kotlin: `kotlinc tests/fixtures/kotlin/SimpleLoop.kt -include-runtime -d /tmp/sl.jar && java -jar /tmp/sl.jar`

---

### Unit 9: Test Skip Helpers

**File**: `tests/helpers/ruby-check.ts`

```typescript
import { spawn } from "node:child_process";

export async function isRdbgAvailable(): Promise<boolean>;
// Spawn `rdbg --version`, check exit code 0

export const SKIP_NO_RDBG: boolean;
// = await isRdbgAvailable().then(ok => !ok)
```

**File**: `tests/helpers/csharp-check.ts`

```typescript
import { spawn } from "node:child_process";

export async function isNetcoredbgAvailable(): Promise<boolean>;
// Check `netcoredbg --version` on PATH, then check cached binary

export const SKIP_NO_CSHARP: boolean;
// = await isNetcoredbgAvailable().then(ok => !ok)
```

**File**: `tests/helpers/swift-check.ts`

```typescript
import { spawn } from "node:child_process";

export async function isSwiftDebugAvailable(): Promise<boolean>;
// Check `swiftc --version` AND `lldb-dap --version` (or xcrun -f lldb-dap on macOS)

export const SKIP_NO_SWIFT: boolean;
// = await isSwiftDebugAvailable().then(ok => !ok)
```

**File**: `tests/helpers/kotlin-check.ts`

```typescript
import { spawn } from "node:child_process";

export async function isKotlinDebugAvailable(): Promise<boolean>;
// Check `kotlinc -version` AND `javac -version` (JDK 17+)

export const SKIP_NO_KOTLIN: boolean;
// = await isKotlinDebugAvailable().then(ok => !ok)
```

**Implementation Notes**: Follow exact pattern from `tests/helpers/node-check.ts` — top-level await for the skip boolean.

**Acceptance Criteria**:
- [ ] Each `SKIP_NO_*` correctly reflects debugger availability
- [ ] Tests using these skip cleanly when the debugger is not installed

---

### Unit 10: Integration Tests

**File**: `tests/integration/adapters/ruby.test.ts`

```typescript
describe.skipIf(SKIP_NO_RDBG)("RubyAdapter integration", () => {
	it("checkPrerequisites() returns satisfied: true");
	it("launch() spawns rdbg and returns a working DAPConnection");
	it("DAPConnection can send/receive DAP messages");
	it("dispose() kills the child processes");
	it("launch with bad script path produces clear error");
});
```

**File**: `tests/integration/adapters/csharp.test.ts`

```typescript
describe.skipIf(SKIP_NO_CSHARP)("CSharpAdapter integration", () => {
	it("checkPrerequisites() returns satisfied: true");
	it("launch() compiles and starts netcoredbg with working DAPConnection");
	it("DAPConnection can send/receive DAP messages");
	it("dispose() kills netcoredbg process");
	it("launch with bad .cs file produces clear error");
});
```

**File**: `tests/integration/adapters/swift.test.ts`

```typescript
describe.skipIf(SKIP_NO_SWIFT)("SwiftAdapter integration", () => {
	it("checkPrerequisites() returns satisfied: true");
	it("launch() compiles Swift and returns working DAPConnection");
	it("DAPConnection can send/receive DAP messages");
	it("dispose() kills lldb-dap process");
	it("launch with bad .swift file produces clear error");
});
```

**File**: `tests/integration/adapters/kotlin.test.ts`

```typescript
describe.skipIf(SKIP_NO_KOTLIN)("KotlinAdapter integration", () => {
	it("checkPrerequisites() returns satisfied: true");
	it("launch() compiles .kt and returns working DAPConnection");
	it("DAPConnection can send/receive DAP messages");
	it("dispose() kills java-debug-adapter process");
	it("launch with bad .kt file produces clear error");
});
```

**Implementation Notes**:
- Follow exact test structure from `tests/integration/adapters/python.test.ts`
- C# and Kotlin tests need longer timeouts (compilation is slow): 30s
- Swift compilation is fast for single files: 15s timeout is fine

**Acceptance Criteria**:
- [ ] All 5 tests pass per adapter when the debugger is available
- [ ] Tests skip cleanly when the debugger is not installed
- [ ] No orphaned processes after tests complete

---

## Implementation Order

1. **Unit 8: Test Fixtures** — no dependencies, can be done first
2. **Unit 9: Test Skip Helpers** — no dependencies
3. **Unit 2: netcoredbg Download Manager** — needed by C# adapter
4. **Unit 1: Ruby Adapter** — independent
5. **Unit 3: C# Adapter** — depends on Unit 2
6. **Unit 4: Swift Adapter** — independent
7. **Unit 5: Kotlin Adapter** — depends on existing Java adapter exports
8. **Unit 7: Value Renderer Extensions** — independent
9. **Unit 6: Adapter Registration** — depends on all adapters existing
10. **Unit 10: Integration Tests** — depends on adapters + fixtures + helpers

**Parallelization**:
- Units 1, 4, 8, 9 can all be done in parallel (no dependencies between them)
- Units 2+3 must be sequential (netcoredbg manager → C# adapter)
- Unit 5 can run in parallel with 1, 3, 4 once Java exports are confirmed
- Units 6, 7, 10 can run in parallel after all adapters are done

---

## Testing

### Unit Tests

**`tests/unit/adapters/ruby.test.ts`**:
- `parseRubyCommand()` — various command strings

**`tests/unit/adapters/csharp.test.ts`**:
- `parseCSharpCommand()` — dotnet run, .cs files, .dll files, binaries

**`tests/unit/adapters/swift.test.ts`**:
- `parseSwiftCommand()` — swift run, .swift files, binaries

**`tests/unit/adapters/kotlin.test.ts`**:
- `parseKotlinCommand()` — .kt files, .jar files, class names
- `deriveMainClass()` — filename to JVM class name mapping

**`tests/unit/core/value-renderer.test.ts`** (additions):
- Ruby internal variable filtering
- C# internal variable filtering
- Swift internal variable filtering

### Integration Tests

- `tests/integration/adapters/ruby.test.ts` — 5 tests
- `tests/integration/adapters/csharp.test.ts` — 5 tests
- `tests/integration/adapters/swift.test.ts` — 5 tests
- `tests/integration/adapters/kotlin.test.ts` — 5 tests

---

## Verification Checklist

```bash
# All existing tests still pass
bun run test:unit
bun run test:integration

# New unit tests
bun run test tests/unit/adapters/ruby.test.ts
bun run test tests/unit/adapters/csharp.test.ts
bun run test tests/unit/adapters/swift.test.ts
bun run test tests/unit/adapters/kotlin.test.ts

# New integration tests (require respective debuggers)
bun run test tests/integration/adapters/ruby.test.ts
bun run test tests/integration/adapters/csharp.test.ts
bun run test tests/integration/adapters/swift.test.ts
bun run test tests/integration/adapters/kotlin.test.ts

# Doctor shows all 10 adapters
bun run dev doctor

# Lint passes
bun run lint
```
