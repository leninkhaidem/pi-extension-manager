# Work Package: WP2 — Skill enable/disable across both surfaces with CLI precedence

## Scope
Owns the primary, must-work skill toggling capability, applied to trusted-project toggle state from WP1.

In scope:
- Skill enable (additive): return `skillPaths` for per-project enabled skill paths from the `resources_discover` handler (return shape `{ skillPaths, promptPaths, themePaths }` is additive-only).
- Skill disable surface 1 (system prompt): in `before_agent_start`, filter `systemPromptOptions.skills` so a folder-disabled skill's name/description is removed and the model will not autonomously use it.
- Skill disable surface 2 (`/skill:name` command): intercept the `input` event (which fires before skill expansion) and block/handle a `/skill:<name>` invocation for a folder-disabled skill, so the user cannot manually expand a disabled skill. A folder-disabled skill must be inert on BOTH surfaces; system-prompt-only disabling is rejected.
- CLI precedence (CLI-PRECEDENCE-001): detect Pi's `--no-skills` and repeated `--skill <path>` flags. With `--no-skills`, no skills load and per-project enables do NOT re-add them. With `--skill <path>`, that skill is force-active even if folder-disabled, and BOTH disable points (system-prompt filter and `/skill:name` block) must detect the explicit `--skill` and stand down for that skill so a force-activated skill is not re-suppressed. With no conflicting flag, per-project toggles apply normally.

Externally observable surfaces: any message shown when a `/skill:<name>` invocation is blocked because the skill is folder-disabled. This must be plain user-facing language explaining the skill is disabled for this project, with no planning/package/Slice terminology.

Excluded (owned elsewhere): config read/write, trust gating, and lifecycle refresh (WP1, consumed here); extension tool/command suppression (WP3); the TUI authoring surface (WP4). WP2 reads the resolved toggle state and applies skill semantics only.

## Assigned Slices
### `.planning/per-folder-resource-toggling/slices/resource-type-asymmetry.md`
Must satisfy:
- `SKILLS-TOGGLE-001` — Skill enable is additive via `resources_discover` `skillPaths`; disable cannot go through `resources_discover` and needs the separate two-surface path.
- `SKILLS-DISABLE-SURFACES-001` — Disabled skill must be fully inert on BOTH surfaces: system prompt (`systemPromptOptions.skills` filter in `before_agent_start`) and `/skill:name` command (block at the `input` stage). The two surfaces fire at different lifecycle stages, so a single filter point is insufficient.
- `CLI-PRECEDENCE-001` — CLI flags win: `--no-skills` suppresses folder enables; `--skill <path>` force-activates and both disable points stand down for that skill; no conflicting flag => toggles apply.

Context only:
- `PRIORITY-001` — Read for the directive that skills are primary/must-work and the skill path must not be destabilized by the best-effort extension path; closure of extension behavior belongs to WP3.

## Primary Paths
- `.tasks/per-folder-resource-toggling/packages/WP1.md`
- `examples/hello-world.mts`

## Verification Expectations
- Enable: a per-project enabled skill path is returned from `resources_discover` and is discoverable in the target trusted project.
- Disable surface 1: a folder-disabled global skill is removed from `systemPromptOptions.skills` and does not appear in the system prompt for the target project; confirm by inspecting the filtered options or `ctx.getSystemPrompt()` content.
- Disable surface 2: a `/skill:<name>` invocation for a folder-disabled skill is blocked/handled at the `input` stage before expansion; confirm the skill content is not expanded.
- Both-surfaces gate: confirm a skill disabled via only one surface is treated as a failure (the package must demonstrate both surfaces are covered for the same disabled skill).
- CLI precedence — `--skill`: a folder-disabled skill passed via `--skill <path>` is present in the system prompt AND invokable (both disable points stand down for it).
- CLI precedence — `--no-skills`: a folder-enabled skill does not appear (enable does not re-add under `--no-skills`).
- Trust/default/edge: when WP1 state is no-config-equivalent (untrusted or absent file), skill behavior is unchanged (no filtering, no blocking, no extra enables).
- Audience-surface: the `/skill` block message is user-facing and free of planning/workflow/package/Slice terminology.

## Proof
- `.tasks/per-folder-resource-toggling/proofs/WP2.proof.md`

## Package Verification Report
- `.tasks/per-folder-resource-toggling/reports/WP2.package-verification.md`

## Dependencies
- WP1

## Notes
- Parallel-safe with WP3: skill semantics and extension tool/command suppression touch different lifecycle concerns and should live in separate modules; serialize only against WP1 for the shared state/loader surface.
- The CLI flag detection must use Pi's existing `--no-skills` / `--skill` flags; do not invent new flags.
