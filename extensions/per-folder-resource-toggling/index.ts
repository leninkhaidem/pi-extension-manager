import {
  createEmptyToggleState,
  loadResourceToggleState,
  type ResourceToggleState,
  type ToggleContext,
} from './state.ts';

export type ResourceDiscoverReason = 'startup' | 'reload' | string;

export interface ResourceDiscoverEvent {
  ctx: ToggleContext;
  reason?: ResourceDiscoverReason;
}

export interface SessionStartEvent {
  ctx: ToggleContext;
}

export interface PiExtensionApi {
  on?(event: 'session_start', handler: (event: SessionStartEvent) => Promise<void> | void): void;
  on?(event: 'resources_discover', handler: (event: ResourceDiscoverEvent) => Promise<object> | object): void;
  registerEvent?(event: 'session_start', handler: (event: SessionStartEvent) => Promise<void> | void): void;
  registerEvent?(event: 'resources_discover', handler: (event: ResourceDiscoverEvent) => Promise<object> | object): void;
  events?: {
    on?(event: 'session_start', handler: (event: SessionStartEvent) => Promise<void> | void): void;
    on?(event: 'resources_discover', handler: (event: ResourceDiscoverEvent) => Promise<object> | object): void;
  };
}

let currentToggleState: ResourceToggleState = createEmptyToggleState();

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
}

export default function perFolderResourceToggling(pi: PiExtensionApi): void {
  registerPiEvent(pi, 'session_start', async ({ ctx }: SessionStartEvent) => {
    await refreshResourceToggleState(ctx);
  });

  registerPiEvent(pi, 'resources_discover', async ({ ctx }: ResourceDiscoverEvent) => {
    await refreshResourceToggleState(ctx);
    return {};
  });
}

function registerPiEvent<EventName extends 'session_start' | 'resources_discover'>(
  pi: PiExtensionApi,
  eventName: EventName,
  handler: EventName extends 'session_start'
    ? (event: SessionStartEvent) => Promise<void> | void
    : (event: ResourceDiscoverEvent) => Promise<object> | object,
): void {
  if (typeof pi.on === 'function') {
    pi.on(eventName, handler as never);
    return;
  }

  if (typeof pi.registerEvent === 'function') {
    pi.registerEvent(eventName, handler as never);
    return;
  }

  if (typeof pi.events?.on === 'function') {
    pi.events.on(eventName, handler as never);
  }
}

export {
  createEmptyToggleState,
  hasAnyResourceToggles,
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
