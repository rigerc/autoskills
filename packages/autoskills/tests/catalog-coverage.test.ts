import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMBO_SKILLS_MAP, SKILLS_MAP } from "../lib.ts";
import { catalogCoverage, catalogCoverageBlock } from "../scripts/catalog-report.mjs";

function readmeText(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname!, "..", relativePath), "utf8");
}

function listedTechnologyCells(readme: string): Set<string> {
  const cells = new Set<string>();
  for (const line of readme.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    for (const column of line.split("|")) {
      for (const part of column.split(",")) {
        const value = part.trim().replace(/`/g, "");
        if (value && value !== "---") cells.add(value);
      }
    }
  }
  return cells;
}

describe("catalog coverage documentation", () => {
  const readme = readmeText("README.md");
  const rootReadme = readmeText("../../README.md");

  it("derives detection-only and skill-backed counts from the map", () => {
    const coverage = catalogCoverage();
    strictEqual(coverage.technologies, SKILLS_MAP.length);
    strictEqual(coverage.combos, COMBO_SKILLS_MAP.length);
    strictEqual(coverage.withSkills, SKILLS_MAP.filter((t) => t.skills.length > 0).length);
    strictEqual(coverage.withSkills + coverage.detectionOnly, coverage.technologies);
    ok(coverage.detectionOnlyNames.length === coverage.detectionOnly);
  });

  it("keeps the generated coverage block current", () => {
    ok(readme.includes(catalogCoverageBlock()), "README.md catalog-coverage block is stale");
  });

  it("lists every technology in the map", () => {
    const cells = listedTechnologyCells(readme);
    const missing = SKILLS_MAP.filter((technology) => !cells.has(technology.name));
    strictEqual(missing.length, 0, missing.map((t) => `${t.id} (${t.name})`).join(", "));
  });

  it("documents the totals in the repository README", () => {
    const { technologies, combos } = catalogCoverage();
    ok(rootReadme.includes(`**${technologies} technologies**`));
    ok(rootReadme.includes(`**${combos} technology combos**`));
  });
});
