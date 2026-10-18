import { describe, it } from "node:test";
import { ok } from "node:assert/strict";
import { detectTechnologies, SKILLS_MAP } from "../lib.ts";
import { useTmpDir, writeFile, writePackageJson } from "./helpers.ts";

function detectedIds(dir: string): string[] {
  return detectTechnologies(dir).detected.map((tech) => tech.id);
}

describe("additional ecosystem detection", () => {
  const tmp = useTmpDir();

  const packageCases: Array<[string, string]> = [
    ["preact", "preact"],
    ["lit", "lit"],
    ["qwik", "@builder.io/qwik"],
    ["sveltekit", "@sveltejs/kit"],
    ["tanstack-form", "@tanstack/react-form"],
    ["tanstack-table", "@tanstack/react-table"],
    ["unocss", "unocss"],
    ["chakra-ui", "@chakra-ui/react"],
    ["fastify", "fastify"],
    ["adonisjs", "@adonisjs/core"],
    ["authjs", "next-auth"],
    ["grpc", "@grpc/grpc-js"],
    ["pulumi", "@pulumi/pulumi"],
    ["sst", "sst"],
    ["capacitor", "@capacitor/core"],
    ["postgres", "pg"],
    ["mysql", "mysql2"],
    ["duckdb", "duckdb"],
    ["polars", "nodejs-polars"],
    ["clickhouse", "@clickhouse/client"],
    ["qdrant", "@qdrant/js-client-rest"],
    ["bullmq", "bullmq"],
    ["temporal", "@temporalio/client"],
    ["inngest", "inngest"],
    ["trigger-dev", "@trigger.dev/sdk"],
    ["langgraph", "@langchain/langgraph"],
    ["openai-agents", "@openai/agents"],
    ["mastra", "@mastra/core"],
    ["llamaindex", "llamaindex"],
    ["opentelemetry", "@opentelemetry/api"],
    ["langfuse", "langfuse"],
    ["msw", "msw"],
  ];

  for (const [id, name] of packageCases) {
    it(`detects ${id} from JS package ${name}`, () => {
      writePackageJson(tmp.path, { dependencies: { [name]: "1.0.0" } });
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  const pythonCases: Array<[string, string]> = [
    ["grpc", "grpcio"],
    ["pulumi", "pulumi"],
    ["google-cloud", "google-cloud-storage"],
    ["postgres", "psycopg"],
    ["mysql", "pymysql"],
    ["duckdb", "duckdb"],
    ["polars", "polars"],
    ["clickhouse", "clickhouse-connect"],
    ["qdrant", "qdrant-client"],
    ["temporal", "temporalio"],
    ["langgraph", "langgraph"],
    ["pydantic-ai", "pydantic-ai"],
    ["openai-agents", "openai-agents"],
    ["llamaindex", "llama-index"],
    ["litellm", "litellm"],
    ["opentelemetry", "opentelemetry-api"],
    ["langfuse", "langfuse"],
  ];

  for (const [id, name] of pythonCases) {
    it(`detects ${id} from declared Python dependency ${name}`, () => {
      writeFile(tmp.path, "requirements.txt", `${name}>=1\n`);
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  const fileCases: Array<[string, string]> = [
    ["unocss", "uno.config.ts"],
    ["adonisjs", "adonisrc.ts"],
    ["deno", "deno.json"],
    ["pulumi", "Pulumi.yaml"],
    ["sst", "sst.config.ts"],
    ["gitlab-ci", ".gitlab-ci.yml"],
    ["capacitor", "capacitor.config.ts"],
  ];

  for (const [id, file] of fileCases) {
    it(`detects ${id} from project file ${file}`, () => {
      writeFile(tmp.path, file, "");
      ok(detectedIds(tmp.path).includes(id));
    });
  }

  it("detects Google Cloud from a scoped JS SDK package", () => {
    writePackageJson(tmp.path, { dependencies: { "@google-cloud/storage": "1.0.0" } });
    ok(detectedIds(tmp.path).includes("google-cloud"));
  });

  it("does not detect Google Cloud from a similarly named package", () => {
    writePackageJson(tmp.path, { dependencies: { "mock-google-cloud-storage": "1.0.0" } });
    ok(!detectedIds(tmp.path).includes("google-cloud"));
  });

  it("does not treat a general GitLab folder as GitLab CI", () => {
    writeFile(tmp.path, ".gitlab/CODEOWNERS", "* @maintainers");
    ok(!detectedIds(tmp.path).includes("gitlab-ci"));
  });

  it("does not infer AI frameworks from a Python project description", () => {
    writeFile(tmp.path, "pyproject.toml", [
      "[project]",
      'description = "uses langgraph, litellm, and pydantic-ai"',
      'dependencies = ["unrelated-framework>=1"]',
    ].join("\n"));
    const ids = detectedIds(tmp.path);
    for (const id of ["langgraph", "litellm", "pydantic-ai"]) {
      ok(!ids.includes(id), `unexpected ${id}`);
    }
  });

  it("detects a cross-ecosystem project without duplicate IDs", () => {
    writePackageJson(tmp.path, { dependencies: { fastify: "1", bullmq: "1", "@openai/agents": "1" } });
    writeFile(tmp.path, "Pulumi.yaml", "name: example");
    const ids = detectedIds(tmp.path);
    for (const id of ["fastify", "bullmq", "openai-agents", "pulumi"]) {
      ok(ids.includes(id), `missing ${id}`);
    }
    ok(ids.length === new Set(ids).size);
  });

  it("keeps all new technology entries detection-only pending skill vetting", () => {
    const addedIds = [
          "preact",
          "lit",
          "qwik",
          "sveltekit",
          "tanstack-form",
          "tanstack-table",
          "unocss",
          "chakra-ui",
          "fastify",
          "adonisjs",
          "authjs",
          "grpc",
          "deno",
          "pulumi",
          "sst",
          "gitlab-ci",
          "google-cloud",
          "capacitor",
          "postgres",
          "mysql",
          "duckdb",
          "polars",
          "clickhouse",
          "qdrant",
          "bullmq",
          "temporal",
          "inngest",
          "trigger-dev",
          "langgraph",
          "pydantic-ai",
          "openai-agents",
          "mastra",
          "llamaindex",
          "litellm",
          "opentelemetry",
          "langfuse",
          "msw"
    ];
    for (const id of addedIds) {
      const tech = SKILLS_MAP.find((entry) => entry.id === id);
      ok(tech, `missing ${id}`);
      ok(tech.skills.length === 0, `unexpected unverified skill for ${id}`);
    }
  });
});
