import { equal, match, ok } from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { installRegistrySkill, readSkillsLock } from "../installer.ts";
import type { LoadedRegistrySkill } from "../registry.ts";
import { useTmpDir, writeFile } from "./helpers.ts";
import { COMMIT, sourceFixture } from "./source-helpers.ts";

function local(registry: string, id: string, directory: string): LoadedRegistrySkill {
  return { registry, entry: { id, description: id, path: id }, origin: { type: "local", directory } };
}

describe("registry installation", () => {
  const tmp = useTmpDir("autoskills-registry-install-");

  it("stages local files, links agents, records origin and works offline", async () => {
    writeFile(tmp.path, "origin/review/SKILL.md", "# Review");
    writeFile(tmp.path, "origin/review/references/notes.md", "notes");
    const skill = local("personal", "review", join(tmp.path, "origin/review"));
    const result = await installRegistrySkill(skill, ["pi"], {
      projectDir: join(tmp.path, "project"),
      fetchImpl: (() => { throw new Error("network used"); }) as typeof fetch,
    });
    ok(result.success, result.output);
    equal(readFileSync(join(tmp.path, "project/.agents/skills/review/references/notes.md"), "utf8"), "notes");
    ok(existsSync(join(tmp.path, "project/.pi/skills/review/SKILL.md")));
    const locked = readSkillsLock(join(tmp.path, "project")).skills.review;
    equal(locked.sourceType, "local");
    equal(locked.source, join(tmp.path, "origin/review"));
    equal(locked.registry, "personal");
    equal(locked.sourceHash?.length, 64);
    equal(locked.computedHash, locked.sourceHash);
  });

  it("rejects symlinks and source collisions before replacing files", async () => {
    writeFile(tmp.path, "origin/review/SKILL.md", "# Original");
    const project = join(tmp.path, "project");
    const first = local("personal", "review", join(tmp.path, "origin/review"));
    ok((await installRegistrySkill(first, [], { projectDir: project })).success);
    writeFile(tmp.path, "other/review/SKILL.md", "# Other");
    const conflict = await installRegistrySkill(local("other", "review", join(tmp.path, "other/review")), [], { projectDir: project });
    match(conflict.output, /another source/);
    equal(readFileSync(join(project, ".agents/skills/review/SKILL.md"), "utf8"), "# Original");
    symlinkSync(join(tmp.path, "other/review/SKILL.md"), join(tmp.path, "origin/review/linked.md"));
    const rejected = await installRegistrySkill(first, [], { projectDir: project });
    match(rejected.output, /symlinks are not allowed/);
    equal(readFileSync(join(project, ".agents/skills/review/SKILL.md"), "utf8"), "# Original");
  });

  it("requires the catalog's exact GitHub directory", async () => {
    const skill: LoadedRegistrySkill = {
      registry: "team",
      entry: { id: "review", description: "Review", repository: "owner/repo", directory: "exact/review" },
      origin: { type: "github", repository: "owner/repo", directory: "exact/review" },
    };
    const fixture = sourceFixture({ "other/review/SKILL.md": "# Other" });
    const missing = await installRegistrySkill(skill, [], { projectDir: tmp.path, ...fixture });
    match(missing.output, /exact skill path/);
    ok(!existsSync(join(tmp.path, ".agents/skills/review")));
    const pinned = { ...skill, origin: { type: "github" as const, repository: "owner/repo", directory: "exact/review", revision: COMMIT } };
    const fixturePinned = sourceFixture({ "exact/review/SKILL.md": "# Exact", "other/review/SKILL.md": "# Other" });
    const valid = await installRegistrySkill(pinned, [], {
      projectDir: tmp.path,
      ...fixturePinned,
    });
    ok(valid.success, valid.output);
    equal(readFileSync(join(tmp.path, ".agents/skills/review/SKILL.md"), "utf8"), "# Exact");
    equal(readSkillsLock(tmp.path).skills.review.skillPath, "exact/review");
    equal(readSkillsLock(tmp.path).skills.review.catalogRevision, COMMIT);
    ok(!fixturePinned.requests.some((url) => url.endsWith("/commits/HEAD")));
  });
});
