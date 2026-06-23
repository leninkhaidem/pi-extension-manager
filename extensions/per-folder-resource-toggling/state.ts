import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { CONFIG_DIR_NAME } from './pi-constants.ts';

export const RESOURCE_TOGGLES_FILE_NAME = 'resource-toggles.json';
export const INVALID_CONFIG_MESSAGE =
  'The resource toggle file is invalid. Global skills and extensions remain in effect.';

export type ResourceType = 'skills' | 'extensions';
export type ToggleValue = boolean;
export type ResourceToggleMap = Record<string, ToggleValue>;

export interface ResourceToggleState {
  skills: ResourceToggleMap;
  extensions: ResourceToggleMap;
}

export interface ToggleContext {
  cwd: string;
  isProjectTrusted(): boolean;
  ui?: {
    notify?(message: string): void | Promise<void>;
  };
}

export interface LoadResourceToggleOptions {
  readText?: (path: string) => Promise<string>;
}

export interface SaveResourceToggleOptions {
  writeText?: (path: string, content: string) => Promise<void>;
  makeDirectory?: (path: string) => Promise<void>;
}

const EMPTY_TOGGLE_STATE: ResourceToggleState = Object.freeze({
  skills: Object.freeze({}),
  extensions: Object.freeze({}),
});

export function createEmptyToggleState(): ResourceToggleState {
  return {
    skills: {},
    extensions: {},
  };
}

export function resolveResourceToggleConfigPath(ctx: Pick<ToggleContext, 'cwd'>): string {
  return join(ctx.cwd, CONFIG_DIR_NAME, RESOURCE_TOGGLES_FILE_NAME);
}

export function hasAnyResourceToggles(state: ResourceToggleState): boolean {
  return Object.keys(state.skills).length > 0 || Object.keys(state.extensions).length > 0;
}

export function cloneResourceToggleState(state: ResourceToggleState): ResourceToggleState {
  return {
    skills: { ...state.skills },
    extensions: { ...state.extensions },
  };
}

export async function loadResourceToggleState(
  ctx: ToggleContext,
  options: LoadResourceToggleOptions = {},
): Promise<ResourceToggleState> {
  if (!ctx.isProjectTrusted()) {
    return createEmptyToggleState();
  }

  const readText = options.readText ?? readFileText;
  const configPath = resolveResourceToggleConfigPath(ctx);

  try {
    const rawConfig = await readText(configPath);
    const parsedConfig = JSON.parse(rawConfig) as unknown;
    return parseResourceToggleState(parsedConfig);
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyToggleState();
    }

    await notifyInvalidConfig(ctx);
    return createEmptyToggleState();
  }
}

export async function saveResourceToggleState(
  ctx: ToggleContext,
  state: ResourceToggleState,
  options: SaveResourceToggleOptions = {},
): Promise<boolean> {
  if (!ctx.isProjectTrusted()) {
    return false;
  }

  const configPath = resolveResourceToggleConfigPath(ctx);
  const makeDirectory = options.makeDirectory ?? makeDirectoryRecursive;
  const writeText = options.writeText ?? writeFileText;
  const serializableState = cloneResourceToggleState(parseResourceToggleState(state));

  await makeDirectory(dirname(configPath));
  await writeText(`${configPath}`, `${JSON.stringify(serializableState, null, 2)}\n`);
  return true;
}

export function parseResourceToggleState(value: unknown): ResourceToggleState {
  if (!isPlainObject(value)) {
    throw new Error('Resource toggle state must be an object.');
  }

  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('skills') || !keys.includes('extensions')) {
    throw new Error('Resource toggle state must contain only skills and extensions.');
  }

  return {
    skills: parseToggleMap(value.skills),
    extensions: parseToggleMap(value.extensions),
  };
}

async function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function writeFileText(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
}

async function makeDirectoryRecursive(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function parseToggleMap(value: unknown): ResourceToggleMap {
  if (!isPlainObject(value)) {
    throw new Error('Resource toggle section must be an object.');
  }

  const toggles: ResourceToggleMap = {};
  for (const [resourceId, toggleValue] of Object.entries(value)) {
    if (typeof toggleValue !== 'boolean') {
      throw new Error('Resource toggle values must be booleans.');
    }
    toggles[resourceId] = toggleValue;
  }
  return toggles;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isPlainObject(error) && error.code === 'ENOENT';
}

async function notifyInvalidConfig(ctx: ToggleContext): Promise<void> {
  await ctx.ui?.notify?.(INVALID_CONFIG_MESSAGE);
}

export { CONFIG_DIR_NAME, EMPTY_TOGGLE_STATE };
