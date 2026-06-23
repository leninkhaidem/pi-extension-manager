import {
  createEmptyToggleState,
  loadResourceToggleState,
  hasAnyResourceToggles,
  type ResourceToggleState,
  type ToggleContext,
} from './state.ts';
import {
  filterDisabledSkillsForSystemPrompt,
  getEnabledSkillPaths,
  handleDisabledSkillInvocation,
  parseSkillCliOverrides,
  type SkillCliOverrides,
} from './skills.ts';

export type ResourceDiscoverReason = 'startup' | 'reload' | string;

export interface ResourceDiscoverEvent {
  ctx?: ToggleContext;
  cwd?: string;
  reason?: ResourceDiscoverReason;
}

export interface SessionStartEvent {
  ctx?: ToggleContext;
  reason?: string;
}

export interface BeforeAgentStartEvent {
  systemPrompt: string;
  systemPromptOptions: { skills?: Array<{ name: string; description?: string; filePath: string; baseDir?: string; disableModelInvocation?: boolean }> };
}

export interface InputEvent {
  text: string;
  source?: string;
}

export interface PiExtensionApi {
  on?(event: 'session_start', handler: (event: SessionStartEvent) => Promise<void> | void): void;
  on?(event: 'resources_discover', handler: (event: ResourceDiscoverEvent, ctx?: ToggleContext) => Promise<object> | object): void;
  on?(event: 'before_agent_start', handler: (event: BeforeAgentStartEvent, ctx: ToggleContext) => Promise<object | void> | object | void): void;
  on?(event: 'input', handler: (event: InputEvent, ctx: ToggleContext) => Promise<object | void> | object | void): void;
  registerEvent?(event: 'session_start', handler: (event: SessionStartEvent) => Promise<void> | void): void;
  registerEvent?(event: 'resources_discover', handler: (event: ResourceDiscoverEvent, ctx?: ToggleContext) => Promise<object> | object): void;
  registerEvent?(event: 'before_agent_start', handler: (event: BeforeAgentStartEvent, ctx: ToggleContext) => Promise<object | void> | object | void): void;
  registerEvent?(event: 'input', handler: (event: InputEvent, ctx: ToggleContext) => Promise<object | void> | object | void): void;
  events?: {
    on?(event: 'session_start', handler: (event: SessionStartEvent) => Promise<void> | void): void;
    on?(event: 'resources_discover', handler: (event: ResourceDiscoverEvent, ctx?: ToggleContext) => Promise<object> | object): void;
    on?(event: 'before_agent_start', handler: (event: BeforeAgentStartEvent, ctx: ToggleContext) => Promise<object | void> | object | void): void;
    on?(event: 'input', handler: (event: InputEvent, ctx: ToggleContext) => Promise<object | void> | object | void): void;
  };
}

let currentToggleState: ResourceToggleState = createEmptyToggleState();
let currentCliOverrides: SkillCliOverrides = parseSkillCliOverrides();

export function getResourceToggleState(): ResourceToggleState {
  return {
    skills: { ...currentToggleState.skills },
    extensions: { ...currentToggleState.extensions },
  };
}

export async function refreshResourceToggleState(ctx: ToggleContext): Promise<ResourceToggleState> {
  currentToggleState = await loadResourceToggleState(ctx);
  return getResourceToggleState();
}

export function resetResourceToggleStateForTests(): void {
  currentToggleState = createEmptyToggleState();
  currentCliOverrides = parseSkillCliOverrides({ argv: [] });
}

export function setSkillCliOverridesForTests(overrides: SkillCliOverrides): void {
  currentCliOverrides = overrides;
}

export default function perFolderResourceToggling(pi: PiExtensionApi): void {
  currentCliOverrides = parseSkillCliOverrides();
  registerPiEvent(pi, 'session_start', async (event: SessionStartEvent, ctx?: ToggleContext) => {
    await refreshResourceToggleState(resolveToggleContext(event, ctx));
  });

  registerPiEvent(pi, 'resources_discover', async (event: ResourceDiscoverEvent, ctx?: ToggleContext) => {
    const state = await refreshResourceToggleState(resolveToggleContext(event, ctx));
    const skillPaths = getEnabledSkillPaths(state, { cli: currentCliOverrides });
    return skillPaths.length > 0 ? { skillPaths } : {};
  });

  registerPiEvent(pi, 'before_agent_start', async (event: BeforeAgentStartEvent) => {
    if (!hasAnyResourceToggles(currentToggleState)) {
      return undefined;
    }

    const systemPrompt = filterDisabledSkillsForSystemPrompt(event, currentToggleState, { cli: currentCliOverrides });
    return systemPrompt ? { systemPrompt } : undefined;
  });

  registerPiEvent(pi, 'input', async (event: InputEvent, ctx: ToggleContext) => {
    if (!hasAnyResourceToggles(currentToggleState)) {
      return { action: 'continue' };
    }

    return handleDisabledSkillInvocation(event, ctx, currentToggleState, { cli: currentCliOverrides });
  });
}

function resolveToggleContext(event: { ctx?: ToggleContext }, ctx?: ToggleContext): ToggleContext {
  const resolvedContext = event.ctx ?? ctx;
  if (!resolvedContext) {
    throw new Error('Per-folder resource toggling requires a Pi extension context.');
  }

  return resolvedContext;
}

function registerPiEvent(
  pi: PiExtensionApi,
  eventName: 'session_start' | 'resources_discover' | 'before_agent_start' | 'input',
  handler: (...args: never[]) => Promise<unknown> | unknown,
): void {
  if (typeof pi.on === 'function') {
    pi.on(eventName as never, handler as never);
    return;
  }

  if (typeof pi.registerEvent === 'function') {
    pi.registerEvent(eventName as never, handler as never);
    return;
  }

  if (typeof pi.events?.on === 'function') {
    pi.events.on(eventName as never, handler as never);
  }
}

export {
  filterDisabledSkillsForSystemPrompt,
  getEnabledSkillPaths,
  handleDisabledSkillInvocation,
  parseSkillCliOverrides,
  SKILL_DISABLED_MESSAGE,
  type SkillCliOverrides,
  type SkillDescriptor,
} from './skills.ts';

export {
  createEmptyToggleState,
  INVALID_CONFIG_MESSAGE,
  loadResourceToggleState,
  parseResourceToggleState,
  resolveResourceToggleConfigPath,
  saveResourceToggleState,
  type ResourceToggleMap,
  type ResourceToggleState,
  type ToggleContext,
  type ToggleValue,
} from './state.ts';