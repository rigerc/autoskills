import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Find immediate child directories that are Git working trees (including worktrees). */
export function findGitRepos(parentDir: string): string[] {
  return readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      try {
        const gitEntry = lstatSync(join(parentDir, entry.name, ".git"));
        return gitEntry.isDirectory() || gitEntry.isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => join(parentDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}
