import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import perFolderResourceToggling, {
  getResourceToggleState,
  INVALID_CONFIG_MESSAGE,
  loadResourceToggleState,
  parseResourceToggleState,
  resetResourceToggleStateForTests,
  resolveResourceToggleConfigPath,
  saveResourceToggleState,
  type ResourceToggleState,
} from '../extensions/per-folder-resource-toggling/index.ts';
import { CONFIG_DIR_NAME } from '../extensions/per-folder-resource-toggling/pi-constants.ts';

interface TestContext {
  cwd: string;
  isProjectTrusted(): boolean;
  ui: { notify(message: string): void };
}

function createContext(cwd: string, trusted = true): TestContext & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    cwd,
    warnings,
    isProjectTrusted: () => trusted,
    ui: {
      notify(message: string): void {
        warnings.push(message);
      },
    },
  };
}

async function withTempProject<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wp1-resource-toggles-'));
  try {
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function testTrustGateDoesNotRead(): Promise<void> {
  const ctx = createContext('/untrusted/project', false);
  let readCalled = false;

  const state = await loadResourceToggleState(ctx, {
    readText: async () => {
      readCalled = true;
      return JSON.stringify({ skills: { hidden: false }, extensions: {} });
    },
  });

  assert.deepEqual(state, { skills: {}, extensions: {} });
  assert.equal(readCalled, false);
  assert.deepEqual(ctx.warnings, []);
}

async function testAbsentFileIsDefaultWithoutWarning(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const ctx = createContext(projectRoot);
    const state = await loadResourceToggleState(ctx);

    assert.deepEqual(state, { skills: {}, extensions: {} });
    assert.deepEqual(ctx.warnings, []);
  });
}

async function testInvalidAndPartialWarnOnceWithoutThrowing(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const malformedCtx = createContext(projectRoot);
    await writeFile(resolveResourceToggleConfigPath(malformedCtx), '{not json', { flag: 'w' }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      await saveTextAtConfigPath(malformedCtx, '{not json');
    });

    const malformedState = await loadResourceToggleState(malformedCtx);
    assert.deepEqual(malformedState, { skills: {}, extensions: {} });
    assert.deepEqual(malformedCtx.warnings, [INVALID_CONFIG_MESSAGE]);

    const partialCtx = createContext(projectRoot);
    await saveTextAtConfigPath(partialCtx, JSON.stringify({ skills: { alpha: true } }));

    const partialState = await loadResourceToggleState(partialCtx);
    assert.deepEqual(partialState, { skills: {}, extensions: {} });
    assert.deepEqual(partialCtx.warnings, [INVALID_CONFIG_MESSAGE]);
  });
}

async function testRoundTripAndPluginRejection(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const ctx = createContext(projectRoot);
    const original: ResourceToggleState = {
      skills: { alpha: true, beta: false },
      extensions: { tools: false },
    };

    assert.equal(await saveResourceToggleState(ctx, original), true);
    const stored = JSON.parse(await readFile(resolveResourceToggleConfigPath(ctx), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(stored).sort(), ['extensions', 'skills']);
    assert.equal(Object.hasOwn(stored, 'plugins'), false);

    const loaded = await loadResourceToggleState(ctx);
    assert.deepEqual(loaded, original);
    assert.throws(() => parseResourceToggleState({ ...original, plugins: { legacy: false } }));
  });
}

async function testLifecycleRefreshes(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    resetResourceToggleStateForTests();
    const handlers = new Map<string, (event: { ctx: TestContext; reason?: string }) => Promise<object | void> | object | void>();
    perFolderResourceToggling({
      on(eventName: string, handler: (event: { ctx: TestContext; reason?: string }) => Promise<object | void> | object | void): void {
        handlers.set(eventName, handler);
      },
    });

    const ctx = createContext(projectRoot);
    await saveResourceToggleState(ctx, { skills: { session: true }, extensions: {} });
    await handlers.get('session_start')?.({ ctx });
    assert.deepEqual(getResourceToggleState(), { skills: { session: true }, extensions: {} });

    await saveResourceToggleState(ctx, { skills: { startup: false }, extensions: { ext: true } });
    assert.deepEqual(await handlers.get('resources_discover')?.({ ctx, reason: 'startup' }), {});
    assert.deepEqual(getResourceToggleState(), { skills: { startup: false }, extensions: { ext: true } });

    await saveResourceToggleState(ctx, { skills: {}, extensions: { reload: false } });
    assert.deepEqual(await handlers.get('resources_discover')?.({ ctx, reason: 'reload' }), {});
    assert.deepEqual(getResourceToggleState(), { skills: {}, extensions: { reload: false } });
  });
}

async function saveTextAtConfigPath(ctx: TestContext, content: string): Promise<void> {
  await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
    await mkdir(join(ctx.cwd, CONFIG_DIR_NAME), { recursive: true });
    await writeFile(resolveResourceToggleConfigPath(ctx), content, 'utf8');
  });
}

assert.equal(resolveResourceToggleConfigPath({ cwd: '/project/root' }), join('/project/root', CONFIG_DIR_NAME, 'resource-toggles.json'));
assert.equal(INVALID_CONFIG_MESSAGE.includes('package'), false);
assert.equal(INVALID_CONFIG_MESSAGE.includes('Slice'), false);
assert.equal(INVALID_CONFIG_MESSAGE.includes('workflow'), false);
assert.equal(INVALID_CONFIG_MESSAGE.includes('planning'), false);

await testTrustGateDoesNotRead();
await testAbsentFileIsDefaultWithoutWarning();
await testInvalidAndPartialWarnOnceWithoutThrowing();
await testRoundTripAndPluginRejection();
await testLifecycleRefreshes();

console.log('WP1 resource toggle checks passed');
