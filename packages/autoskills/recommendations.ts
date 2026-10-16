import { partitionCatalog } from "./catalog.ts";
import { readSkillsLock } from "./installer.ts";
import { collectSkills, parseSkillPath, type SkillEntry, type Technology, type ComboSkill } from "./lib.ts";
import { loadRegistries, type LoadedRegistrySkill, type RegistryLoadOptions } from "./registry.ts";

export interface ProjectRecommendations {
  recommended: SkillEntry[];
  selectable: SkillEntry[];
  warnings: string[];
}

function originKey(skill: LoadedRegistrySkill): string {
  const origin = skill.origin;
  return origin.type === "local" ? `local:${origin.directory}` : `github:${origin.repository}:${origin.directory}`;
}
function installName(skill: SkillEntry): string {
  return skill.registrySkill?.entry.id ?? parseSkillPath(skill.skill).skillName;
}
function sourceKey(skill: SkillEntry): string {
  return skill.registrySkill ? originKey(skill.registrySkill) : `built-in:${skill.skill}`;
}

export function validateSkillSelection(skills: SkillEntry[], projectDir: string): void {
  const byName = new Map<string, string>();
  const installed = readSkillsLock(projectDir).skills;
  for (const skill of skills) {
    const name = installName(skill);
    const source = sourceKey(skill);
    const previous = byName.get(name);
    if (previous && previous !== source) throw new Error(`skill ${name} has conflicting sources; choose one before installing`);
    byName.set(name, source);
    const locked = installed[name];
    if (!locked) continue;
    if (!skill.registrySkill) {
      const repo = parseSkillPath(skill.skill).repo;
      if (!["github", "autoskills-registry"].includes(locked.sourceType) || locked.source !== repo) {
        throw new Error(`skill ${name} is already installed from another source`);
      }
      continue;
    }
    const origin = skill.registrySkill.origin;
    const same = origin.type === "local"
      ? locked.sourceType === "local" && locked.source === origin.directory
      : ["github", "autoskills-registry"].includes(locked.sourceType) && locked.source === origin.repository && (locked.skillPath ?? "") === origin.directory;
    if (!same) throw new Error(`skill ${name} is already installed from another source`);
  }
}

export async function collectProjectRecommendations(
  projectDir: string,
  options: { detected: Technology[]; isFrontend: boolean; combos?: ComboSkill[]; installedNames?: Set<string> | null } & RegistryLoadOptions,
): Promise<ProjectRecommendations> {
  const { detected, isFrontend, combos = [], installedNames = null, ...loadOptions } = options;
  const recommended = collectSkills({ detected, isFrontend, combos, installedNames });
  const selectable: SkillEntry[] = [];
  const warnings: string[] = [];
  const origins = new Map<string, SkillEntry>();
  const targets = new Map<string, string>();
  for (const entry of recommended) targets.set(installName(entry), sourceKey(entry));
  const registries = await loadRegistries(projectDir, loadOptions);
  for (const registry of registries) {
    if (registry.warning) warnings.push(`${registry.name}: ${registry.warning}`);
    const partition = partitionCatalog({ version: 1, skills: registry.skills.map((skill) => skill.entry) }, detected.map((tech) => tech.id));
    const automatic = new Set(partition.recommended);
    for (const skill of registry.skills) {
      const source = originKey(skill);
      const duplicate = origins.get(source);
      if (duplicate) {
        if (!duplicate.sources.includes(`Registry: ${registry.name}`)) duplicate.sources.push(`Registry: ${registry.name}`);
        if (automatic.has(skill.entry) && selectable.includes(duplicate)) {
          selectable.splice(selectable.indexOf(duplicate), 1);
          recommended.push(duplicate);
        }
        continue;
      }
      const name = skill.entry.id;
      const prior = targets.get(name);
      if (prior && prior !== source) throw new Error(`skill ${name} has conflicting sources in recommendations`);
      targets.set(name, source);
      const item: SkillEntry = {
        skill: `registry:${registry.name}/${name}`,
        sources: [`Registry: ${registry.name}`],
        installed: installedNames?.has(name) ?? false,
        registrySkill: skill,
      };
      origins.set(source, item);
      (automatic.has(skill.entry) ? recommended : selectable).push(item);
    }
  }
  return { recommended, selectable, warnings };
}
