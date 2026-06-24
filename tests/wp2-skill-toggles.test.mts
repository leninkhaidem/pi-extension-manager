import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import perFolderResourceToggling, {
  parseSkillCliOverrides,
  resetResourceToggleStateForTests,
  saveResourceToggleState,
  setSkillCliOverridesForTests,
  SKILL_DISABLED_MESSAGE,
  type SkillDescriptor,
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

function registerExtension(): Map<string, Handler> {
  resetResourceToggleStateForTests();
  const handlers = new Map<string, Handler>();
  perFolderResourceToggling({
    on(eventName: string, handler: Handler): void {
      handlers.set(eventName, handler);
    },
  });
  return handlers;
}

async function withTempProject<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wp2-skill-toggles-'));
  try {
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function createSkill(projectRoot: string, dirName: string, name = dirName): Promise<SkillDescriptor> {
  const filePath = join(projectRoot, 'skills', dirName, 'SKILL.md');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `---\nname: ${name}\ndescription: ${name} description\n---\n${name.toUpperCase()} SECRET BODY\n`, 'utf8');
  return { name, description: `${name} description`, filePath, baseDir: dirname(filePath), disableModelInvocation: false };
}


async function expandSkillForTest(skill: SkillDescriptor, args = ''): Promise<string> {
  const content = await readFile(skill.filePath, 'utf8');
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir ?? skill.filePath}.\n\n${body}\n</skill>`;
  return args ? `${skillBlock}\n\n${args}` : skillBlock;
}

function promptFor(skills: SkillDescriptor[], currentPiWording = false): string {
  return [
    'base prompt',
    '',
    'The following skills provide specialized instructions for specific tasks.',
    currentPiWording
      ? 'Read the full skill file when the task matches its description.'
      : "Use the read tool to load a skill's file when the task matches its description.",
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
    ...skills.flatMap((skill) => [
      '  <skill>',
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
      `    <location>${skill.filePath}</location>`,
      '  </skill>',
    ]),
    '</available_skills>',
  ].join('\n');
}

async function testEnableReturnsSkillPathsUnlessNoSkills(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const handlers = registerExtension();
    const ctx = createContext(projectRoot);
    const enabledSkill = await createSkill(projectRoot, 'enabled-skill');
    await saveResourceToggleState(ctx, { skills: { [enabledSkill.filePath]: true }, extensions: {} });

    const discover = handlers.get('resources_discover');
    assert.deepEqual(await discover?.({ ctx, reason: 'startup' } as never), { skillPaths: [enabledSkill.filePath] });

    const loaded = await expandSkillForTest(enabledSkill);
    assert.match(loaded, /<skill name="enabled-skill"/);
    assert.match(loaded, /ENABLED-SKILL SECRET BODY/);

    setSkillCliOverridesForTests(parseSkillCliOverrides({ argv: ['--no-skills'] }));
    assert.deepEqual(await discover?.({ ctx, reason: 'reload' } as never), {});
  });
}

async function testDisableBothSurfacesForSameSkill(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const handlers = registerExtension();
    const ctx = createContext(projectRoot);
    const disabledSkill = await createSkill(projectRoot, 'caveman');
    const otherSkill = await createSkill(projectRoot, 'other');
    await saveResourceToggleState(ctx, { skills: { caveman: false }, extensions: {} });
    await handlers.get('resources_discover')?.({ ctx, reason: 'startup' } as never);

    const beforeEvent = {
      systemPrompt: promptFor([disabledSkill, otherSkill]),
      systemPromptOptions: { skills: [disabledSkill, otherSkill] },
    };
    const beforeResult = await handlers.get('before_agent_start')?.(beforeEvent as never, ctx) as { systemPrompt?: string } | undefined;
    assert.deepEqual(beforeEvent.systemPromptOptions.skills, [otherSkill]);
    assert.equal(beforeResult?.systemPrompt?.includes('<name>caveman</name>'), false);
    assert.equal(beforeResult?.systemPrompt?.includes('<name>other</name>'), true);

    const inputResult = await handlers.get('input')?.({ text: '/skill:caveman do it', source: 'interactive' } as never, ctx);
    assert.deepEqual(inputResult, { action: 'handled' });
    assert.deepEqual(ctx.notices, [SKILL_DISABLED_MESSAGE]);

    const wouldExpandWithoutBlock = await expandSkillForTest(disabledSkill, 'do it');
    assert.match(wouldExpandWithoutBlock, /CAVEMAN SECRET BODY/);
  });
}

async function testCurrentPiSkillPromptWordingIsReplaced(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const handlers = registerExtension();
    const ctx = createContext(projectRoot);
    const disabledSkill = await createSkill(projectRoot, 'current-wording-disabled');
    const otherSkill = await createSkill(projectRoot, 'current-wording-other');
    await saveResourceToggleState(ctx, { skills: { [disabledSkill.filePath]: false }, extensions: {} });
    await handlers.get('resources_discover')?.({ ctx, reason: 'startup' } as never);

    const beforeEvent = {
      systemPrompt: promptFor([disabledSkill, otherSkill], true),
      systemPromptOptions: { skills: [disabledSkill, otherSkill] },
    };
    const beforeResult = await handlers.get('before_agent_start')?.(beforeEvent as never, ctx) as { systemPrompt?: string } | undefined;
    assert.deepEqual(beforeEvent.systemPromptOptions.skills, [otherSkill]);
    assert.equal(beforeResult?.systemPrompt?.includes('Read the full skill file'), false);
    assert.equal(beforeResult?.systemPrompt?.includes('<name>current-wording-disabled</name>'), false);
    assert.equal(beforeResult?.systemPrompt?.includes('<name>current-wording-other</name>'), true);
  });
}

async function testDynamicSkillPersistedByPathFiltersBeforeAgentStart(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const handlers = registerExtension();
    const ctx = createContext(projectRoot);
    const dynamicSkill = { name: 'dynamic-path-skill', description: 'Dynamic path skill', filePath: '/dynamic/skills/dynamic-path-skill/SKILL.md' };
    const otherSkill = await createSkill(projectRoot, 'dynamic-other');
    await saveResourceToggleState(ctx, { skills: { [dynamicSkill.filePath]: false }, extensions: {} });
    await handlers.get('resources_discover')?.({ ctx, reason: 'startup' } as never);

    const beforeEvent = {
      systemPrompt: promptFor([dynamicSkill, otherSkill]),
      systemPromptOptions: { skills: [dynamicSkill, otherSkill] },
    };
    const beforeResult = await handlers.get('before_agent_start')?.(beforeEvent as never, ctx) as { systemPrompt?: string } | undefined;
    assert.deepEqual(beforeEvent.systemPromptOptions.skills, [otherSkill]);
    assert.equal(beforeResult?.systemPrompt?.includes('<name>dynamic-path-skill</name>'), false);
    assert.equal(beforeResult?.systemPrompt?.includes('<name>dynamic-other</name>'), true);
  });
}

async function testExplicitSkillOverridesDisableOnBothSurfaces(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const handlers = registerExtension();
    const ctx = createContext(projectRoot);
    const disabledSkill = await createSkill(projectRoot, 'force-me');
    setSkillCliOverridesForTests(parseSkillCliOverrides({ argv: ['--skill', disabledSkill.filePath] }));
    await saveResourceToggleState(ctx, { skills: { 'force-me': false }, extensions: {} });
    await handlers.get('resources_discover')?.({ ctx, reason: 'startup' } as never);

    const beforeEvent = {
      systemPrompt: promptFor([disabledSkill]),
      systemPromptOptions: { skills: [disabledSkill] },
    };
    const beforeResult = await handlers.get('before_agent_start')?.(beforeEvent as never, ctx);
    assert.equal(beforeResult, undefined);
    assert.deepEqual(beforeEvent.systemPromptOptions.skills, [disabledSkill]);
    assert.equal(beforeEvent.systemPrompt.includes('<name>force-me</name>'), true);

    assert.deepEqual(await handlers.get('input')?.({ text: '/skill:force-me now', source: 'interactive' } as never, ctx), { action: 'continue' });
    assert.deepEqual(ctx.notices, []);
    assert.match(await expandSkillForTest(disabledSkill, 'now'), /FORCE-ME SECRET BODY/);
  });
}

async function testNoConfigEquivalentLeavesBehaviorUnchanged(): Promise<void> {
  await withTempProject(async (projectRoot) => {
    const handlers = registerExtension();
    const trustedCtx = createContext(projectRoot);
    const skill = await createSkill(projectRoot, 'default-skill');

    assert.deepEqual(await handlers.get('resources_discover')?.({ ctx: trustedCtx, reason: 'startup' } as never), {});
    const beforeEvent = { systemPrompt: promptFor([skill]), systemPromptOptions: { skills: [skill] } };
    assert.equal(await handlers.get('before_agent_start')?.(beforeEvent as never, trustedCtx), undefined);
    assert.deepEqual(beforeEvent.systemPromptOptions.skills, [skill]);
    assert.deepEqual(await handlers.get('input')?.({ text: '/skill:default-skill', source: 'interactive' } as never, trustedCtx), { action: 'continue' });

    const untrustedCtx = createContext(projectRoot, false);
    await saveResourceToggleState(trustedCtx, { skills: { 'default-skill': false, [skill.filePath]: true }, extensions: {} });
    assert.deepEqual(await handlers.get('resources_discover')?.({ ctx: untrustedCtx, reason: 'reload' } as never), {});
    assert.deepEqual(await handlers.get('input')?.({ text: '/skill:default-skill', source: 'interactive' } as never, untrustedCtx), { action: 'continue' });
  });
}

assert.equal(SKILL_DISABLED_MESSAGE.includes('package'), false);
assert.equal(SKILL_DISABLED_MESSAGE.includes('Slice'), false);
assert.equal(SKILL_DISABLED_MESSAGE.includes('workflow'), false);
assert.equal(SKILL_DISABLED_MESSAGE.includes('planning'), false);

await testEnableReturnsSkillPathsUnlessNoSkills();
await testDisableBothSurfacesForSameSkill();
await testCurrentPiSkillPromptWordingIsReplaced();
await testDynamicSkillPersistedByPathFiltersBeforeAgentStart();
await testExplicitSkillOverridesDisableOnBothSurfaces();
await testNoConfigEquivalentLeavesBehaviorUnchanged();

console.log('WP2 skill toggle checks passed');
