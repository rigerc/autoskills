import { deepStrictEqual, equal, match, ok, rejects } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { detectTechnologies, getInstalledSkillNames } from "../lib.ts";
import { collectProjectRecommendations } from "../recommendations.ts";
import { useTmpDir, writeFile, writeJson, writePackageJson } from "./helpers.ts";

const cli = resolve(import.meta.dirname!, "..", "index.mjs");

describe("registry recommendations", () => {
  const tmp = useTmpDir("autoskills-recommendations-");

  it("merges mapped and always entries while keeping unmapped skills selectable", async () => {
    const project = join(tmp.path, "project");
    writeJson(project, "autoskills.json", { version: 1, registries: { personal: { directory: "../skills" } } });
    writePackageJson(project, { dependencies: { react: "19" } });
    for (const name of ["mapped", "always", "manual"]) writeFile(tmp.path, `skills/${name}/SKILL.md`, `# ${name}`);
    writeJson(tmp.path, "skills/catalog.json", { version: 1, skills: [
      { id: "mapped", description: "Mapped", path: "mapped", technologies: ["react"] },
      { id: "always", description: "Always", path: "always", always: true },
      { id: "manual", description: "Manual", path: "manual" },
    ] });
    const { detected, isFrontend, combos } = detectTechnologies(project);
    const result = await collectProjectRecommendations(project, { detected, isFrontend, combos, installedNames: getInstalledSkillNames(project), homeDir: join(tmp.path, "home") });
    ok(result.recommended.some((entry) => entry.skill === "registry:personal/mapped"));
    ok(result.recommended.some((entry) => entry.skill === "registry:personal/always"));
    deepStrictEqual(result.selectable.map((entry) => entry.skill), ["registry:personal/manual"]);
    ok(result.recommended.some((entry) => entry.sources.includes("React")));
    const { FORCE_COLOR: _forceColor, ...env } = process.env;
    const output = execFileSync(process.execPath, [cli, "--dry-run"], {
      cwd: project, encoding: "utf8", env: { ...env, XDG_CONFIG_HOME: join(tmp.path, "empty-config"), NO_COLOR: "1" },
    });
    match(output, /personal › mapped/);
    match(output, /personal › always/);
    match(output, /Additional registry skills for explicit selection/);
    match(output, /personal › manual/);
  });

  it("keeps always recommendations for a project with no detected stack", async () => {
    const project = join(tmp.path, "project");
    writeJson(project, "autoskills.json", { version: 1, registries: { personal: { directory: "../skills" } } });
    writeFile(tmp.path, "skills/always/SKILL.md", "# Always");
    writeJson(tmp.path, "skills/catalog.json", { version: 1, skills: [{ id: "always", description: "Always", path: "always", always: true }] });
    const result = await collectProjectRecommendations(project, { detected: [], isFrontend: false, homeDir: join(tmp.path, "home") });
    equal(result.recommended[0].skill, "registry:personal/always");
    const { FORCE_COLOR: _forceColor, ...env } = process.env;
    const output = execFileSync(process.execPath, [cli, "-y"], {
      cwd: project, encoding: "utf8", env: { ...env, XDG_CONFIG_HOME: join(tmp.path, "empty-config"), NO_COLOR: "1" },
    });
    match(output, /personal › always/);
    ok(existsSync(join(project, ".agents/skills/always/SKILL.md")));
    equal(JSON.parse(readFileSync(join(project, "skills-lock.json"), "utf8")).skills.always.sourceType, "local");
  });

  it("deduplicates the same origin and rejects different sources targeting one name", async () => {
    const project = join(tmp.path, "project");
    writeJson(project, "autoskills.json", { version: 1, registries: {
      one: { directory: "../skills" }, two: { directory: "../skills" },
    } });
    writeFile(tmp.path, "skills/shared/SKILL.md", "# Shared");
    let result = await collectProjectRecommendations(project, { detected: [], isFrontend: false, homeDir: join(tmp.path, "home") });
    equal(result.selectable.length, 1);
    deepStrictEqual(result.selectable[0].sources, ["Registry: one", "Registry: two"]);
    writeJson(project, "autoskills.json", { version: 1, registries: {
      one: { directory: "../skills" }, two: { directory: "../different" },
    } });
    writeFile(tmp.path, "different/shared/SKILL.md", "# Different");
    await rejects(collectProjectRecommendations(project, { detected: [], isFrontend: false, homeDir: join(tmp.path, "home") }), /conflicting sources/);
  });

  it("does not install an unmapped skill from a noninteractive CLI run", () => {
    const project = join(tmp.path, "project");
    writeJson(project, "autoskills.json", { version: 1, registries: { personal: { directory: "../skills" } } });
    writeFile(tmp.path, "skills/manual/SKILL.md", "# Manual");
    const { FORCE_COLOR: _forceColor, ...env } = process.env;
    const output = execFileSync(process.execPath, [cli], {
      cwd: project, encoding: "utf8", env: { ...env, XDG_CONFIG_HOME: join(tmp.path, "empty-config"), NO_COLOR: "1" },
    });
    match(output, /Select an additional registry skill interactively/);
    ok(!existsSync(join(project, ".agents/skills/manual")));
  });
});
