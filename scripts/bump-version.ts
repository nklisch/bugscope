#!/usr/bin/env bun
// Usage: bun scripts/bump-version.ts [patch|minor|major|x.y.z]

const arg = process.argv[2];

if (!arg) {
	console.error("Usage: bun scripts/bump-version.ts [patch|minor|major|x.y.z]");
	process.exit(1);
}

// Read package.json
const pkgFile = Bun.file("package.json");
const pkg = await pkgFile.json();
const current: string = pkg.version;

// Parse semver
const semverRe = /^(\d+)\.(\d+)\.(\d+)$/;
const match = current.match(semverRe);
if (!match) {
	console.error(`Could not parse current version: ${current}`);
	process.exit(1);
}

const [, majorStr, minorStr, patchStr] = match;
const major = parseInt(majorStr, 10);
const minor = parseInt(minorStr, 10);
const patch = parseInt(patchStr, 10);

let nextVersion: string;

if (arg === "patch") {
	nextVersion = `${major}.${minor}.${patch + 1}`;
} else if (arg === "minor") {
	nextVersion = `${major}.${minor + 1}.0`;
} else if (arg === "major") {
	nextVersion = `${major + 1}.0.0`;
} else if (semverRe.test(arg)) {
	nextVersion = arg;
} else {
	console.error(`Invalid argument: ${arg}. Expected patch, minor, major, or x.y.z`);
	process.exit(1);
}

console.log(`Bumping ${current} → ${nextVersion}`);

// Update package.json
pkg.version = nextVersion;
await Bun.write("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);

// Sync plugin version
const pluginJsonPath = "plugin/.claude-plugin/plugin.json";
const pluginFile = Bun.file(pluginJsonPath);
if (await pluginFile.exists()) {
	const pluginPkg = await pluginFile.json();
	pluginPkg.version = nextVersion;
	await Bun.write(pluginJsonPath, `${JSON.stringify(pluginPkg, null, "\t")}\n`);
	console.log(`Synced plugin version → ${nextVersion}`);
}

// Commit, tag, push
const filesToAdd = ["package.json"];
if (await Bun.file(pluginJsonPath).exists()) filesToAdd.push(pluginJsonPath);
await Bun.$`git add ${filesToAdd}`;
await Bun.$`git commit -m ${`Release v${nextVersion}`}`;
await Bun.$`git tag ${`v${nextVersion}`}`;
await Bun.$`git push`;
await Bun.$`git push origin ${`v${nextVersion}`}`;

console.log(`Released v${nextVersion}`);
