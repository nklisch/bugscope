#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { browserCommand } from "./commands/browser.js";
import {
	attachCommand,
	breakCommand,
	breakpointsCommand,
	continueCommand,
	doctorCommand,
	evalCommand,
	launchCommand,
	logCommand,
	outputCommand,
	runToCommand,
	skillCommand,
	sourceCommand,
	stackCommand,
	statusCommand,
	stepCommand,
	stopCommand,
	threadsCommand,
	unwatchCommand,
	varsCommand,
	watchCommand,
} from "./commands/index.js";

const main = defineCommand({
	meta: {
		name: "krometrail",
		version: "0.1.0",
		description: "Runtime debugging viewport for AI coding agents",
	},
	args: {
		mcp: {
			type: "boolean",
			description: "Start as an MCP server on stdio instead of running the CLI",
			default: false,
		},
		tools: {
			type: "string",
			description: "Comma-separated tool groups to expose (debug, browser). Default: all. Only used with --mcp.",
		},
	},
	async run({ args }) {
		if (args.mcp) {
			const { startMcpServer } = await import("../mcp/index.js");
			const { parseToolGroups } = await import("../mcp/tool-groups.js");
			await startMcpServer({ toolGroups: parseToolGroups(args.tools) });
			return;
		}
		// citty shows help by default when no subcommand given
	},
	subCommands: {
		launch: launchCommand,
		attach: attachCommand,
		stop: stopCommand,
		status: statusCommand,
		continue: continueCommand,
		step: stepCommand,
		"run-to": runToCommand,
		break: breakCommand,
		breakpoints: breakpointsCommand,
		eval: evalCommand,
		vars: varsCommand,
		stack: stackCommand,
		source: sourceCommand,
		watch: watchCommand,
		unwatch: unwatchCommand,
		log: logCommand,
		output: outputCommand,
		threads: threadsCommand,
		doctor: doctorCommand,
		skill: skillCommand,
		browser: browserCommand,
		// Hidden: internal daemon entry point
		_daemon: () =>
			defineCommand({
				meta: { hidden: true },
				async run() {
					await import("../daemon/entry.js");
				},
			}),
	},
});

runMain(main);
