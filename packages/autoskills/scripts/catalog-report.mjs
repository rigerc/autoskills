#!/usr/bin/env node

// Derives catalog totals and coverage from SKILLS_MAP so documentation cannot
// drift from the map. `--write` refreshes the generated block in README.md and
// `--check` fails when it is stale.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMBO_SKILLS_MAP, SKILLS_MAP } from "../skills-map.ts";

const README_PATH = fileURLToPath(new URL("../README.md", import.meta.url));

export const COVERAGE_START = "<!-- catalog-coverage:start -->";
export const COVERAGE_END = "<!-- catalog-coverage:end -->";

export function catalogCoverage(skillsMap = SKILLS_MAP, comboMap = COMBO_SKILLS_MAP) {
  const withSkills = skillsMap.filter((technology) => technology.skills.length > 0).length;
  return {
    technologies: skillsMap.length,
    combos: comboMap.length,
    withSkills,
    detectionOnly: skillsMap.length - withSkills,
    detectionOnlyNames: skillsMap
      .filter((technology) => technology.skills.length === 0)
      .map((technology) => technology.name),
  };
}

export function catalogCoverageBlock(coverage = catalogCoverage()) {
  return [
    COVERAGE_START,
    `\`autoskills\` detects **${coverage.technologies} technologies** and **${coverage.combos} technology combos** from \`package.json\`, project manifests, Gradle files, and configuration files. **${coverage.withSkills} technologies have curated skills** and the remaining **${coverage.detectionOnly} are detection-only** until a suitable upstream skill is verified and synced. The tables below list every technology in \`SKILLS_MAP\`.`,
    COVERAGE_END,
  ].join("\n");
}

export function replaceCoverageBlock(readme, block = catalogCoverageBlock()) {
  const start = readme.indexOf(COVERAGE_START);
  const end = readme.indexOf(COVERAGE_END);
  if (start === -1 || end === -1 || end < start) return null;
  return `${readme.slice(0, start)}${block}${readme.slice(end + COVERAGE_END.length)}`;
}

function main() {
  const check = process.argv.includes("--check");
  const readme = readFileSync(README_PATH, "utf8");
  const block = catalogCoverageBlock();

  if (check) {
    if (!readme.includes(block)) {
      console.error("Catalog coverage in README.md is stale. Run: pnpm --dir packages/autoskills run catalog:report");
      process.exitCode = 1;
      return;
    }
    console.log("Catalog coverage is current.");
    return;
  }

  const updated = replaceCoverageBlock(readme, block);
  if (updated === null) {
    console.error(`README.md is missing the ${COVERAGE_START} / ${COVERAGE_END} markers.`);
    process.exitCode = 1;
    return;
  }

  if (updated === readme) {
    console.log("Catalog coverage is already current.");
    return;
  }
  writeFileSync(README_PATH, updated);
  console.log("Updated catalog coverage in README.md.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
