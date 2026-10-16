import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { parseCatalog, resolveCatalogLocalPath, type CatalogEntry, type SkillCatalog } from "./catalog.ts";
import { resolveRegistryConfig, type RegistrySource } from "./config.ts";
import { fetchSourceTree, sourceFetch, type SourceOptions, type SourceTree } from "./source.ts";

export interface LoadedRegistrySkill {
  registry: string;
  entry: CatalogEntry;
  origin: { type: "local"; directory: string } | { type: "github"; repository: string; directory: string; revision?: string };
}

export interface LoadedRegistry {
  name: string;
  source: RegistrySource;
  skills: LoadedRegistrySkill[];
  revision?: string;
  stale: boolean;
  warning?: string;
}

export interface RegistryLoadOptions extends SourceOptions {
  homeDir?: string;
  configHome?: string;
  cacheDir?: string;
  refresh?: boolean;
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel));
}

function localSkill(name: string, entry: CatalogEntry, manifest: string, root: string): LoadedRegistrySkill {
  if (!("path" in entry)) throw new Error("localSkill requires a local catalog entry");
  const path = resolveCatalogLocalPath(manifest, entry);
  const real = realpathSync(path);
  if (!inside(root, real) || !lstatSync(real).isDirectory() || !existsSync(join(real, "SKILL.md"))) {
    throw new Error(`registry ${name}: ${entry.id} must be a directory inside the registry containing SKILL.md`);
  }
  return { registry: name, entry, origin: { type: "local", directory: real } };
}

function loadLocal(name: string, source: Extract<RegistrySource, { type: "local" }>): LoadedRegistry {
  const root = realpathSync(source.directory);
  if (!lstatSync(root).isDirectory()) throw new Error(`registry ${name}: ${source.directory} is not a directory`);
  const manifest = resolve(root, source.manifest ?? "catalog.json");
  const hasManifest = existsSync(manifest);
  if (source.manifest && !hasManifest) throw new Error(`registry ${name}: manifest not found: ${manifest}`);
  let catalog: SkillCatalog = { version: 1, skills: [] };
  if (hasManifest) {
    const realManifest = realpathSync(manifest);
    if (!inside(root, realManifest) || !lstatSync(realManifest).isFile()) throw new Error(`registry ${name}: manifest escapes registry directory`);
    try { catalog = parseCatalog(JSON.parse(readFileSync(realManifest, "utf8"))); }
    catch (error) { throw new Error(`registry ${name}: invalid manifest ${manifest}: ${(error as Error).message}`); }
  }
  const skills = catalog.skills.map((entry): LoadedRegistrySkill => {
    if ("path" in entry) return localSkill(name, entry, manifest, root);
    return { registry: name, entry, origin: { type: "github", repository: entry.repository, directory: entry.directory } };
  });
  const ids = new Set(skills.map((skill) => skill.entry.id));
  for (const child of readdirSync(root, { withFileTypes: true })) {
    if (!child.isDirectory() || ids.has(child.name) || !/^[a-z0-9][a-z0-9._-]*$/.test(child.name)) continue;
    const directory = realpathSync(join(root, child.name));
    if (!inside(root, directory) || !existsSync(join(directory, "SKILL.md"))) continue;
    const entry: CatalogEntry = { id: child.name, description: child.name, path: child.name };
    skills.push({ registry: name, entry, origin: { type: "local", directory } });
  }
  return { name, source, skills, stale: false };
}

interface CachedManifest { repository: string; manifest: string; revision: string; catalog: SkillCatalog; digest: string }
function cachePath(repo: string, manifest: string, opts: RegistryLoadOptions): string {
  const dir = opts.cacheDir ?? process.env.AUTOSKILLS_REGISTRY_CACHE_DIR ?? join(opts.homeDir ?? homedir(), ".cache", "autoskills", "registries");
  return join(dir, `${createHash("sha256").update(`${repo}/${manifest}`).digest("hex")}.json`);
}
function readCache(path: string, repo: string, manifest: string): CachedManifest | null {
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, "utf8")) as CachedManifest;
    if (cached.repository !== repo || cached.manifest !== manifest || !/^[a-f0-9]{40}$/.test(cached.revision)) return null;
    const catalog = parseCatalog(cached.catalog);
    if (createHash("sha256").update(JSON.stringify(catalog)).digest("hex") !== cached.digest) return null;
    return { ...cached, catalog };
  } catch { return null; }
}
function saveCache(path: string, value: CachedManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, path);
}
function githubDirectory(manifest: string, entry: CatalogEntry, registryRepo: string): { repository: string; directory: string } {
  if ("repository" in entry) return { repository: entry.repository, directory: entry.directory === "." ? "" : entry.directory };
  const directory = posix.normalize(posix.join(posix.dirname(manifest), entry.path));
  if (directory === ".." || directory.startsWith("../") || directory.startsWith("/")) throw new Error(`catalog entry ${entry.id} escapes repository`);
  return { repository: registryRepo, directory: directory === "." ? "" : directory };
}
function fromGithub(name: string, source: Extract<RegistrySource, { type: "github" }>, cached: CachedManifest, stale: boolean, warning?: string): LoadedRegistry {
  return {
    name, source, revision: cached.revision, stale, warning,
    skills: cached.catalog.skills.map((entry) => {
      const location = githubDirectory(source.manifest, entry, source.repository);
      return { registry: name, entry, origin: { type: "github", ...location, ...(location.repository === source.repository ? { revision: cached.revision } : {}) } };
    }),
  };
}
function gitBlobSha(content: Buffer): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}
function hasSkill(tree: SourceTree, directory: string): boolean {
  const skillPath = directory ? `${directory}/SKILL.md` : "SKILL.md";
  return tree.files.some((file) => file.path === skillPath && file.type === "blob" && file.mode !== "120000");
}
async function loadGithub(name: string, source: Extract<RegistrySource, { type: "github" }>, opts: RegistryLoadOptions): Promise<LoadedRegistry> {
  const path = cachePath(source.repository, source.manifest, opts);
  const cached = readCache(path, source.repository, source.manifest);
  let tree: SourceTree;
  try { tree = await fetchSourceTree(source.repository, opts); }
  catch (error) {
    if (cached && !opts.refresh) return fromGithub(name, source, cached, true, `Using stale registry cache: ${(error as Error).message}`);
    throw new Error(`registry ${name}: refresh failed: ${(error as Error).message}`);
  }
  if (cached?.revision === tree.commitSha && !opts.refresh) return fromGithub(name, source, cached, false);
  const file = tree.files.find((item) => item.path === source.manifest && item.type === "blob" && item.mode !== "120000");
  if (!file || !/^[a-f0-9]{40}$/i.test(file.sha)) throw new Error(`registry ${name}: manifest ${source.manifest} not found in ${source.repository}@${tree.commitSha}`);
  const url = `https://raw.githubusercontent.com/${source.repository}/${tree.commitSha}/${source.manifest.split("/").map(encodeURIComponent).join("/")}`;
  const content = Buffer.from(await (await sourceFetch(url, opts)).arrayBuffer());
  if (gitBlobSha(content) !== file.sha) throw new Error(`registry ${name}: manifest hash mismatch`);
  let catalog: SkillCatalog;
  try { catalog = parseCatalog(JSON.parse(content.toString("utf8"))); }
  catch (error) { throw new Error(`registry ${name}: invalid manifest ${source.manifest}: ${(error as Error).message}`); }
  for (const entry of catalog.skills) {
    const location = githubDirectory(source.manifest, entry, source.repository);
    if (location.repository === source.repository && !hasSkill(tree, location.directory)) {
      throw new Error(`registry ${name}: ${entry.id} has no SKILL.md at ${location.directory || "."}`);
    }
  }
  const value: CachedManifest = { repository: source.repository, manifest: source.manifest, revision: tree.commitSha, catalog, digest: createHash("sha256").update(JSON.stringify(catalog)).digest("hex") };
  saveCache(path, value);
  return fromGithub(name, source, value, false);
}

/** Resolve and load each configured registry for one project. */
export async function loadRegistries(projectDir: string, opts: RegistryLoadOptions = {}): Promise<LoadedRegistry[]> {
  const config = resolveRegistryConfig(projectDir, opts);
  const loaded: LoadedRegistry[] = [];
  for (const [name, source] of Object.entries(config.registries)) {
    try { loaded.push(await loadRegistrySource(name, source, opts)); }
    catch (error) { throw new Error(`registry ${name}: ${(error as Error).message}`); }
  }
  return loaded;
}

export async function loadRegistrySource(name: string, source: RegistrySource, opts: RegistryLoadOptions = {}): Promise<LoadedRegistry> {
  return source.type === "local" ? loadLocal(name, source) : loadGithub(name, source, opts);
}
