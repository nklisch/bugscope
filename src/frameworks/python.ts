import type { FrameworkDetector, FrameworkOverrides } from "./index.js";

/** Matches "pytest", "python -m pytest", "python3 -m pytest" */
const PYTEST_PATTERN = /(?:^|\s)(?:python3?\s+-m\s+)?pytest\b/;

/** Matches pytest-xdist parallel flag: -n <num> or -nauto */
const XDIST_PATTERN = /(?:^|\s)-n\s*(?:\d+|auto)\b/;

/** Matches pytest --forked flag */
const FORKED_PATTERN = /\s--forked\b/;

export const pytestDetector: FrameworkDetector = {
	id: "pytest",
	displayName: "pytest",
	adapterId: "python",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!PYTEST_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		const launchArgs: Record<string, unknown> = {
			// Enable subprocess debugging so debugpy attaches to pytest's
			// child processes (e.g., when pytest uses subprocesses for isolation)
			subProcess: true,
		};

		// Warn about incompatible modes
		if (XDIST_PATTERN.test(command)) {
			warnings.push("pytest-xdist (-n) spawns parallel workers that cannot be individually debugged. " + "Consider removing -n for debugging, or use -n0 to disable parallelism.");
		}
		if (FORKED_PATTERN.test(command)) {
			warnings.push("pytest --forked spawns subprocesses per test. Breakpoints may not " + "be hit in forked processes. Consider removing --forked for debugging.");
		}

		return {
			framework: "pytest",
			displayName: "pytest",
			launchArgs,
			warnings,
		};
	},
};

/** Matches "manage.py runserver" or "django-admin runserver" */
const DJANGO_PATTERN = /(?:manage\.py|django-admin)\s+runserver/;

export const djangoDetector: FrameworkDetector = {
	id: "django",
	displayName: "Django",
	adapterId: "python",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!DJANGO_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		let modifiedCommand: string | undefined;

		// Add --nothreading and --noreload if not already present
		const flags: string[] = [];
		if (!command.includes("--nothreading")) {
			flags.push("--nothreading");
		}
		if (!command.includes("--noreload")) {
			flags.push("--noreload");
		}

		if (flags.length > 0) {
			modifiedCommand = `${command} ${flags.join(" ")}`;
			warnings.push(`Added ${flags.join(", ")} for debugger compatibility. ` + "Django's auto-reloader and threading conflict with debugpy.");
		}

		return {
			framework: "django",
			displayName: "Django",
			command: modifiedCommand,
			env: { PYTHONDONTWRITEBYTECODE: "1" },
			warnings,
		};
	},
};

/** Matches "flask run" or "python -m flask run" */
const FLASK_PATTERN = /(?:^|\s)(?:python3?\s+-m\s+)?flask\s+run/;

export const flaskDetector: FrameworkDetector = {
	id: "flask",
	displayName: "Flask",
	adapterId: "python",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!FLASK_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		let modifiedCommand: string | undefined;

		// Add --no-reload if not already present
		if (!command.includes("--no-reload") && !command.includes("--no-debugger")) {
			modifiedCommand = `${command} --no-reload`;
			warnings.push("Added --no-reload for debugger compatibility. " + "Flask's Werkzeug reloader spawns a child process that conflicts with debugpy.");
		}

		return {
			framework: "flask",
			displayName: "Flask",
			command: modifiedCommand,
			env: {
				WERKZEUG_RUN_MAIN: "true",
				FLASK_DEBUG: "0",
			},
			warnings,
		};
	},
};

export const detectors: FrameworkDetector[] = [pytestDetector, djangoDetector, flaskDetector];
