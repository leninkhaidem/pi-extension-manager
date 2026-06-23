# Work Package: WP3 — Best-effort extension tool/command suppression

## Scope
Owns the best-effort extension toggling capability, applied to trusted-project toggle state from WP1.

In scope:
- Determine which tools and commands a target extension registered, using Pi's introspection surfaces: tool provenance via `pi.getAllTools()` `sourceInfo` (extension-sourced tools) and command provenance via `pi.getCommands()` `source`/`sourceInfo` (`source === "extension"`).
- Suppress the tools a folder-disabled extension registered by computing a reduced active-tool set and applying it via `pi.setActiveTools()` (preserving other active tools). Suppress/neutralize the commands a folder-disabled extension registered to the extent Pi permits (e.g. intercepting their invocation at the `input` stage), without unloading the extension.
- Hard constraint: runtime unload of another extension is NOT supported and must NOT be attempted. Best-effort tool/command suppression is the accepted ceiling.
- Priority/safety: the extension path is best-effort and must degrade gracefully — if an extension exposes nothing suppressible, or suppression cannot be applied, it must no-op cleanly and must never block, throw into, or destabilize the skill path (WP2) or the session.
- Expose a suppressibility classification helper (does a given extension register tools and/or commands?) that WP4 consumes for honest TUI listing; this is the single source of truth for "is this extension actionable."

Externally observable surfaces: none directly authored here beyond internal tool/command state changes; any user-facing message on a suppressed command invocation must use plain user-facing language (the extension's command is disabled for this project) with no planning/package/Slice terminology.

Excluded (owned elsewhere): config read/write, trust gating, lifecycle refresh (WP1); skill semantics and CLI precedence (WP2); the TUI command and rendering (WP4). WP3 reads resolved toggle state and applies extension suppression + provides the suppressibility classifier.

## Assigned Slices
### `.planning/per-folder-resource-toggling/slices/resource-type-asymmetry.md`
Must satisfy:
- `EXT-TOGGLE-001` — Extension disable cannot rely on runtime unload; achievable semantics limited to suppressing the tools/commands a target extension registered. Runtime unload must not be attempted.
- `PRIORITY-001` — Extension toggling is explicitly best-effort; design/verification prioritize robust skills; extension path must degrade gracefully and never block or destabilize the skill path.

Context only:
- `TUI-EXT-LISTING-001` — Read for the suppressibility classification semantics (tools and/or commands => suppressible/listed; nothing suppressible => not actionable). WP3 provides the classifier; the TUI presentation/closure of this Slice belongs to WP4.

## Primary Paths
- `.tasks/per-folder-resource-toggling/packages/WP1.md`
- `examples/hello-world.mts`

## Verification Expectations
- Tool suppression: a folder-disabled extension's registered tools (identified via `pi.getAllTools()` `sourceInfo`) are removed from the active set via `pi.setActiveTools()` in the target project, while unrelated active tools are preserved.
- Command suppression: a folder-disabled extension's registered commands (identified via `pi.getCommands()` provenance) are neutralized/blocked to the extent Pi permits, without unloading the extension.
- No-unload guarantee: static inspection confirms there is no attempt to unload, remove, or de-register another extension's module; only tool/command suppression is used.
- Best-effort degradation: an extension with nothing suppressible (event-only/rendering-only) results in a clean no-op; a suppression failure does not throw into or destabilize the skill path or session.
- Classifier correctness: the suppressibility helper reports tool-only, command-only, both, and neither extensions correctly (edge: registers commands but no tools, and vice versa) for WP4 consumption.
- Trust/default/edge: when WP1 state is no-config-equivalent (untrusted or absent file), no extension tools/commands are suppressed.
- Audience-surface: any suppressed-command message is user-facing and free of planning/workflow/package/Slice terminology.

## Proof
- `.tasks/per-folder-resource-toggling/proofs/WP3.proof.md`

## Package Verification Report
- `.tasks/per-folder-resource-toggling/reports/WP3.package-verification.md`

## Dependencies
- WP1

## Notes
- Parallel-safe with WP2 against the WP1 foundation: extension suppression and skill semantics live in separate modules and do not share proof surfaces. Coordinate only the shared `input`-stage handler composition so WP2's `/skill` block and WP3's command block do not clobber each other (compose, do not overwrite).
- The suppressibility classifier is the contract WP4 relies on for honest listing; keep its return shape stable.
