import { createHash } from "node:crypto";

export const COMMIT = "a".repeat(40);
export const NEXT_COMMIT = "b".repeat(40);

export function blobHash(content: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
}

export function sourceFixture(files: Record<string, string>, commit = COMMIT) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url === "https://api.github.com/repos/owner/repo/commits/HEAD") {
      return Response.json({ sha: commit });
    }
    if (url === `https://api.github.com/repos/owner/repo/git/trees/${commit}?recursive=1`) {
      return Response.json({
        tree: Object.entries(files).map(([path, content]) => ({
          path,
          type: "blob",
          mode: path.endsWith(".sh") ? "100755" : "100644",
          sha: blobHash(content),
        })),
      });
    }
    const prefix = `https://raw.githubusercontent.com/owner/repo/${commit}/`;
    const path = decodeURIComponent(url.slice(prefix.length));
    if (url.startsWith(prefix) && path in files) return new Response(files[path]);
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { requests, fetchImpl };
}
