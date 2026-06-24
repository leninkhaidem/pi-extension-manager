import {
  classifyKnownExtensionSuppressibility,
  type CommandDescriptor,
  type ExtensionIntrospectionApi,
  type ToolDescriptor,
} from './extensions.ts';
import {
  createEmptyToggleState,
  loadResourceToggleState,
  saveResourceToggleState,
  type ResourceToggleState,
  type ToggleContext,
} from './state.ts';
import type { SkillDescriptor } from './skills.ts';

export const RESOURCE_TOGGLE_COMMAND = 'skills-extensions';
export const RESOURCE_TOGGLE_COMMAND_DESCRIPTION = 'Turn skills and extensions on or off for this project.';
export const NON_TUI_MESSAGE = 'Skills and extensions can be turned on or off in the interactive terminal UI.';
export const SAVE_SUCCESS_MESSAGE = 'Changes saved. They take effect after /reload or when you start a new session.';
export const SAVE_SKIPPED_UNTRUSTED_MESSAGE = 'This project is not trusted, so skills and extensions were not changed.';
export const BEST_EFFORT_EXTENSION_DETAIL = 'Best-effort: turns off this extension\'s tools/commands, but does not unload the extension.';
export const EVENT_ONLY_EXTENSION_DETAIL = 'No tools or commands to turn off.';

export interface ResourceToggleComponent {
  render(width: number): string[];
  invalidate(): void;
  handleInput?(data: string): void | boolean | Promise<void | boolean>;
}

export type ResourceToggleCustomFactory = (
  tui: { requestRender?(): void },
  theme: ResourceToggleTheme,
  keybindings: unknown,
  done: (value?: unknown) => void,
) => ResourceToggleComponent;

export interface ResourceToggleTheme {
  fg?(name: string, text: string): string;
  bold?(text: string): string;
}

export interface ResourceToggleCommandContext extends ToggleContext {
  mode?: string;
  hasUI?: boolean | (() => boolean);
  skills?: SkillDescriptor[];
  availableSkills?: SkillDescriptor[];
  extensions?: ExtensionDescriptor[];
  availableExtensions?: ExtensionDescriptor[];
  systemPromptOptions?: { skills?: SkillDescriptor[] };
  getSkills?(): SkillDescriptor[] | Promise<SkillDescriptor[]>;
  getExtensions?(): ExtensionDescriptor[] | Promise<ExtensionDescriptor[]>;
  ui?: ToggleContext['ui'] & {
    custom?(factory: ResourceToggleCustomFactory): unknown | Promise<unknown>;
  };
}

export interface ResourceToggleCommandApi extends ExtensionIntrospectionApi {
  registerCommand?(name: string, options: CommandRegistration): void;
  getSkills?(): SkillDescriptor[] | Promise<SkillDescriptor[]>;
  getExtensions?(): ExtensionDescriptor[] | Promise<ExtensionDescriptor[]>;
}

export interface CommandRegistration {
  description: string;
  handler(args: string, ctx: ResourceToggleCommandContext): Promise<void>;
}

export interface ExtensionDescriptor {
  id?: string;
  name?: string;
  packageName?: string;
  sourceInfo?: string | Record<string, unknown> | null;
}

type SkillDescriptorWithMetadata = SkillDescriptor & Record<string, unknown>;

export type ResourceToggleItemKind = 'skill' | 'extension';

export interface ResourceToggleViewItem {
  id: string;
  kind: ResourceToggleItemKind;
  label: string;
  enabled: boolean;
  toggleable: boolean;
  detail?: string;
}

export interface ResourceToggleView {
  title: string;
  message: string;
  items: ResourceToggleViewItem[];
  onToggle(id: string, enabled: boolean): Promise<ResourceToggleState>;
}

export function registerResourceToggleCommand(pi: ResourceToggleCommandApi): void {
  if (typeof pi.registerCommand !== 'function') {
    return;
  }

  pi.registerCommand(RESOURCE_TOGGLE_COMMAND, {
    description: RESOURCE_TOGGLE_COMMAND_DESCRIPTION,
    handler: async (_args: string, ctx: ResourceToggleCommandContext) => {
      await openResourceToggleTui(pi, ctx);
    },
  });
}

export async function openResourceToggleTui(
  pi: ResourceToggleCommandApi,
  ctx: ResourceToggleCommandContext,
): Promise<void> {
  if (ctx.mode !== 'tui') {
    if (hasUi(ctx)) {
      await ctx.ui?.notify?.(NON_TUI_MESSAGE);
    }
    return;
  }

  if (typeof ctx.ui?.custom !== 'function') {
    await ctx.ui?.notify?.(NON_TUI_MESSAGE);
    return;
  }

  const state = await loadResourceToggleState(ctx);
  const view = await buildResourceToggleView(pi, ctx, state);
  await ctx.ui.custom(createResourceToggleCustomFactory(view));
}

export function createResourceToggleCustomFactory(view: ResourceToggleView): ResourceToggleCustomFactory {
  return (tui, theme, keybindings, done) => new ResourceToggleComponentAdapter(view, tui, theme, keybindings, done);
}

class ResourceToggleComponentAdapter implements ResourceToggleComponent {
  private selectedIndex = 0;
  private view: ResourceToggleView;
  private tui: { requestRender?(): void };
  private theme: ResourceToggleTheme;
  private keybindings: unknown;
  private done: (value?: unknown) => void;

  constructor(
    view: ResourceToggleView,
    tui: { requestRender?(): void },
    theme: ResourceToggleTheme,
    keybindings: unknown,
    done: (value?: unknown) => void,
  ) {
    this.view = view;
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
  }

  render(width: number): string[] {
    const maxWidth = Math.max(1, width);
    const title = this.style('accent', this.bold(this.view.title));
    const lines = [title, ...wrapLine(this.view.message, maxWidth), ''];

    if (this.view.items.length === 0) {
      lines.push(this.style('dim', 'No skills or extensions found.'));
    } else {
      this.view.items.forEach((item, index) => {
        const selected = index === this.selectedIndex ? '›' : ' ';
        const mark = item.enabled ? '[x]' : '[ ]';
        const muted = item.toggleable ? '' : ' (not actionable)';
        lines.push(...wrapLine(`${selected} ${mark} ${item.label}${muted}`, maxWidth));
        if (item.detail) {
          lines.push(...wrapLine(`    ${item.detail}`, maxWidth).map((line) => this.style('dim', line)));
        }
      });
    }

    lines.push('', this.style('dim', '↑/↓ move • Space/Enter toggle • Esc/q close'));
    return lines.flatMap((line) => wrapLine(line, maxWidth));
  }

  invalidate(): void {}

  async handleInput(data: string): Promise<boolean> {
    if (matchesInput(data, ['cancel', 'q'], this.keybindings)) {
      this.done(undefined);
      return true;
    }
    if (matchesInput(data, ['up'], this.keybindings)) {
      this.moveSelection(-1);
      return true;
    }
    if (matchesInput(data, ['down'], this.keybindings)) {
      this.moveSelection(1);
      return true;
    }
    if (matchesInput(data, ['confirm', 'space', 'enter'], this.keybindings)) {
      const item = this.view.items[this.selectedIndex];
      if (item?.toggleable) {
        await this.view.onToggle(item.id, !item.enabled);
        this.requestRender();
      }
      return true;
    }
    return false;
  }

  private moveSelection(delta: number): void {
    if (this.view.items.length === 0) {
      return;
    }
    this.selectedIndex = (this.selectedIndex + delta + this.view.items.length) % this.view.items.length;
    this.requestRender();
  }

  private requestRender(): void {
    this.tui.requestRender?.();
  }

  private bold(text: string): string {
    return this.theme.bold?.(text) ?? text;
  }

  private style(name: string, text: string): string {
    return this.theme.fg?.(name, text) ?? text;
  }
}

function matchesInput(data: string, keys: string[], keybindings: unknown): boolean {
  return keys.some((key) => matchesKeybinding(data, key, keybindings) || matchesRawFallback(data, key));
}

function matchesKeybinding(data: string, key: string, keybindings: unknown): boolean {
  if (!keybindings || typeof keybindings !== 'object') {
    return false;
  }

  const matcher = (keybindings as { matches?: unknown }).matches;
  if (typeof matcher !== 'function') {
    return false;
  }

  for (const binding of keybindingCandidates(key, keybindings)) {
    try {
      if (matcher.call(keybindings, data, binding)) {
        return true;
      }
    } catch {
      // Ignore incompatible keybinding manager shapes and keep deterministic raw fallbacks.
    }
  }
  return false;
}

function keybindingCandidates(key: string, keybindings: unknown): unknown[] {
  const bindingName = keybindingNameForInput(key);
  const candidates: unknown[] = [bindingName, key];
  if (!keybindings || typeof keybindings !== 'object') {
    return candidates;
  }

  const source = keybindings as Record<string, unknown>;
  for (const accessorName of ['get', 'getKeybinding', 'resolve']) {
    const accessor = source[accessorName];
    if (typeof accessor !== 'function') {
      continue;
    }
    try {
      candidates.unshift(accessor.call(keybindings, bindingName));
    } catch {
      // Best-effort compatibility with Pi keybinding managers.
    }
  }
  candidates.unshift(source[bindingName], source[key]);
  return candidates.filter((candidate) => candidate !== undefined && candidate !== null);
}

function keybindingNameForInput(key: string): string {
  switch (key) {
    case 'up':
      return 'tui.select.up';
    case 'down':
      return 'tui.select.down';
    case 'confirm':
      return 'tui.select.confirm';
    case 'cancel':
      return 'tui.select.cancel';
    default:
      return key;
  }
}

function matchesRawFallback(data: string, key: string): boolean {
  switch (key) {
    case 'confirm':
    case 'enter':
      return data === '\r' || data === '\n' || data === '\x1BOM';
    case 'cancel':
      return data === '\x1B' || data === 'q';
    case 'space':
      return data === ' ';
    case 'up':
      return data === '\x1B[A' || data === 'up';
    case 'down':
      return data === '\x1B[B' || data === 'down';
    default:
      return data === key;
  }
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) {
    return [line];
  }

  const lines: string[] = [];
  let remaining = line;
  while (remaining.length > width) {
    lines.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  lines.push(remaining);
  return lines;
}

export async function buildResourceToggleView(
  pi: ResourceToggleCommandApi,
  ctx: ResourceToggleCommandContext,
  initialState: ResourceToggleState = createEmptyToggleState(),
): Promise<ResourceToggleView> {
  let currentState = cloneState(initialState);
  const [skills, extensions] = await Promise.all([listSkillItems(pi, ctx, currentState), listExtensionItems(pi, ctx, currentState)]);

  return {
    title: 'Skills and extensions',
    message: 'Turn skills and extensions on or off for this project. Changes take effect after /reload or when you start a new session.',
    items: [...skills, ...extensions],
    onToggle: async (id: string, enabled: boolean): Promise<ResourceToggleState> => {
      const item = [...skills, ...extensions].find((candidate) => candidate.id === id);
      if (!item || !item.toggleable) {
        return cloneState(currentState);
      }

      const nextState = cloneState(currentState);
      if (item.kind === 'skill') {
        nextState.skills[id] = enabled;
      } else {
        nextState.extensions[id] = enabled;
      }

      const saved = await saveResourceToggleState(ctx, nextState);
      if (saved) {
        currentState = cloneState(nextState);
        item.enabled = enabled;
        await ctx.ui?.notify?.(SAVE_SUCCESS_MESSAGE);
      } else {
        await ctx.ui?.notify?.(SAVE_SKIPPED_UNTRUSTED_MESSAGE);
      }

      return cloneState(currentState);
    },
  };
}

async function listSkillItems(
  pi: ResourceToggleCommandApi,
  ctx: ResourceToggleCommandContext,
  state: ResourceToggleState,
): Promise<ResourceToggleViewItem[]> {
  const skills = uniqueSkillDescriptors(await collectSkills(pi, ctx));
  return skills.map((skill) => {
    const id = skill.filePath || skill.name;
    return {
      id,
      kind: 'skill',
      label: skill.name,
      enabled: state.skills[id] ?? state.skills[skill.name] ?? true,
      toggleable: true,
    };
  });
}

async function listExtensionItems(
  pi: ResourceToggleCommandApi,
  ctx: ResourceToggleCommandContext,
  state: ResourceToggleState,
): Promise<ResourceToggleViewItem[]> {
  const extensionIds = await collectExtensionIds(pi, ctx, state);
  const suppressibilities = await classifyKnownExtensionSuppressibility(pi, extensionIds);
  return suppressibilities.map((extension): ResourceToggleViewItem => ({
    id: extension.extensionId,
    kind: 'extension',
    label: extension.extensionId,
    enabled: state.extensions[extension.extensionId] ?? true,
    toggleable: extension.suppressible,
    detail: extension.suppressible ? BEST_EFFORT_EXTENSION_DETAIL : EVENT_ONLY_EXTENSION_DETAIL,
  }));
}

async function collectSkills(pi: ResourceToggleCommandApi, ctx: ResourceToggleCommandContext): Promise<SkillDescriptor[]> {
  const sources = await Promise.all([
    safeList(() => ctx.getSkills?.()),
    safeList(() => pi.getSkills?.()),
    Promise.resolve(ctx.availableSkills ?? []),
    Promise.resolve(ctx.skills ?? []),
    Promise.resolve(ctx.systemPromptOptions?.skills ?? []),
  ]);
  return sources.flat().filter(isSkillDescriptor);
}

async function collectExtensionIds(
  pi: ResourceToggleCommandApi,
  ctx: ResourceToggleCommandContext,
  state: ResourceToggleState,
): Promise<string[]> {
  const [ctxExtensions, piExtensions, tools, commands] = await Promise.all([
    safeList(() => ctx.getExtensions?.()),
    safeList(() => pi.getExtensions?.()),
    safeList(() => pi.getAllTools?.()),
    safeList(() => pi.getCommands?.()),
  ]);

  return uniqueStrings([
    ...Object.keys(state.extensions),
    ...(ctx.availableExtensions ?? []).map(extensionIdFromDescriptor),
    ...(ctx.extensions ?? []).map(extensionIdFromDescriptor),
    ...ctxExtensions.map(extensionIdFromDescriptor),
    ...piExtensions.map(extensionIdFromDescriptor),
    ...tools.map(extensionIdFromTool),
    ...commands.filter((command) => command.source === 'extension').map(extensionIdFromCommand),
  ].filter((id): id is string => Boolean(id)));
}

async function safeList<T>(read: () => T[] | Promise<T[]> | undefined): Promise<T[]> {
  try {
    const value = await read();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function uniqueSkillDescriptors(skills: SkillDescriptor[]): SkillDescriptor[] {
  const byId = new Map<string, SkillDescriptor>();
  for (const skill of skills) {
    if (isBuiltInSkillDescriptor(skill)) {
      continue;
    }
    byId.set(skill.filePath || skill.name, skill);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function isBuiltInSkillDescriptor(skill: SkillDescriptor): boolean {
  const descriptor = skill as SkillDescriptorWithMetadata;
  if (['builtin', 'built-in', 'core'].some((value) => hasMetadataValue(descriptor, value))) {
    return true;
  }
  if (['builtin', 'builtIn', 'isBuiltin', 'isBuiltIn'].some((key) => descriptor[key] === true)) {
    return true;
  }

  const pathValues = [descriptor.filePath, descriptor.baseDir, descriptor.sourceInfo, descriptor.source, descriptor.sourceType, descriptor.kind, descriptor.packageName]
    .flatMap(extractStringValues)
    .map((value) => value.toLowerCase());

  return pathValues.some((value) => /(^|[\/])(@?pi|pi)([\/](core|built[-_]?in|system))?[\/]skills[\/]/i.test(value)
    || /(^|[\/])(core|built[-_]?in|system)([\/].*)?skills[\/]/i.test(value)
    || /(^|[\/])(core|built[-_]?in|system)[-_]?skills([\/]|$)/i.test(value)
    || /(^|[\/])skills[\/](core|built[-_]?in|system)([\/]|$)/i.test(value));
}

function hasMetadataValue(descriptor: SkillDescriptorWithMetadata, expected: string): boolean {
  return ['source', 'sourceType', 'kind', 'type', 'origin'].some((key) => descriptor[key] === expected);
}

function extractStringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.values(value as Record<string, unknown>).filter((entry): entry is string => typeof entry === 'string');
}

function extensionIdFromDescriptor(extension: ExtensionDescriptor): string | null {
  return extension.id ?? extension.name ?? extension.packageName ?? extensionIdFromSourceInfo(extension.sourceInfo);
}

function extensionIdFromTool(tool: ToolDescriptor): string | null {
  return extensionIdFromSourceInfo(tool.sourceInfo) ?? extensionIdFromSource(tool.source);
}

function extensionIdFromCommand(command: CommandDescriptor): string | null {
  return extensionIdFromSourceInfo(command.sourceInfo);
}

function extensionIdFromSource(source: string | undefined): string | null {
  if (!source || source === 'core' || source === 'extension') {
    return null;
  }
  return normalizeSourceId(source);
}

function extensionIdFromSourceInfo(sourceInfo: string | Record<string, unknown> | null | undefined): string | null {
  if (typeof sourceInfo === 'string') {
    return normalizeSourceId(sourceInfo);
  }
  if (!sourceInfo || typeof sourceInfo !== 'object') {
    return null;
  }
  for (const key of ['extensionId', 'id', 'name', 'extensionName', 'packageName', 'package', 'sourceId', 'path', 'filePath', 'modulePath', 'directory']) {
    const value = sourceInfo[key];
    if (typeof value === 'string' && value.length > 0) {
      return normalizeSourceId(value);
    }
  }
  return null;
}

function normalizeSourceId(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/\.[cm]?[jt]s$/i, '') ?? value;
}

function isSkillDescriptor(value: unknown): value is SkillDescriptor {
  return typeof value === 'object'
    && value !== null
    && typeof (value as SkillDescriptor).name === 'string'
    && typeof (value as SkillDescriptor).filePath === 'string';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function cloneState(state: ResourceToggleState): ResourceToggleState {
  return {
    skills: { ...state.skills },
    extensions: { ...state.extensions },
  };
}

function hasUi(ctx: ResourceToggleCommandContext): boolean {
  if (typeof ctx.hasUI === 'function') {
    return ctx.hasUI();
  }
  if (typeof ctx.hasUI === 'boolean') {
    return ctx.hasUI;
  }
  return Boolean(ctx.ui?.notify);
}
