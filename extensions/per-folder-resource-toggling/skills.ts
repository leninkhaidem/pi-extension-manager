import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import type { ResourceToggleState, ToggleContext } from './state.ts';

export const SKILL_DISABLED_MESSAGE = 'This skill is disabled for this project.';

export interface SkillDescriptor {
  name: string;
  description?: string;
  filePath: string;
  baseDir?: string;
  disableModelInvocation?: boolean;
}

export interface SystemPromptOptionsWithSkills {
  skills?: SkillDescriptor[];
}

export interface BeforeAgentStartEventWithSkills {
  systemPrompt: string;
  systemPromptOptions: SystemPromptOptionsWithSkills;
}

export interface InputEventWithText {
  text: string;
  source?: string;
}

export interface SkillFlagOptions {
  argv?: readonly string[];
}

export interface SkillCliOverrides {
  noSkills: boolean;
  explicitSkillPaths: string[];
  explicitSkillNames: Set<string>;
}

export interface ApplySkillTogglesOptions {
  cli?: SkillCliOverrides;
}

const SKILL_COMMAND_PREFIX = '/skill:';
const SKILL_FILE_NAME = 'SKILL.md';

export function getEnabledSkillPaths(state: ResourceToggleState, options: ApplySkillTogglesOptions = {}): string[] {
  if (options.cli?.noSkills) {
    return [];
  }

  return Object.entries(state.skills)
    .filter(([, enabled]) => enabled)
    .map(([skillPath]) => skillPath);
}

export function filterDisabledSkillsForSystemPrompt(
  event: BeforeAgentStartEventWithSkills,
  state: ResourceToggleState,
  options: ApplySkillTogglesOptions = {},
): string | undefined {
  const skills = event.systemPromptOptions.skills;
  if (!skills || skills.length === 0) {
    return undefined;
  }

  const filteredSkills = skills.filter((skill) => !isSkillDisabledByFolder(skill, state, options.cli));
  if (filteredSkills.length === skills.length) {
    return undefined;
  }

  event.systemPromptOptions.skills = filteredSkills;
  return buildSystemPromptWithSkills(event.systemPrompt, skills, filteredSkills);
}

export async function handleDisabledSkillInvocation(
  event: InputEventWithText,
  ctx: Pick<ToggleContext, 'ui'>,
  state: ResourceToggleState,
  options: ApplySkillTogglesOptions = {},
): Promise<{ action: 'continue' } | { action: 'handled' }> {
  const skillName = parseSkillCommandName(event.text);
  if (!skillName) {
    return { action: 'continue' };
  }

  if (!isSkillNameDisabledByFolder(skillName, state, options.cli)) {
    return { action: 'continue' };
  }

  await ctx.ui?.notify?.(SKILL_DISABLED_MESSAGE);
  return { action: 'handled' };
}

export function parseSkillCliOverrides(options: SkillFlagOptions = {}): SkillCliOverrides {
  const argv = options.argv ?? process.argv.slice(2);
  const explicitSkillPaths: string[] = [];
  let noSkills = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-skills') {
      noSkills = true;
      continue;
    }

    if (arg === '--skill') {
      const skillPath = argv[index + 1];
      if (skillPath && !skillPath.startsWith('-')) {
        explicitSkillPaths.push(skillPath);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--skill=')) {
      const skillPath = arg.slice('--skill='.length);
      if (skillPath) {
        explicitSkillPaths.push(skillPath);
      }
    }
  }

  return {
    noSkills,
    explicitSkillPaths,
    explicitSkillNames: new Set(explicitSkillPaths.map(resolveSkillNameFromPath).filter((name): name is string => Boolean(name))),
  };
}

function isSkillDisabledByFolder(
  skill: SkillDescriptor,
  state: ResourceToggleState,
  cli: SkillCliOverrides | undefined,
): boolean {
  if (isExplicitlyActivatedSkill(skill, cli)) {
    return false;
  }

  return state.skills[skill.name] === false || state.skills[skill.filePath] === false;
}

function isSkillNameDisabledByFolder(
  skillName: string,
  state: ResourceToggleState,
  cli: SkillCliOverrides | undefined,
): boolean {
  const disabledSkillNames = getDisabledSkillNames(state);
  if (!disabledSkillNames.has(skillName)) {
    return false;
  }

  if (cli?.explicitSkillNames.has(skillName)) {
    return false;
  }

  return !isExplicitPathForSkillName(skillName, cli);
}

function getDisabledSkillNames(state: ResourceToggleState): Set<string> {
  const names = new Set<string>();

  for (const [resourceId, enabled] of Object.entries(state.skills)) {
    if (enabled) {
      continue;
    }

    names.add(resourceId);
    const resolvedName = resolveSkillNameFromPath(resourceId);
    if (resolvedName) {
      names.add(resolvedName);
    }
  }

  return names;
}

function isExplicitlyActivatedSkill(skill: SkillDescriptor, cli: SkillCliOverrides | undefined): boolean {
  if (!cli) {
    return false;
  }

  return cli.explicitSkillNames.has(skill.name) || cli.explicitSkillPaths.some((path) => sameResolvedPath(path, skill.filePath));
}

function isExplicitPathForSkillName(skillName: string, cli: SkillCliOverrides | undefined): boolean {
  return cli?.explicitSkillPaths.some((skillPath) => resolveSkillNameFromPath(skillPath) === skillName) ?? false;
}

function parseSkillCommandName(text: string): string | null {
  if (!text.startsWith(SKILL_COMMAND_PREFIX)) {
    return null;
  }

  const commandBody = text.slice(SKILL_COMMAND_PREFIX.length).trimStart();
  const [skillName] = commandBody.split(/\s+/, 1);
  return skillName || null;
}

function buildSystemPromptWithSkills(
  currentSystemPrompt: string,
  originalSkills: SkillDescriptor[],
  filteredSkills: SkillDescriptor[],
): string {
  let nextPrompt = currentSystemPrompt;
  const originalSkillPrompt = formatSkillsForPrompt(originalSkills);
  if (originalSkillPrompt) {
    nextPrompt = nextPrompt.replace(originalSkillPrompt, '');
  }

  const filteredSkillPrompt = formatSkillsForPrompt(filteredSkills);
  if (!filteredSkillPrompt) {
    return nextPrompt;
  }

  return `${nextPrompt}${filteredSkillPrompt}`;
}

function formatSkillsForPrompt(skills: SkillDescriptor[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) {
    return '';
  }

  const lines = [
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    '',
    '<available_skills>',
  ];

  for (const skill of visibleSkills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description ?? '')}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }

  lines.push('</available_skills>');
  return lines.join('\n');
}

function resolveSkillNameFromPath(skillPath: string): string | null {
  const absolutePath = resolve(skillPath);
  const candidateSkillFiles = absolutePath.endsWith(SKILL_FILE_NAME)
    ? [absolutePath]
    : [absolutePath, resolve(absolutePath, SKILL_FILE_NAME)];

  for (const candidateSkillFile of candidateSkillFiles) {
    try {
      const content = readFileSync(candidateSkillFile, 'utf8');
      const frontmatterName = parseSkillFrontmatterName(content);
      const fallbackName = candidateSkillFile.endsWith(SKILL_FILE_NAME)
        ? basename(resolve(candidateSkillFile, '..'))
        : basename(candidateSkillFile).replace(/\.md$/i, '');
      return frontmatterName || fallbackName;
    } catch {
      // Try the next Pi-supported skill path shape: direct markdown file or directory/SKILL.md.
    }
  }

  return basename(skillPath).replace(/\.md$/i, '') || null;
}

function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseSkillFrontmatterName(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return '';
  }

  for (const line of match[1].split(/\r?\n/)) {
    const nameMatch = line.match(/^name:\s*(.*)$/);
    if (nameMatch) {
      return nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  return '';
}
