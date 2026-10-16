import test from 'node:test';
import { strictEqual, deepStrictEqual, throws } from 'node:assert/strict';
import {
  applyDiscoveryIntensity, parseTechnologyIds, shouldConfigureDiscovery,
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
