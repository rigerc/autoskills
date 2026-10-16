import { describe, it } from "node:test";
import { deepStrictEqual, ok, throws } from "node:assert/strict";
import { matchesCatalogEntry, parseCatalog, partitionCatalog, resolveCatalogLocalPath } from "../catalog.ts";

const base = { version: 1, skills: [
  { id: "local-skill", description: "A local skill", path: "skills/local-skill", technologies: ["react", "nextjs"] },
  { id: "github-skill", description: "A GitHub skill", repository: "acme/skills", directory: "skills/exact-skill", technologies: ["vue"] },
  { id: "unmapped", description: "Choose me manually", path: "skills/unmapped" },
  { id: "always", description: "Always recommend", path: "skills/always", always: true },
] };

describe("skill catalog", () => {
  it("parses local and GitHub entries with typed source data", () => {
    const catalog = parseCatalog(base);
    deepStrictEqual(catalog.skills[0], base.skills[0]);
    deepStrictEqual(catalog.skills[1], base.skills[1]);
    deepStrictEqual(resolveCatalogLocalPath("/project/registry/catalog.json", catalog.skills[0] as { id: string; description: string; path: string }), "/project/registry/skills/local-skill");
    throws(() => resolveCatalogLocalPath("/project/registry/catalog.json", { id: "bad", description: "Bad", path: "../outside" }), /safe relative path/);
    deepStrictEqual(parseCatalog({ version: 1, skills: [{ id: "root", description: "Repository root", repository: "acme/skills", directory: "." }] }).skills[0], { id: "root", description: "Repository root", repository: "acme/skills", directory: "." });
  });

  it("matches any listed technology and includes always entries with no detections", () => {
    const catalog = parseCatalog(base);
    const result = partitionCatalog(catalog, []);
    deepStrictEqual(result.recommended.map(({ id }) => id), ["always"]);
    deepStrictEqual(result.selectable.map(({ id }) => id), ["local-skill", "github-skill", "unmapped"]);
    ok(matchesCatalogEntry(catalog.skills[0], ["nextjs"]));
    const matched = partitionCatalog(catalog, ["nextjs", "vue"]);
    deepStrictEqual(matched.recommended.map(({ id }) => id), ["local-skill", "github-skill", "always"]);
    deepStrictEqual(matched.selectable.map(({ id }) => id), ["unmapped"]);
  });

  it("reports malformed entries, duplicate IDs, invalid technologies and unsafe sources", () => {
    throws(() => parseCatalog({ version: 2, skills: [] }), /version 1/);
    throws(() => parseCatalog({ version: 1, skills: [], detect: {} }), /unknown root field/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", path: "x" }] }), /description/);
    throws(() => parseCatalog({ version: 1, skills: [base.skills[0], base.skills[0]] }), /duplicate ID/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", path: "../outside" }] }), /safe relative path/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", path: "/tmp/x" }] }), /safe relative path/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", path: "x", detect: {} }] }), /unknown field/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", path: "x\0y" }] }), /safe relative path/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", path: "x", repository: "acme/repo", directory: "x" }] }), /exactly one source/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", repository: "https://github.com/acme/repo", directory: "skills/x" }] }), /owner\/repository/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", path: "x", technologies: ["not-a-technology"] }] }), /unknown technology ID/);
    throws(() => parseCatalog({ version: 1, skills: [{ id: "x", description: "x", repository: "acme/repo", directory: "../x" }] }), /exact skill directory/);
  });
});
