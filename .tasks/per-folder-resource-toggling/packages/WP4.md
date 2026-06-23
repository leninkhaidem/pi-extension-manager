# Work Package: WP4 — Slash-command TUI authoring and honest resource listing

## Scope
Owns the only authoring path: a slash command that opens an interactive TUI to toggle skills and extensions on/off for the current project, auto-persisting the result through WP1.

In scope:
- Register a slash command via `pi.registerCommand` that opens the toggle TUI for the current project.
- TUI gating: present the interactive component only when `ctx.mode === "tui"` (use `ctx.ui.custom()` for the rich list, or `ctx.ui.select` multi-select if sufficient). In print/json/rpc modes, degrade gracefully — no-op or an informative message via `ctx.hasUI`-guarded `notify` — and never attempt TUI rendering.
- Resource listing:
  - Skills are listed fully and are always toggleable; toggling off must drive the fully-inert behavior owned by WP2.
  - Extensions that register suppressible surfaces (tools and/or commands, per the WP3 suppressibility classifier) are listed as toggleable with a clear best-effort label stating it disables the extension's tools/commands and does NOT unload the extension.
  - Extensions with nothing suppressible (event-only/rendering-only) are hidden or shown greyed-out/non-toggleable with a short explanation, so the UI never implies an action that would do nothing.
- Persistence: on toggle changes, auto-persist via WP1's writer (skills + extensions only; no plugin entries). The user never hand-edits the file; the file format is an internal detail.
- No user-facing allowlist/denylist concept: the TUI tracks on/off per resource; internal storage representation stays hidden.
- Effect timing: communicate or apply that changes take effect on `/reload` and at session start (consistent with WP1 re-read), without inventing a separate persistence mechanism.

Externally observable surfaces: the slash command itself, the TUI list and its labels (best-effort extension label, event-only explanation), the non-TUI-mode degradation message, and any confirmation/notification text. All such text must use plain user-facing language (skills, extensions, on/off, best-effort) with no planning/package/Slice/work-package terminology.

Excluded (owned elsewhere): config schema/read/write primitives and trust gating (WP1, consumed); skill enable/disable semantics and CLI precedence (WP2); extension tool/command suppression mechanics and the suppressibility classifier (WP3, consumed). WP4 authors the command + presentation + persistence-trigger only; it does not itself filter skills or call `setActiveTools()`.

## Assigned Slices
### `.planning/per-folder-resource-toggling/slices/resource-type-asymmetry.md`
Must satisfy:
- `UX-MODEL-001` — Slash-command TUI is the only authoring path; auto-persisted per folder; manual editing is a non-goal; no user-facing allow/deny model (TUI tracks on/off); requires `ctx.mode === "tui"` and degrades gracefully in print/json/rpc.
- `TUI-EXT-LISTING-001` — Honest best-effort listing: skills listed fully; tool/command-registering extensions listed toggleable with a best-effort label; event-only/rendering-only extensions hidden or greyed-out/non-toggleable with explanation.

Context only:
- `PERSIST-001` — Read because the TUI auto-persists through WP1's writer and the persisted shape must round-trip TUI reads/writes; closure of the persistence/trust/fallback primitives belongs to WP1.
- `SKILLS-DISABLE-SURFACES-001` — Read so the skill on/off toggle wires to WP2's both-surface inert behavior; closure of the disable mechanism belongs to WP2.
- `EXT-TOGGLE-001` — Read so the extension toggle and best-effort label reflect WP3's suppression-only semantics; closure of suppression belongs to WP3.

## Primary Paths
- `.tasks/per-folder-resource-toggling/packages/WP1.md`
- `.tasks/per-folder-resource-toggling/packages/WP3.md`
- `examples/hello-world.mts`

## Verification Expectations
- Command registration: the slash command is registered and opens the toggle TUI in `tui` mode.
- Mode gating: in print/json/rpc modes the command does not attempt `ctx.ui.custom()` and instead no-ops or shows a `hasUI`-guarded informative message; confirm no TUI rendering is attempted in non-tui modes.
- Skill listing: all available skills for the current project are listed and toggleable; toggling a skill off persists state that WP2 consumes to make it inert.
- Extension listing — suppressible: a tool/command-registering extension appears as toggleable with the best-effort label (disables tools/commands, does not unload).
- Extension listing — event-only: an extension with nothing suppressible (per WP3 classifier) is hidden or greyed-out/non-toggleable with a short explanation; it is never presented as an actionable toggle.
- Persistence round-trip: a toggle change is auto-persisted via WP1's writer and reloaded into the same on/off state on reopen; confirm only skills/extensions are written (no plugin keys).
- No allow/deny leakage: the UI exposes only on/off, not allowlist/denylist terms.
- Audience-surface: command name, labels, explanations, and degradation messages are user-facing and free of planning/workflow/package/Slice terminology.

## Proof
- `.tasks/per-folder-resource-toggling/proofs/WP4.proof.md`

## Package Verification Report
- `.tasks/per-folder-resource-toggling/reports/WP4.package-verification.md`

## Dependencies
- WP1
- WP2
- WP3

## Notes
- Integration package: depends on WP1 (persistence), WP2 (skill on/off effect), and WP3 (suppressibility classifier + extension effect). Sequenced last because its listing and persistence wire together all three; it owns the user-facing presentation and must not duplicate their mechanics.
- Prefer `ctx.ui.custom()` for the toggle list; fall back to `ctx.ui.select` multi-select only if a full custom component is unnecessary.
