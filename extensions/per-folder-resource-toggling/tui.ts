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
    custom?(view: ResourceToggleView): unknown | Promise<unknown>;
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
  await ctx.ui.custom(view);
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
  const skills = uniqueSkillDescriptors(await collectSkills(pi, ctx), state);
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

function uniqueSkillDescriptors(skills: SkillDescriptor[], state: ResourceToggleState): SkillDescriptor[] {
  const byId = new Map<string, SkillDescriptor>();
  for (const skill of skills) {
    byId.set(skill.filePath || skill.name, skill);
  }
  for (const id of Object.keys(state.skills)) {
    if (!byId.has(id)) {
      byId.set(id, { name: id, filePath: id });
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
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
