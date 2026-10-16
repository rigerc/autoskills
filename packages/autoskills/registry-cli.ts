import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { dim, green, log } from "./colors.ts";
import { readScopedRegistries, registryConfigFile, resolveRegistryConfig, validateRegistrySource, writeScopedRegistries, type RegistryScope, type RegistrySource } from "./config.ts";
import { loadRegistrySource } from "./registry.ts";

function sourceLabel(source: RegistrySource): string {
  return source.type === "local" ? source.directory : `${source.repository}:${source.manifest}`;
}
function localPath(input: string, projectDir: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return isAbsolute(input) ? input : resolve(projectDir, input);
}
function parseSource(input: string, projectDir: string, manifest?: string): RegistrySource {
  const directory = localPath(input, projectDir);
  if (existsSync(directory) || input.startsWith(".") || input.startsWith("~") || isAbsolute(input)) {
    return { type: "local", directory, ...(manifest ? { manifest } : {}) };
  }
  return { type: "github", repository: input, manifest: manifest ?? "catalog.json" };
}

/** Handle `autoskills registry` management commands. */
export async function runRegistryCommand(args: string[], projectDir: string): Promise<void> {
  const [action, ...rest] = args;
  const scope: RegistryScope = rest.includes("--global") ? "global" : "project";
  const positional = rest.filter((arg, index) => arg !== "--global" && arg !== "--path" && rest[index - 1] !== "--path");
  const pathIndex = rest.indexOf("--path");
  const manifest = pathIndex === -1 ? undefined : rest[pathIndex + 1];
  if (pathIndex !== -1 && (!manifest || manifest.startsWith("--"))) throw new Error("registry --path requires a relative manifest path");
  if (!action || !["add", "list", "remove", "refresh"].includes(action)) {
    throw new Error("usage: autoskills registry <add|list|remove|refresh> [name] [source] [--path manifest] [--global]");
  }
  if (action !== "add" && pathIndex !== -1) throw new Error("--path is only valid with registry add");
  if (action === "add") {
    if (positional.length !== 2) throw new Error("usage: autoskills registry add <name> <directory|owner/repo> [--path manifest] [--global]");
    const [name, input] = positional;
    const source = parseSource(input, projectDir, manifest);
    validateRegistrySource(name, source);
    const entries = readScopedRegistries(projectDir, scope);
    if (Object.hasOwn(entries, name)) throw new Error(`registry ${name} already exists in ${scope} config`);
    // Validate the catalog and source before mutating a config file.
    const loaded = await loadRegistrySource(name, source, { refresh: true });
    const file = writeScopedRegistries(projectDir, scope, { ...entries, [name]: source });
    log(green(`   Added registry ${name} (${loaded.skills.length} skills) to ${file}`));
    return;
  }
  if (action === "list") {
    if (positional.length) throw new Error("usage: autoskills registry list [--global]");
    const entries = scope === "global" ? readScopedRegistries(projectDir, scope) : resolveRegistryConfig(projectDir).registries;
    const names = Object.keys(entries).sort();
    if (!names.length) { log(dim("   No registries configured.")); return; }
    for (const name of names) log(`   ${name}  ${sourceLabel(entries[name])}`);
    return;
  }
  if (action === "remove") {
    if (positional.length !== 1) throw new Error("usage: autoskills registry remove <name> [--global]");
    const [name] = positional;
    const entries = readScopedRegistries(projectDir, scope);
    if (!Object.hasOwn(entries, name)) throw new Error(`registry ${name} not found in ${registryConfigFile(projectDir, scope)}`);
    delete entries[name];
    const file = writeScopedRegistries(projectDir, scope, entries);
    log(green(`   Removed registry ${name} from ${file}`));
    return;
  }
  if (positional.length > 1) throw new Error("usage: autoskills registry refresh [name] [--global]");
  const entries = scope === "global" ? readScopedRegistries(projectDir, scope) : resolveRegistryConfig(projectDir).registries;
  const names = positional.length ? positional : Object.keys(entries).sort();
  for (const name of names) {
    const source = entries[name];
    if (!source) throw new Error(`registry ${name} is not configured`);
    const loaded = await loadRegistrySource(name, source, { refresh: true });
    log(green(`   Refreshed ${name}: ${loaded.skills.length} skills${loaded.revision ? ` at ${loaded.revision.slice(0, 7)}` : ""}`));
  }
}
