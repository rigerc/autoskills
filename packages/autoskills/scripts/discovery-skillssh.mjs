/**
 * Authenticated Skills.sh catalog discovery.
 * VERCEL_OIDC_TOKEN is a short-lived Vercel OIDC JWT; never log or persist it.
 * All candidates still require independent GitHub SKILL.md verification.
 */
import { bestMatches, createQueryPlanner } from './discovery-matcher.mjs';

const REPO_RE = /^[a-z\d_.-]+\/[a-z\d_.-]+$/i;

export function normalizeSkillsSh(raw) {
  if (!raw || typeof raw !== 'object' || raw.sourceType !== 'github' || raw.isDuplicate === true) return null;
  const repository = String(raw.source || '').trim();
  const slug = String(raw.slug || '').trim();
  if (!REPO_RE.test(repository) || !/^[a-z0-9][a-z0-9_.-]*$/i.test(slug)) return null;
  if (String(raw.id || '').toLowerCase() !== (repository + '/' + slug).toLowerCase()) return null;
  return {
    repository, slug, hint: slug,
    name: String(raw.name || slug),
    description: '', tags: [],
    installs: Number(raw.installs) || 0,
    skillsshUrl: typeof raw.url === 'string' && raw.url.startsWith('https://skills.sh/') ? raw.url : '',
  };
}

/** Network and caching are supplied by the existing discovery runner. */
export async function findSkillsSh(opts, profiles, jsonFetch, urlFor) {
  const byKey = new Map(), errors = [];
  const stats = { requests: 0, rows: 0 };
  const coverage = new Map(profiles.map(p => [p.tech.id, 0]));

  const add = (raw) => {
    const item = normalizeSkillsSh(raw);
    if (!item) return;
    const key = item.repository.toLowerCase() + ':' + item.slug.toLowerCase();
    const old = byKey.get(key);
    if (old) {
      byKey.set(key, { ...old, ...item, installs: Math.max(old.installs, item.installs) });
      return;
    }
    byKey.set(key, item);
    for (const match of bestMatches(item, profiles, opts.minScore))
      coverage.set(match.id, (coverage.get(match.id) || 0) + 1);
  };
  const get = async (url, label) => {
    try {
      // Obtain the current token for each request. Vercel OIDC tokens expire.
      const token = process.env.VERCEL_OIDC_TOKEN?.trim();
      if (!token) throw new Error('VERCEL_OIDC_TOKEN is required for Skills.sh discovery');
      const body = await jsonFetch(url, { token, verbose: opts.verbose, kind: 'skillssh' });
      if (!Array.isArray(body?.data)) throw new Error('Unexpected response: expected {data:[]}');
      stats.requests++; stats.rows += body.data.length;
      return body;
    } catch (e) {
      const message = label + ': ' + e.message;
      errors.push(message);
      console.error('Skills.sh warning: ' + message);
      return null;
    }
  };

  for (let page = 0; page < opts.skillsshPages; page++) {
    const body = await get(urlFor(opts.skillsshApi, '/skills',
      { view: opts.skillsshView, page, per_page: opts.limit }), 'list page ' + page);
    if (!body) break;
    body.data.forEach(add);
    if (!body.pagination?.hasMore) break;
  }
  if (opts.skillsshCurated) {
    const body = await get(urlFor(opts.skillsshApi, '/skills/curated'), 'curated');
    if (body) for (const owner of body.data) {
      if (Array.isArray(owner?.skills)) owner.skills.forEach(add);
    }
  }
  const planner = createQueryPlanner(profiles, Math.max(2, opts.queriesPerTech), opts.skillsshSearches);
  for (let next; (next = planner.next(coverage));) {
    if (next.query.trim().length < 2) continue;
    const body = await get(urlFor(opts.skillsshApi, '/skills/search',
      { q: next.query, limit: opts.limit }), 'search ' + next.query);
    if (body) body.data.forEach(add);
  }
  return { items: [...byKey.values()], stats, errors };
}
