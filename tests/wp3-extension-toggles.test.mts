import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import perFolderResourceToggling, {
  applyDisabledExtensionSuppression,
  classifyExtensionSuppressibility,
  EXTENSION_COMMAND_DISABLED_MESSAGE,
  handleDisabledExtensionCommandInvocation,
  resetResourceToggleStateForTests,
  saveResourceToggleState,
  type CommandDescriptor,
  type ToolDescriptor,
} from '../extensions/per-folder-resource-toggling/index.ts';

interface TestContext {
  cwd: string;
  isProjectTrusted(): boolean;
  ui: { notify(message: string): void };
  notices: string[];
}

type Handler = (event: never, ctx?: TestContext) => Promise<unknown> | unknown;

function createContext(cwd: string, trusted = true): TestContext {
  const notices: string[] = [];
  return {
    cwd,
    notices,
    isProjectTrusted: () => trusted,
    ui: {
      notify(message: string): void {
        notices.push(message);
      },
    },
  };
}

function registerExtension(api: Record<string, unknown> = {}): Map<string, Handler> {
  resetResourceToggleStateForTests();
  const handlers = new Map<string, Handler>();
  perFolderResourceToggling({
    ...api,
    on(eventName: string, handler: Handler): void {
      handlers.set(eventName, handler);
    },
  });
  return handlers;
}

async function withTempProject<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wp3-extension-toggles-'));
  try {
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function testToolSuppressionPreservesUnrelatedActiveTools(): Promise<void> {
  const setActiveCalls: string[][] = [];
  const tools: ToolDescriptor[] = [
    { name: 'disabled-tool', active: true, sourceInfo: { extensionId: 'disabled-ext' } },
    { name: 'other-tool', active: true, sourceInfo: { extensionId: 'other-ext' } },
    { name: 'already-off', active: false, sourceInfo: { extensionId: 'other-ext' } },
    { name: 'core-tool', active: true, source: 'core' },
  ];

  const result = await applyDisabledExtensionSuppression(
    {
      getAllTools: () => tools,
      getCommands: () => [],
      setActiveTools: (toolNames: string[]) => setActiveCalls.push(toolNames),
    },
    { skills: {}, extensions: { 'disabled-ext': false } },
  );

  assert.deepEqual(result.suppressedToolNames, ['disabled-tool']);
  assert.equal(result.appliedToolSuppression, true);
  assert.deepEqual(setActiveCalls, [['other-tool', 'core-tool']]);
}


async function testReEnableRestoresPreviouslySuppressedTools(): Promise<void> {
  const setActiveCalls: string[][] = [];
  const tools: ToolDescriptor[] = [
    { name: 'toggle-tool', active: true, sourceInfo: { extensionId: 'toggle-ext' } },
    { name: 'other-tool', active: true, sourceInfo: { extensionId: 'other-ext' } },
  ];
  const pi = {
    getAllTools: () => tools,
    getCommands: () => [],
    setActiveTools: (toolNames: string[]) => {
      setActiveCalls.push(toolNames);
      for (const tool of tools) {
        tool.active = Boolean(tool.name && toolNames.includes(tool.name));
      }
    },
  };

  await applyDisabledExtensionSuppression(pi, { skills: {}, extensions: { 'toggle-ext': false } });
  await applyDisabledExtensionSuppression(pi, { skills: {}, extensions: { 'toggle-ext': true } });

  assert.deepEqual(setActiveCalls, [['other-tool'], ['other-tool', 'toggle-tool']]);
}

async function testCommandSuppressionComposesAfterSkillHandler(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const ctx = createContext(projectRoot);
    const handlers = registerExtension({
      getAllTools: () => [],
      getCommands: (): CommandDescriptor[] => [
        { name: 'blocked-command', source: 'extension', sourceInfo: { extensionId: 'cmd-ext' } },
        { name: 'core-command', source: 'core', sourceInfo: { extensionId: 'cmd-ext' } },
      ],
    });

    await saveResourceToggleState(ctx, { skills: {}, extensions: { 'cmd-ext': false } });
    assert.deepEqual(await handlers.get('resources_discover')?.({ ctx, reason: 'startup' } as never), {});

    assert.deepEqual(await handlers.get('input')?.({ text: '/blocked-command arg', source: 'interactive' } as never, ctx), { action: 'handled' });
    assert.deepEqual(ctx.notices, [EXTENSION_COMMAND_DISABLED_MESSAGE]);
    assert.deepEqual(await handlers.get('input')?.({ text: '/core-command', source: 'interactive' } as never, ctx), { action: 'continue' });
  });
}

async function testBestEffortFailuresAndEventOnlyNoopDoNotThrow(): Promise<void> {
  const failureResult = await applyDisabledExtensionSuppression(
    {
      getAllTools: () => [{ name: 'disabled-tool', sourceInfo: { extensionId: 'flaky-ext' } }],
      getCommands: () => { throw new Error('registry unavailable'); },
      setActiveTools: () => { throw new Error('cannot set active tools'); },
    },
    { skills: { caveman: false }, extensions: { 'flaky-ext': false } },
  );

  assert.deepEqual(failureResult.suppressedToolNames, ['disabled-tool']);
  assert.equal(failureResult.appliedToolSuppression, false);
  assert.deepEqual(failureResult.blockedCommandNames, []);

  const eventOnlyResult = await applyDisabledExtensionSuppression(
    { getAllTools: () => [], getCommands: () => [], setActiveTools: () => { throw new Error('must not be called'); } },
    { skills: {}, extensions: { 'event-only-ext': false } },
  );
  assert.deepEqual(eventOnlyResult, {
    disabledExtensionIds: ['event-only-ext'],
    suppressedToolNames: [],
    blockedCommandNames: [],
    appliedToolSuppression: false,
  });
}

async function testClassifierCoversToolCommandBothNeither(): Promise<void> {
  const pi = {
    getAllTools: (): ToolDescriptor[] => [
      { name: 'tool-a', sourceInfo: { extensionId: 'tool-only' } },
      { name: 'tool-b', sourceInfo: { name: 'both' } },
    ],
    getCommands: (): CommandDescriptor[] => [
      { name: 'cmd-a', source: 'extension', sourceInfo: { extensionId: 'command-only' } },
      { name: 'cmd-b', source: 'extension', sourceInfo: { extensionId: 'both' } },
      { name: 'ignored', source: 'core', sourceInfo: { extensionId: 'command-only' } },
    ],
  };

  assert.deepEqual(await classifyExtensionSuppressibility(pi, 'tool-only'), {
    extensionId: 'tool-only',
    toolNames: ['tool-a'],
    commandNames: [],
    hasTools: true,
    hasCommands: false,
    suppressible: true,
  });
  assert.deepEqual(await classifyExtensionSuppressibility(pi, 'command-only'), {
    extensionId: 'command-only',
    toolNames: [],
    commandNames: ['cmd-a'],
    hasTools: false,
    hasCommands: true,
    suppressible: true,
  });
  assert.deepEqual(await classifyExtensionSuppressibility(pi, 'both'), {
    extensionId: 'both',
    toolNames: ['tool-b'],
    commandNames: ['cmd-b'],
    hasTools: true,
    hasCommands: true,
    suppressible: true,
  });
  assert.deepEqual(await classifyExtensionSuppressibility(pi, 'neither'), {
    extensionId: 'neither',
    toolNames: [],
    commandNames: [],
    hasTools: false,
    hasCommands: false,
    suppressible: false,
  });
}

async function testNoConfigEquivalentDoesNotSuppress(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const trustedCtx = createContext(projectRoot);
    const untrustedCtx = createContext(projectRoot, false);
    const setActiveCalls: string[][] = [];
    const handlers = registerExtension({
      getAllTools: (): ToolDescriptor[] => [{ name: 'target-tool', active: true, sourceInfo: { extensionId: 'target-ext' } }],
      getCommands: (): CommandDescriptor[] => [{ name: 'target-command', source: 'extension', sourceInfo: { extensionId: 'target-ext' } }],
      setActiveTools: (toolNames: string[]) => setActiveCalls.push(toolNames),
    });

    assert.deepEqual(await handlers.get('resources_discover')?.({ ctx: trustedCtx, reason: 'startup' } as never), {});
    assert.deepEqual(setActiveCalls, []);
    assert.deepEqual(await handlers.get('input')?.({ text: '/target-command', source: 'interactive' } as never, trustedCtx), { action: 'continue' });

    await saveResourceToggleState(trustedCtx, { skills: {}, extensions: { 'target-ext': false } });
    assert.deepEqual(await handlers.get('resources_discover')?.({ ctx: untrustedCtx, reason: 'reload' } as never), {});
    assert.deepEqual(setActiveCalls, []);
    assert.deepEqual(await handlers.get('input')?.({ text: '/target-command', source: 'interactive' } as never, untrustedCtx), { action: 'continue' });
  });
}

async function testDirectCommandHandlerFailureFallsThrough(): Promise<void> {
  const ctx = createContext('/tmp/project');
  const result = await handleDisabledExtensionCommandInvocation(
    { text: '/flaky' },
    ctx,
    { getCommands: () => { throw new Error('registry unavailable'); } },
    { skills: {}, extensions: { flaky: false } },
  );

  assert.deepEqual(result, { action: 'continue' });
  assert.deepEqual(ctx.notices, []);
}

assert.equal(EXTENSION_COMMAND_DISABLED_MESSAGE.includes('package'), false);
assert.equal(EXTENSION_COMMAND_DISABLED_MESSAGE.includes('Slice'), false);
assert.equal(EXTENSION_COMMAND_DISABLED_MESSAGE.includes('workflow'), false);
assert.equal(EXTENSION_COMMAND_DISABLED_MESSAGE.includes('planning'), false);

await testToolSuppressionPreservesUnrelatedActiveTools();
await testReEnableRestoresPreviouslySuppressedTools();
await testCommandSuppressionComposesAfterSkillHandler();
await testBestEffortFailuresAndEventOnlyNoopDoNotThrow();
await testClassifierCoversToolCommandBothNeither();
await testNoConfigEquivalentDoesNotSuppress();
await testDirectCommandHandlerFailureFallsThrough();

console.log('WP3 extension toggle checks passed');
