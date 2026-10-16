import {
  copyFileSync,
  chmodSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { parseSkillPath } from "./lib.ts";
import type { SkillEntry } from "./lib.ts";
import { bundleHash, downloadSourceSkill, resolveSourceSkill, resolveSourceSkillExact } from "./source.ts";
import type { SourceOptions, SourceSkill } from "./source.ts";
import type { LoadedRegistrySkill } from "./registry.ts";
import { AGENT_FOLDER_MAP } from "./skills-map.ts";
import { log, write, dim, green, cyan, red, HIDE_CURSOR, SHOW_CURSOR, SPINNER } from "./colors.ts";

// ── Registry ─────────────────────────────────────────────────

export interface RegistryEntry {
  source: string;
  skillPath: string;
  commitSha: string;
  files: string[];
  sha256: Record<string, string>;
  bundleHash: string;
  review: {
    status: "approved" | "flagged";
    flags: string[];
    summary: string;
    model: string;
    promptVersion: string;
    reviewedAt: string;
  };
  securityCheck?: {
    status: "ok" | "warning";
    findings: string[];
    summary: string;
    checkedAt: string;
  };
}

export interface Registry {
  version: number;
  generatedAt: string;
  reviewer: { model: string; promptVersion: string };
  skills: Record<string, RegistryEntry>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

let _cachedRegistry: Registry | null | undefined;
let _cachedRegistryDir: string | null = null;
export function getRegistryDir(): string {
  if (_cachedRegistryDir) return _cachedRegistryDir;
  const candidates = [join(__dirname, "skills-registry"), join(__dirname, "..", "skills-registry")];
  for (const c of candidates) {
    if (existsSync(join(c, "index.json"))) {
      _cachedRegistryDir = c;
      return c;
    }
  }
  _cachedRegistryDir = candidates[0];
  return _cachedRegistryDir;
}

export function loadRegistry(): Registry | null {
  if (_cachedRegistry !== undefined) return _cachedRegistry;
  const manifestPath = join(getRegistryDir(), "index.json");
  try {
    const body = JSON.parse(readFileSync(manifestPath, "utf-8")) as Registry;
    _cachedRegistry = body;
    return body;
  } catch {
    _cachedRegistry = null;
    return null;
  }
}

/** @internal — exported for testing only */
export function _setRegistryDir(dir: string | null): void {
  _cachedRegistryDir = dir;
  _cachedRegistry = undefined;
}

// ── Integrity ────────────────────────────────────────────────

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyRegistryEntry(
  skillName: string,
  entry: RegistryEntry,
  registryDir: string = getRegistryDir(),
): { ok: boolean; reason?: string } {
  const skillDir = join(registryDir, skillName);
  if (!existsSync(skillDir)) {
    return { ok: false, reason: `missing directory ${skillDir}` };
  }
  for (const rel of entry.files) {
    const normalizedRel = normalizeRegistryRelPath(rel);
    const abs = join(skillDir, ...normalizedRel.split("/"));
    if (!existsSync(abs)) {
      return { ok: false, reason: `missing file ${normalizedRel}` };
    }
    const expected = entry.sha256[rel] || entry.sha256[normalizedRel];
    if (!expected) {
      return { ok: false, reason: `no recorded hash for ${normalizedRel}` };
    }
    const actual = sha256File(abs);
    if (actual !== expected) {
      return { ok: false, reason: `hash mismatch for ${normalizedRel}` };
    }
  }
  return { ok: true };
}

// ── Install ──────────────────────────────────────────────────

export interface InstallResult {
  success: boolean;
  output: string;
  stderr: string;
  exitCode: number | null;
  command: string;
  securityCheck?: InstallSecurityCheck;
}

export interface InstallSecurityCheck {
  name: string;
  status: "ok" | "warning";
  summary: string;
  findings: string[];
}

export interface InstallOptions extends SourceOptions {
  projectDir?: string;
  verbose?: boolean;
  resolvedSource?: SourceSkill;
}

function relPathFromTo(from: string, to: string): string {
  return relative(from, to).split("\\").join("/");
}

function normalizeRegistryRelPath(rel: string): string {
  return rel.split("\\").join("/");
}

export function getAutoskillsCacheDir(): string {
  return (
    process.env.AUTOSKILLS_CACHE_DIR || join(homedir(), ".cache", "autoskills", "skills-registry")
  );
}

export function clearAutoskillsCache(): { cacheDir: string; removed: boolean } {
  const cacheDir = getAutoskillsCacheDir();
  const removed = existsSync(cacheDir);
  rmSync(cacheDir, { recursive: true, force: true });
  return { cacheDir, removed };
}

// Synced registry reviews describe old snapshots, not the live upstream content.
export function securityCheckForSkillPath(_skillPath: string): InstallSecurityCheck | null {
  return null;
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) copyFileSync(s, d);
  }
}

function ensureSymlinkTo(target: string, linkPath: string): void {
  mkdirSync(dirname(linkPath), { recursive: true });
  try {
    lstatSync(linkPath);
    rmSync(linkPath, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  try {
    symlinkSync(relPathFromTo(dirname(linkPath), target), linkPath, "dir");
  } catch {
    copyDir(target, linkPath);
  }
}

export function agentFolderFor(agent: string): string | null {
  for (const [folder, name] of Object.entries(AGENT_FOLDER_MAP)) {
    if (name === agent) return folder;
  }
  return null;
}

export interface LockedSkill {
  source: string;
  sourceType: string;
  skillPath?: string;
  commitSha?: string;
  sourceHash?: string;
  computedHash?: string;
  agents?: string[];
  registry?: string;
  catalogRevision?: string;
}

export function readSkillsLock(projectDir: string): {
  version: number;
  skills: Record<string, LockedSkill>;
} {
  const path = join(projectDir, "skills-lock.json");
  if (!existsSync(path)) return { version: 1, skills: {} };
  const lock = JSON.parse(readFileSync(path, "utf-8"));
  if (!lock?.skills || typeof lock.skills !== "object" || Array.isArray(lock.skills)) {
    throw new Error("invalid skills-lock.json: expected a skills object");
  }
  return lock;
}

export function installedAgents(projectDir: string, name: string, locked?: LockedSkill): string[] {
  const agents = new Set(Array.isArray(locked?.agents) ? locked.agents : []);
  for (const [folder, agent] of Object.entries(AGENT_FOLDER_MAP)) {
    try {
      lstatSync(join(projectDir, folder, "skills", name));
      agents.add(agent);
    } catch {}
  }
  return [...agents];
}

export async function installSkill(
  skillPath: string,
  agents: string[] = [],
  opts: InstallOptions = {},
): Promise<InstallResult> {
  const projectDir = opts.projectDir || process.cwd();
  const command = `autoskills install ${skillPath}`;
  try {
    const source = opts.resolvedSource || (await resolveSourceSkill(skillPath, opts));
    const lock = readSkillsLock(projectDir);
    const resolvedAgents = [
      ...new Set([
        ...installedAgents(projectDir, source.name, lock.skills[source.name]),
        ...agents,
      ]),
    ];
    const files = await downloadSourceSkill(source, opts);
    const hash = bundleHash(files);
    const skillsDir = join(projectDir, ".agents", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const canonicalDir = join(skillsDir, source.name);
    const stage = mkdtempSync(join(skillsDir, ".autoskills-"));
    const backup = `${stage}-backup`;
    let backedUp = false;
    let replaced = false;
    try {
      for (const file of files) {
        const dest = join(stage, ...file.path.split("/"));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, file.content);
        if (file.executable) chmodSync(dest, 0o755);
      }
      try {
        lstatSync(canonicalDir);
        backedUp = true;
      } catch {}
      if (backedUp) renameSync(canonicalDir, backup);
      try {
        renameSync(stage, canonicalDir);
        replaced = true;
      } catch (err) {
        if (backedUp) renameSync(backup, canonicalDir);
        throw err;
      }
    } finally {
      rmSync(stage, { recursive: true, force: true });
      if (replaced) rmSync(backup, { recursive: true, force: true });
    }
    const errors: string[] = [];
    for (const agent of resolvedAgents) {
      const folder = agentFolderFor(agent);
      if (!folder) continue;
      try {
        ensureSymlinkTo(canonicalDir, join(projectDir, folder, "skills", source.name));
      } catch (err) {
        errors.push(`${folder}: ${(err as Error).message}`);
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));

    // Read again after awaits so concurrent installs preserve each other's entries.
    const latestLock = readSkillsLock(projectDir);
    latestLock.skills[source.name] = {
      source: source.source,
      sourceType: "github",
      skillPath: source.skillPath,
      commitSha: source.commitSha,
      sourceHash: source.sourceHash,
      computedHash: hash,
      agents: resolvedAgents,
    };
    latestLock.skills = Object.fromEntries(
      Object.entries(latestLock.skills).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(join(projectDir, "skills-lock.json"), JSON.stringify(latestLock, null, 2) + "\n");
    opts.onTrace?.(`installed ${source.source}@${source.commitSha}:${source.skillPath}`);
    return {
      success: true,
      output: `installed ${source.name} into ${relPathFromTo(projectDir, canonicalDir)}`,
      stderr: "",
      exitCode: 0,
      command,
    };
  } catch (err) {
    const message = (err as Error).message;
    return { success: false, output: message, stderr: message, exitCode: 1, command };
  }
}

/** Copy a catalog skill from its recorded source, keeping its source identity. */
export async function installRegistrySkill(
  skill: LoadedRegistrySkill,
  agents: string[] = [],
  opts: InstallOptions = {},
): Promise<InstallResult> {
  const projectDir = opts.projectDir || process.cwd();
  const name = skill.entry.id;
  const command = `autoskills registry install ${skill.registry}/${name}`;
  try {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`invalid catalog skill name: ${name}`);
    const origin = skill.origin;
    let files: { path: string; content: Buffer; executable: boolean }[];
    let record: LockedSkill;
    if (origin.type === "local") {
      const root = origin.directory;
      if (!lstatSync(root).isDirectory()) throw new Error(`local source is not a directory: ${root}`);
      files = [];
      function walk(dir: string, prefix = ""): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          const stat = lstatSync(path);
          if (stat.isSymbolicLink()) throw new Error(`symlinks are not allowed in local skills: ${path}`);
          if (stat.isDirectory()) walk(path, rel);
          else if (stat.isFile()) files.push({ path: rel, content: readFileSync(path), executable: Boolean(stat.mode & 0o111) });
          else throw new Error(`unsupported file in local skill: ${path}`);
        }
      }
      walk(root);
      if (!files.some((file) => file.path === "SKILL.md")) throw new Error(`SKILL.md missing from local source ${root}`);
      record = { source: root, sourceType: "local", sourceHash: bundleHash(files), registry: skill.registry };
    } else {
      const source = await resolveSourceSkillExact(origin.repository, name, origin.directory, opts, origin.revision);
      files = await downloadSourceSkill(source, opts);
      record = {
        source: source.source, sourceType: "github", skillPath: source.skillPath,
        commitSha: source.commitSha, sourceHash: source.sourceHash,
        registry: skill.registry, ...(origin.revision ? { catalogRevision: origin.revision } : {}),
      };
    }
    const skillsDir = join(projectDir, ".agents", "skills");
    const canonicalDir = join(skillsDir, name);
    const current = readSkillsLock(projectDir).skills[name];
    if (current) {
      const sameSource = current.source === record.source &&
        (current.sourceType === record.sourceType || (current.sourceType === "autoskills-registry" && record.sourceType === "github")) &&
        (current.skillPath ?? "") === (record.skillPath ?? "");
      if (!sameSource) throw new Error(`skill ${name} is already installed from another source`);
    } else if (existsSync(canonicalDir)) {
      throw new Error(`skill ${name} already exists without recorded source`);
    }
    const resolvedAgents = [...new Set([...installedAgents(projectDir, name, current), ...agents])];
    mkdirSync(skillsDir, { recursive: true });
    const stage = mkdtempSync(join(skillsDir, ".autoskills-"));
    const backup = `${stage}-backup`;
    let backedUp = false;
    let replaced = false;
    try {
      for (const file of files) {
        const dest = join(stage, ...file.path.split("/"));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, file.content);
        if (file.executable) chmodSync(dest, 0o755);
      }
      try { lstatSync(canonicalDir); backedUp = true; } catch {}
      if (backedUp) renameSync(canonicalDir, backup);
      try { renameSync(stage, canonicalDir); replaced = true; }
      catch (error) { if (backedUp) renameSync(backup, canonicalDir); throw error; }
    } finally {
      rmSync(stage, { recursive: true, force: true });
      if (replaced) rmSync(backup, { recursive: true, force: true });
    }
    const errors: string[] = [];
    for (const agent of resolvedAgents) {
      const folder = agentFolderFor(agent);
      if (!folder) continue;
      try { ensureSymlinkTo(canonicalDir, join(projectDir, folder, "skills", name)); }
      catch (error) { errors.push(`${folder}: ${(error as Error).message}`); }
    }
    if (errors.length) throw new Error(errors.join("\n"));
    const lock = readSkillsLock(projectDir);
    lock.skills[name] = { ...record, computedHash: bundleHash(files), agents: resolvedAgents };
    lock.skills = Object.fromEntries(Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(projectDir, "skills-lock.json"), JSON.stringify(lock, null, 2) + "\n");
    opts.onTrace?.(`installed registry ${skill.registry}/${name} from ${record.source}`);
    return { success: true, output: `installed ${name} into ${relPathFromTo(projectDir, canonicalDir)}`, stderr: "", exitCode: 0, command };
  } catch (error) {
    const message = (error as Error).message;
    return { success: false, output: message, stderr: message, exitCode: 1, command };
  }
}

// ── Batch install (concurrent + spinner) ─────────────────────

function installEntry(entry: SkillEntry, agents: string[], opts: InstallOptions): Promise<InstallResult> {
  return entry.registrySkill
    ? installRegistrySkill(entry.registrySkill, agents, opts)
    : installSkill(entry.skill, agents, opts);
}

function sortByRepo(skills: SkillEntry[]): SkillEntry[] {
  return [...skills].sort((a, b) => {
    const repoA = a.registrySkill?.registry ?? parseSkillPath(a.skill).repo;
    const repoB = b.registrySkill?.registry ?? parseSkillPath(b.skill).repo;
    return repoA.localeCompare(repoB);
  });
}

interface InstallAllResult {
  installed: number;
  failed: number;
  securityChecks: InstallSecurityCheck[];
  errors: {
    name: string;
    output: string;
    stderr: string;
    exitCode: number | null;
    command: string;
  }[];
}

export async function installAll(
  skills: SkillEntry[],
  agents: string[] = [],
  opts: InstallOptions = {},
): Promise<InstallAllResult> {
  opts = { ...opts, repoTrees: opts.repoTrees || new Map() };
  if (opts.verbose) return installAllVerbose(skills, agents, opts);
  if (!process.stdout.isTTY) return installAllSimple(skills, agents, opts);

  const CONCURRENCY = 6;
  const sorted = sortByRepo(skills);
  const total = sorted.length;

  const states = sorted.map((entry) => ({
    entry,
    skill: entry.skill,
    name: entry.skill,
    status: "pending" as "pending" | "installing" | "success" | "failed",
    output: "",
  }));

  let frame = 0;
  let rendered = false;
  let activeCount = 0;

  function render(): void {
    if (rendered) {
      write(`\x1b[${total}A\r`);
    }
    rendered = true;
    write("\x1b[J");

    for (const state of states) {
      switch (state.status) {
        case "pending":
          write(dim(`   ◌ ${state.name}`) + "\n");
          break;
        case "installing":
          write(cyan(`   ${SPINNER[frame]}`) + ` ${state.name}...\n`);
          break;
        case "success":
          write(green(`   ✔ ${state.name}`) + "\n");
          break;
        case "failed":
          write(red(`   ✘ ${state.name}`) + dim(" — failed") + "\n");
          break;
      }
    }
  }

  write(HIDE_CURSOR);

  const timer = setInterval(() => {
    frame = (frame + 1) % SPINNER.length;
    if (activeCount > 0) render();
  }, 80);

  let installed = 0;
  let failed = 0;
  const errors: InstallAllResult["errors"] = [];
  const securityChecks: InstallSecurityCheck[] = [];
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < total) {
      const idx = nextIdx++;
      const state = states[idx];
      state.status = "installing";
      activeCount++;
      render();

      const result = await installEntry(state.entry, agents, opts);

      activeCount--;
      if (result.success) {
        state.status = "success";
        installed++;
        if (result.securityCheck) securityChecks.push(result.securityCheck);
      } else {
        state.status = "failed";
        state.output = result.output;
        errors.push({
          name: state.name,
          output: result.output,
          stderr: result.stderr,
          exitCode: result.exitCode,
          command: result.command,
        });
        failed++;
      }
      render();
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
  await Promise.all(workers);

  clearInterval(timer);
  render();
  write(SHOW_CURSOR);

  return { installed, failed, errors, securityChecks };
}

async function installAllVerbose(
  skills: SkillEntry[],
  agents: string[] = [],
  opts: InstallOptions = {},
): Promise<InstallAllResult> {
  const sorted = sortByRepo(skills);
  let installed = 0;
  let failed = 0;
  const errors: InstallAllResult["errors"] = [];
  const securityChecks: InstallSecurityCheck[] = [];

  for (const entry of sorted) {
    const { skill } = entry;
    log(cyan(`   ◆ ${skill}`));
    const result = await installEntry(entry, agents, {
      ...opts,
      onTrace: (message) => log(dim(`     ${message}`)),
    });

    if (result.success) {
      log(green(`     ✔ installed`));
      installed++;
      if (result.securityCheck) securityChecks.push(result.securityCheck);
    } else {
      log(red(`     ✘ failed`) + dim(` — ${result.output}`));
      errors.push({
        name: skill,
        output: result.output,
        stderr: result.stderr,
        exitCode: result.exitCode,
        command: result.command,
      });
      failed++;
    }
    log();
  }

  return { installed, failed, errors, securityChecks };
}

async function installAllSimple(
  skills: SkillEntry[],
  agents: string[] = [],
  opts: InstallOptions = {},
): Promise<InstallAllResult> {
  const CONCURRENCY = 6;
  const sorted = sortByRepo(skills);
  let installed = 0;
  let failed = 0;
  const errors: InstallAllResult["errors"] = [];
  const securityChecks: InstallSecurityCheck[] = [];
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < sorted.length) {
      const idx = nextIdx++;
      const entry = sorted[idx];
      const { skill } = entry;
      const result = await installEntry(entry, agents, opts);

      if (result.success) {
        log(green(`   ✔ ${skill}`));
        installed++;
        if (result.securityCheck) securityChecks.push(result.securityCheck);
      } else {
        log(red(`   ✘ ${skill}`) + dim(" — failed"));
        errors.push({
          name: skill,
          output: result.output,
          stderr: result.stderr,
          exitCode: result.exitCode,
          command: result.command,
        });
        failed++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, sorted.length) }, () => worker());
  await Promise.all(workers);

  return { installed, failed, errors, securityChecks };
}

// ── Deprecated shim ──────────────────────────────────────────

/** @deprecated retained so that UI code keeps compiling; no longer used. */
export function resolveSkillsBin(): string | null {
  return null;
}
