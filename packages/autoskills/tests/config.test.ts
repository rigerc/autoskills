import { deepStrictEqual, match, ok, throws } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { resolveRegistryConfig } from "../config.ts";
import { useTmpDir, writeFile, writeJson, writePackageJson } from "./helpers.ts";

const cli = resolve(import.meta.dirname!, "..", "index.mjs");

describe("registry configuration", () => {
  const tmp = useTmpDir("autoskills-config-");

  it("allows missing files and keeps built-in recommendations enabled", () => {
    deepStrictEqual(resolveRegistryConfig(tmp.path, { homeDir: tmp.path }), {
      version: 1, includeBuiltIn: true, registries: {},
    });
  });

  it("reports malformed project and user files with their path and field", () => {
    writeFile(tmp.path, "autoskills.json", "{");
    throws(() => resolveRegistryConfig(tmp.path, { homeDir: tmp.path }), /autoskills\.json \(JSON\)/);
    writeJson(tmp.path, "autoskills.json", { version: 2, registries: {} });
    throws(() => resolveRegistryConfig(tmp.path, { homeDir: tmp.path }), /autoskills\.json \(version\): expected version 1/);
    writeJson(tmp.path, "autoskills.json", { version: 1, registries: { team: { directory: "./skills", repository: "acme/skills" } } });
    throws(() => resolveRegistryConfig(tmp.path, { homeDir: tmp.path }), /registries\.team.*exactly one source/);
    writeJson(tmp.path, "autoskills.json", { version: 1, registries: {} });
    writeJson(tmp.path, ".config/autoskills/config.json", { version: 1, registries: { team: { repository: "not-a-repo" } } });
    throws(() => resolveRegistryConfig(tmp.path, { homeDir: tmp.path }), /config\.json \(registries\.team\.repository\)/);
  });

  it("overrides user entries by name and resolves paths relative to their own config files", () => {
    const home = join(tmp.path, "home");
    const project = join(tmp.path, "project");
    writeJson(home, ".config/autoskills/config.json", {
      version: 1,
      registries: { team: { repository: "old-owner/skills" }, shared: { directory: "./shared" } },
    });
    writeJson(project, "autoskills.json", {
      version: 1,
      registries: {
        team: { directory: "./team-skills", manifest: "metadata/catalog.json" },
        project: { repository: "acme/project-skills", manifest: "skills/catalog.json" },
      },
    });
    const config = resolveRegistryConfig(project, { homeDir: home });
    deepStrictEqual(config.registries, {
      team: { type: "local", directory: join(project, "team-skills"), manifest: "metadata/catalog.json" },
      shared: { type: "local", directory: join(home, ".config/autoskills/shared") },
      project: { type: "github", repository: "acme/project-skills", manifest: "skills/catalog.json" },
    });
    ok(config.includeBuiltIn);
    writeJson(project, "autoskills.json", { version: 1, registries: { bad: { repository: "acme/skills", manifest: "../other.json" } } });
    throws(() => resolveRegistryConfig(project, { homeDir: home }), /registries\.bad\.manifest/);
  });

  it("resolves each --repos project separately and retains built-in dry-run recommendations", () => {
    const repos = join(tmp.path, "repos");
    for (const name of ["first", "second"]) {
      writeFile(repos, `${name}/.git/HEAD`, "ref: refs/heads/main");
      writePackageJson(join(repos, name), { dependencies: { react: "19" } });
      writeJson(repos, `${name}/autoskills.json`, { version: 1, registries: { [name]: { directory: "./skills" } } });
    }
    const { FORCE_COLOR: _forceColor, ...env } = process.env;
    const output = execFileSync(process.execPath, [cli, "--repos", repos, "--dry-run", "--verbose"], {
      cwd: tmp.path,
      encoding: "utf8",
      env: { ...env, XDG_CONFIG_HOME: join(tmp.path, "empty-config"), NO_COLOR: "1" },
    });
    const first = output.slice(output.indexOf("Repository: first"), output.indexOf("Repository: second"));
    const second = output.slice(output.indexOf("Repository: second"));
    match(first, /Configured registries: first/);
    match(second, /Configured registries: second/);
    ok(!first.includes("Configured registries: second"));
    ok(!second.includes("Configured registries: first"));
    match(first, /React/);
    match(second, /React/);
    match(output, /--dry-run: nothing was installed/);
  });
});
