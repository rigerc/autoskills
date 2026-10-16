/**
 * Optional TTY wizard for discovery arguments. Does not run for CI or pipes.
 * Parsing remains deterministic and the existing --flag interface is unchanged.
 */
import { createInterface } from 'node:readline/promises';

const INTENSITIES = {
  quick: { directorySearches: 12, skillsmdSearches: 8, skillsshSearches: 8,
    verifyLimit: 12, detailsLimit: 15, pages: 1, recentPages: 1, categoryPages: 0 },
  balanced: { directorySearches: 30, skillsmdSearches: 15, skillsshSearches: 15,
    verifyLimit: 30, detailsLimit: 35, pages: 1, recentPages: 1, categoryPages: 1 },
  thorough: { directorySearches: 80, skillsmdSearches: 45, skillsshSearches: 45,
    verifyLimit: 80, detailsLimit: 100, pages: 2, recentPages: 2, categoryPages: 2 },
};

export function shouldConfigureDiscovery(args, input, output) {
  return Boolean(input?.isTTY && output?.isTTY &&
    (args.length === 0 || args.includes('--configure')));
}
export function parseTechnologyIds(raw, all) {
  const value = raw.trim();
  if (value.toLowerCase() === 'all') return [];
  if (value.toLowerCase() === 'gaps') return all.filter(t => t.skills.length === 0).map(t => t.id);
  const ids = [...new Set(value.split(',').map(x => x.trim()).filter(Boolean))];
  if (!ids.length) throw new Error('Enter all, gaps, or comma-separated technology IDs');
  const unknown = ids.filter(id => !all.some(t => t.id === id));
  if (unknown.length) throw new Error('Unknown technologies: ' + unknown.join(', ') + ' (enter ? to list)');
  return ids;
}
export function applyDiscoveryIntensity(opts, intensity, argv = []) {
  if (!Object.hasOwn(INTENSITIES, intensity)) throw new Error('Use quick, balanced, or thorough');
  const flags = {
    directorySearches: '--directory-searches', skillsmdSearches: '--skillsmd-searches',
    skillsshSearches: '--skillssh-searches', verifyLimit: '--verify-limit',
    detailsLimit: '--details-limit', pages: '--pages', recentPages: '--recent-pages',
    categoryPages: '--category-pages',
  };
  for (const [key, value] of Object.entries(INTENSITIES[intensity]))
    if (!argv.includes(flags[key])) opts[key] = value;
  return opts;
}


/** Parse interactive numeric settings using the same bounds as the CLI. */
export function parseDiscoveryNumber(value, name, min, max) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) ||
      Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}
export function parseDiscoveryChoice(value, choices) {
  const normalized = value.trim().toLowerCase();
  if (!choices.includes(normalized)) throw new Error('Choose ' + choices.join(', '));
  return normalized;
}
export function parseDiscoveryYesNo(value) {
  if (/^(y|yes)$/i.test(value)) return true;
  if (/^(n|no)$/i.test(value)) return false;
  throw new Error('Choose yes or no');
}

/** Advanced settings are opt-in, grouped, and reflect current flag values. */
async function configureAdvanced(opts, ask, output) {
  const num = async (label, key, min, max) => {
    opts[key] = await ask(label, String(opts[key]),
      value => parseDiscoveryNumber(value, label, min, max));
  };
  const choice = async (label, key, choices) => {
    opts[key] = await ask(label, opts[key],
      value => parseDiscoveryChoice(value, choices));
  };
  const yesNo = async (label, key) => {
    opts[key] = await ask(label, opts[key] ? 'yes' : 'no', parseDiscoveryYesNo);
  };
  const file = async (label, key) => {
    opts[key] = await ask(label, opts[key], value => {
      if (!value || /[\r\n\0]/.test(value)) throw new Error('Enter a valid file path');
      if (key.startsWith('selection') && value === '-')
        throw new Error('Selection exports must be files, not stdout');
      return value;
    });
  };
  for (;;) {
    output.write('Advanced settings: quality | providers | cache | files | done\n');
    const group = await ask('Configure group', 'done',
      value => parseDiscoveryChoice(value, ['quality','providers','cache','files','done']));
    if (group === 'done') break;
    if (group === 'quality') {
      await num('Minimum final match score', 'minScore', 0, 1000);
      await num('GitHub repositories to verify', 'verifyLimit', 0, 10000);
      await num('Candidates to enrich with details', 'detailsLimit', 0, 10000);
      await num('Suggestions per technology in Markdown', 'maxPerTech', 0, 10000);
      await num('API page size', 'limit', 1, 100);
    } else if (group === 'providers') {
      await num('Queries per technology', 'queriesPerTech', 0, 6);
      if (['both','all','skillsdirectory'].includes(opts.source)) {
        output.write('Skills Directory settings\n');
        await choice('Sort order', 'sort', ['recent','stars','votes']);
        await num('Directory text search budget', 'directorySearches', 0, 300);
        await num('Pages per directory query', 'pages', 0, 20);
        await num('Recent directory pages', 'recentPages', 0, 20);
        await num('Pages per relevant directory category', 'categoryPages', 0, 20);
        opts.category = await ask('Directory category (all or slug)', opts.category || 'all',
          value => value.toLowerCase() === 'all' ? '' : value);
      }
      if (['both','all','skillsmd'].includes(opts.source)) {
        output.write('SkillsMD settings\n');
        await choice('SkillsMD filter', 'skillsmdFilter', ['all','hot','trending']);
        await num('SkillsMD listing pages', 'skillsmdPages', 0, 30);
        await num('SkillsMD search budget', 'skillsmdSearches', 0, 100);
      }
      if (['all','skillssh'].includes(opts.source)) {
        output.write('Skills.sh settings\n');
        await choice('Skills.sh leaderboard', 'skillsshView', ['trending','hot','all-time']);
        await num('Skills.sh leaderboard pages', 'skillsshPages', 0, 30);
        await num('Skills.sh search budget', 'skillsshSearches', 0, 100);
        await yesNo('Include curated Skills.sh skills', 'skillsshCurated');
      }
    } else if (group === 'cache') {
      await yesNo('Use discovery response cache', 'cache');
      if (opts.cache) {
        await num('Cache lifetime in minutes', 'cacheTtlMinutes', 0, 43200);
        await file('Cache directory', 'cacheDir');
        await yesNo('Clear existing discovery cache first', 'clearCache');
      } else {
        opts.clearCache = false;
      }
    } else if (group === 'files') {
      await file('JSON report', 'output');
      await file('Markdown report', 'markdown');
      await file('Selected JSON export', 'selectionOutput');
      await file('Selected Markdown export', 'selectionMarkdown');
    }
  }
}

/** Runs before any network requests or report output. */
export async function configureDiscovery(opts, technologies, argv, input = process.stdin, output = process.stdout, makeInterface = createInterface) {
  if (!input.isTTY || !output.isTTY) throw new Error('--configure requires a TTY; use explicit flags in CI or pipes.');
  const rl = makeInterface({ input, output });
  const hasToken = Boolean(process.env.VERCEL_OIDC_TOKEN?.trim());
  const defaultSource = argv.includes('--source') ? opts.source : hasToken ? 'all' : 'both';
  const defaultsTech = opts.tech.length ? opts.tech.join(',') : 'all';
  const choices = ['both', 'skillsdirectory', 'skillsmd', 'skillssh', 'all'];
  const ask = async (label, defaultValue, validate) => {
    for (;;) {
      const entered = (await rl.question(label + ' [' + defaultValue + ']: ')).trim();
      const answer = entered || defaultValue;
      if (answer.toLowerCase() === 'q') throw new Error('Discovery setup cancelled');
      try { return validate(answer); }
      catch (error) { output.write('  ' + error.message + '\n'); }
    }
  };
  try {
    output.write('\nAutoSkills discovery setup (Enter accepts defaults; q quits)\n');
    output.write('Sources: both (Directory + SkillsMD), skillsdirectory, skillsmd, skillssh, all\n');
    output.write(hasToken
      ? 'Vercel OIDC token found: Skills.sh available.\n'
      : 'No Vercel OIDC token found: Skills.sh requires VERCEL_OIDC_TOKEN.\n');
    opts.source = await ask('Source', defaultSource, value => {
      const name = value.toLowerCase();
      if (!choices.includes(name)) throw new Error('Choose ' + choices.join(', '));
      if (['skillssh','all'].includes(name) && !hasToken)
        throw new Error('Skills.sh requires VERCEL_OIDC_TOKEN; see scripts/README-discover-autoskills.md');
      return name;
    });
    output.write('Technologies: all; gaps (technologies with no registered skills); or comma-separated IDs.\n');
    opts.tech = await ask('Technologies (? for available IDs)', defaultsTech, value => {
      if (value === '?') {
        output.write(technologies.map(t => t.id).join(', ') + '\n');
        throw new Error('Choose technology IDs, all, or gaps');
      }
      return parseTechnologyIds(value, technologies);
    });
    const intensity = await ask('Search intensity (quick / balanced / thorough)', 'balanced',
      value => {
        const preset = value.toLowerCase();
        if (!Object.hasOwn(INTENSITIES, preset)) throw new Error('Choose quick, balanced, or thorough');
        return preset;
      });
    applyDiscoveryIntensity(opts, intensity, argv);
    const advanced = await ask('Customize advanced options (yes / no)', 'no', parseDiscoveryYesNo);
    if (advanced) await configureAdvanced(opts, ask, output);
    const reviewDefault = opts.interactive === 'off' ? 'no' : 'yes';
    opts.interactive = await ask('Review matches interactively (yes / no)', reviewDefault,
      value => parseDiscoveryYesNo(value) ? 'on' : 'off');
    output.write('Selected ' + opts.source + ' | ' +
      (opts.tech.length ? opts.tech.join(', ') : 'all technologies') +
      ' | ' + intensity + ' | score >= ' + opts.minScore +\n      ' | GitHub checks <= ' + opts.verifyLimit + ' repositories\n\n');
    return opts;
  } finally {
    rl.close();
  }
}
