import { describe, it } from "node:test";
import { deepStrictEqual, ok } from "node:assert/strict";
import { detectCombos, detectTechnologies, readPythonPackageNames } from "../lib.ts";
import { useTmpDir, writeFile, writePackageJson } from "./helpers.ts";

describe("expanded technology detection", () => {
  const tmp = useTmpDir();

  const fromPackage: Array<[string, string]> = [
    ["mongodb", "mongoose"],
    ["mongodb", "mongodb"],
    ["firebase", "firebase-admin"],
    ["convex", "convex"],
    ["redis", "ioredis"],
    ["graphql", "graphql"],
    ["trpc", "@trpc/server"],
    ["tanstack-query", "@tanstack/react-query"],
    ["zustand", "zustand"],
    ["redux", "@reduxjs/toolkit"],
    ["solid", "solid-js"],
    ["storybook", "@storybook/react"],
    ["jest", "jest"],
    ["cypress", "cypress"],
    ["eslint", "eslint"],
    ["biome", "@biomejs/biome"],
    ["anthropic-sdk", "@anthropic-ai/sdk"],
    ["openai", "openai"],
    ["langchain", "@langchain/core"],
    ["mcp-sdk", "@modelcontextprotocol/sdk"],
    ["huggingface", "@huggingface/inference"],
    ["sentry", "@sentry/nextjs"],
  ];

  for (const [id, name] of fromPackage) {
    it("detects " + id + " from " + name + " dependency", () => {
      writePackageJson(tmp.path, { dependencies: { [name]: "1.0.0" } });
      ok(detectTechnologies(tmp.path).detected.some((tech) => tech.id === id));
    });
  }

  const fromFile: Array<[string, string]> = [
    ["docker", "Dockerfile"],
    ["docker", "docker-compose.yaml"],
    ["docker", "compose.yml"],
    ["github-actions", ".github/workflows/build.yml"],
    ["kubernetes", "kustomization.yml"],
    ["helm", "Chart.yaml"],
    ["firebase", "firebase.json"],
    ["convex", "convex/schema.ts"],
    ["storybook", ".storybook/main.ts"],
    ["jest", "jest.config.mjs"],
    ["cypress", "cypress.config.ts"],
    ["eslint", "eslint.config.mjs"],
    ["biome", "biome.jsonc"],
    ["swift", "Package.swift"],
    ["elixir", "mix.exs"],
    ["cpp", "CMakeLists.txt"],
  ];

  for (const [id, file] of fromFile) {
    it("detects " + id + " from " + file, () => {
      writeFile(tmp.path, file, "");
      ok(detectTechnologies(tmp.path).detected.some((tech) => tech.id === id));
    });
  }

  it("detects Kotlin from a Kotlin Gradle plugin", () => {
    writeFile(tmp.path, "build.gradle.kts", 'plugins { kotlin("jvm") version "2.1.0" }');
    ok(detectTechnologies(tmp.path).detected.some((tech) => tech.id === "kotlin"));
  });

  it("does not classify a Java-only Kotlin-DSL Gradle build as Kotlin", () => {
    writeFile(tmp.path, "build.gradle.kts", 'plugins { id("java-library") }');
    ok(!detectTechnologies(tmp.path).detected.some((tech) => tech.id === "kotlin"));
  });

  it("detects Python SDKs from pyproject dependency lists", () => {
    writeFile(tmp.path, "pyproject.toml", [
      "[project]",
      'description = "mentions anthropic but is not a dependency"',
      "dependencies = [",
      '  "anthropic[bedrock]>=0.5",',
      '  "openai>=1.0",',
      '  "sentry-sdk>=2.0",',
      "]",
      "[project.optional-dependencies]",
      'ai = ["langchain-core>=1", "huggingface-hub>=0.1", "mcp>=1"]',
    ].join("\n"));
    const ids = detectTechnologies(tmp.path).detected.map((tech) => tech.id);
    for (const id of ["anthropic-sdk", "openai", "sentry", "langchain", "huggingface", "mcp-sdk"]) {
      ok(ids.includes(id), "expected " + id);
    }
  });

  it("detects Python packages in requirements.txt, Poetry and Pipfile", () => {
    writeFile(tmp.path, "requirements.txt", "# anthropic\npymongo>=4\nredis>=5\n");
    writeFile(tmp.path, "pyproject.toml", '[tool.poetry.dependencies]\npython = ">=3.11"\n"anthropic" = "^0.5"\n');
    writeFile(tmp.path, "Pipfile", '[packages]\nsentry_sdk = "*"\n');
    const ids = detectTechnologies(tmp.path).detected.map((tech) => tech.id);
    for (const id of ["mongodb", "redis", "anthropic-sdk", "sentry"]) {
      ok(ids.includes(id), "expected " + id);
    }
  });

  it("does not match unrelated packages or prose containing anthropic", () => {
    writeFile(tmp.path, "requirements.txt", "# anthropic\nother-anthropic-sdk>=1\n");
    writeFile(tmp.path, "pyproject.toml", [
      "[project]",
      'description = "Anthropic is discussed here"',
      'name = "anthropic-demo"',
      'dependencies = ["not-anthropic>=1", "anthropic-helper>=1"]',
    ].join("\n"));
    ok(!detectTechnologies(tmp.path).detected.some((tech) => tech.id === "anthropic-sdk"));
    deepStrictEqual(readPythonPackageNames(tmp.path).filter((name) => name === "anthropic"), []);
  });

  it("does not detect GitHub Actions from an unrelated .github folder", () => {
    writeFile(tmp.path, ".github/CODEOWNERS", "* @maintainers");
    ok(!detectTechnologies(tmp.path).detected.some((tech) => tech.id === "github-actions"));
  });
});

describe("expanded combo detection", () => {
  const combos: Array<[string, string[]]> = [
    ["react-tanstack-query", ["react", "tanstack-query"]],
    ["react-zustand", ["react", "zustand"]],
    ["nextjs-trpc", ["nextjs", "trpc"]],
    ["nextjs-prisma", ["nextjs", "prisma"]],
    ["nextjs-drizzle", ["nextjs", "drizzle"]],
    ["fastapi-sqlalchemy", ["fastapi", "sqlalchemy"]],
    ["django-celery", ["django", "celery"]],
    ["docker-node", ["docker", "node"]],
    ["docker-python", ["docker", "python"]],
  ];

  for (const [id, required] of combos) {
    it("requires all of the technologies for " + id, () => {
      ok(detectCombos(required).some((combo) => combo.id === id));
      for (const item of required) {
        ok(!detectCombos(required.filter((name) => name !== item)).some((combo) => combo.id === id));
      }
    });
  }

  const tmp = useTmpDir();
  it("detects Docker + Node.js in a real project", () => {
    writeFile(tmp.path, "Dockerfile", "FROM node:22");
    writeFile(tmp.path, "pnpm-lock.yaml", "");
    ok(detectTechnologies(tmp.path).combos.some((combo) => combo.id === "docker-node"));
  });
});
