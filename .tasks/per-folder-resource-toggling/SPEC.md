# Per-Folder Resource Toggling (Skills + Extensions) Specification

## Overview
Provide a single Pi extension that lets a user enable or disable globally-installed skills and extensions on a per-project basis through a slash-command TUI, with toggles auto-persisted at the project root and applied at the relevant Pi lifecycle hooks for trusted projects only.

## Conceptualize Inputs
- Index: `.planning/per-folder-resource-toggling/index.md`

## Authoritative Slices
- `.planning/per-folder-resource-toggling/slices/resource-type-asymmetry.md`

## Requirements
- REQ-1: A user can enable or disable individual skills per project; disabling makes the skill fully inert on both surfaces (system prompt and `/skill:name` invocation). (SKILLS-TOGGLE-001, SKILLS-DISABLE-SURFACES-001)
- REQ-2: A user can enable additional skill paths per project; enable is additive via `resources_discover` returning `skillPaths`. (SKILLS-TOGGLE-001)
- REQ-3: A user can toggle extensions on a best-effort basis: toggling off suppresses the tools/commands a target extension registered; runtime unload is never attempted. (EXT-TOGGLE-001, PRIORITY-001)
- REQ-4: Skill toggling is the primary, must-work capability; extension toggling is best-effort and must never block or destabilize the skill path. (PRIORITY-001)
- REQ-5: A slash command opens an interactive TUI listing the current project's skills and extensions and lets the user toggle each on/off; the extension auto-persists the resulting state. Manual file editing is a non-goal. There is no user-facing allowlist/denylist concept; the TUI tracks on/off. (UX-MODEL-001)
- REQ-6: The TUI is presented only when `ctx.mode === "tui"`; in print/json/rpc modes the command degrades gracefully (no-op or informative message). (UX-MODEL-001)
- REQ-7: The TUI lists skills fully; lists tool/command-registering extensions as toggleable with a clear best-effort label (disables tools/commands, does not unload the extension); and hides or greys-out event-only/rendering-only extensions (nothing suppressible) with a short explanation so the UI never implies a no-op action. (TUI-EXT-LISTING-001)
- REQ-8: Toggle state is persisted in a single file at the project root resolved via `CONFIG_DIR_NAME` (not hardcoded `.pi`), e.g. `<project-root>/<CONFIG_DIR_NAME>/resource-toggles.json`. Toggles apply repo-wide with no nesting and no parent/child precedence. (PERSIST-001)
- REQ-9: The config file is read and applied only when `ctx.isProjectTrusted()` is true; untrusted projects behave as if no config exists. (PERSIST-001)
- REQ-10: Absence of the config file preserves current global behavior unchanged. (PERSIST-001)
- REQ-11: An invalid or partial config file warns via `ctx.ui.notify` and falls back to global behavior without crashing the session. (PERSIST-001)
- REQ-12: Toggle changes take effect on `/reload` and at session start; the config is re-read at `resources_discover`/`session_start`. (PERSIST-001)
- REQ-13: CLI flags win over per-folder toggles: `--no-skills` means no skills load and per-folder enables do not re-add them; `--skill <path>` force-activates that skill even if folder-disabled, and the disable logic (system-prompt filter and `/skill:name` block) detects an explicit `--skill` and stands down for that skill; with no conflicting flag, per-folder toggles apply. (CLI-PRECEDENCE-001)

## Acceptance Criteria
- AC-1: A folder-disabled global skill does not appear in the system prompt AND its `/skill:name` command is blocked/hidden in the target trusted project; partial/system-prompt-only disabling is rejected. (SKILLS-DISABLE-SURFACES-001)
- AC-2: An enabled additional skill path is discoverable in the target project. (SKILLS-TOGGLE-001)
- AC-3: A tool/command-registering extension toggled off has those tools/commands suppressed in the target project, with no attempt to unload the extension; an event-only/rendering-only extension is not presented as an actionable toggle. (EXT-TOGGLE-001, PRIORITY-001, TUI-EXT-LISTING-001)
- AC-4: With `--skill <path>`, a folder-disabled skill is present in the system prompt and invokable; with `--no-skills`, a folder-enabled skill does not appear. (CLI-PRECEDENCE-001)
- AC-5: Absence of config preserves current global behavior; an invalid config warns and falls back without crashing. (PERSIST-001)
- AC-6: In non-TUI modes the toggling command degrades gracefully and the skill/extension apply paths still behave correctly. (UX-MODEL-001)

## Constraints
- C-1: Scope is skills and extensions only. Plugin-manager-managed plugins are out of scope (user decision 2026-06-23); do not reintroduce plugin toggling. (SCOPE-001)
- C-2: Toggling controls activation only, never installation; resources are never uninstalled or relocated. (SCOPE-001, REQUIREMENTS.md NFR-1)
- C-3: Skills are primary/must-work; extension toggling is best-effort, limited to suppressing registered tools/commands. Runtime extension unload is unsupported and must not be attempted. (PRIORITY-001, EXT-TOGGLE-001)
- C-4: Single project-root config file via `CONFIG_DIR_NAME`; no nested per-subfolder files and no parent/child precedence in this iteration. (PERSIST-001)
- C-5: All project-local behavior is gated on `ctx.isProjectTrusted()`. (PERSIST-001, REQUIREMENTS.md NFR-2)
- C-6: Integrate with existing Pi mechanisms (`resources_discover`, `before_agent_start`, the `input` event, `pi.setActiveTools()`); do not fork core behavior. (REQUIREMENTS.md NFR-3)
- C-7: The persisted file format is an internal implementation detail (TUI-authored, not a documented user surface) but must round-trip what the TUI reads and writes. (UX-MODEL-001, PERSIST-001)

## Work Packages
- `packages/WP1.md` — Config persistence, trust gating, and graceful degradation core
- `packages/WP2.md` — Skill enable/disable across both surfaces with CLI precedence
- `packages/WP3.md` — Best-effort extension tool/command suppression
- `packages/WP4.md` — Slash-command TUI authoring and honest resource listing

## Code References
- `examples/hello-world.mts` — existing repo TypeScript/ESM style reference (the repo is otherwise greenfield for extension code).
- `examples/README.md` — repo run/convention notes for example TypeScript.

## Out of Scope
- Plugin-manager plugin toggling — excluded by user decision 2026-06-23 (drops REQUIREMENTS.md FR-3, OQ-6, and plugin clauses of FR-4/NFR-1). (SCOPE-001)
- Uninstalling or physically relocating resources. (SCOPE-001, REQUIREMENTS.md NFR-1)
- Nested per-subfolder toggle files and parent/child precedence — deferred this iteration by user decision 2026-06-23 (eliminates REQUIREMENTS.md OQ-3). (PERSIST-001)
- User-facing allowlist/denylist model and hand-edited config — superseded by the TUI/auto-persist model; manual file editing is a non-goal (supersedes REQUIREMENTS.md §7 and FR-5/FR-6 user-facing semantics). (UX-MODEL-001)
- Preventing extension load / runtime unload of extensions — unsupported; best-effort tool/command suppression is the accepted ceiling. (EXT-TOGGLE-001, PRIORITY-001)
