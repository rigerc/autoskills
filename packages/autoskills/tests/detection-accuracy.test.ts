import { describe, it } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_MAP, COMBO_SKILLS_MAP, detectTechnologies, collectSkills, readPythonPackageNames } from "../lib.ts";
import { useTmpDir, writeFile, writeJson, writePackageJson, addWorkspace } from "./helpers.ts";

describe("specific framework evidence", () => {
  const tmp = useTmpDir();
  const ids = () => detectTechnologies(tmp.path).detected.map((t) => t.id);

  it("distinguishes a Swift package from a SwiftUI app", () => {
    writeFile(tmp.path, "Package.swift", "import PackageDescription");
    writeFile(tmp.path, "Podfile", "platform :ios, '16.0'");
    ok(ids().includes("swift"));
    ok(!ids().includes("swiftui"));
    writeFile(tmp.path, "Sources/UI/ContentView.swift", "import SwiftUI\n");
    ok(ids().includes("swiftui"));
  });

  it("ignores commented and quoted SwiftUI examples", () => {
    writeFile(tmp.path, "View.swift", '/*\nimport SwiftUI\n*/\nlet example = """\nimport SwiftUI\n"""');
    ok(!ids().includes("swiftui"));
  });

  it("detects Minimal API source without relying on OpenAPI", () => {
    writeFile(tmp.path, "src/Api/Program.cs", 'var app = WebApplication.Create(args);\napp.MapGet("/", () => "ok");');
    ok(ids().includes("aspnet-minimal-api"));
  });

  it("does not classify controllers, strings, or comments as Minimal API", () => {
    writeFile(tmp.path, "Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web" />');
    writeFile(tmp.path, "Program.cs", 'var builder = WebApplication.CreateBuilder(args);\napp.MapControllers();\n// app.MapGet("/", () => "ok");\nvar docs = "app.MapPost()";');
    ok(ids().includes("aspnetcore"));
    ok(!ids().includes("aspnet-minimal-api"));
  });

  it("distinguishes F# from C# and ignores XML comments", () => {
    writeFile(tmp.path, "App.fsproj", '<Project Sdk="Microsoft.NET.Sdk">\n<!-- <Project Sdk="Microsoft.NET.Sdk.Web"> -->\n</Project>');
    ok(ids().includes("dotnet"));
    ok(!ids().includes("csharp"));
    ok(!ids().includes("aspnetcore"));
  });

  it("recognizes framework references and single quoted Web SDKs", () => {
    writeFile(tmp.path, "App.csproj", "<Project Sdk='Microsoft.NET.Sdk.Web' />");
    ok(ids().includes("aspnetcore"));
    writeFile(tmp.path, "App.csproj", '<Project><FrameworkReference Include="Microsoft.AspNetCore.App" /></Project>');
    ok(ids().includes("aspnetcore"));
  });

  it("finds Spring Boot in declared nested Gradle modules", () => {
    writeFile(tmp.path, "settings.gradle.kts", 'include(":services:api")');
    writeFile(tmp.path, "services/api/build.gradle.kts", 'plugins { id("org.springframework.boot") }');
    ok(ids().includes("springboot"));
  });

  it("ignores commented Spring Boot declarations", () => {
    writeFile(tmp.path, "build.gradle", "// id 'org.springframework.boot'\n/* implementation 'org.springframework.boot:spring-boot-starter' */");
    writeFile(tmp.path, "pom.xml", "<project><!-- <groupId>org.springframework.boot</groupId> --></project>");
    ok(!ids().includes("springboot"));
  });

  it("separates CMake from the project's source language", () => {
    writeFile(tmp.path, "CMakeLists.txt", "project(example LANGUAGES C)");
    writeFile(tmp.path, "src/main.c", "int main() {}");
    ok(ids().includes("cmake"));
    ok(!ids().includes("cpp"));
    writeFile(tmp.path, "include/widget.hpp", "class Widget {};");
    ok(ids().includes("cpp"));
  });

  it("accepts React Router's DOM dependency", () => {
    writePackageJson(tmp.path, { dependencies: { "react-router-dom": "7.0.0" } });
    ok(ids().includes("react-router"));
  });

  it("does not infer Home Assistant from prose or commented configuration", () => {
    writeFile(tmp.path, "config.yaml", 'description: "hassio_api: true"\n# homeassistant_api: true');
    ok(!ids().includes("home-assistant"));
  });
});

describe("declared Python dependencies", () => {
  const tmp = useTmpDir();

  it("reads static setup.cfg requirements and extras", () => {
    writeFile(tmp.path, "setup.cfg", '[metadata]\ndescription = flask\n[options]\ninstall_requires =\n    FastAPI[standard]>=0.100\n    SQLAlchemy>=2\n[options.extras_require]\ntest =\n    pytest>=8\n');
    deepStrictEqual(readPythonPackageNames(tmp.path).sort(), ["fastapi", "pytest", "sqlalchemy"]);
  });

  it("reads literal setup.py requirements without executing it", () => {
    writeFile(tmp.path, "setup.py", 'raise RuntimeError("never run me")\nsetup(name="flask", install_requires=["FastAPI[standard]>=0.100", "pydantic>=2"], extras_require={"test": ["pytest>=8"]})');
    deepStrictEqual(readPythonPackageNames(tmp.path).sort(), ["fastapi", "pydantic", "pytest"]);
  });

  it("ignores dynamic requirements, comments, and dependency-like prose", () => {
    writeFile(tmp.path, "setup.py", '# setup(install_requires=["flask"])\ndoc = "setup(install_requires=[\'django\'])"\nsetup(install_requires=load_requirements())');
    writeFile(tmp.path, "pyproject.toml", '[project]\ndescription = "fastapi django requests"\ndependencies = ["not-fastapi", "requests-mock", "pydantic-ai"]');
    const ids = detectTechnologies(tmp.path).detected.map((t) => t.id);
    for (const id of ["fastapi", "django", "requests", "flask", "pydantic"]) ok(!ids.includes(id), id);
  });

  it("normalizes names and ignores dependency group references", () => {
    writeFile(tmp.path, "pyproject.toml", '[dependency-groups]\ntest = [{include-group = "pytest"}, "sentry__SDK>=2", "scikit_learn>=1"]\n[project.optional-dependencies]\n"web.test" = ["Flask>=3"]');
    deepStrictEqual(readPythonPackageNames(tmp.path).sort(), ["flask", "scikit-learn", "sentry-sdk"]);
  });

  it("ignores incomplete dependency arrays and requirements options", () => {
    writeFile(tmp.path, "pyproject.toml", '[project]\ndependencies = ["flask"');
    writeFile(tmp.path, "requirements.txt", '# django\n-r requirements-dev.txt\n--index-url https://example.com/fastapi\nrequests-mock>=1');
    deepStrictEqual(readPythonPackageNames(tmp.path), ["requests-mock"]);
  });
});

describe("additional manifest ecosystems", () => {
  const tmp = useTmpDir();
  const ids = () => detectTechnologies(tmp.path).detected.map((t) => t.id);

  it("detects Symfony and Stripe only from Composer requirements", () => {
    writeJson(tmp.path, "composer.json", { require: { "symfony/framework-bundle": "7.0.0", "stripe/stripe-php": "16.0.0" } });
    ok(ids().includes("symfony"));
    ok(ids().includes("stripe"));
    writeJson(tmp.path, "composer.json", { description: "symfony/framework-bundle", require: { "symfony/console": "7.0.0" } });
    ok(!ids().includes("symfony"));
    writeFile(tmp.path, "composer.json", "invalid JSON");
    ok(!ids().includes("symfony"));
  });

  it("reads Go require blocks and direct declarations", () => {
    for (const declaration of ["require github.com/gin-gonic/gin v1.10.0", "require (\n github.com/gin-gonic/gin v1.10.0\n)"]) {
      writeFile(tmp.path, "go.mod", `module example.com/demo\n${declaration}`);
      ok(ids().includes("gin"));
    }
  });

  it("does not infer Gin from replacements, indirect deps, comments, or go.sum", () => {
    writeFile(tmp.path, "go.mod", 'module github.com/gin-gonic/gin\n// require github.com/gin-gonic/gin v1.0.0\nrequire github.com/gin-gonic/gin v1.0.0 // indirect\nreplace github.com/gin-gonic/gin => ../gin');
    writeFile(tmp.path, "go.sum", "github.com/gin-gonic/gin v1.0.0 hash");
    ok(!ids().includes("gin"));
  });

  it("reads Cargo dependencies, targets, and renamed crates", () => {
    for (const manifest of ['[dependencies]\naxum = "0.8"', '[dependencies.web]\npackage = "axum"\nversion = "0.8"', '[target.\'cfg(unix)\'.dependencies]\nweb = { version = "0.8", package = "axum" }']) {
      writeFile(tmp.path, "Cargo.toml", manifest);
      ok(ids().includes("axum"));
    }
  });

  it("does not confuse Cargo aliases, metadata, or unused workspace dependencies", () => {
    writeFile(tmp.path, "Cargo.toml", '[package]\nname="axum"\n[dependencies]\naxum = { package = "unrelated", version = "1" }\n[workspace.dependencies]\naxum = "0.8"');
    ok(!ids().includes("axum"));
  });

  it("detects Phoenix from conventional literal Mix dependencies", () => {
    writeFile(tmp.path, "mix.exs", 'defmodule Demo.MixProject do\n defp deps do\n [{:phoenix, "1.7.0"}, {:jason, "1.4.0"}]\n end\nend');
    ok(ids().includes("phoenix"));
    writeFile(tmp.path, "mix.exs", '# {:phoenix, "1.7.0"}\ndefp deps, do: [{:phoenix_live_view, "1.0.0"}]');
    ok(!ids().includes("phoenix"));
  });

  it("expands cross-language services without substring matches", () => {
    writeFile(tmp.path, "requirements.txt", "boto3>=1\nazure-identity>=1\nstripe>=1\nsupabase>=1\nelevenlabs>=1");
    for (const id of ["aws", "azure", "stripe", "supabase", "elevenlabs"]) ok(ids().includes(id), id);
    writeFile(tmp.path, "requirements.txt", "not-boto3\nnot-azure-identity\nstripe-helper");
    for (const id of ["aws", "azure", "stripe"]) ok(!ids().includes(id), id);
  });

  it("preserves both PostgreSQL IDs and deduplicates repeated workspace signals", () => {
    writePackageJson(tmp.path, { workspaces: ["apps/*"], dependencies: { pg: "8.0.0" } });
    addWorkspace(tmp.path, "apps/api", { dependencies: { pg: "8.0.0" } });
    writeFile(tmp.path, "Gemfile", 'gem "pg"');
    const found = ids().filter((id) => id.startsWith("postgres"));
    deepStrictEqual(found.sort(), ["postgres", "postgres-ruby"]);
  });
});

describe("bounded scanning and workspace behavior", () => {
  const tmp = useTmpDir();
  const ids = () => detectTechnologies(tmp.path).detected.map((t) => t.id);

  it("ignores hidden, generated, dependency, deep, and symlinked source trees", () => {
    for (const dir of ["node_modules", "target", "vendor", "deps", "_build", "venv", ".hidden", "a/b/c/d/e"]) {
      writeFile(tmp.path, `${dir}/View.swift`, "import SwiftUI");
    }
    symlinkSync(join(tmp.path, "target"), join(tmp.path, "linked"), "dir");
    ok(!ids().includes("swiftui"));
    ok(!ids().includes("swift"));
  });

  it("ignores oversized content and sees file changes between detections", () => {
    writeFile(tmp.path, "View.swift", "import SwiftUI\n" + " ".repeat(256 * 1024));
    ok(!ids().includes("swiftui"));
    writeFile(tmp.path, "View.swift", "import SwiftUI");
    ok(ids().includes("swiftui"));
    rmSync(join(tmp.path, "View.swift"));
    ok(!ids().includes("swiftui"));
  });

  it("finds new ecosystems in workspaces and retains union-based combos", () => {
    writePackageJson(tmp.path, { workspaces: ["apps/*"] });
    addWorkspace(tmp.path, "apps/ui", { dependencies: { react: "19.0.0", ink: "6.0.0" } });
    addWorkspace(tmp.path, "apps/api", { dependencies: { zustand: "5.0.0" } });
    writeFile(tmp.path, "apps/api/composer.json", '{"require":{"symfony/framework-bundle":"7.0.0"}}');
    const result = detectTechnologies(tmp.path);
    ok(result.detected.some((t) => t.id === "symfony"));
    ok(result.detected.some((t) => t.id === "ink"));
    ok(result.combos.some((c) => c.id === "react-zustand"));
    const skills = collectSkills(result);
    strictEqual(skills.length, new Set(skills.map((s) => s.skill)).size);
  });
});

describe("catalog invariants", () => {
  it("has unique IDs, valid references, and distinct skill and detection signals", () => {
    const ids = new Set(SKILLS_MAP.map((t) => t.id));
    strictEqual(ids.size, SKILLS_MAP.length);
    strictEqual(new Set(COMBO_SKILLS_MAP.map((c) => c.id)).size, COMBO_SKILLS_MAP.length);
    const unique = (items: unknown[], label: string) => strictEqual(new Set(items.map(String)).size, items.length, label);
    for (const tech of SKILLS_MAP) {
      ok(Object.keys(tech.detect).length > 0, tech.id);
      for (const [key, value] of Object.entries(tech.detect)) {
        if (key === "configFileContent") {
          for (const block of Array.isArray(value) ? value : [value]) {
            ok(block.patterns.length > 0, tech.id);
            ok(block.files?.length || block.sourceExtensions?.length || block.scanGradleLayout || block.scanDotNetLayout, tech.id);
            unique(block.patterns, tech.id);
          }
        } else {
          ok(Array.isArray(value) && value.length > 0, `${tech.id}:${key}`);
          unique(value, `${tech.id}:${key}`);
        }
      }
    }
    for (const combo of COMBO_SKILLS_MAP) {
      ok(combo.requires.length >= 2, combo.id);
      unique(combo.requires, combo.id);
      for (const id of combo.requires) ok(ids.has(id), `${combo.id}:${id}`);
    }
    for (const entry of [...SKILLS_MAP, ...COMBO_SKILLS_MAP]) {
      unique(entry.skills, entry.id);
      for (const path of entry.skills) ok(/^[\w.-]+\/[\w.-]+\/[\w./-]+$/.test(path), path);
    }
  });
});
