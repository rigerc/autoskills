import { SKILLS_MAP } from "./skills-map.ts";
import { dirname, resolve } from "node:path";

export interface LocalCatalogEntry {
  id: string;
  description: string;
  path: string;
  technologies?: string[];
  always?: boolean;
}

export interface GitHubCatalogEntry {
  id: string;
  description: string;
  repository: string;
  directory: string;
  technologies?: string[];
  always?: boolean;
}

export type CatalogEntry = LocalCatalogEntry | GitHubCatalogEntry;

export interface SkillCatalog {
  version: 1;
  skills: CatalogEntry[];
}

export interface CatalogRecommendations {
  recommended: CatalogEntry[];
  selectable: CatalogEntry[];
}

const technologyIds = new Set(SKILLS_MAP.map(({ id }) => id));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fail(where: string, message: string): never {
  throw new Error(`Invalid skill catalog ${where}: ${message}`);
}

function validRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(value) || value.startsWith("//")) return false;
  if (value === ".") return true;
  const segments = value.replace(/^\.\//, "").split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Resolve a local entry from the manifest file, never from the current directory. */
export function resolveCatalogLocalPath(manifestPath: string, entry: LocalCatalogEntry): string {
  if (!validRelativePath(entry.path)) fail("path", "expected a safe relative path from the manifest directory");
  return resolve(dirname(manifestPath), entry.path);
}

/** Parse and validate the shared version-1 JSON catalog format. */
export function parseCatalog(input: unknown): SkillCatalog {
  if (!isRecord(input)) fail("root", "expected a JSON object with version and skills fields");
  const unknownRoot = Object.keys(input).find((key) => key !== "version" && key !== "skills");
  if (unknownRoot) fail(unknownRoot, "unknown root field; expected only version and skills");
  if (input.version !== 1) fail("version", `expected version 1, received ${JSON.stringify(input.version)}`);
  if (!Array.isArray(input.skills)) fail("skills", "expected an array of catalog entries");

  const ids = new Set<string>();
  const skills = input.skills.map((raw, index): CatalogEntry => {
    const where = `skills[${index}]`;
    if (!isRecord(raw)) fail(where, "expected an object");
    const allowed = new Set(["id", "description", "path", "repository", "directory", "technologies", "always"]);
    const unknown = Object.keys(raw).find((key) => !allowed.has(key));
    if (unknown) fail(`${where}.${unknown}`, "unknown field; use path or repository and directory for the source");
    if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(raw.id)) fail(`${where}.id`, "expected a non-empty lowercase ID using letters, numbers, '.', '_' or '-'");
    if (ids.has(raw.id)) fail(`${where}.id`, `duplicate ID ${JSON.stringify(raw.id)}`);
    ids.add(raw.id);
    if (typeof raw.description !== "string" || raw.description.trim().length === 0) fail(`${where}.description`, "expected a non-empty string");

    const local = Object.hasOwn(raw, "path");
    const github = Object.hasOwn(raw, "repository") || Object.hasOwn(raw, "directory");
    if (local === github) fail(where, "provide exactly one source: path, or both repository and directory");
    let source: { path: string } | { repository: string; directory: string };
    if (local) {
      if (!validRelativePath(raw.path)) fail(`${where}.path`, "expected a safe relative path from the manifest directory (no absolute paths or '..' segments)");
      source = { path: raw.path };
    } else {
      if (typeof raw.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.repository) || raw.repository.split("/").some((part) => part === "." || part === "..")) {
        fail(`${where}.repository`, "expected a GitHub owner/repository name, such as 'acme/skills'");
      }
      if (!validRelativePath(raw.directory)) fail(`${where}.directory`, "expected the exact skill directory as a safe repository-relative path ('.' means repository root)");
      source = { repository: raw.repository, directory: raw.directory };
    }
    let technologies: string[] | undefined;
    if (Object.hasOwn(raw, "technologies")) {
      if (!Array.isArray(raw.technologies) || raw.technologies.some((id) => typeof id !== "string")) fail(`${where}.technologies`, "expected an array of technology IDs");
      technologies = raw.technologies as string[];
      for (const id of technologies) if (!technologyIds.has(id)) fail(`${where}.technologies`, `unknown technology ID ${JSON.stringify(id)}; use an ID from SKILLS_MAP`);
    }
    if (Object.hasOwn(raw, "always") && typeof raw.always !== "boolean") fail(`${where}.always`, "expected a boolean");
    return {
      id: raw.id,
      description: raw.description,
      ...source,
      ...(technologies === undefined ? {} : { technologies }),
      ...(raw.always === undefined ? {} : { always: raw.always as boolean }),
    } as CatalogEntry;
  });
  return { version: 1, skills };
}

/** Return automatically recommended entries and entries left for manual selection. */
export function partitionCatalog(catalog: SkillCatalog, detectedTechnologyIds: readonly string[]): CatalogRecommendations {
  const detected = new Set(detectedTechnologyIds);
  const recommended: CatalogEntry[] = [];
  const selectable: CatalogEntry[] = [];
  for (const entry of catalog.skills) {
    if (entry.always || entry.technologies?.some((id) => detected.has(id))) recommended.push(entry);
    else selectable.push(entry);
  }
  return { recommended, selectable };
}

export function matchesCatalogEntry(entry: CatalogEntry, detectedTechnologyIds: readonly string[]): boolean {
  return Boolean(entry.always || entry.technologies?.some((id) => detectedTechnologyIds.includes(id)));
}
