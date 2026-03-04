/**
 * Daemon entry point — spawned as a detached background process by the CLI.
 * This file is the target of `bun run src/daemon/entry.ts`.
 *
 * Registers adapters, creates SessionManager, starts DaemonServer.
 * Detaches stdio so the parent CLI process can exit.
 */

import { registerAllAdapters } from "../adapters/registry.js";
import { createSessionManager } from "../core/session-manager.js";
import { setupGracefulShutdown } from "../core/shutdown.js";
import { registerAllDetectors } from "../frameworks/index.js";
import { getDaemonPidPath, getDaemonSocketPath } from "./protocol.js";
import { DaemonServer } from "./server.js";

registerAllAdapters();
registerAllDetectors();
const sessionManager = createSessionManager();

const server = new DaemonServer(sessionManager, {
	socketPath: getDaemonSocketPath(),
	pidPath: getDaemonPidPath(),
	idleTimeoutMs: 60_000,
});

await server.start();
setupGracefulShutdown(() => server.shutdown());
