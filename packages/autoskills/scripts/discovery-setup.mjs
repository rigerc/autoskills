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

/** Runs before any network requests or report output. */
export async function configureDiscovery(opts, technologies, argv, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) throw new Error('--configure requires a TTY; use explicit flags in CI or pipes.');
  const rl = createInterface({ input, output });
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
    opts.interactive = await ask('Review matches interactively (yes / no)', 'yes', value => {
      if (/^(y|yes)$/i.test(value)) return 'on';
      if (/^(n|no)$/i.test(value)) return 'off';
      throw new Error('Choose yes or no');
    });
    output.write('Selected ' + opts.source + ' | ' +
      (opts.tech.length ? opts.tech.join(', ') : 'all technologies') +
      ' | ' + intensity + ' | GitHub checks <= ' + opts.verifyLimit + ' repositories\n\n');
    return opts;
  } finally {
    rl.close();
  }
}
