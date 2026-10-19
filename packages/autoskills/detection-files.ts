import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SCAN_SKIP_DIRS = new Set([
  "node_modules", ".git", "vendor", ".next", "dist", "build", ".output", ".nuxt",
  ".svelte-kit", "__pycache__", ".cache", "coverage", ".turbo", ".terraform",
  "var", "bin", "obj", ".vs", "target", "deps", "_build", "venv", ".venv",
]);

// One lazy index per project/workspace, shared by all extension and source rules.
// Do not follow symlinks, hidden directories, or generated dependency trees.
export function scanProjectFiles(projectDir: string): string[] {
  const files: string[] = [];
  let entriesSeen = 0;
  function scan(dir: string, depth: number): void {
    if (entriesSeen >= 20_000) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++entriesSeen > 20_000) break;
      const path = join(dir, entry.name);
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory() && depth < 4 && !entry.name.startsWith(".") && !SCAN_SKIP_DIRS.has(entry.name)) {
        scan(path, depth + 1);
      }
    }
  }
  scan(projectDir, 0);
  return files;
}

export function readDetectionFile(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 256 * 1024) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// Preserve line boundaries and quoted content while ignoring comments. Source
// rules may also mask strings, so an example embedded in a string is not code.
export function stripComments(content: string, style: "code" | "hash" | "xml", maskStrings = false): string {
  const blank = (text: string) => text.replace(/[^\r\n]/g, " ");
  if (style === "xml") return content.replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
  const tokens = /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|@"(?:""|[^"])*"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`[^`]*`|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|#[^\r\n]*/g;
  return content.replace(tokens, (token) => {
    if (style === "hash" ? token.startsWith("#") : token.startsWith("//") || token.startsWith("/*")) return blank(token);
    const quoted = /^["'`@]/.test(token);
    return maskStrings && quoted ? blank(token) : token;
  });
}
