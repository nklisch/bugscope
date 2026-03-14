# Design: Auto-Generated Documentation from Type System

## Overview

Create a `scripts/generate-docs.ts` script that produces reference documentation directly from the codebase's Zod schemas, adapter registry, and framework detector registry. This eliminates the drift between source code and docs that caused ~30 inaccuracies in the hand-written reference pages.

The script generates **markdown partial files** in `docs/.generated/` that are included by the hand-written reference pages via VitePress's `<!--@include: -->` directive. This preserves editorial control (descriptions, examples, tips) while auto-generating the parts that drift: parameter tables, language lists, framework lists.

## Architecture Decision: Mock McpServer

The MCP tool schemas are embedded in `server.tool()` calls inside `registerTools()` and `registerBrowserTools()`. To extract them without starting a real MCP server, the script creates a **mock McpServer** that records each `tool()` call's arguments (name, description, Zod schema object) without executing anything. This is the simplest approach — no AST parsing, no schema duplication, and it exercises the same code path that production uses.

## Implementation Units

### Unit 1: Mock McpServer Capture

**File**: `scripts/generate-docs.ts` (top section)

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Captured tool metadata from server.tool() calls */
interface CapturedTool {
	name: string;
	description: string;
	params: Record<string, z.ZodTypeAny>;
}

/**
 * Create a mock McpServer that captures tool registrations.
 * Records name, description, and Zod schema for each tool() call.
 * All other methods are no-ops.
 */
function createCaptureMock(): { server: McpServer; tools: CapturedTool[] } {
	const tools: CapturedTool[] = [];
	const server = {
		tool(name: string, description: string, schema: Record<string, z.ZodTypeAny>, _handler: unknown): void {
			tools.push({ name, description, params: schema });
		},
		// MCP SDK may call other methods during registration — stub them
		resource: () => {},
		prompt: () => {},
	} as unknown as McpServer;
	return { server, tools };
}
```

**Acceptance Criteria**:
- [ ] Calling `registerTools(mockServer, ...)` captures all 18 debug tools
- [ ] Calling `registerBrowserTools(mockServer, ...)` captures all 10 browser tools
- [ ] Each captured tool has name, description, and params record

### Unit 2: Zod Schema Introspection

**File**: `scripts/generate-docs.ts` (schema section)

```typescript
/** Extracted parameter metadata */
interface ParamInfo {
	name: string;
	type: string;       // e.g., "string", "number", "boolean", '"over" | "into" | "out"'
	required: boolean;
	description: string;
}

/**
 * Extract parameter info from a Zod schema record (the 3rd arg to server.tool()).
 * Handles: z.string(), z.number(), z.boolean(), z.enum(), z.array(),
 * z.object(), z.union(), z.optional() wrappers, and .describe().
 */
function extractParams(params: Record<string, z.ZodTypeAny>): ParamInfo[] {
	// For each key in params:
	//   1. Unwrap ZodOptional/ZodDefault to find the inner type
	//   2. Determine if required (not wrapped in optional/default)
	//   3. Map ZodType to human-readable type string:
	//      - ZodString → "string"
	//      - ZodNumber → "number"
	//      - ZodBoolean → "boolean"
	//      - ZodEnum → join values with " | ", quote strings
	//      - ZodArray → "type[]" (recurse for inner)
	//      - ZodObject → "object" (or inline if small)
	//      - ZodUnion → join options with " | "
	//   4. Extract description from .describe() metadata
}
```

**Implementation Notes**:
- Zod 4 uses `z.ZodOptional`, `z.ZodDefault` wrapper types. Check `schema._def.typeName` or use `schema instanceof z.ZodOptional` to detect.
- For `z.enum()`, access values via `schema._def.values` (array of strings).
- For `z.array()`, recurse on `schema._def.type` (the element schema).
- For `z.object()`, recurse on `schema._def.shape()` to get nested fields.
- Description is on `schema._def.description` or `schema.description`.

**Acceptance Criteria**:
- [ ] Correctly identifies required vs optional params
- [ ] Renders enum values as `"a" | "b" | "c"`
- [ ] Extracts .describe() text
- [ ] Handles nested objects (like `launch_config`, `time_range`)

### Unit 3: Markdown Renderers

**File**: `scripts/generate-docs.ts` (renderer section)

```typescript
/**
 * Render a single MCP tool as a markdown section.
 */
function renderToolMarkdown(tool: CapturedTool): string {
	// Output format:
	// ### `tool_name`
	//
	// {description}
	//
	// | Parameter | Type | Required | Description |
	// |-----------|------|----------|-------------|
	// | `param`   | string | yes    | Description |
}

/**
 * Render the language adapter table from the live registry.
 */
function renderLanguageTable(adapters: DebugAdapter[]): string {
	// Output format:
	// | Language | ID | Debugger | Extensions | Aliases | Status |
	// |----------|----|----------|------------|---------|--------|
	// | Python (debugpy) | python | debugpy | .py | — | Stable |
}

/**
 * Render the framework detector table from the live registry.
 */
function renderFrameworkTable(detectors: ReadonlyArray<FrameworkDetector>): string {
	// Output format:
	// | Framework | Language | ID |
	// |-----------|----------|----|
	// | pytest    | python   | pytest |
}

/**
 * Render ViewportConfig parameter table from the Zod schema.
 */
function renderViewportConfigTable(): string {
	// Extract from ViewportConfigSchema: field name, type, default value
	// Output format:
	// | Parameter | Type | Default | Description |
	// |-----------|------|---------|-------------|
}
```

**Acceptance Criteria**:
- [ ] Tool markdown renders valid markdown tables
- [ ] Tables have consistent column alignment
- [ ] Descriptions are properly escaped for markdown (pipes, backticks)

### Unit 4: File Generation Orchestration

**File**: `scripts/generate-docs.ts` (main section)

```typescript
import { registerAllAdapters, listAdapters } from "../src/adapters/registry.js";
import { registerAllDetectors, listDetectors } from "../src/frameworks/index.js";
import { registerTools } from "../src/mcp/tools/index.js";
import { registerBrowserTools } from "../src/mcp/tools/browser.js";
import { ViewportConfigSchema } from "../src/core/types.js";

const OUTPUT_DIR = "docs/.generated";

async function main(): Promise<void> {
	// 1. Initialize registries
	registerAllAdapters();
	registerAllDetectors();

	// 2. Capture MCP tools via mock server
	const debugMock = createCaptureMock();
	registerTools(debugMock.server, null as any); // SessionManager not needed for registration
	const browserMock = createCaptureMock();
	registerBrowserTools(browserMock.server, null as any); // QueryEngine not needed for registration

	// 3. Generate partial files
	await Bun.write(`${OUTPUT_DIR}/mcp-tools-debug.md`, renderToolsSection("Debug Tools", debugMock.tools));
	await Bun.write(`${OUTPUT_DIR}/mcp-tools-browser.md`, renderToolsSection("Browser Tools", browserMock.tools));
	await Bun.write(`${OUTPUT_DIR}/languages.md`, renderLanguageTable(listAdapters()));
	await Bun.write(`${OUTPUT_DIR}/frameworks.md`, renderFrameworkTable(listDetectors()));
	await Bun.write(`${OUTPUT_DIR}/viewport-config.md`, renderViewportConfigTable());

	console.log(`Generated ${5} files in ${OUTPUT_DIR}/`);
}

main();
```

**Implementation Notes**:
- `registerTools` calls `listDetectors()` and `listAdapters()` internally for building descriptions, so those registries must be populated first.
- The `SessionManager` and `QueryEngine` params are never accessed during registration (only in handlers), so passing `null as any` is safe for schema capture.
- `registerBrowserTools` similarly only uses `queryEngine` in handlers, not during the `server.tool()` call itself.
- Create `docs/.generated/` directory if it doesn't exist via `mkdir -p`.

**Acceptance Criteria**:
- [ ] Script runs without errors: `bun scripts/generate-docs.ts`
- [ ] Produces 5 files in `docs/.generated/`
- [ ] Generated markdown is valid and renders correctly in VitePress

### Unit 5: Include Generated Content in Reference Pages

**Files**: `docs/reference/mcp-tools.md`, `docs/reference/configuration.md`

Replace the hand-written parameter tables with `<!--@include: -->` directives:

```markdown
<!-- In docs/reference/mcp-tools.md -->

# MCP Tools Reference

<!--@include: ../.generated/mcp-tools-debug.md-->

<!--@include: ../.generated/mcp-tools-browser.md-->
```

```markdown
<!-- In docs/reference/configuration.md, Viewport Configuration section -->

## Viewport Configuration

<!--@include: ../.generated/viewport-config.md-->
```

Keep the editorial prose (intro paragraphs, usage tips, JSON examples) hand-written. Only replace the parameter tables and language/framework lists with includes.

For the debugging/framework-detection.md page:
```markdown
## Detected Frameworks

<!--@include: ../.generated/frameworks.md-->
```

**Implementation Notes**:
- VitePress `<!--@include: path-->` is relative to the current file.
- The `.generated/` directory should be gitignored — generation runs in CI before `docs:build`.
- Add `docs/.generated/` to `.gitignore`.

**Acceptance Criteria**:
- [ ] VitePress resolves includes correctly during build
- [ ] Generated content replaces hand-written tables seamlessly
- [ ] Editorial content (intros, examples, tips) is preserved

### Unit 6: Package.json Script and CI Integration

**File**: `package.json` (add script)

```json
{
	"scripts": {
		"docs:generate": "bun scripts/generate-docs.ts",
		"docs:build": "bun scripts/generate-docs.ts && vitepress build docs"
	}
}
```

**File**: `.github/workflows/deploy-pages.yml` (update build step)

The `docs:build` script now runs generation first, so no workflow change needed — it's chained in the npm script.

**File**: `.gitignore` (add generated dir)

```
docs/.generated/
```

**Acceptance Criteria**:
- [ ] `bun run docs:generate` produces the partial files
- [ ] `bun run docs:build` generates then builds (VitePress resolves includes)
- [ ] `.generated/` directory is not committed

---

## Implementation Order

1. **Unit 1**: Mock McpServer capture
2. **Unit 2**: Zod schema introspection
3. **Unit 3**: Markdown renderers
4. **Unit 4**: File generation orchestration — at this point, `bun scripts/generate-docs.ts` works
5. **Unit 6**: Package.json script + .gitignore — verify `bun run docs:build` works end-to-end
6. **Unit 5**: Wire includes into reference pages — replace hand-written tables with `<!--@include:-->` directives, verify VitePress build

## Testing

### Manual Verification (Primary)

This is a code generation script, not runtime logic. Primary verification is:

```bash
bun scripts/generate-docs.ts                     # generates files
diff docs/.generated/mcp-tools-debug.md expected  # spot-check a few
bun run docs:build                                # VitePress build succeeds
```

### Smoke Test: `tests/unit/generate-docs.test.ts`

```typescript
import { describe, test, expect } from "vitest";

// Test the schema introspection logic in isolation

describe("extractParams", () => {
	test("required string param", () => {
		const params = { name: z.string().describe("The name") };
		const result = extractParams(params);
		expect(result).toEqual([{ name: "name", type: "string", required: true, description: "The name" }]);
	});

	test("optional number param with default", () => {
		const params = { count: z.number().optional().describe("How many") };
		const result = extractParams(params);
		expect(result[0].required).toBe(false);
	});

	test("enum param renders values", () => {
		const params = { dir: z.enum(["over", "into", "out"]).describe("Direction") };
		const result = extractParams(params);
		expect(result[0].type).toBe('"over" | "into" | "out"');
	});

	test("array param", () => {
		const params = { items: z.array(z.string()).describe("List") };
		const result = extractParams(params);
		expect(result[0].type).toBe("string[]");
	});

	test("nested object param", () => {
		const params = {
			config: z.object({ a: z.string(), b: z.number() }).optional().describe("Config"),
		};
		const result = extractParams(params);
		expect(result[0].type).toBe("object");
	});
});

describe("createCaptureMock", () => {
	test("captures tool registrations", () => {
		const { server, tools } = createCaptureMock();
		server.tool("test_tool", "A test", { id: z.string() }, async () => ({}));
		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("test_tool");
	});
});
```

**Note**: `extractParams` and `createCaptureMock` should be exported from `scripts/generate-docs.ts` (or factored into a shared module) for testability. Given this is a script, the simplest approach is to export them and have the test import from the script file.

## Verification Checklist

```bash
bun scripts/generate-docs.ts          # generates 5 files
ls docs/.generated/                    # verify files exist
bun run docs:build                     # VitePress build with includes
bun run test:unit                      # smoke tests pass
```

## What This Prevents

After this is in place, when someone:
- Adds a new MCP tool → `bun run docs:generate` picks it up automatically
- Adds a new language adapter → language table updates automatically
- Adds a new framework detector → framework table updates automatically
- Changes a tool's parameter schema → parameter table updates automatically
- Renames a parameter → old name disappears, new name appears

The only manual doc work is writing editorial content (descriptions, examples, guides) — the reference tables are always correct.
