# Requirements: Per-Folder / Per-Project Resource Toggling for Pi

## Document Status

| Field | Value |
|-------|-------|
| Author | khaising |
| Created | 2026-06-23 |
| Status | Draft |
| Component | pi-extension-manager |

## 1. Summary

Provide a mechanism to **enable or disable individual Pi resources — skills, extensions, and plugins (managed by the Claude Code plugin manager extension) — on a per-folder or per-project basis**.

Today these resources behave largely as global on/off: a globally-installed skill, extension, or plugin is offered in every project/folder. There is no native per-folder allowlist/denylist for individual globally-installed resources. This requirement asks for selective activation scoped to the current working directory (and its project/repo tree).

## 2. Problem Statement

- Skills and extensions installed globally (`~/.pi/agent/skills/`, `~/.agents/skills/`, `~/.pi/agent/extensions/`) load in **every** project.
- Project-local placement (`.pi/skills/`, `.agents/skills/`, `.pi/extensions/`) scopes resources to a folder tree, but only after the project is trusted, and it requires physically moving/copying resources.
- Plugins managed by the plugin manager extension (stored under `~/.pi/agent/claude-plugin-manager`) are likewise enabled globally; `/plugin enable` / `/plugin disable` is not folder-aware.
- `--no-skills` plus repeated `--skill <path>` allows per-invocation control, but this is manual and not persisted per folder.
- There is no single declarative way to say "in folder/project X, enable resources A and B but disable C".

## 3. Goal

Allow a user to declaratively control, **per folder or per project**, which of the following are active:

1. **Skills** (global and project-local)
2. **Extensions** (global and project-local)
3. **Plugins** managed by the plugin manager extension

…while keeping the resources installed globally (no need to uninstall or physically move them).

## 4. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | The user can define a per-folder/per-project configuration that lists which skills are enabled or disabled for that folder (and its descendants up to the project/repo root). |
| FR-2 | The user can define the same enable/disable control for extensions on a per-folder/per-project basis. |
| FR-3 | The user can define the same enable/disable control for plugin-manager-managed plugins on a per-folder/per-project basis. |
| FR-4 | Globally-installed resources remain installed; the per-folder configuration only controls activation, not installation. |
| FR-5 | Configuration is declarative and stored within the project (e.g. a file under `.pi/`), so it can be version-controlled and shared with collaborators. |
| FR-6 | The configuration supports both allowlist (enable only these) and denylist (disable these) semantics, or an equivalent expressive model. |
| FR-7 | Resolution honors project trust: per-project config is only applied for trusted projects. |
| FR-8 | When no per-folder configuration is present, behavior is unchanged (current global behavior is the default). |
| FR-9 | Changes to the configuration take effect on `/reload` (and on session start) without requiring reinstallation. |

## 5. Non-Functional / Constraints

| ID | Constraint |
|----|-----------|
| NFR-1 | Must not require uninstalling or relocating globally-installed resources. |
| NFR-2 | Must respect Pi's project-trust model; untrusted folders must not silently gain or change behavior. |
| NFR-3 | Should integrate with existing Pi mechanisms (skill/extension discovery, `resources_discover`, `before_agent_start`) rather than forking core behavior. |
| NFR-4 | Should degrade gracefully: an invalid or partial config should warn, not crash the session. |

## 6. Background: Current Pi Behavior (Reference)

### Skill load locations
- Global: `~/.pi/agent/skills/`, `~/.agents/skills/`
- Project (after trust): `.pi/skills/`, `.agents/skills/` in cwd and ancestors up to git root
- Per-invocation: `--skill <path>` (additive even with `--no-skills`)
- Disable discovery: `--no-skills`

### Extension load locations
- Global: `~/.pi/agent/extensions/*.ts`, `~/.pi/agent/extensions/*/index.ts`
- Project-local (after trust): `.pi/extensions/*.ts`, `.pi/extensions/*/index.ts`
- Additional paths via `settings.json` (`extensions`, `packages`)

### Plugin manager
- Plugins and marketplaces stored under `~/.pi/agent/claude-plugin-manager`
- `/plugin enable` / `/plugin disable` exist but are global, not folder-aware
- Adapter currently loads Claude plugin skills and command markdown; hooks, MCP servers, LSP servers, monitors, and plugin settings are not yet imported

## 7. Proposed Direction (Non-Binding)

A Pi **extension** that:

1. On `resources_discover` / `session_start`, reads a project-local config file (e.g. `.pi/resource-toggles.json`) from the cwd/project tree.
2. Contributes additional skill/extension paths for enabled resources and suppresses disabled ones.
3. For plugins, coordinates with the plugin manager extension to scope enable/disable to the current folder/project.
4. Applies only when `ctx.isProjectTrusted()` is true.

### Example config sketch (illustrative only)

```json
{
  "skills": {
    "mode": "denylist",
    "disable": ["caveman", "grill-me"],
    "enable": []
  },
  "extensions": {
    "mode": "allowlist",
    "enable": ["my-project-extension"]
  },
  "plugins": {
    "disable": ["super-developer@super-developer-marketplace"]
  }
}
```

## 8. Open Questions

| ID | Question |
|----|----------|
| OQ-1 | Should configuration live in `.pi/` only, or also support a user-level mapping of folder globs → toggles? |
| OQ-2 | Allowlist vs denylist as the default model, or support both per resource type (as sketched)? |
| OQ-3 | How should conflicts resolve when a parent folder and a child folder both define toggles? |
| OQ-4 | Should disabling a skill also hide its `/skill:name` command, or only remove it from the system prompt? |
| OQ-5 | What is the desired interaction with `--no-skills` / `--skill` CLI flags (override order)? |
| OQ-6 | For plugins, should the toggle integrate with `/plugin enable|disable`, or operate as a separate folder-scoped layer? |

## 9. Acceptance Criteria

- [ ] A documented config format exists for per-folder/per-project resource toggling.
- [ ] Skills can be enabled/disabled per folder without uninstalling them.
- [ ] Extensions can be enabled/disabled per folder without uninstalling them.
- [ ] Plugin-manager plugins can be enabled/disabled per folder without uninstalling them.
- [ ] Toggles apply only in trusted projects.
- [ ] Absence of config preserves current global behavior.
- [ ] Config changes take effect on `/reload`.
