import test from 'node:test';
import { strictEqual, deepStrictEqual, throws } from 'node:assert/strict';
import {
  applyDiscoveryIntensity, parseTechnologyIds, shouldConfigureDiscovery,
  configureDiscovery, parseDiscoveryNumber, parseDiscoveryChoice, parseDiscoveryYesNo,
} from '../scripts/discovery-setup.mjs';

const tech = [
  { id: 'react', name: 'React', skills: ['example/repo/skill'] },
  { id: 'docker', name: 'Docker', skills: [] },
  { id: 'playwright', name: 'Playwright', skills: [] },
];
const tty = { isTTY: true }, pipe = { isTTY: false };

test('interactive argument wizard is enabled only for no-arg TTY or --configure', () => {
  strictEqual(shouldConfigureDiscovery([], tty, tty), true);
  strictEqual(shouldConfigureDiscovery(['--tech', 'react'], tty, tty), false);
  strictEqual(shouldConfigureDiscovery(['--tech', 'react', '--configure'], tty, tty), true);
  strictEqual(shouldConfigureDiscovery([], pipe, tty), false);
  strictEqual(shouldConfigureDiscovery(['--configure'], tty, pipe), false);
});

test('technology selection supports all, gaps, list and invalid-ID feedback', () => {
  deepStrictEqual(parseTechnologyIds('all', tech), []);
  deepStrictEqual(parseTechnologyIds('gaps', tech), ['docker', 'playwright']);
  deepStrictEqual(parseTechnologyIds('react, playwright,react', tech), ['react', 'playwright']);
  throws(() => parseTechnologyIds('unknown', tech), /Unknown technologies/);
  throws(() => parseTechnologyIds(' ', tech), /Enter all/);
});

test('quick/balanced/thorough settings preserve explicit budget flags', () => {
  const opts = { verifyLimit: 123, directorySearches: 0, skillsmdSearches: 0, skillsshSearches: 0 };
  applyDiscoveryIntensity(opts, 'quick', ['--verify-limit', '123']);
  strictEqual(opts.verifyLimit, 123);
  strictEqual(opts.directorySearches, 12);
  strictEqual(opts.skillsshSearches, 8);
  applyDiscoveryIntensity(opts, 'balanced');
  strictEqual(opts.verifyLimit, 30);
  applyDiscoveryIntensity(opts, 'thorough');
  strictEqual(opts.verifyLimit, 80);
  throws(() => applyDiscoveryIntensity(opts, 'unknown'), /quick/);
});


const wizardDefaults = () => ({
  source: 'both', tech: [], interactive: 'auto', minScore: 35, maxPerTech: 5,
  verifyLimit: 25, detailsLimit: 35, limit: 50, queriesPerTech: 3,
  sort: 'recent', directorySearches: 60, pages: 1, recentPages: 1,
  categoryPages: 1, category: '', skillsmdFilter: 'all', skillsmdPages: 3,
  skillsmdSearches: 25, skillsshView: 'trending', skillsshPages: 1,
  skillsshSearches: 25, skillsshCurated: true, cache: true,
  cacheDir: '/tmp/autoskills-cache', cacheTtlMinutes: 360, clearCache: false,
  output: 'skills-discovery.json', markdown: 'skills-discovery.md',
  selectionOutput: 'skills-discovery.selected.json',
  selectionMarkdown: 'skills-discovery.selected.md',
});
async function runWizard(answers, initial = wizardDefaults(), argv = []) {
  const values = [...answers], prompts = [], writes = [];
  let closed = false;
  const input = {isTTY:true};
  const output = {isTTY:true, write(chunk) {writes.push(chunk);}};
  const makeInterface = () => ({
    async question(prompt) {
      prompts.push(prompt);
      if (!values.length) throw new Error('Wizard asked an unexpected question: ' + prompt);
      return values.shift();
    },
    close() {closed = true;},
  });
  const result = await configureDiscovery(initial, tech, argv, input, output, makeInterface);
  if (!closed) throw new Error('Wizard did not close readline');
  if (values.length) throw new Error('Wizard did not consume every answer: ' + values);
  return {result, prompts, writes};
}

test('interactive setting validators enforce bounds and permitted values', () => {
  strictEqual(parseDiscoveryNumber('0', 'Budget', 0, 100), 0);
  strictEqual(parseDiscoveryNumber('100', 'Budget', 0, 100), 100);
  throws(() => parseDiscoveryNumber('-1', 'Budget', 0, 100), /integer/);
  throws(() => parseDiscoveryNumber('1.5', 'Budget', 0, 100), /integer/);
  throws(() => parseDiscoveryNumber('101', 'Budget', 0, 100), /integer/);
  strictEqual(parseDiscoveryChoice('HOT', ['all','hot']), 'hot');
  throws(() => parseDiscoveryChoice('none', ['all','hot']), /Choose/);
  strictEqual(parseDiscoveryYesNo('Yes'), true);
  strictEqual(parseDiscoveryYesNo('n'), false);
  throws(() => parseDiscoveryYesNo('perhaps'), /yes or no/);
});

test('quick interactive setup keeps advanced options hidden by default', async () => {
  const {result, prompts} = await runWizard(['both','','','',''], wizardDefaults(), ['--source','both']);
  strictEqual(result.source, 'both');
  strictEqual(result.verifyLimit, 30);
  strictEqual(result.minScore, 35);
  strictEqual(result.interactive, 'on');
  strictEqual(prompts.some(x => x.includes('Minimum final match score')), false);
});

test('advanced quality settings override the preset with validation and preserve source', async () => {
  const {result, writes} = await runWizard([
    'both','gaps','balanced','yes','quality','-1','47','22','40','3','75','done','no',
  ], wizardDefaults(), ['--source','both']);
  deepStrictEqual(result.tech, ['docker','playwright']);
  strictEqual(result.minScore, 47);
  strictEqual(result.verifyLimit, 22);
  strictEqual(result.detailsLimit, 40);
  strictEqual(result.maxPerTech, 3);
  strictEqual(result.limit, 75);
  strictEqual(result.interactive, 'off');
  if (!writes.join('').includes('integer')) throw new Error('Expected inline numeric validation feedback');
});

test('provider settings prompt only for the selected discovery sources', async () => {
  const {result, prompts} = await runWizard([
    'skillsmd','docker','quick','yes','providers','5','trending','2','7','done','no',
  ]);
  strictEqual(result.source, 'skillsmd');
  strictEqual(result.queriesPerTech, 5);
  strictEqual(result.skillsmdFilter, 'trending');
  strictEqual(result.skillsmdPages, 2);
  strictEqual(result.skillsmdSearches, 7);
  strictEqual(prompts.some(x => x.includes('Skills.sh leaderboard')), false);
  strictEqual(prompts.some(x => x.includes('Directory text')), false);
});

test('advanced cache and report settings are persisted in wizard options', async () => {
  const {result} = await runWizard([
    'both','react','balanced','yes',
    'cache','yes','120','/tmp/discovery-cache','yes',
    'files','out.json','out.md','shortlist.json','shortlist.md','done','no',
  ], wizardDefaults(), ['--source','both']);
  strictEqual(result.cache, true);
  strictEqual(result.clearCache, true);
  strictEqual(result.cacheTtlMinutes, 120);
  strictEqual(result.cacheDir, '/tmp/discovery-cache');
  strictEqual(result.output, 'out.json');
  strictEqual(result.markdown, 'out.md');
  strictEqual(result.selectionOutput, 'shortlist.json');
  strictEqual(result.selectionMarkdown, 'shortlist.md');
});
