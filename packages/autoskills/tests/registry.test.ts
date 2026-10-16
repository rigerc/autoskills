import { deepStrictEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { loadRegistries } from "../registry.ts";
import { useTmpDir, writeFile, writeJson } from "./helpers.ts";
import { blobHash, COMMIT } from "./source-helpers.ts";

const cli = resolve(import.meta.dirname!, "..", "index.mjs");

describe("registry loading and management", () => {
  const tmp = useTmpDir("autoskills-registries-");

  it("discovers local SKILL.md children without a manifest and never fetches", async () => {
    writeJson(tmp.path, "project/autoskills.json", { version: 1, registries: { personal: { directory: "../skills" } } });
    writeFile(tmp.path, "skills/review/SKILL.md", "# Review");
    writeFile(tmp.path, "skills/ignored/README.md", "not a skill");
    const loaded = await loadRegistries(join(tmp.path, "project"), {
      homeDir: join(tmp.path, "home"),
      fetchImpl: (() => { throw new Error("network used"); }) as typeof fetch,
    });
    equal(loaded.length, 1);
    deepStrictEqual(loaded[0].skills.map((skill) => skill.entry.id), ["review"]);
    deepStrictEqual(loaded[0].skills[0].origin, { type: "local", directory: join(tmp.path, "skills/review") });
  });

  it("loads optional mappings and rejects invalid IDs and paths", async () => {
    writeJson(tmp.path, "project/autoskills.json", { version: 1, registries: { personal: { directory: "../skills" } } });
    writeFile(tmp.path, "skills/review/SKILL.md", "# Review");
    writeJson(tmp.path, "skills/catalog.json", { version: 1, skills: [{ id: "review", description: "Review code", path: "review", technologies: ["react"] }] });
    const loaded = await loadRegistries(join(tmp.path, "project"), { homeDir: join(tmp.path, "home") });
    equal(loaded[0].skills[0].entry.description, "Review code");
    writeJson(tmp.path, "skills/catalog.json", { version: 1, skills: [{ id: "review", description: "Review", path: "review", technologies: ["not-a-tech"] }] });
    await rejects(loadRegistries(join(tmp.path, "project"), { homeDir: join(tmp.path, "home") }), /unknown technology ID/);
    writeJson(tmp.path, "skills/catalog.json", { version: 1, skills: [{ id: "review", description: "Review", path: "escape" }] });
    symlinkSync(tmp.path, join(tmp.path, "skills/escape"));
    await rejects(loadRegistries(join(tmp.path, "project"), { homeDir: join(tmp.path, "home") }), /inside the registry/);
  });

  it("verifies GitHub bytes, caches by revision and reports stale cache", async () => {
    writeJson(tmp.path, "project/autoskills.json", { version: 1, registries: { team: { repository: "owner/repo" } } });
    const manifest = JSON.stringify({ version: 1, skills: [{ id: "review", description: "Review", path: "skills/review", always: true }] });
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/commits/HEAD")) return Response.json({ sha: COMMIT });
      if (url.includes("/git/trees/")) return Response.json({ tree: [
        { path: "catalog.json", type: "blob", mode: "100644", sha: blobHash(manifest) },
        { path: "skills/review/SKILL.md", type: "blob", mode: "100644", sha: blobHash("# Review") },
      ] });
      if (url.includes("raw.githubusercontent.com")) return new Response(manifest);
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const options = { homeDir: join(tmp.path, "home"), cacheDir: join(tmp.path, "cache"), fetchImpl };
    const first = await loadRegistries(join(tmp.path, "project"), options);
    equal(first[0].revision, COMMIT);
    equal(first[0].skills[0].origin.type, "github");
    equal(requests.filter((url) => url.includes("raw.githubusercontent.com")).length, 1);
    await loadRegistries(join(tmp.path, "project"), options);
    equal(requests.filter((url) => url.includes("raw.githubusercontent.com")).length, 1);
    const offline = { ...options, fetchImpl: (() => { throw new Error("offline"); }) as typeof fetch };
    const stale = await loadRegistries(join(tmp.path, "project"), offline);
    ok(stale[0].stale);
    match(stale[0].warning!, /offline/);
    await rejects(loadRegistries(join(tmp.path, "project"), { ...offline, refresh: true }), /refresh failed.*offline/);
  });

  it("adds, lists, refreshes and removes a local registry without network", () => {
    writeFile(tmp.path, "skills/review/SKILL.md", "# Review");
    const project = join(tmp.path, "project");
    writeFile(project, ".keep", "");
    const { FORCE_COLOR: _forceColor, ...env } = process.env;
    const run = (args: string[]) => execFileSync(process.execPath, [cli, "registry", ...args], {
      cwd: project, encoding: "utf8", env: { ...env, XDG_CONFIG_HOME: join(tmp.path, "xdg"), NO_COLOR: "1" },
    });
    match(run(["add", "personal", "../skills"]), /Added registry personal/);
    match(run(["list"]), /personal/);
    match(run(["refresh", "personal"]), /Refreshed personal: 1 skills/);
    const config = JSON.parse(readFileSync(join(project, "autoskills.json"), "utf8"));
    equal(config.registries.personal.directory, join(tmp.path, "skills"));
    match(run(["remove", "personal"]), /Removed registry personal/);
    match(run(["list"]), /No registries configured/);
    match(run(["add", "personal", "../skills", "--global"]), /Added registry personal/);
    ok(readFileSync(join(tmp.path, "xdg/autoskills/config.json"), "utf8").includes("personal"));
  });
});
