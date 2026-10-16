import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { installRegistrySkill, installSkill, localBundleSourceHash, readLocalSkillBundle, readSkillsLock } from "./installer.ts";
import type { InstallOptions, InstallResult } from "./installer.ts";
import { resolveSourceSkill, resolveSourceSkillExact, safeSourcePath } from "./source.ts";
import type { SourceSkill } from "./source.ts";
import type { LoadedRegistrySkill } from "./registry.ts";

export interface SkillUpdate {
  name: string;
  source: SourceSkill;
  outdated: boolean;
  kind: "github" | "local";
  registry?: string;
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
    if (!["github", "autoskills-registry", "local"].includes(entry?.sourceType)) {
      result.skipped.push(name);
      continue;
    }
    try {
      if (!safeSourcePath(name) || name.includes("/")) throw new Error("invalid locked skill name");
      let source: SourceSkill;
      if (entry.sourceType === "local") {
        if (!isAbsolute(entry.source)) throw new Error(`local source must be absolute: ${entry.source}`);
        let files: ReturnType<typeof readLocalSkillBundle>;
        try { files = readLocalSkillBundle(entry.source); }
        catch (error) { throw new Error(`local source unavailable at ${entry.source}: ${(error as Error).message}`); }
        source = { source: entry.source, name, skillPath: "", commitSha: "local", sourceHash: localBundleSourceHash(files), files: [] };
      } else if (entry.registry) {
        if (entry.skillPath === undefined) throw new Error("registry skill lock is missing exact skillPath");
        source = await resolveSourceSkillExact(entry.source, name, entry.skillPath, shared);
      } else {
        // Also migrate installations made by the former registry installer.
        source = await resolveSourceSkill(`${entry.source}/${name}`, shared, entry.skillPath);
      }
      result.skills.push({
        name,
        source,
        kind: entry.sourceType === "local" ? "local" : "github",
        ...(entry.registry ? { registry: entry.registry } : {}),
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
  if (update.kind === "local" || update.registry) {
    const origin: LoadedRegistrySkill["origin"] = update.kind === "local"
      ? { type: "local", directory: update.source.source }
      : { type: "github", repository: update.source.source, directory: update.source.skillPath, revision: update.source.commitSha };
    const skill: LoadedRegistrySkill = {
      registry: update.registry ?? "local",
      entry: update.kind === "local"
        ? { id: update.name, description: update.name, path: "." }
        : { id: update.name, description: update.name, repository: update.source.source, directory: update.source.skillPath || "." },
      origin,
    };
    return installRegistrySkill(skill, agents, opts);
  }
  return installSkill(`${update.source.source}/${update.name}`, agents, {
    ...opts,
    resolvedSource: update.source,
  });
}
