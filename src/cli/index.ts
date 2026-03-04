#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import {
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
	unwatchCommand,
	varsCommand,
	watchCommand,
} from "./commands/index.js";

const main = defineCommand({
	meta: {
		name: "agent-lens",
		version: "0.1.0",
		description: "Runtime debugging viewport for AI coding agents",
	},
	subCommands: {
		launch: launchCommand,
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
		doctor: doctorCommand,
		skill: skillCommand,
		// Hidden: internal daemon entry point
		_daemon: async () => {
			await import("../daemon/entry.js");
		},
	},
});

runMain(main);
