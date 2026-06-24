import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import perFolderResourceToggling, {
  BEST_EFFORT_EXTENSION_DETAIL,
  EVENT_ONLY_EXTENSION_DETAIL,
  NON_TUI_MESSAGE,
  RESOURCE_TOGGLE_COMMAND,
  RESOURCE_TOGGLE_COMMAND_DESCRIPTION,
  SAVE_SUCCESS_MESSAGE,
  buildResourceToggleView,
  resetResourceToggleStateForTests,
  resolveResourceToggleConfigPath,
  saveResourceToggleState,
  type CommandDescriptor,
  type ResourceToggleView,
  type SkillDescriptor,
  type ToolDescriptor,
} from '../extensions/per-folder-resource-toggling/index.ts';

interface TestContext {
  cwd: string;
  mode: string;
  hasUI: boolean;
  isProjectTrusted(): boolean;
  ui: {
    notify(message: string): void;
    custom(view: ResourceToggleView): void;
  };
  notices: string[];
  customViews: ResourceToggleView[];
  skills?: SkillDescriptor[];
}

async function withTempProject<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wp4-resource-toggles-'));
  try {
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function createContext(cwd: string, mode = 'tui'): TestContext {
  const notices: string[] = [];
  const customViews: ResourceToggleView[] = [];
  return {
    cwd,
    mode,
    hasUI: true,
    notices,
    customViews,
    isProjectTrusted: () => true,
    ui: {
      notify(message: string): void {
        notices.push(message);
      },
      custom(view: ResourceToggleView): void {
        customViews.push(view);
      },
    },
  };
}

function createPi(api: Record<string, unknown> = {}): { commands: Map<string, { description: string; handler(args: string, ctx: TestContext): Promise<void> }> } & Record<string, unknown> {
  const commands = new Map<string, { description: string; handler(args: string, ctx: TestContext): Promise<void> }>();
  return {
    commands,
    ...api,
    registerCommand(name: string, options: { description: string; handler(args: string, ctx: TestContext): Promise<void> }): void {
      assert.equal(typeof name, 'string');
      commands.set(name, options);
    },
    on(): void {},
  };
}

const alphaSkill: SkillDescriptor = { name: 'alpha', description: 'Alpha skill', filePath: '/skills/alpha/SKILL.md' };
const betaSkill: SkillDescriptor = { name: 'beta', description: 'Beta skill', filePath: '/skills/beta/SKILL.md' };

async function testCommandRegistrationAndTuiOpen(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    resetResourceToggleStateForTests();
    const pi = createPi({
      getSkills: (): SkillDescriptor[] => [alphaSkill, betaSkill],
      getExtensions: () => [{ id: 'tool-ext' }],
      getAllTools: (): ToolDescriptor[] => [{ name: 'tool-a', sourceInfo: { extensionId: 'tool-ext' } }],
      getCommands: (): CommandDescriptor[] => [],
    });
    perFolderResourceToggling(pi as never);

    const command = pi.commands.get(RESOURCE_TOGGLE_COMMAND);
    assert.ok(command);
    assert.equal(typeof RESOURCE_TOGGLE_COMMAND, 'string');
    assert.equal(RESOURCE_TOGGLE_COMMAND, 'skills-extensions');
    assert.equal(command?.description, RESOURCE_TOGGLE_COMMAND_DESCRIPTION);
    assert.equal(typeof command?.handler, 'function');

    const ctx = createContext(projectRoot);
    await command?.handler('', ctx);
    assert.equal(ctx.customViews.length, 1);
    assert.equal(ctx.customViews[0].title, 'Skills and extensions');
    assert.equal(ctx.customViews[0].items.filter((item) => item.kind === 'skill').length, 2);
  });
}

async function testNonTuiDoesNotRenderCustomUi(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    resetResourceToggleStateForTests();
    const pi = createPi({
      getSkills: (): SkillDescriptor[] => [alphaSkill],
      getAllTools: (): ToolDescriptor[] => { throw new Error('must not render or list'); },
    });
    perFolderResourceToggling(pi as never);
    const command = pi.commands.get(RESOURCE_TOGGLE_COMMAND);

    for (const mode of ['print', 'json', 'rpc']) {
      const ctx = createContext(projectRoot, mode);
      await command?.handler('', ctx);
      assert.equal(ctx.customViews.length, 0);
      assert.deepEqual(ctx.notices, [NON_TUI_MESSAGE]);
    }
  });
}

async function testSkillAndExtensionListingHonesty(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const ctx = createContext(projectRoot);
    const view = await buildResourceToggleView(
      {
        getSkills: (): SkillDescriptor[] => [alphaSkill, betaSkill],
        getExtensions: () => [{ id: 'tool-ext' }, { id: 'command-ext' }, { id: 'event-only-ext' }],
        getAllTools: (): ToolDescriptor[] => [{ name: 'tool-a', sourceInfo: { extensionId: 'tool-ext' } }],
        getCommands: (): CommandDescriptor[] => [{ name: 'cmd-a', source: 'extension', sourceInfo: { extensionId: 'command-ext' } }],
      },
      ctx,
      { skills: { [betaSkill.filePath]: false }, extensions: { 'command-ext': false } },
    );

    assert.deepEqual(view.items.filter((item) => item.kind === 'skill').map((item) => [item.label, item.enabled, item.toggleable]), [
      ['alpha', true, true],
      ['beta', false, true],
    ]);

    const toolExtension = view.items.find((item) => item.id === 'tool-ext');
    assert.deepEqual({ enabled: toolExtension?.enabled, toggleable: toolExtension?.toggleable, detail: toolExtension?.detail }, {
      enabled: true,
      toggleable: true,
      detail: BEST_EFFORT_EXTENSION_DETAIL,
    });

    const commandExtension = view.items.find((item) => item.id === 'command-ext');
    assert.deepEqual({ enabled: commandExtension?.enabled, toggleable: commandExtension?.toggleable, detail: commandExtension?.detail }, {
      enabled: false,
      toggleable: true,
      detail: BEST_EFFORT_EXTENSION_DETAIL,
    });

    const eventOnlyExtension = view.items.find((item) => item.id === 'event-only-ext');
    assert.deepEqual({ enabled: eventOnlyExtension?.enabled, toggleable: eventOnlyExtension?.toggleable, detail: eventOnlyExtension?.detail }, {
      enabled: true,
      toggleable: false,
      detail: EVENT_ONLY_EXTENSION_DETAIL,
    });
  });
}

async function testTogglePersistsOnlySkillsAndExtensionsAndRoundTrips(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const ctx = createContext(projectRoot);
    await saveResourceToggleState(ctx, { skills: {}, extensions: {} });
    const view = await buildResourceToggleView(
      {
        getSkills: (): SkillDescriptor[] => [alphaSkill],
        getExtensions: () => [{ id: 'tool-ext' }, { id: 'event-only-ext' }],
        getAllTools: (): ToolDescriptor[] => [{ name: 'tool-a', sourceInfo: { extensionId: 'tool-ext' } }],
        getCommands: (): CommandDescriptor[] => [],
      },
      ctx,
      { skills: {}, extensions: {} },
    );

    assert.deepEqual(await view.onToggle(alphaSkill.filePath, false), { skills: { [alphaSkill.filePath]: false }, extensions: {} });
    assert.deepEqual(await view.onToggle('tool-ext', false), { skills: { [alphaSkill.filePath]: false }, extensions: { 'tool-ext': false } });
    assert.deepEqual(await view.onToggle('event-only-ext', false), { skills: { [alphaSkill.filePath]: false }, extensions: { 'tool-ext': false } });
    assert.deepEqual(ctx.notices, [SAVE_SUCCESS_MESSAGE, SAVE_SUCCESS_MESSAGE]);

    const stored = JSON.parse(await readFile(resolveResourceToggleConfigPath(ctx), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(stored).sort(), ['extensions', 'skills']);
    assert.equal(Object.hasOwn(stored, 'plugins'), false);

    const reopened = await buildResourceToggleView(
      {
        getSkills: (): SkillDescriptor[] => [alphaSkill],
        getExtensions: () => [{ id: 'tool-ext' }],
        getAllTools: (): ToolDescriptor[] => [{ name: 'tool-a', sourceInfo: { extensionId: 'tool-ext' } }],
        getCommands: (): CommandDescriptor[] => [],
      },
      ctx,
      stored as never,
    );
    assert.equal(reopened.items.find((item) => item.id === alphaSkill.filePath)?.enabled, false);
    assert.equal(reopened.items.find((item) => item.id === 'tool-ext')?.enabled, false);
  });
}

function testAudienceText(): void {
  const texts = [
    RESOURCE_TOGGLE_COMMAND,
    RESOURCE_TOGGLE_COMMAND_DESCRIPTION,
    NON_TUI_MESSAGE,
    SAVE_SUCCESS_MESSAGE,
    BEST_EFFORT_EXTENSION_DETAIL,
    EVENT_ONLY_EXTENSION_DETAIL,
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /allowlist|denylist|package|Slice|workflow|planning/i);
  }
}

await testCommandRegistrationAndTuiOpen();
await testNonTuiDoesNotRenderCustomUi();
await testSkillAndExtensionListingHonesty();
await testTogglePersistsOnlySkillsAndExtensionsAndRoundTrips();
testAudienceText();

console.log('WP4 TUI resource toggle checks passed');
