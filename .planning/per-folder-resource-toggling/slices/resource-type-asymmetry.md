# Slice: Resource-Type Toggling Asymmetry (Skills vs Extensions)

## Purpose
- Capture the central technical constraint shaping the whole concept: skills and extensions differ sharply in how they can be enabled/disabled at runtime by a Pi extension. A uniform "toggle" abstraction cannot assume identical mechanisms.

## Shared Understanding

### SCOPE-001 — Skills and extensions only; plugins excluded
The concept covers per-folder/per-project toggling of (1) skills and (2) extensions only. Plugin-manager-managed plugins are explicitly out of scope per user decision (2026-06-23). This drops requirements FR-3 and OQ-6 entirely, and removes the plugin clauses from FR-4/NFR-1. Future agents must not reintroduce plugin toggling into this concept without a new user decision.

### UX-MODEL-001 — Interaction is a slash-command TUI; auto-persisted per folder; no allow/deny model
User decision (2026-06-23) — this supersedes the REQUIREMENTS.md §7 hand-edited-config direction and FR-5/FR-6's user-facing allow/deny semantics:
- A **slash command** opens an interactive **TUI** that lists the available skills and extensions for the current folder and lets the user toggle each on/off.
- The extension **auto-persists** toggle state to a per-folder backend config. The user never hand-edits the file.
- **TUI is the only authoring path.** Manual file editing is a NON-GOAL (file format is an internal implementation detail, not a documented user surface).
- **Allowlist vs denylist is no longer a user-facing concept** (resolves OQ-2). The TUI tracks on/off per resource; internal storage representation is an implementation detail.
- TUI requires `ctx.mode === "tui"`; guard accordingly. Behavior in non-TUI modes (print/json/rpc) for the command must degrade gracefully (e.g. no-op or informative message), per NFR-4.

Implementation-shaping notes: register the command via `pi.registerCommand`; build the interactive list via `ctx.ui.custom()` (TUI-only) or `ctx.ui.select` with multi-select if sufficient. Persisted toggles are applied at `resources_discover` (skill enable paths), `before_agent_start` (skill system-prompt filtering), the `input` stage (`/skill:name` blocking), and `pi.setActiveTools()` (best-effort extension tool suppression) — see SKILLS-DISABLE-SURFACES-001, EXT-TOGGLE-001, PRIORITY-001. Changes take effect on `/reload` and session start (FR-9).

### SKILLS-TOGGLE-001 — Skill enable is additive via resources_discover; disable needs a separate path
Enabling additional skill paths is straightforward: an extension returns `skillPaths` from `resources_discover`. However, `resources_discover` is purely **additive** — its return shape is `{ skillPaths, promptPaths, themePaths }` with no documented way to remove/suppress an already-discovered skill. Therefore a skill **denylist** cannot be implemented through `resources_discover` alone. Suppression requires acting on the two surfaces described in SKILLS-DISABLE-SURFACES-001. Verification must confirm a disabled global skill no longer appears in the system prompt for the target folder.

### SKILLS-DISABLE-SURFACES-001 — Disabled skill must be fully inert (both surfaces)
User decision (2026-06-23), resolving OQ-4: a disabled skill must be turned off on BOTH independent surfaces in the target trusted folder:
1. **System prompt** — the skill's name/description must be removed so the model will not autonomously use it. Mechanism: filter `systemPromptOptions.skills` in `before_agent_start`.
2. **`/skill:name` command** — the manual invocation must also be disabled/blocked so the user cannot expand a disabled skill. The `/skill:name` expansion happens at the `input` event stage (before `before_agent_start`), so suppression must also intercept there (e.g. handle/block the `input` event for a disabled `/skill:<name>`), not only in `before_agent_start`.

Rationale: a half-disabled skill (model ignores it but user can still manually invoke it) breaks the "this skill is off here" mental model. Non-goal: partial/system-prompt-only disabling is explicitly rejected.

Edge case for planning: the two surfaces fire at different lifecycle stages (`input` vs `before_agent_start`), so a single filter point is insufficient — both must be covered for a skill to be truly inert.

### EXT-TOGGLE-001 — Extension disable cannot rely on runtime unload
Extensions are NOT part of the `resources_discover` return shape; they load from fixed locations (`~/.pi/agent/extensions/`, `.pi/extensions/`) plus `settings.json` (`extensions`, `packages`). Once loaded, one extension cannot un-load another at runtime. Consequently, true per-folder "disable an extension" by preventing its load is not achievable from within a sibling extension at session runtime. Achievable semantics are likely limited to: suppressing the tools/commands a target extension registered (e.g. via `pi.setActiveTools()` for tools), and/or influencing project-local discovery. This makes FR-2 the hardest requirement and an open design question (see Questions).

### PRIORITY-001 — Skills are the priority; extension toggling is best-effort
User decision (2026-06-23): skill toggling is the primary, must-work capability. Extension toggling is explicitly **best-effort** — limited to suppressing the tools/commands a target extension registered (e.g. via `pi.setActiveTools()`), with no requirement to prevent extension load. Design, planning, and verification effort should prioritize robust per-folder skill enable/disable. Extension toggling must degrade gracefully and must never block or destabilize the skill path. A future agent should not invest in unsupported runtime-unload approaches for extensions to satisfy FR-2; best-effort tool/command suppression is the accepted ceiling unless the user revisits this.

### PERSIST-001 — Project-root single file under CONFIG_DIR_NAME; trusted projects only
User decision (2026-06-23): toggle state is anchored at the **project root** in a **single file**, resolved via `CONFIG_DIR_NAME` (not hardcoded `.pi`), e.g. `<project-root>/<CONFIG_DIR_NAME>/resource-toggles.json`. Toggles apply repo-wide for that project.
- **Eliminates OQ-3**: no nested per-folder files means no parent/child precedence problem. Nested per-subfolder toggles are a NON-GOAL for this iteration (may be revisited later; not designed-for now per user choice of the simple option).
- **Trust gating (FR-7, NFR-2)**: the file is read and applied only when `ctx.isProjectTrusted()` is true. Untrusted projects behave as if no config exists.
- **Default behavior (FR-8)**: absence of the file = current global behavior, unchanged.
- **Graceful degradation (NFR-4)**: invalid/partial file should warn (via `ctx.ui.notify`) and fall back to global behavior, never crash the session.
- **Reload (FR-9)**: changes take effect on `/reload` and session start; the file is re-read at `resources_discover`/`session_start`.
- Format is internal (TUI-authored). A simple JSON object keyed by resource type and resource id with on/off state is sufficient; exact schema is an implementation detail to be finalized in planning, but it must round-trip what the TUI writes and reads.

### TUI-EXT-LISTING-001 — Honest best-effort extension presentation
User decision (2026-06-23): the TUI presents extensions honestly given the best-effort constraint (PRIORITY-001, EXT-TOGGLE-001):
- **Skills** are listed fully; toggling off makes them fully inert (SKILLS-DISABLE-SURFACES-001).
- **Extensions that register suppressible surfaces** (LLM-callable tools and/or commands) are listed as toggleable, with a clear label that this is **best-effort: disables the extension's tools/commands, does not unload the extension**.
- **Extensions with nothing suppressible** (event-only / rendering-only — no registered tools or commands) are **hidden or shown greyed-out / non-toggleable** with a short explanation, so the UI never implies an action that would do nothing.

Rationale: prevents a misleading UI where toggling an event-only extension appears to work but has no effect. Edge cases for planning: an extension may register commands but no tools (or vice versa) — it is still suppressible and listed; determine suppressibility by inspecting what the extension registered (tools via the tool registry / `pi.setActiveTools()` surface, commands via the command registry). Verification: an event-only extension must not appear as an actionable toggle; a tool/command-registering extension toggled off must have those tools/commands suppressed in the target folder.

### CLI-PRECEDENCE-001 — CLI skill flags win over per-folder toggles
User decision (2026-06-23), resolving OQ-5. Verified against Pi docs: `--skill <path>` (repeatable, additive even with `--no-skills`) and `--no-skills` (disables discovery; explicit `--skill` paths still load) are real out-of-the-box flags (docs/usage.md:219-220, docs/skills.md:34,41). Pi already treats explicit `--skill` as overriding `--no-skills`.

Per-folder toggles compose with these flags as follows — **CLI flags are explicit per-invocation overrides and win**:
1. `--no-skills` present → no skills load for that invocation; per-folder "enable" toggles do NOT re-add them.
2. `--skill <path>` present → that skill is force-active for the invocation, even if a per-folder toggle would disable it (mirrors Pi's existing `--skill` > `--no-skills` rule).
3. No conflicting flag → per-folder toggles apply normally.

Mental model: "what you type on the command line now beats what you saved in the folder earlier." Edge case for planning: when `--skill <path>` force-activates a folder-disabled skill, the disable logic (system-prompt filter in `before_agent_start` and `/skill:name` blocking at the `input` stage, per SKILLS-DISABLE-SURFACES-001) must detect the explicit flag and stand down for that skill, so the two suppression points do not re-suppress a force-activated skill. Verification: a folder-disabled skill passed via `--skill` must be present in the system prompt and invokable; with `--no-skills`, a folder-enabled skill must not appear.

## Source References
- `docs/extensions.md` (Resource Events / resources_discover) — return shape is additive `{ skillPaths, promptPaths, themePaths }`; no suppression return.
- `docs/extensions.md` (Extension Locations) — extensions load from fixed dirs + settings.json; project-local load only after trust.
- `docs/extensions.md` (before_agent_start) — exposes `systemPromptOptions.skills` and `selectedTools`; `pi.setActiveTools()` toggles tools at runtime.
- `docs/usage.md` (lines 219-220) — `--skill <path>` (repeatable) and `--no-skills` are real CLI flags.
- `docs/skills.md` (lines 34, 41) — `--skill` is additive even with `--no-skills`; explicit `--skill` paths still load under `--no-skills`.

## Non-Goals / Deferred Scope
- Plugin (plugin-manager) toggling — excluded by user decision.
- Uninstalling or physically relocating resources — excluded (FR-4, NFR-1).

## Acceptance / Verification Expectations
- A disabled global skill does not appear in the system prompt AND its `/skill:name` command is blocked/hidden in the target trusted folder (both surfaces mandatory, per SKILLS-DISABLE-SURFACES-001).
- An enabled additional skill path is discoverable in the target folder.
- The chosen extension-disable semantics are explicitly documented and verified against what Pi actually permits at runtime (no reliance on unsupported runtime unload); event-only extensions are not actionable toggles (TUI-EXT-LISTING-001).
- CLI flag precedence holds: `--skill` force-activates a folder-disabled skill; `--no-skills` suppresses folder-enabled skills (CLI-PRECEDENCE-001).
- Absence of config preserves current global behavior; invalid config warns and falls back without crashing (PERSIST-001).

## Questions to Resolve Before Planning
- None.
