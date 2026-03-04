import { describe, expect, it } from "vitest";
import { djangoDetector, flaskDetector, pytestDetector } from "../../../src/frameworks/python.js";

describe("pytestDetector", () => {
	it("detects 'pytest tests/'", () => {
		const result = pytestDetector.detect("pytest tests/", "/p");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("pytest");
	});

	it("detects 'python -m pytest tests/test_order.py -x'", () => {
		const result = pytestDetector.detect("python -m pytest tests/test_order.py -x", "/p");
		expect(result).not.toBeNull();
	});

	it("detects 'python3 -m pytest tests/'", () => {
		const result = pytestDetector.detect("python3 -m pytest tests/", "/p");
		expect(result).not.toBeNull();
	});

	it("does not detect 'python app.py'", () => {
		expect(pytestDetector.detect("python app.py", "/p")).toBeNull();
	});

	it("does not detect 'python pytest_helper.py'", () => {
		expect(pytestDetector.detect("python pytest_helper.py", "/p")).toBeNull();
	});

	it("sets subProcess: true in launchArgs", () => {
		const result = pytestDetector.detect("pytest tests/", "/p");
		expect(result!.launchArgs).toMatchObject({ subProcess: true });
	});

	it("warns about pytest-xdist -n flag", () => {
		const result = pytestDetector.detect("pytest -n4 tests/", "/p");
		expect(result!.warnings.length).toBeGreaterThan(0);
		expect(result!.warnings[0]).toContain("xdist");
	});

	it("warns about --forked flag", () => {
		const result = pytestDetector.detect("pytest --forked tests/", "/p");
		expect(result!.warnings.length).toBeGreaterThan(0);
		expect(result!.warnings[0]).toContain("forked");
	});

	it("no warnings for clean pytest command", () => {
		const result = pytestDetector.detect("pytest tests/", "/p");
		expect(result!.warnings).toHaveLength(0);
	});
});

describe("djangoDetector", () => {
	it("detects 'python manage.py runserver'", () => {
		const result = djangoDetector.detect("python manage.py runserver", "/p");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("django");
	});

	it("detects 'django-admin runserver'", () => {
		const result = djangoDetector.detect("django-admin runserver", "/p");
		expect(result).not.toBeNull();
	});

	it("does not detect 'python manage.py migrate'", () => {
		expect(djangoDetector.detect("python manage.py migrate", "/p")).toBeNull();
	});

	it("appends --nothreading --noreload when neither present", () => {
		const result = djangoDetector.detect("python manage.py runserver", "/p");
		expect(result!.command).toContain("--nothreading");
		expect(result!.command).toContain("--noreload");
	});

	it("does not double-add --noreload", () => {
		const result = djangoDetector.detect("python manage.py runserver --noreload", "/p");
		const count = (result!.command ?? "python manage.py runserver --noreload").split("--noreload").length - 1;
		expect(count).toBe(1);
	});

	it("does not double-add --nothreading", () => {
		const result = djangoDetector.detect("python manage.py runserver --nothreading", "/p");
		const cmd = result!.command ?? "python manage.py runserver --nothreading";
		const count = cmd.split("--nothreading").length - 1;
		expect(count).toBe(1);
	});

	it("sets PYTHONDONTWRITEBYTECODE env", () => {
		const result = djangoDetector.detect("python manage.py runserver", "/p");
		expect(result!.env).toMatchObject({ PYTHONDONTWRITEBYTECODE: "1" });
	});
});

describe("flaskDetector", () => {
	it("detects 'flask run'", () => {
		const result = flaskDetector.detect("flask run", "/p");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("flask");
	});

	it("detects 'python -m flask run'", () => {
		const result = flaskDetector.detect("python -m flask run", "/p");
		expect(result).not.toBeNull();
	});

	it("does not detect 'flask db migrate'", () => {
		expect(flaskDetector.detect("flask db migrate", "/p")).toBeNull();
	});

	it("appends --no-reload", () => {
		const result = flaskDetector.detect("flask run", "/p");
		expect(result!.command).toContain("--no-reload");
	});

	it("does not double-add --no-reload", () => {
		const result = flaskDetector.detect("flask run --no-reload", "/p");
		const cmd = result!.command ?? "flask run --no-reload";
		const count = cmd.split("--no-reload").length - 1;
		expect(count).toBe(1);
	});

	it("sets WERKZEUG_RUN_MAIN env", () => {
		const result = flaskDetector.detect("flask run", "/p");
		expect(result!.env).toMatchObject({ WERKZEUG_RUN_MAIN: "true" });
	});
});
