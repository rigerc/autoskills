import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type RegistrySource =
  | { type: "local"; directory: string; manifest?: string }
  | { type: "github"; repository: string; manifest: string };

export interface ResolvedRegistryConfig {
  version: 1;
  /** Bundled recommendations are always available alongside configured registries. */
  includeBuiltIn: true;
  registries: Record<string, RegistrySource>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function invalid(file: string, where: string, message: string): never {
  throw new Error(`Invalid autoskills config ${file} (${where}): ${message}`);
}

type ConfiguredRegistry = RegistrySource;

function validManifest(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..");
}

function parseConfig(input: unknown, file: string): Record<string, ConfiguredRegistry> {
  if (!isRecord(input)) invalid(file, "root", "expected a JSON object");
  const unknownRoot = Object.keys(input).find((key) => key !== "version" && key !== "registries");
  if (unknownRoot) invalid(file, unknownRoot, "unknown field; expected version and registries");
  if (input.version !== 1) invalid(file, "version", "expected version 1");
  if (!isRecord(input.registries)) invalid(file, "registries", "expected an object keyed by registry name");
  const registries: Record<string, ConfiguredRegistry> = {};
  for (const [name, raw] of Object.entries(input.registries)) {
    const where = `registries.${name}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) invalid(file, where, "use letters, numbers, '.', '_' or '-' in registry names");
    if (!isRecord(raw)) invalid(file, where, "expected an object with directory or repository");
    const keys = Object.keys(raw);
    const unknown = keys.find((key) => key !== "directory" && key !== "repository" && key !== "manifest");
    if (unknown) invalid(file, `${where}.${unknown}`, "unknown field; use directory, repository or manifest");
    if (Object.hasOwn(raw, "directory") === Object.hasOwn(raw, "repository")) {
      invalid(file, where, "provide exactly one source: directory or repository");
    }
    if (Object.hasOwn(raw, "manifest") && !validManifest(raw.manifest)) {
      invalid(file, `${where}.manifest`, "expected a relative catalog file path without parent traversal");
    }
    if (Object.hasOwn(raw, "directory")) {
      if (typeof raw.directory !== "string" || raw.directory.trim() === "" || raw.directory.includes("\0")) invalid(file, `${where}.directory`, "expected a non-empty directory path");
      registries[name] = { type: "local", directory: raw.directory, ...(raw.manifest ? { manifest: raw.manifest as string } : {}) };
    } else {
      if (typeof raw.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.repository) || raw.repository.split("/").some((part) => part === "." || part === "..")) {
        invalid(file, `${where}.repository`, "expected a GitHub owner/repository name, such as 'acme/skills'");
      }
      registries[name] = { type: "github", repository: raw.repository, manifest: (raw.manifest as string | undefined) ?? "catalog.json" };
    }
  }
  return registries;
}

function readConfig(file: string): Record<string, RegistrySource> {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    invalid(file, "JSON", `could not parse file: ${(error as Error).message}`);
  }
  const registries = parseConfig(parsed, file);
  return Object.fromEntries(Object.entries(registries).map(([name, source]) => [
    name,
    source.type === "local"
      ? { ...source, directory: resolve(dirname(file), source.directory) }
      : source,
  ]));
}

/** Resolve user defaults and project overrides for one repository. */
export function resolveRegistryConfig(
  projectDir: string,
  options: { homeDir?: string; configHome?: string } = {},
): ResolvedRegistryConfig {
  const homeDir = options.homeDir ?? homedir();
  const configHome = options.configHome ?? process.env.XDG_CONFIG_HOME ?? join(homeDir, ".config");
  const userFile = join(isAbsolute(configHome) ? configHome : resolve(homeDir, configHome), "autoskills", "config.json");
  const projectFile = join(resolve(projectDir), "autoskills.json");
  const registries = { ...readConfig(userFile), ...readConfig(projectFile) };
  return { version: 1, includeBuiltIn: true, registries };
}
