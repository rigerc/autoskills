import { join } from "node:path";
import { readDetectionFile, stripComments } from "./detection-files.ts";

type ReadFile = (name: string) => string | null;
const quoted = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

// Extract a balanced literal without evaluating it. Quoted brackets are ignored.
function balanced(text: string, start: number, open: string, close: string): string | null {
  const masked = text.replace(quoted, (value) => " ".repeat(value.length));
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    if (masked[i] === open) depth++;
    if (masked[i] === close && --depth === 0) return text.slice(start + 1, i);
  }
  return null;
}

function literalStrings(text: string): string[] {
  // Only top-level literal list items. Ignore inline tables such as include-group.
  const values: string[] = [];
  let depth = 0;
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}[\]()]/g)) {
    if (/^["']/.test(token[0])) {
      if (depth === 0) values.push(token[0].slice(1, -1));
    } else if (/[{[(]/.test(token[0])) depth++;
    else depth--;
  }
  return values;
}

export function pythonPackageNames(read: ReadFile): string[] {
  const names = new Set<string>();
  const add = (spec: string) => {
    const match = spec.trim().match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?=\s|\[|[<>=!~;@]|$)/);
    if (match) names.add(normalizePythonName(match[1]));
  };
  const requirements = stripComments(read("requirements.txt") ?? "", "hash");
  for (const line of requirements.split(/\r?\n/)) {
    if (!line.trim().startsWith("-")) add(line);
  }

  for (const file of ["pyproject.toml", "Pipfile"]) {
    const content = stripComments(read(file) ?? "", "hash");
    // Restrict parsing to dependency sections, never descriptions or tool prose.
    const sections = [...content.matchAll(/^\s*\[([^\]\r\n]+)\][ \t]*$/gm)];
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i][1];
      const body = content.slice(sections[i].index! + sections[i][0].length, sections[i + 1]?.index ?? content.length);
      if (["project", "project.optional-dependencies", "dependency-groups", "tool.pdm.dev-dependencies"].includes(section)) {
        for (const match of body.matchAll(/^\s*([\w.-]+|"[^"\n]+"|'[^'\n]+')\s*=\s*\[/gm)) {
          if (section === "project" && match[1] !== "dependencies") continue;
          const list = balanced(body, match.index! + match[0].lastIndexOf("["), "[", "]");
          if (list !== null) literalStrings(list).forEach(add);
        }
      } else if (["packages", "dev-packages", "tool.poetry.dependencies", "tool.poetry.dev-dependencies"].includes(section) || /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)) {
        for (const match of body.matchAll(/^\s*["']?([\w.-]+)["']?\s*=/gm)) {
          if (match[1] !== "python") add(match[1]);
        }
      }
    }
  }

  let section = "";
  let inDependencies = false;
  for (const raw of (read("setup.cfg") ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1];
      inDependencies = false;
      continue;
    }
    const assignment = raw.match(/^([^\s=][^=]*?)\s*=\s*(.*)$/);
    if (assignment) {
      inDependencies = (section === "options" && assignment[1].trim() === "install_requires") || section === "options.extras_require";
      if (inDependencies) add(assignment[2]);
    } else if (inDependencies && /^\s/.test(raw)) add(line);
  }

  const setup = stripComments(read("setup.py") ?? "", "hash");
  const setupCode = stripComments(setup, "hash", true);
  for (const call of setupCode.matchAll(/\bsetup\s*\(/g)) {
    const body = balanced(setup, call.index! + call[0].lastIndexOf("("), "(", ")");
    if (body === null) continue;
    const code = stripComments(body, "hash", true);
    for (const match of code.matchAll(/\binstall_requires\s*=\s*\[/g)) {
      const list = balanced(body, match.index! + match[0].lastIndexOf("["), "[", "]");
      if (list !== null && /^\s*(?:(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,?\s*)*$/.test(list)) literalStrings(list).forEach(add);
    }
    for (const match of code.matchAll(/\bextras_require\s*=\s*\{/g)) {
      const extras = balanced(body, match.index! + match[0].lastIndexOf("{"), "{", "}");
      if (extras === null) continue;
      for (const entry of extras.matchAll(/["'][^"']+["']\s*:\s*\[/g)) {
        const list = balanced(extras, entry.index! + entry[0].lastIndexOf("["), "[", "]");
        if (list !== null) literalStrings(list).forEach(add);
      }
    }
  }
  return [...names];
}

export function readPythonPackageNames(dir: string): string[] {
  return pythonPackageNames((file) => readDetectionFile(join(dir, file)));
}

export function composerPackageNames(read: ReadFile): string[] {
  try {
    const manifest = JSON.parse(read("composer.json") ?? "null");
    return ["require", "require-dev"].flatMap((key) => {
      const deps = manifest?.[key];
      return deps && typeof deps === "object" && !Array.isArray(deps) ? Object.keys(deps) : [];
    });
  } catch {
    return [];
  }
}

export function goModuleNames(read: ReadFile): string[] {
  const modules: string[] = [];
  let inRequire = false;
  for (const raw of (read("go.mod") ?? "").split(/\r?\n/)) {
    if (/\/\/\s*indirect\b/.test(raw)) continue;
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) { inRequire = true; continue; }
    if (line === ")") { inRequire = false; continue; }
    const spec = inRequire ? line : line.match(/^require\s+(.+)$/)?.[1];
    const match = spec?.match(/^"?([^\s"]+)"?\s+v\S+$/);
    if (match) modules.push(match[1]);
  }
  return modules;
}

export function cargoPackageNames(read: ReadFile): string[] {
  const names = new Set<string>();
  const content = stripComments(read("Cargo.toml") ?? "", "hash");
  const sections = [...content.matchAll(/^\s*\[(.+)\][ \t]*$/gm)];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i][1];
    // Workspace definitions alone do not mean a member actually uses the crate.
    if (section.startsWith("workspace.")) continue;
    const dep = section.match(/^(?:target\..+\.)?(?:dependencies|dev-dependencies|build-dependencies)(?:\.([\w-]+))?$/);
    if (!dep) continue;
    const body = content.slice(sections[i].index! + sections[i][0].length, sections[i + 1]?.index ?? content.length);
    if (dep[1]) {
      names.add(body.match(/^\s*package\s*=\s*["']([^"']+)["']/m)?.[1] ?? dep[1]);
      continue;
    }
    for (const entry of body.matchAll(/^\s*["']?([\w-]+)["']?\s*=\s*(.+)$/gm)) {
      let value = entry[2];
      if (value.startsWith("{")) {
        const inline = balanced(body, entry.index! + entry[0].indexOf("{"), "{", "}");
        if (inline === null) continue;
        value = inline;
      } else if (!/^["'][^"']+["']\s*$/.test(value)) continue;
      names.add(value.match(/\bpackage\s*=\s*["']([^"']+)["']/)?.[1] ?? entry[1]);
    }
  }
  return [...names];
}

export function mixPackageNames(read: ReadFile): string[] {
  const source = stripComments(read("mix.exs") ?? "", "hash");
  const code = stripComments(source, "hash", true);
  const names: string[] = [];
  // Recognize the conventional literal deps function, never evaluate Mix code.
  for (const match of code.matchAll(/\bdefp?\s+deps\s*(?:\(\))?\s*,?\s*do\s*:?\s*\[/g)) {
    const list = balanced(source, match.index! + match[0].lastIndexOf("["), "[", "]");
    if (list === null) continue;
    const masked = stripComments(list, "hash", true);
    for (const dep of masked.matchAll(/\{\s*:([a-zA-Z_][\w]*)\s*,/g)) names.push(dep[1]);
  }
  return names;
}
