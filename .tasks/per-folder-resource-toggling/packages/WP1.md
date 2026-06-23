# Work Package: WP1 — Config persistence, trust gating, and graceful degradation core

## Scope
Owns the shared foundation the rest of the extension builds on: the project-root toggle config file and the in-memory toggle state it produces.

In scope:
- Resolve the config path as `<project-root>/<CONFIG_DIR_NAME>/resource-toggles.json` using the imported `CONFIG_DIR_NAME` constant and `ctx.cwd` — never hardcode `.pi`.
- Define the internal JSON schema keyed by resource type (skills, extensions) and resource id with on/off state, and provide read and write functions that round-trip exactly what the TUI (WP4) writes and reads. The format is an internal implementation detail, not a documented user surface.
- Trust gating: read and apply the file only when `ctx.isProjectTrusted()` is true. When untrusted, return state equivalent to "no config present" so behavior is unchanged.
- Default behavior: when the file is absent, return state that yields unchanged global behavior.
- Graceful degradation: when the file is invalid or partial, emit a single clear warning via `ctx.ui.notify` and fall back to global (no-toggle) behavior; never throw out of the read path or crash the session.
- Establish the extension skeleton (directory extension with an `index.ts` entry exporting the default factory) and the re-read lifecycle wiring at `session_start` and `resources_discover` (both `startup` and `reload` reasons) so cached toggle state is refreshed; expose the resolved state to consumer modules (WP2, WP3, WP4) through a stable internal accessor.

Externally observable surfaces: the `ctx.ui.notify` warning text shown to the user on an invalid/partial config. This text must be plain operator-facing language (what went wrong, that global behavior is in effect) with no planning/package/Slice terminology.

Excluded (owned elsewhere): skill enable/disable and CLI precedence (WP2); extension tool/command suppression (WP3); the TUI command and resource listing/writes (WP4). WP1 provides the read/write/state primitives and lifecycle refresh those packages consume; it does not itself filter skills, suppress tools, or render UI.

## Assigned Slices
### `.planning/per-folder-resource-toggling/slices/resource-type-asymmetry.md`
Must satisfy:
- `PERSIST-001` — Project-root single file under `CONFIG_DIR_NAME`; trusted-projects only; absent file = unchanged behavior; invalid/partial file warns and falls back; re-read at `resources_discover`/`session_start`; format round-trips TUI reads/writes.
- `SCOPE-001` — Skills and extensions only; plugins excluded. The schema and state model must represent only skills and extensions and must not introduce any plugin resource type.

Context only:
- `UX-MODEL-001` — Read for the constraint that the file is TUI-authored and manual editing is a non-goal, so the format is internal; closure of the TUI itself belongs to WP4.

## Primary Paths
- `examples/hello-world.mts`
- `examples/README.md`

## Verification Expectations
- Static inspection: config path is built from imported `CONFIG_DIR_NAME` + `ctx.cwd`; grep confirms no hardcoded `.pi` literal in the path construction.
- Trust gate: with `ctx.isProjectTrusted()` false, the loader returns no-config-equivalent state and does not read or apply the file; confirm via a direct unit-style invocation or a focused test harness.
- Default case: absent file yields no-toggle state (unchanged global behavior) and emits no warning.
- Invalid/partial case: malformed JSON and a partially-shaped object each produce exactly one `ctx.ui.notify` warning and fall back to no-toggle state without throwing; confirm the read path never propagates an exception.
- Round-trip: a state object written by the writer is read back by the reader to an equivalent object (skills + extensions only); confirm no plugin key is produced or accepted.
- Lifecycle refresh: confirm the state is re-read on `session_start` and on `resources_discover` for both `startup` and `reload` reasons.
- Audience-surface: the invalid-config `notify` text is operator-facing and free of planning/workflow/package/Slice terminology.
- Build sanity: the extension entry typechecks/loads under the repo's TypeScript/ESM conventions (per `examples/README.md`).

## Proof
- `.tasks/per-folder-resource-toggling/proofs/WP1.proof.md`

## Package Verification Report
- `.tasks/per-folder-resource-toggling/reports/WP1.package-verification.md`

## Dependencies
- None.

## Notes
- Foundation package: WP2, WP3, and WP4 depend on the loader, internal state accessor, and lifecycle refresh defined here. Keep the public-to-consumers surface (path resolution, load/save, state accessor) stable to avoid forcing rework downstream.
- The schema is an implementation detail but must round-trip TUI writes (WP4); coordinate the shape through this module's exported types rather than duplicating it in consumers.
