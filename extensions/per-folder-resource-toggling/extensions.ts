import type { ResourceToggleState, ToggleContext } from './state.ts';

export const EXTENSION_COMMAND_DISABLED_MESSAGE = 'This extension command is disabled for this project.';

export interface ExtensionSourceInfo {
  [key: string]: unknown;
}

export interface ToolDescriptor {
  id?: string;
  name?: string;
  active?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  source?: string;
  sourceInfo?: string | ExtensionSourceInfo | null;
}

export interface CommandDescriptor {
  id?: string;
  name?: string;
  command?: string;
  title?: string;
  source?: string;
  sourceInfo?: string | ExtensionSourceInfo | null;
}

export interface ExtensionIntrospectionApi {
  getAllTools?(): ToolDescriptor[] | Promise<ToolDescriptor[]>;
  getCommands?(): CommandDescriptor[] | Promise<CommandDescriptor[]>;
  setActiveTools?(toolNames: string[]): void | Promise<void>;
}

export interface ExtensionSuppressibility {
  extensionId: string;
  toolNames: string[];
  commandNames: string[];
  hasTools: boolean;
  hasCommands: boolean;
  suppressible: boolean;
}

export interface ExtensionSuppressionResult {
  disabledExtensionIds: string[];
  suppressedToolNames: string[];
  blockedCommandNames: string[];
  appliedToolSuppression: boolean;
}

export type InputHandlerResult = { action: 'continue' } | { action: 'handled' };

let lastSuppressedToolNames = new Set<string>();

export function resetExtensionSuppressionForTests(): void {
  lastSuppressedToolNames = new Set<string>();
}

export async function applyDisabledExtensionSuppression(
  pi: ExtensionIntrospectionApi,
  state: ResourceToggleState,
): Promise<ExtensionSuppressionResult> {
  const disabledExtensionIds = getDisabledExtensionIds(state);
  if (disabledExtensionIds.length === 0 && lastSuppressedToolNames.size === 0) {
    return emptySuppressionResult();
  }

  const tools = await safelyListTools(pi);
  const disabledToolNames = tools
    .filter((tool) => disabledExtensionIds.some((extensionId) => isFromExtension(tool, extensionId)))
    .map(getToolName)
    .filter((name): name is string => Boolean(name));

  let appliedToolSuppression = false;
  if ((disabledToolNames.length > 0 || (lastSuppressedToolNames.size > 0 && tools.length > 0)) && typeof pi.setActiveTools === 'function') {
    try {
      const knownToolNames = new Set(tools.map(getToolName).filter((name): name is string => Boolean(name)));
      const disabledToolNameSet = new Set(disabledToolNames);
      const restoredToolNames = [...lastSuppressedToolNames]
        .filter((name) => knownToolNames.has(name) && !disabledToolNameSet.has(name));
      const activeToolNames = uniqueStrings([
        ...tools
          .filter(isCurrentlyActiveTool)
          .map(getToolName)
          .filter((name): name is string => Boolean(name)),
        ...restoredToolNames,
      ]).filter((name) => !disabledToolNameSet.has(name));

      await pi.setActiveTools(activeToolNames);
      lastSuppressedToolNames = disabledToolNameSet;
      appliedToolSuppression = true;
    } catch {
      appliedToolSuppression = false;
    }
  }

  const commands = await safelyListCommands(pi);
  const blockedCommandNames = commands
    .filter((command) => disabledExtensionIds.some((extensionId) => isExtensionCommandFrom(command, extensionId)))
    .map(getCommandName)
    .filter((name): name is string => Boolean(name));

  return {
    disabledExtensionIds,
    suppressedToolNames: uniqueStrings(disabledToolNames),
    blockedCommandNames: uniqueStrings(blockedCommandNames),
    appliedToolSuppression,
  };
}

export async function classifyExtensionSuppressibility(
  pi: ExtensionIntrospectionApi,
  extensionId: string,
): Promise<ExtensionSuppressibility> {
  const [tools, commands] = await Promise.all([safelyListTools(pi), safelyListCommands(pi)]);
  const toolNames = tools
    .filter((tool) => isFromExtension(tool, extensionId))
    .map(getToolName)
    .filter((name): name is string => Boolean(name));
  const commandNames = commands
    .filter((command) => isExtensionCommandFrom(command, extensionId))
    .map(getCommandName)
    .filter((name): name is string => Boolean(name));

  return buildSuppressibility(extensionId, toolNames, commandNames);
}

export async function classifyKnownExtensionSuppressibility(
  pi: ExtensionIntrospectionApi,
  extensionIds: readonly string[],
): Promise<ExtensionSuppressibility[]> {
  const [tools, commands] = await Promise.all([safelyListTools(pi), safelyListCommands(pi)]);
  return extensionIds.map((extensionId) => buildSuppressibility(
    extensionId,
    tools.filter((tool) => isFromExtension(tool, extensionId)).map(getToolName).filter((name): name is string => Boolean(name)),
    commands.filter((command) => isExtensionCommandFrom(command, extensionId)).map(getCommandName).filter((name): name is string => Boolean(name)),
  ));
}

export async function handleDisabledExtensionCommandInvocation(
  event: { text: string },
  ctx: Pick<ToggleContext, 'ui'>,
  pi: ExtensionIntrospectionApi,
  state: ResourceToggleState,
): Promise<InputHandlerResult> {
  const commandName = parseSlashCommandName(event.text);
  if (!commandName) {
    return { action: 'continue' };
  }

  const disabledExtensionIds = getDisabledExtensionIds(state);
  if (disabledExtensionIds.length === 0) {
    return { action: 'continue' };
  }

  const commands = await safelyListCommands(pi);
  const commandIsDisabled = commands.some((command) => {
    const registeredName = getCommandName(command);
    return registeredName === commandName && disabledExtensionIds.some((extensionId) => isExtensionCommandFrom(command, extensionId));
  });

  if (!commandIsDisabled) {
    return { action: 'continue' };
  }

  await ctx.ui?.notify?.(EXTENSION_COMMAND_DISABLED_MESSAGE);
  return { action: 'handled' };
}

function getDisabledExtensionIds(state: ResourceToggleState): string[] {
  return Object.entries(state.extensions)
    .filter(([, enabled]) => enabled === false)
    .map(([extensionId]) => extensionId);
}

async function safelyListTools(pi: ExtensionIntrospectionApi): Promise<ToolDescriptor[]> {
  if (typeof pi.getAllTools !== 'function') {
    return [];
  }

  try {
    const tools = await pi.getAllTools();
    return Array.isArray(tools) ? tools : [];
  } catch {
    return [];
  }
}

async function safelyListCommands(pi: ExtensionIntrospectionApi): Promise<CommandDescriptor[]> {
  if (typeof pi.getCommands !== 'function') {
    return [];
  }

  try {
    const commands = await pi.getCommands();
    return Array.isArray(commands) ? commands : [];
  } catch {
    return [];
  }
}

function isFromExtension(resource: { source?: string; sourceInfo?: string | ExtensionSourceInfo | null }, extensionId: string): boolean {
  return sourceCandidates(resource).has(extensionId);
}

function isExtensionCommandFrom(command: CommandDescriptor, extensionId: string): boolean {
  return command.source === 'extension' && isFromExtension(command, extensionId);
}

function sourceCandidates(resource: { source?: string; sourceInfo?: string | ExtensionSourceInfo | null }): Set<string> {
  const candidates = new Set<string>();
  addCandidate(candidates, resource.source);

  const sourceInfo = resource.sourceInfo;
  if (typeof sourceInfo === 'string') {
    addCandidate(candidates, sourceInfo);
    return candidates;
  }

  if (!sourceInfo || typeof sourceInfo !== 'object') {
    return candidates;
  }

  for (const key of ['id', 'name', 'extensionId', 'extensionName', 'packageName', 'package', 'sourceId', 'path', 'filePath', 'modulePath', 'directory']) {
    addCandidate(candidates, sourceInfo[key]);
  }

  return candidates;
}

function addCandidate(candidates: Set<string>, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }

  candidates.add(value);
  const pathPart = value.split(/[\\/]/).filter(Boolean).at(-1);
  if (pathPart) {
    candidates.add(pathPart.replace(/\.[cm]?[jt]s$/i, ''));
  }
}

function getToolName(tool: ToolDescriptor): string | null {
  return tool.name ?? tool.id ?? null;
}

function getCommandName(command: CommandDescriptor): string | null {
  const rawName = command.name ?? command.command ?? command.id ?? null;
  return rawName ? rawName.replace(/^\//, '') : null;
}

function isCurrentlyActiveTool(tool: ToolDescriptor): boolean {
  if (tool.disabled === true) {
    return false;
  }

  if (tool.active === false || tool.enabled === false) {
    return false;
  }

  return true;
}

function parseSlashCommandName(text: string): string | null {
  if (!text.startsWith('/')) {
    return null;
  }

  const [rawCommand] = text.slice(1).trimStart().split(/\s+/, 1);
  return rawCommand || null;
}

function buildSuppressibility(extensionId: string, toolNames: string[], commandNames: string[]): ExtensionSuppressibility {
  const uniqueToolNames = uniqueStrings(toolNames);
  const uniqueCommandNames = uniqueStrings(commandNames);
  return {
    extensionId,
    toolNames: uniqueToolNames,
    commandNames: uniqueCommandNames,
    hasTools: uniqueToolNames.length > 0,
    hasCommands: uniqueCommandNames.length > 0,
    suppressible: uniqueToolNames.length > 0 || uniqueCommandNames.length > 0,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function emptySuppressionResult(): ExtensionSuppressionResult {
  return {
    disabledExtensionIds: [],
    suppressedToolNames: [],
    blockedCommandNames: [],
    appliedToolSuppression: false,
  };
}
