import { describe, it } from "node:test";
import { ok } from "node:assert/strict";
import { detectTechnologies, SKILLS_MAP } from "../lib.ts";
import { useTmpDir, writeFile, writeJson, writePackageJson } from "./helpers.ts";

function detectedIds(dir: string): string[] {
  return detectTechnologies(dir).detected.map((tech) => tech.id);
}

describe("UI libraries, charts, editors and content detection", () => {
  const tmp = useTmpDir();

  const fromPackage: Array<[string, string]> = [
    ["preact", "preact"],
    ["preact", "preact-render-to-string"],
    ["lit", "lit"],
    ["lit", "@lit/react"],
    ["ink", "ink"],
    ["ink", "ink-select-input"],
    ["ink", "@inkjs/ui"],
    ["radix-ui", "@radix-ui/react-dialog"],
    ["radix-ui", "@radix-ui/react-slot"],
    ["recharts", "recharts"],
    ["d3", "d3"],
    ["d3", "d3-scale"],
    ["codemirror", "codemirror"],
    ["codemirror", "@codemirror/view"],
    ["monaco-editor", "monaco-editor"],
    ["monaco-editor", "@monaco-editor/react"],
    ["tanstack-table", "@tanstack/react-table"],
    ["remark", "remark-gfm"],
    ["remark", "rehype-raw"],
    ["remark", "mdast-util-to-string"],
    ["remark", "unist-util-visit"],
  ];

  for (const [id, name] of fromPackage) {
    it(`detects ${id} from ${name}`, () => {
      writePackageJson(tmp.path, { dependencies: { [name]: "1.0.0" } });
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  it("detects Recharts and D3 side by side in a dashboard", () => {
    writePackageJson(tmp.path, { dependencies: { recharts: "2.0.0", "d3-scale": "4.0.0" } });
    const ids = detectedIds(tmp.path);
    ok(ids.includes("recharts"));
    ok(ids.includes("d3"));
  });

  it("does not detect Ink, D3 or Radix UI from unrelated dependencies", () => {
    writePackageJson(tmp.path, {
      dependencies: { d3chart: "1.0.0", "linkify-it": "5.0.0", "@radixx/ui": "1.0.0" },
    });
    const ids = detectedIds(tmp.path);
    ok(!ids.includes("ink"));
    ok(!ids.includes("d3"));
    ok(!ids.includes("radix-ui"));
  });
});

describe("backend, data and AI SDK detection", () => {
  const tmp = useTmpDir();

  const fromPackage: Array<[string, string]> = [
    ["workos", "@workos-inc/authkit-react"],
    ["workos", "@workos-inc/widgets"],
    ["sqlite", "better-sqlite3"],
    ["sqlite", "@libsql/client"],
    ["google-genai", "@google/genai"],
    ["firecrawl", "@mendable/firecrawl-js"],
  ];

  for (const [id, name] of fromPackage) {
    it(`detects ${id} from ${name}`, () => {
      writePackageJson(tmp.path, { dependencies: { [name]: "1.0.0" } });
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  it("does not treat any config.json as a Home Assistant add-on", () => {
    writePackageJson(tmp.path, {});
    writeJson(tmp.path, "config.json", { name: "demo", arch: "x64", slug: "demo" });
    ok(!detectedIds(tmp.path).includes("home-assistant"));
  });

  it("does not infer Home Assistant from generic repository metadata", () => {
    writePackageJson(tmp.path, {});
    writeFile(tmp.path, "repository.yaml", "name: My add-ons\nurl: https://example.com\n");
    ok(!detectedIds(tmp.path).includes("home-assistant"));
  });

  it("detects Home Assistant from an add-on configuration with supervisor APIs", () => {
    writePackageJson(tmp.path, {});
    writeFile(tmp.path, "config.yaml", "name: Demo\nversion: 1.0.0\nhassio_api: true\n");
    ok(detectedIds(tmp.path).includes("home-assistant"));
  });

  it("detects the Python and JS AI SDK variants", () => {
    writePackageJson(tmp.path, {});
    writeFile(tmp.path, "requirements.txt", "google-genai>=1\nfirecrawl-py>=0.1\naiosqlite>=0.20\n");
    const ids = detectedIds(tmp.path);
    for (const id of ["google-genai", "firecrawl", "sqlite"]) {
      ok(ids.includes(id), `expected ${id}`);
    }
  });
});

describe("build, lint and test tooling detection", () => {
  const tmp = useTmpDir();

  const fromPackage: Array<[string, string]> = [
    ["rollup", "rollup"],
    ["rollup", "rollup-plugin-visualizer"],
    ["rollup", "@rollup/plugin-node-resolve"],
    ["babel", "@babel/core"],
    ["babel", "babel-jest"],
    ["babel", "babel-plugin-transform-remove-console"],
    ["nodemon", "nodemon"],
    ["knip", "knip"],
    ["typedoc", "typedoc"],
    ["ava", "ava"],
    ["xo", "xo"],
  ];

  for (const [id, name] of fromPackage) {
    it(`detects ${id} from ${name}`, () => {
      writePackageJson(tmp.path, { devDependencies: { [name]: "1.0.0" } });
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  it("does not treat Rollup platform binaries as a Rollup project", () => {
    writePackageJson(tmp.path, { devDependencies: { "@rollup/rollup-linux-x64-gnu": "4.0.0" } });
    ok(!detectedIds(tmp.path).includes("rollup"));
  });

  const fromFile: Array<[string, string]> = [
    ["rollup", "rollup.config.mjs"],
    ["babel", ".babelrc"],
    ["babel", "babel.config.cjs"],
    ["nodemon", "nodemon.json"],
    ["knip", "knip.json"],
    ["typedoc", "typedoc.json"],
    ["ava", "ava.config.mjs"],
  ];

  for (const [id, path] of fromFile) {
    it(`detects ${id} from ${path}`, () => {
      writePackageJson(tmp.path, {});
      writeFile(tmp.path, path, "");
      ok(detectedIds(tmp.path).includes(id));
    });
  }
});

describe("platform, shell and template detection", () => {
  const tmp = useTmpDir();

  const fromFile: Array<[string, string]> = [
    ["nix", "flake.nix"],
    ["nix", "default.nix"],
    ["nix", "modules/editor.nix"],
    ["qml", "scrollbar/scrollbar.qml"],
    ["qml", "qmldir"],
    ["vala", "src/app.vala"],
    ["meson", "meson.build"],
    ["supercollider", "synth.scd"],
    ["lua", "init.lua"],
    ["lua", "lua/plugins/telescope.lua"],
    ["haskell", "demo.cabal"],
    ["haskell", "app/Main.hs"],
    ["powershell", "scripts/build.ps1"],
    ["powershell", "modules/Helper.psm1"],
    ["fish", ".config/fish/config.fish"],
    ["fish", "functions/fzf.fish"],
    ["zsh", "scripts/setup.zsh"],
    ["batch", "build.bat"],
    ["batch", "dev.cmd"],
    ["jinja", "templates/index.html.jinja"],
    ["jinja", "templates/report.j2"],
    ["userscripts", "scripts/app.user.js"],
    ["cpp", "src/main.cpp"],
    ["cpp", "include/widget.hpp"],
  ];

  for (const [id, path] of fromFile) {
    it(`detects ${id} from ${path}`, () => {
      writePackageJson(tmp.path, {});
      writeFile(tmp.path, path, "");
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  it("detects userscripts from the Tampermonkey toolchain", () => {
    writePackageJson(tmp.path, { devDependencies: { "vite-plugin-monkey": "5.0.0" } });
    ok(detectedIds(tmp.path).includes("userscripts"));
  });

  it("detects Obsidian plugins from dev dependencies and the plugin manifest", () => {
    writePackageJson(tmp.path, { devDependencies: { obsidian: "1.5.0" } });
    ok(detectedIds(tmp.path).includes("obsidian"));

    writePackageJson(tmp.path, { devDependencies: { "obsidian-plugin-cli": "0.9.0" } });
    writeJson(tmp.path, "manifest.json", { id: "demo", minAppVersion: "1.0.0", isDesktopOnly: false });
    ok(detectedIds(tmp.path).includes("obsidian"));
  });

  it("does not mistake a Chrome extension manifest for an Obsidian plugin manifest", () => {
    writePackageJson(tmp.path, {});
    writeJson(tmp.path, "manifest.json", { manifest_version: 3, name: "demo", version: "1.0.0" });
    const ids = detectedIds(tmp.path);
    ok(ids.includes("chrome-extension"));
    ok(!ids.includes("obsidian"));
  });

  it("does not detect shell or platform techs from TypeScript sources", () => {
    writePackageJson(tmp.path, {});
    writeFile(tmp.path, "src/index.ts", "export const x = 1;\n");
    const ids = detectedIds(tmp.path);
    for (const id of ["nix", "qml", "vala", "lua", "haskell", "powershell", "fish", "batch", "jinja"]) {
      ok(!ids.includes(id), `unexpected ${id}`);
    }
  });
});

describe("new detections stay detection-only", () => {
  it("new entries use no unverified skill paths", () => {
    const additions = [
      "preact",
      "lit",
      "ink",
      "radix-ui",
      "recharts",
      "d3",
      "codemirror",
      "monaco-editor",
      "tanstack-table",
      "remark",
      "workos",
      "sqlite",
      "google-genai",
      "firecrawl",
      "ava",
      "xo",
      "rollup",
      "babel",
      "nodemon",
      "knip",
      "typedoc",
      "nix",
      "qml",
      "vala",
      "meson",
      "supercollider",
      "lua",
      "haskell",
      "powershell",
      "fish",
      "zsh",
      "batch",
      "jinja",
      "obsidian",
      "userscripts",
      "home-assistant",
    ];
    for (const id of additions) {
      const tech = SKILLS_MAP.find((entry) => entry.id === id);
      ok(tech, `missing ${id}`);
      ok(tech.skills.length === 0, `unverified skills for ${id}`);
    }
  });
});
