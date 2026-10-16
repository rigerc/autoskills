import { describe, it } from "node:test";
import { equal, ok, deepEqual } from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { checkSkillUpdates, updateSkill } from "../updater.ts";
import { installRegistrySkill, installSkill, readSkillsLock } from "../installer.ts";
import type { LoadedRegistrySkill } from "../registry.ts";
import { useTmpDir, writeFile, writeJson } from "./helpers.ts";
import { COMMIT, NEXT_COMMIT, sourceFixture } from "./source-helpers.ts";

describe("skill updates", () => {
  const tmp = useTmpDir();

  it("updates changed content, removes deleted files and preserves agent destinations", async () => {
    const initial = await installSkill("owner/repo/hello", ["pi", "claude-code"], {
      projectDir: tmp.path,
      ...sourceFixture({ "skills/hello/SKILL.md": "old", "skills/hello/deleted.md": "obsolete" }),
    });
    ok(initial.success, initial.output);
    const fixture = sourceFixture(
      { "skills/hello/SKILL.md": "new", "skills/hello/added.md": "added" },
      NEXT_COMMIT,
    );
    const before = readFileSync(join(tmp.path, "skills-lock.json"), "utf-8");
    const check = await checkSkillUpdates({ projectDir: tmp.path, ...fixture });
    equal(check.skills.length, 1);
    equal(check.skills[0].outdated, true);
    equal(readFileSync(join(tmp.path, "skills-lock.json"), "utf-8"), before);
    ok(fixture.requests.every((url) => !url.includes("raw.githubusercontent.com")));
    const result = await updateSkill(check.skills[0], [], { projectDir: tmp.path, ...fixture });
    ok(result.success, result.output);
    equal(readFileSync(join(tmp.path, ".pi/skills/hello/SKILL.md"), "utf-8"), "new");
    equal(readFileSync(join(tmp.path, ".claude/skills/hello/added.md"), "utf-8"), "added");
    const lock = readSkillsLock(tmp.path).skills.hello;
    equal(lock.commitSha, NEXT_COMMIT);
    deepEqual(lock.agents, ["pi", "claude-code"]);
    const current = await checkSkillUpdates({ projectDir: tmp.path, ...fixture });
    equal(current.skills[0].outdated, false);
    ok(!existsSync(join(tmp.path, ".agents/skills/hello/deleted.md")));
  });

  it("uses the installed source path when a repository contains duplicate skill names", async () => {
    const fixture = sourceFixture({
      "a/hello/SKILL.md": "other skill",
      "plugins/custom/hello/SKILL.md": "chosen skill",
    });
    const initial = await installSkill("owner/repo/plugins/custom/hello", [], {
      projectDir: tmp.path,
      ...fixture,
    });
    ok(initial.success, initial.output);
    const result = await checkSkillUpdates({ projectDir: tmp.path, ...fixture });
    equal(result.skills[0].source.skillPath, "plugins/custom/hello");
    equal(result.skills[0].outdated, false);
  });

  it("does not consider unrelated upstream commits an update", async () => {
    const files = { "skills/hello/SKILL.md": "same" };
    await installSkill("owner/repo/hello", [], {
      projectDir: tmp.path,
      ...sourceFixture(files, COMMIT),
    });
    const fixture = sourceFixture({ ...files, "README.md": "unrelated commit" }, NEXT_COMMIT);
    const result = await checkSkillUpdates({ projectDir: tmp.path, ...fixture });
    equal(result.skills[0].outdated, false);
  });

  it("migrates old registry locks to upstream provenance and retains existing drawer copies", async () => {
    writeJson(tmp.path, "skills-lock.json", {
      version: 1,
      skills: {
        hello: { source: "owner/repo", sourceType: "autoskills-registry", computedHash: "old" },
      },
    });
    writeFile(tmp.path, ".pi/skills/hello/SKILL.md", "old fallback copy");
    const fixture = sourceFixture({ "skills/hello/SKILL.md": "latest" });
    const result = await checkSkillUpdates({ projectDir: tmp.path, ...fixture });
    equal(result.skills[0].outdated, true);
    const updated = await updateSkill(result.skills[0], [], { projectDir: tmp.path, ...fixture });
    ok(updated.success, updated.output);
    equal(readSkillsLock(tmp.path).skills.hello.sourceType, "github");
    equal(readFileSync(join(tmp.path, ".pi/skills/hello/SKILL.md"), "utf-8"), "latest");
  });

  it("offers to repair a missing installation even when the source hash matches", async () => {
    const fixture = sourceFixture({ "skills/hello/SKILL.md": "same" });
    await installSkill("owner/repo/hello", [], { projectDir: tmp.path, ...fixture });
    rmSync(join(tmp.path, ".agents/skills/hello"), { recursive: true });
    const result = await checkSkillUpdates({ projectDir: tmp.path, ...fixture });
    equal(result.skills[0].outdated, true);
  });

  it("handles no lock and skips unsupported sources", async () => {
    deepEqual(await checkSkillUpdates({ projectDir: tmp.path }), {
      skills: [],
      skipped: [],
      errors: [],
    });
    writeJson(tmp.path, "skills-lock.json", {
      version: 1,
      skills: { other: { source: "/local", sourceType: "unsupported" } },
    });
    const result = await checkSkillUpdates({ projectDir: tmp.path });
    deepEqual(result.skipped, ["other"]);
  });

  it("updates local bundles from their locked origin after registry removal", async () => {
    const source = join(tmp.path, "origin/review");
    writeFile(tmp.path, "origin/review/SKILL.md", "# Old");
    writeFile(tmp.path, "origin/review/deleted.md", "obsolete");
    const skill: LoadedRegistrySkill = { registry: "personal", entry: { id: "review", description: "Review", path: "review" }, origin: { type: "local", directory: source } };
    ok((await installRegistrySkill(skill, ["pi"], { projectDir: tmp.path })).success);
    writeJson(tmp.path, "autoskills.json", { version: 1, registries: { personal: { directory: "./different" } } });
    writeFile(tmp.path, "origin/review/SKILL.md", "# New");
    writeFile(tmp.path, "origin/review/added.md", "new");
    rmSync(join(source, "deleted.md"));
    const check = await checkSkillUpdates({ projectDir: tmp.path });
    equal(check.skills[0].kind, "local");
    equal(check.skills[0].outdated, true);
    const updated = await updateSkill(check.skills[0], [], { projectDir: tmp.path });
    ok(updated.success, updated.output);
    equal(readFileSync(join(tmp.path, ".pi/skills/review/SKILL.md"), "utf8"), "# New");
    ok(existsSync(join(tmp.path, ".agents/skills/review/added.md")));
    ok(!existsSync(join(tmp.path, ".agents/skills/review/deleted.md")));
    equal(readSkillsLock(tmp.path).skills.review.source, source);
    equal((await checkSkillUpdates({ projectDir: tmp.path })).skills[0].outdated, false);
    rmSync(source, { recursive: true });
    const unavailable = await checkSkillUpdates({ projectDir: tmp.path });
    equal(unavailable.errors[0].name, "review");
    ok(unavailable.errors[0].error.includes("local source unavailable"));
  });

  it("updates a GitHub registry skill from its exact locked path", async () => {
    const skill: LoadedRegistrySkill = {
      registry: "team", catalogRevision: COMMIT,
      entry: { id: "review", description: "Review", repository: "owner/repo", directory: "exact/review" },
      origin: { type: "github", repository: "owner/repo", directory: "exact/review", revision: COMMIT },
    };
    ok((await installRegistrySkill(skill, [], { projectDir: tmp.path, ...sourceFixture({ "exact/review/SKILL.md": "old" }) })).success);
    const fixture = sourceFixture({ "wrong/review/SKILL.md": "decoy", "exact/review/SKILL.md": "new" }, NEXT_COMMIT);
    const check = await checkSkillUpdates({ projectDir: tmp.path, ...fixture });
    equal(check.skills[0].source.skillPath, "exact/review");
    const updated = await updateSkill(check.skills[0], [], { projectDir: tmp.path, ...fixture });
    ok(updated.success, updated.output);
    equal(readFileSync(join(tmp.path, ".agents/skills/review/SKILL.md"), "utf8"), "new");
    equal(readSkillsLock(tmp.path).skills.review.catalogRevision, COMMIT);
    equal(readSkillsLock(tmp.path).skills.review.commitSha, NEXT_COMMIT);
  });

  it("reports a failing source while checking other installed skills", async () => {
    writeJson(tmp.path, "skills-lock.json", {
      version: 1,
      skills: {
        missing: { source: "owner/repo", sourceType: "github" },
        hello: { source: "owner/repo", sourceType: "github" },
      },
    });
    const result = await checkSkillUpdates({
      projectDir: tmp.path,
      ...sourceFixture({ "skills/hello/SKILL.md": "new" }),
    });
    equal(result.skills.length, 1);
    equal(result.errors.length, 1);
    equal(result.errors[0].name, "missing");
  });
});
