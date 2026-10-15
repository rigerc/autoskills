import { existsSync } from "node:fs";
import { join } from "node:path";

import { installSkill, readSkillsLock } from "./installer.ts";
import type { InstallOptions, InstallResult } from "./installer.ts";
import { resolveSourceSkill, safeSourcePath } from "./source.ts";
import type { SourceSkill } from "./source.ts";

export interface SkillUpdate {
  name: string;
  source: SourceSkill;
  outdated: boolean;
}

export interface UpdateCheck {
  skills: SkillUpdate[];
  errors: { name: string; error: string }[];
  skipped: string[];
}

export async function checkSkillUpdates(opts: InstallOptions = {}): Promise<UpdateCheck> {
  const projectDir = opts.projectDir || process.cwd();
  const lock = readSkillsLock(projectDir);
  const shared = { ...opts, repoTrees: opts.repoTrees || new Map() };
  const result: UpdateCheck = { skills: [], errors: [], skipped: [] };
  for (const [name, entry] of Object.entries(lock.skills)) {
    // Also migrate installations made by the former registry installer.
    if (!["github", "autoskills-registry"].includes(entry?.sourceType)) {
      result.skipped.push(name);
      continue;
    }
    try {
      if (!safeSourcePath(name) || name.includes("/")) throw new Error("invalid locked skill name");
      const source = await resolveSourceSkill(`${entry.source}/${name}`, shared, entry.skillPath);
      result.skills.push({
        name,
        source,
        outdated:
          entry.sourceHash !== source.sourceHash ||
          !existsSync(join(projectDir, ".agents", "skills", name, "SKILL.md")),
      });
    } catch (err) {
      result.errors.push({ name, error: (err as Error).message });
    }
  }
  return result;
}

export async function updateSkill(
  update: SkillUpdate,
  agents: string[] = [],
  opts: InstallOptions = {},
): Promise<InstallResult> {
  return installSkill(`${update.source.source}/${update.name}`, agents, {
    ...opts,
    resolvedSource: update.source,
  });
}
