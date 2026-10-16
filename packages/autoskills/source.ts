import { createHash } from "node:crypto";
import { parseSkillPath } from "./lib.ts";

export interface SourceOptions {
  fetchImpl?: typeof fetch;
  onTrace?: (message: string) => void;
  // Shared only for one install/update operation, so later runs always check upstream again.
  repoTrees?: Map<string, Promise<SourceTree>>;
}

export interface TreeFile {
  path: string;
  type: string;
  mode: string;
  sha: string;
}

export interface SourceTree {
  commitSha: string;
  files: TreeFile[];
}

export interface SourceSkill {
  source: string;
  name: string;
  skillPath: string;
  commitSha: string;
  sourceHash: string;
  files: { path: string; sha: string; executable: boolean }[];
}

export function safeSourcePath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function bundleHash(files: { path: string; content: Buffer }[]): string {
  return hash(
    files
      .map(({ path, content }) => `${path}:${hash(content)}`)
      .sort()
      .join("\n"),
  );
}

export async function sourceFetch(url: string, opts: SourceOptions): Promise<Response> {
  opts.onTrace?.(`GET ${url}`);
  const headers: Record<string, string> = { "User-Agent": "autoskills" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await (opts.fetchImpl || fetch)(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    if (
      (res.status === 403 || res.status === 429) &&
      res.headers.get("x-ratelimit-remaining") === "0"
    ) {
      throw new Error(
        "GitHub rate limit exceeded. Set GITHUB_TOKEN or GH_TOKEN to increase the limit.",
      );
    }
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${url}`);
  }
  return res;
}

export async function fetchSourceTree(repo: string, opts: SourceOptions): Promise<SourceTree> {
  const head = await sourceFetch(`https://api.github.com/repos/${repo}/commits/HEAD`, opts);
  const { sha } = (await head.json()) as { sha: string };
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error(`invalid HEAD for ${repo}`);
  const res = await sourceFetch(
    `https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,
    opts,
  );
  const body = (await res.json()) as { truncated?: boolean; tree: TreeFile[] };
  if (body.truncated)
    throw new Error(`GitHub tree truncated for ${repo}; cannot resolve skills safely`);
  if (!Array.isArray(body.tree)) throw new Error(`invalid GitHub tree for ${repo}`);
  return { commitSha: sha, files: body.tree };
}

export async function resolveSourceSkill(
  skill: string,
  opts: SourceOptions = {},
  preferredPath?: string,
): Promise<SourceSkill> {
  const { repo, skillName } = parseSkillPath(skill);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !safeSourcePath(skillName)) {
    throw new Error(`invalid skill path: ${skill}`);
  }
  const name = skillName.split("/").at(-1)!;
  if (name.startsWith(".")) throw new Error(`invalid skill name: ${name}`);
  let pending = opts.repoTrees?.get(repo);
  if (!pending) {
    pending = fetchSourceTree(repo, opts);
    opts.repoTrees?.set(repo, pending);
  }
  const tree = await pending;
  const dirs = tree.files
    .filter(
      (file) =>
        file.type === "blob" && file.mode !== "120000" && /(^|\/)SKILL\.md$/.test(file.path),
    )
    .map((file) => (file.path === "SKILL.md" ? "" : file.path.slice(0, -"/SKILL.md".length)));
  const candidates = dirs.filter(
    (dir) =>
      dir === skillName ||
      dir.endsWith(`/${skillName}`) ||
      dir === `${skillName}/skills` ||
      dir.endsWith(`/${skillName}/skills`),
  );
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  const skillPath =
    preferredPath !== undefined && dirs.includes(preferredPath)
      ? preferredPath
      : (candidates[0] ?? (dirs.includes("") ? "" : undefined));
  if (skillPath === undefined) throw new Error(`skill '${skillName}' not found in ${repo}`);
  const prefix = skillPath ? `${skillPath}/` : "";
  const files = tree.files
    .filter(
      (file) => file.type === "blob" && file.mode !== "120000" && file.path.startsWith(prefix),
    )
    .map((file) => ({
      path: file.path.slice(prefix.length),
      sha: file.sha,
      executable: file.mode === "100755",
    }))
    .filter(
      (file) =>
        !file.path.split("/").some((part) => [".git", "node_modules"].includes(part)) &&
        !file.path.toLowerCase().endsWith(".zip"),
    );
  for (const file of files) {
    if (!safeSourcePath(file.path) || !/^[a-f0-9]{40}$/i.test(file.sha)) {
      throw new Error(`invalid source file: ${file.path}`);
    }
  }
  return {
    source: repo,
    name,
    skillPath,
    commitSha: tree.commitSha,
    files,
    sourceHash: hash(
      files
        .map((file) => `${file.path}:${file.sha}:${file.executable}`)
        .sort()
        .join("\n"),
    ),
  };
}

// Bound raw downloads across concurrently installed skills.
let active = 0;
const waiters: (() => void)[] = [];
async function downloadSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active < 16) active++;
  else await new Promise<void>((resolve) => waiters.push(resolve));
  try {
    return await task();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}

export async function downloadSourceSkill(source: SourceSkill, opts: SourceOptions = {}) {
  return Promise.all(
    source.files.map((file) =>
      downloadSlot(async () => {
        const repoPath = [source.skillPath, file.path].filter(Boolean).join("/");
        const url = `https://raw.githubusercontent.com/${source.source}/${source.commitSha}/${repoPath.split("/").map(encodeURIComponent).join("/")}`;
        const res = await sourceFetch(url, opts);
        const content = Buffer.from(await res.arrayBuffer());
        const blobSha = createHash("sha1")
          .update(`blob ${content.length}\0`)
          .update(content)
          .digest("hex");
        if (blobSha !== file.sha) throw new Error(`source hash mismatch for ${file.path}`);
        return { ...file, content };
      }),
    ),
  );
}
