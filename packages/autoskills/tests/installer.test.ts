import { describe, it } from "node:test";
import { ok, equal, deepEqual } from "node:assert/strict";
import { existsSync, readFileSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import {
  agentFolderFor,
  installAll,
  installSkill,
  readSkillsLock,
  securityCheckForSkillPath,
} from "../installer.ts";
import { resolveSourceSkill } from "../source.ts";
import { useTmpDir, writeFile, writeJson } from "./helpers.ts";
import { COMMIT, sourceFixture } from "./source-helpers.ts";

const source = "owner/repo/hello";

describe("upstream installer", () => {
  const tmp = useTmpDir();

  it("installs directly from upstream, records provenance and preserves executable scripts", async () => {
    const fixture = sourceFixture({
      "skills/hello/SKILL.md": "# Latest upstream",
      "skills/hello/references/notes.md": "notes",
      "skills/hello/scripts/run.sh": "#!/bin/sh\nexit 0\n",
      "skills/other/SKILL.md": "# Other",
    });
    writeFile(tmp.path, "CLAUDE.md", "# User instructions\n");
    const result = await installSkill(source, ["universal", "pi", "claude-code"], {
      projectDir: tmp.path,
      ...fixture,
    });
    ok(result.success, result.output);
    const installed = join(tmp.path, ".agents", "skills", "hello");
    equal(readFileSync(join(installed, "SKILL.md"), "utf-8"), "# Latest upstream");
    equal(readFileSync(join(installed, "references", "notes.md"), "utf-8"), "notes");
    ok(statSync(join(installed, "scripts", "run.sh")).mode & 0o111);
    ok(!existsSync(join(tmp.path, ".agents", "skills", "other")));
    equal(readlinkSync(join(tmp.path, ".pi", "skills", "hello")), "../../.agents/skills/hello");
    const entry = readSkillsLock(tmp.path).skills.hello;
    equal(entry.source, "owner/repo");
    equal(entry.sourceType, "github");
    equal(entry.commitSha, COMMIT);
    equal(entry.skillPath, "skills/hello");
    equal(entry.sourceHash?.length, 64);
    equal(entry.computedHash?.length, 64);
    equal(result.securityCheck, undefined);
    equal(securityCheckForSkillPath(source), null);
    equal(readFileSync(join(tmp.path, "CLAUDE.md"), "utf-8"), "# User instructions\n");
    ok(
      fixture.requests
        .filter((url) => url.includes("raw.githubusercontent.com"))
        .every((url) => url.includes(`/owner/repo/${COMMIT}/`)),
    );
  });

  it("does not use installed or locally synced files as a source", async () => {
    writeFile(tmp.path, ".agents/skills/hello/SKILL.md", "# stale");
    const fixture = sourceFixture({ "skills/hello/SKILL.md": "# latest" });
    const result = await installSkill(source, [], { projectDir: tmp.path, ...fixture });
    ok(result.success, result.output);
    equal(readFileSync(join(tmp.path, ".agents/skills/hello/SKILL.md"), "utf-8"), "# latest");
    ok(fixture.requests.some((url) => url.includes("raw.githubusercontent.com/owner/repo/")));
  });

  it("installs root-level skills with supporting files", async () => {
    const fixture = sourceFixture({ "SKILL.md": "# Root", "references/notes.md": "root notes" });
    const result = await installSkill(source, [], { projectDir: tmp.path, ...fixture });
    ok(result.success, result.output);
    equal(
      readFileSync(join(tmp.path, ".agents/skills/hello/references/notes.md"), "utf-8"),
      "root notes",
    );
  });

  it("resolves nested skills and the legacy <name>/skills layout deterministically", async () => {
    const fixture = sourceFixture({
      "plugins/hello/skills/SKILL.md": "# Legacy",
      "a/hello/SKILL.md": "# Shortest",
      "longer/hello/SKILL.md": "# Other",
    });
    const resolved = await resolveSourceSkill(source, fixture);
    equal(resolved.skillPath, "a/hello");
    const legacy = await resolveSourceSkill(
      source,
      sourceFixture({ "plugins/hello/skills/SKILL.md": "# Legacy" }),
    );
    equal(legacy.skillPath, "plugins/hello/skills");
  });

  it("keeps the previous files and lock on failed downloads", async () => {
    writeFile(tmp.path, ".agents/skills/hello/SKILL.md", "# old");
    writeJson(tmp.path, "skills-lock.json", {
      version: 1,
      skills: { hello: { source: "owner/repo", sourceType: "github", computedHash: "old" } },
    });
    const before = readFileSync(join(tmp.path, "skills-lock.json"), "utf-8");
    const fixture = sourceFixture({
      "skills/hello/SKILL.md": "# latest",
      "skills/hello/notes.md": "new",
    });
    const result = await installSkill(source, [], {
      projectDir: tmp.path,
      fetchImpl: (async (url, init) => {
        if (String(url).includes("raw.githubusercontent.com") && String(url).endsWith("notes.md"))
          return new Response("error", { status: 500 });
        return fixture.fetchImpl(url, init);
      }) as typeof fetch,
    });
    ok(!result.success);
    equal(readFileSync(join(tmp.path, ".agents/skills/hello/SKILL.md"), "utf-8"), "# old");
    equal(readFileSync(join(tmp.path, "skills-lock.json"), "utf-8"), before);
  });

  it("rejects altered source bytes before replacing an installation", async () => {
    const fixture = sourceFixture({ "skills/hello/SKILL.md": "# real" });
    const result = await installSkill(source, [], {
      projectDir: tmp.path,
      fetchImpl: (async (url, init) => {
        if (String(url).includes("raw.githubusercontent.com")) return new Response("# tampered");
        return fixture.fetchImpl(url, init);
      }) as typeof fetch,
    });
    ok(!result.success);
    ok(result.output.includes("source hash mismatch"));
    ok(!existsSync(join(tmp.path, ".agents/skills/hello")));
  });

  it("preserves unrelated lock entries and shares repository lookups across concurrent installs", async () => {
    writeJson(tmp.path, "skills-lock.json", {
      version: 1,
      skills: { zebra: { source: "x/y", sourceType: "other" } },
    });
    const fixture = sourceFixture({
      "skills/hello/SKILL.md": "# hello",
      "skills/alpha/SKILL.md": "# alpha",
    });
    const result = await installAll(
      [
        { skill: source, sources: [], installed: false },
        { skill: "owner/repo/alpha", sources: [], installed: false },
      ],
      [],
      { projectDir: tmp.path, ...fixture },
    );
    equal(result.installed, 2);
    equal(result.failed, 0);
    deepEqual(Object.keys(readSkillsLock(tmp.path).skills), ["alpha", "hello", "zebra"]);
    equal(fixture.requests.filter((url) => url.endsWith("commits/HEAD")).length, 1);
    equal(fixture.requests.filter((url) => url.includes("/git/trees/")).length, 1);
  });

  it("repairs broken Pi links", async () => {
    writeFile(tmp.path, ".pi/skills/.keep", "");
    symlinkSync("missing", join(tmp.path, ".pi/skills/hello"));
    const fixture = sourceFixture({ "skills/hello/SKILL.md": "# hello" });
    const result = await installSkill(source, ["pi"], { projectDir: tmp.path, ...fixture });
    ok(result.success, result.output);
    ok(existsSync(join(tmp.path, ".pi/skills/hello/SKILL.md")));
  });

  it("reports rate limits and missing skills without writing files", async () => {
    const missing = await installSkill(source, [], {
      projectDir: tmp.path,
      ...sourceFixture({ "skills/other/SKILL.md": "other" }),
    });
    ok(!missing.success);
    ok(missing.output.includes("not found"));
    const limited = await installSkill(source, [], {
      projectDir: tmp.path,
      fetchImpl: (async () =>
        new Response("limit", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        })) as typeof fetch,
    });
    ok(!limited.success);
    ok(limited.output.includes("GITHUB_TOKEN"));
    ok(!existsSync(join(tmp.path, "skills-lock.json")));
  });

  it("rejects unsafe source paths and truncated trees", async () => {
    const fixture = sourceFixture({ "skills/hello/SKILL.md": "# hello" });
    for (const path of [
      "owner/repo/../hello",
      "owner/repo/hello/../../outside",
      "https://example.com/skill",
      "owner/repo/hello\\evil",
    ]) {
      const result = await installSkill(path, [], { projectDir: tmp.path, ...fixture });
      ok(!result.success, path);
    }
    const result = await installSkill(source, [], {
      projectDir: tmp.path,
      fetchImpl: (async (url, init) => {
        if (String(url).includes("/git/trees/"))
          return Response.json({ truncated: true, tree: [] });
        return fixture.fetchImpl(url, init);
      }) as typeof fetch,
    });
    ok(!result.success);
    ok(result.output.includes("truncated"));
  });

  it("maps Pi and existing dedicated agent folders", () => {
    equal(agentFolderFor("pi"), ".pi");
    equal(agentFolderFor("claude-code"), ".claude");
    equal(agentFolderFor("junie"), ".junie");
    equal(agentFolderFor("codex"), null);
    equal(agentFolderFor("unknown"), null);
  });
});
