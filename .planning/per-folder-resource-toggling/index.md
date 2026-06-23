# Conceptualize Index: Per-Folder Resource Toggling (Skills + Extensions)

Workspace: `.planning/per-folder-resource-toggling/`

## Summary
- Goal: declaratively enable/disable globally-installed **skills** and **extensions** per folder/project, without uninstalling or relocating them.
- Plugins (plugin-manager-managed) are now **out of scope** per user decision; FR-3, OQ-6, and the plugin parts of FR-4/NFR-1 are dropped.
- Implementation is expected to be a Pi extension using `resources_discover`, `before_agent_start`, and `ctx.isProjectTrusted()`.

## Current Direction
- A single Pi extension provides a **slash-command TUI** to toggle skills/extensions on/off per folder. State is **auto-persisted** per folder (no manual editing). The extension applies the persisted toggles at the relevant lifecycle hooks, honoring project trust.
- This supersedes REQUIREMENTS.md §7's hand-edited declarative-config direction and the user-facing allow/deny model of FR-5/FR-6 (the underlying per-folder persistence and trust requirements still hold).

## Slices
- `slices/resource-type-asymmetry.md` — captures the core technical constraint: skills, extensions differ sharply in how (and whether) they can be toggled at runtime.

## Durable Shared Understanding
- Scope is skills + extensions only. Plugins excluded (user decision, 2026-06-23).
- Toggling controls activation only, never installation (FR-4, NFR-1).
- Applies only in trusted projects (FR-7, NFR-2).
- Absence of config preserves current global behavior (FR-8).

## Research and Source References
- `resources_discover` returns only `{ skillPaths, promptPaths, themePaths }` — additive; no documented suppression/removal return. Source: docs/extensions.md (Resource Events).
- Extensions are NOT in the `resources_discover` return shape; they load from fixed locations + `settings.json` and cannot be runtime-unloaded by another extension. Source: docs/extensions.md (Extension Locations, Resource Events).
- `before_agent_start` exposes `systemPromptOptions.skills` and `selectedTools`; `pi.setActiveTools()` can enable/disable tools at runtime. Source: docs/extensions.md (before_agent_start, registerTool).
- `CONFIG_DIR_NAME` should be used instead of hardcoding `.pi`. Source: docs/extensions.md (ctx.cwd).

## Open Questions
- None. All open questions resolved or eliminated.

## Resolved Decisions
- OQ-4 RESOLVED: disabled skill must be fully inert on both surfaces (system prompt + `/skill:name` command). See SKILLS-DISABLE-SURFACES-001.
- OQ-2 RESOLVED (dissolved): no user-facing allowlist/denylist; TUI tracks on/off. See UX-MODEL-001.
- Priority RESOLVED: skills primary, extensions best-effort. See PRIORITY-001.
- UX RESOLVED: slash-command TUI is the only authoring path; auto-persisted per folder; manual editing is a non-goal. See UX-MODEL-001.
- OQ-3 RESOLVED (eliminated): project-root single file, no nesting, so no parent/child precedence. See PERSIST-001.
- PERSIST RESOLVED: single file at project-root under CONFIG_DIR_NAME, trusted-projects-only, graceful fallback. See PERSIST-001.
- TUI-EXT-LISTING RESOLVED: honest best-effort listing; event-only extensions hidden/greyed-out. See TUI-EXT-LISTING-001.
- OQ-5 RESOLVED: CLI flags (`--no-skills`, `--skill`) win over per-folder toggles, mirroring Pi's own `--skill` > `--no-skills` rule. Both flags verified real (docs/usage.md, docs/skills.md). See CLI-PRECEDENCE-001.
- OQ-1 RESOLVED (eliminated): config location settled by PERSIST-001 (project-root single file under CONFIG_DIR_NAME; no user-level glob mapping).

## Planning Handoff
- Treat skills and extensions as having different toggling mechanisms; do not assume a single uniform suppression path works for both.
- The hardest requirement is per-folder extension disabling (FR-2): runtime unload is not supported; plan around suppressing the extension's registered tools/commands and/or scoping discovery rather than unloading.
