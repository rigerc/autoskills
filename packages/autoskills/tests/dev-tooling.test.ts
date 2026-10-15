import { describe, it } from "node:test";
import { ok } from "node:assert/strict";
import { detectTechnologies, SKILLS_MAP } from "../lib.ts";
import { useTmpDir, writeFile, writePackageJson } from "./helpers.ts";

function detectedIds(dir: string): string[] {
  return detectTechnologies(dir).detected.map((tech) => tech.id);
}

describe("developer tooling technology detection", () => {
  const tmp = useTmpDir();

  const fileSignals: Array<[string, string]> = [
    ["just", "justfile"],
    ["just", "Justfile"],
    ["just", ".justfile"],
    ["taskfile", "Taskfile.yml"],
    ["taskfile", "Taskfile.yaml"],
    ["taskfile", "taskfile.yaml"],
    ["taskfile", "Taskfile.dist.yml"],
    ["taskfile", "taskfile.dist.yml"],
    ["make", "Makefile"],
    ["make", "GNUmakefile"],
    ["mise", "mise.toml"],
    ["mise", ".mise.toml"],
    ["mise", ".config/mise/config.toml"],
    ["direnv", ".envrc"],
    ["pre-commit", ".pre-commit-config.yaml"],
    ["lefthook", "lefthook.yml"],
    ["lefthook", ".lefthook.yaml"],
    ["lefthook", ".config/lefthook.json"],
    ["husky", ".husky/pre-commit"],
    ["lint-staged", "lint-staged.config.mjs"],
    ["changesets", ".changeset/config.json"],
    ["semantic-release", ".releaserc.json"],
    ["commitlint", "commitlint.config.ts"],
    ["renovate", "renovate.json5"],
    ["renovate", ".github/renovate.json"],
    ["dependabot", ".github/dependabot.yml"],
    ["nx", "nx.json"],
    ["moonrepo", ".moon/workspace.yml"],
    ["prettier", ".prettierrc.json"],
    ["tsup", "tsup.config.ts"],
    ["tsdown", "tsdown.config.ts"],
    ["rolldown", "rolldown.config.js"],
    ["webpack", "webpack.config.mjs"],
    ["rspack", "rspack.config.ts"],
    ["uv", "uv.lock"],
    ["poetry", "poetry.lock"],
    ["ruff", "ruff.toml"],
    ["bazel", "MODULE.bazel"],
    ["bazel", ".bazelrc"],
  ];

  for (const [id, path] of fileSignals) {
    it(`detects ${id} from ${path}`, () => {
      writeFile(tmp.path, path, "");
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  const packageSignals: Array<[string, string]> = [
    ["viteplus", "vite-plus"],
    ["lefthook", "lefthook"],
    ["husky", "husky"],
    ["lint-staged", "lint-staged"],
    ["changesets", "@changesets/cli"],
    ["semantic-release", "semantic-release"],
    ["commitlint", "@commitlint/cli"],
    ["renovate", "renovate"],
    ["nx", "@nx/js"],
    ["nx", "@nrwl/workspace"],
    ["moonrepo", "@moonrepo/cli"],
    ["prettier", "prettier"],
    ["tsup", "tsup"],
    ["tsdown", "tsdown"],
    ["rolldown", "rolldown"],
    ["esbuild", "esbuild"],
    ["webpack", "webpack"],
    ["rspack", "@rspack/core"],
  ];

  for (const [id, name] of packageSignals) {
    it(`detects ${id} from ${name}`, () => {
      writePackageJson(tmp.path, { devDependencies: { [name]: "1.0.0" } });
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  it("detects Vite+ imports in the shared Vite configuration", () => {
    writeFile(
      tmp.path,
      "vite.config.ts",
      "import { defineConfig } from 'vite-plus';\nexport default defineConfig({});\n",
    );
    ok(detectedIds(tmp.path).includes("viteplus"));
    ok(detectedIds(tmp.path).includes("vite"));
  });

  it("does not mistake a normal Vite config for Vite+", () => {
    writeFile(
      tmp.path,
      "vite.config.ts",
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    );
    ok(detectedIds(tmp.path).includes("vite"));
    ok(!detectedIds(tmp.path).includes("viteplus"));
  });

  it("does not detect mise from an asdf .tool-versions file alone", () => {
    writeFile(tmp.path, ".tool-versions", "nodejs 22.0.0\n");
    ok(!detectedIds(tmp.path).includes("mise"));
  });

  it("does not treat any .github directory as Renovate or Dependabot", () => {
    writeFile(tmp.path, ".github/CODEOWNERS", "* @maintainers\n");
    const ids = detectedIds(tmp.path);
    ok(!ids.includes("renovate"));
    ok(!ids.includes("dependabot"));
  });

  it("detects uv, Poetry and Ruff from pyproject.toml sections", () => {
    writeFile(
      tmp.path,
      "pyproject.toml",
      '[tool.uv]\npackage = true\n[tool.poetry]\nname = "demo"\n[tool.ruff]\nline-length = 100\n',
    );
    const ids = detectedIds(tmp.path);
    for (const id of ["uv", "poetry", "ruff"]) {
      ok(ids.includes(id), `expected ${id}`);
    }
  });

  it("detects pre-commit and Ruff from declared Python dependencies", () => {
    writeFile(tmp.path, "requirements.txt", "pre-commit>=4\nruff>=0.13\n");
    const ids = detectedIds(tmp.path);
    ok(ids.includes("pre-commit"));
    ok(ids.includes("ruff"));
  });

  it("does not confuse generic Python prose with Ruff configuration", () => {
    writeFile(tmp.path, "pyproject.toml", '[project]\ndescription = "using ruff"\n');
    ok(!detectedIds(tmp.path).includes("ruff"));
  });

  it("new entries use no unverified skill paths", () => {
    const additions = [
      "viteplus",
      "just",
      "taskfile",
      "make",
      "mise",
      "direnv",
      "pre-commit",
      "lefthook",
      "husky",
      "lint-staged",
      "changesets",
      "semantic-release",
      "commitlint",
      "renovate",
      "dependabot",
      "nx",
      "moonrepo",
      "prettier",
      "tsup",
      "tsdown",
      "rolldown",
      "esbuild",
      "webpack",
      "rspack",
      "uv",
      "poetry",
      "ruff",
      "bazel",
    ];
    for (const id of additions) {
      const tech = SKILLS_MAP.find((entry) => entry.id === id);
      ok(tech, `missing ${id}`);
      ok(tech.skills.length === 0, `unverified skills for ${id}`);
    }
  });
});
