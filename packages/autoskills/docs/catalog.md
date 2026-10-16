# User skill catalog (version 1)

A user registry may contain a `catalog.json` manifest with this JSON format. The same format applies to a manifest on disk and one stored in a GitHub repository. It describes skill sources and recommendation rules; it is separate from `skills-registry/index.json`, which records bundled review and integrity metadata.

```json
{
  "version": 1,
  "skills": [
    {
      "id": "team-style",
      "description": "Our team's writing conventions",
      "path": "./skills/team-style",
      "technologies": ["react", "nextjs"]
    },
    {
      "id": "code-review",
      "description": "Review project changes",
      "repository": "acme/agent-skills",
      "directory": "skills/code-review",
      "always": true
    },
    {
      "id": "migration-helper",
      "description": "Run only when explicitly selected",
      "path": "skills/migration-helper"
    }
  ]
}
```

| Field | Requirement | Meaning |
| --- | --- | --- |
| `version` | Required, integer `1` | Catalog format version. Other versions are rejected. |
| `skills` | Required array | Skill entries, with IDs unique within this manifest. |
| `id` | Required string | Lowercase letters, numbers, `.`, `_`, or `-`; starts with a letter or number. |
| `description` | Required nonempty string | Text shown to people selecting a skill. |
| `path` | One source option | Skill directory relative to the manifest file's directory. For a local manifest this is a disk path; for a GitHub manifest it is a path in that repository. Use `"."` for the manifest directory itself. |
| `repository` and `directory` | Other source option | GitHub `owner/repository` and the **exact** directory containing `SKILL.md`. Use `"."` for the repository root. |
| `technologies` | Optional string array | Recommend when **any** listed technology ID is detected. IDs must already exist in `SKILLS_MAP` (`skills-map.ts`). An empty array matches no technology. |
| `always` | Optional boolean | When `true`, recommend in every project, even when no technology is detected. |

Each entry needs exactly one source option: `path`, or both `repository` and `directory`. Paths must be relative and may start with `./`; absolute paths, parent traversal, backslashes, and empty segments are invalid. A registry loader must confirm that a local directory stays within the registry and contains `SKILL.md` before installing it. Any GitHub directory must be used exactly when resolving the skill; a similarly named directory elsewhere is not a substitute.

Entries without `always: true` or a matching technology stay available for explicit selection. They do not enter the automatic recommendation set. `always: true` takes precedence when `technologies` is also present.

The parser rejects unknown fields, duplicate IDs, unknown technology IDs, malformed sources, and unsupported versions with an error naming the offending field. This format has no custom detection rules or arbitrary HTTP sources. Registry configuration, loading, selection in the CLI and desk, and installation are covered by the follow-on registry tasks.
