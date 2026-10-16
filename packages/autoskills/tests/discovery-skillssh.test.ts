import test from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSkillsSh } from '../scripts/discovery-skillssh.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'autoskills-skillssh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/autoskills/skills-registry'), { recursive: true });
  writeFileSync(join(root, 'packages/autoskills/skills-map.ts'), `
export const SKILLS_MAP = [{id:'react',name:'React',
  detect:{packages:['react','react-dom']},skills:[]}];
export const COMBO_SKILLS_MAP = []; export const FRONTEND_BONUS_SKILLS = [];
`);
  writeFileSync(join(root, 'packages/autoskills/skills-registry/index.json'),
    JSON.stringify({ skills: {} }));
  return root;
}
const script = new URL('../scripts/discover-autoskills.mjs', import.meta.url).pathname;
async function run(args, env = {}) {
  const child = spawn(process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', script, ...args],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', x => stdout += x);
  child.stderr.on('data', x => stderr += x);
  const exit = await new Promise(resolve => child.on('exit', resolve));
  return { exit, stdout, stderr };
}
function row(slug, source = 'neworg/react-hooks') {
  return { id: source + '/' + slug, slug, name: 'React Hooks',
    source, sourceType: 'github', installs: 234,
    url: 'https://skills.sh/' + source + '/' + slug };
}

test('Skills.sh accepts only matching GitHub skill IDs and rejects duplicates', () => {
  if (!normalizeSkillsSh(row('react-hooks'))) throw new Error('Expected valid entry');
  if (normalizeSkillsSh({ ...row('react-hooks'), sourceType: 'well-known' }))
    throw new Error('Accepted non-GitHub source');
  if (normalizeSkillsSh({ ...row('react-hooks'), id: 'fake/other/skill' }))
    throw new Error('Accepted mismatched ID');
  if (normalizeSkillsSh({ ...row('react-hooks'), slug: '../unsafe' }))
    throw new Error('Accepted unsafe slug');
  if (normalizeSkillsSh({ ...row('react-hooks'), isDuplicate: true }))
    throw new Error('Accepted duplicate skill');
});

test('Skills.sh authenticated discovery verifies GitHub blob and preserves provenance', async t => {
  const root = fixture(t), token = 'mock-vercel-oidc-token';
  const skillMd = '---\nname: React Hooks\ndescription: React hooks and components\n---\n# React Hooks\nDevelop React hooks and React components.';
  const sha = createHash('sha1').update('blob ' + Buffer.byteLength(skillMd) + '\\0').update(skillMd).digest('hex');
  let authorized = 0, searched = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let result;
    if (url.pathname.startsWith('/v1/')) {
      if (req.headers.authorization !== 'Bearer ' + token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      authorized++;
      if (url.pathname === '/v1/skills') {
        result = { data: [row('react-hooks'),
          { ...row('non-github'), sourceType: 'well-known' },
          { ...row('wrong-id'), id: 'wrong/skill/slug' },
          { ...row('copied'), isDuplicate: true }],
          pagination: { page: 0, hasMore: false } };
      } else if (url.pathname === '/v1/skills/curated') {
        result = { data: [{ owner: 'neworg', skills: [row('react-hooks')] }] };
      } else if (url.pathname === '/v1/skills/search') {
        searched++;
        result = { data: [row('react-hooks')], count: 1 };
      }
    } else if (url.pathname === '/repos/neworg/react-hooks') {
      result = { default_branch: 'main' };
    } else if (url.pathname === '/repos/neworg/react-hooks/git/trees/main') {
      result = { truncated: false, tree: [{ path: 'skills/react-hooks/SKILL.md',
        type: 'blob', mode: '100644', sha }] };
    } else if (url.pathname === '/repos/neworg/react-hooks/git/blobs/' + sha) {
      result = { encoding: 'base64', size: Buffer.byteLength(skillMd),
        content: Buffer.from(skillMd).toString('base64') };
    }
    if (!result) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  t.after(() => server.close());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const output = join(root, 'results.json'), markdown = join(root, 'results.md');
  const result = await run(['--repo-root', root, '--source', 'skillssh',
    '--skillssh-api', base + '/v1', '--github-api', base, '--skillssh-pages', '1',
    '--skillssh-searches', '2', '--tech', 'react', '--verify-limit', '5',
    '--no-cache', '--no-interactive', '--output', output, '--markdown', markdown],
    { VERCEL_OIDC_TOKEN: token });
  if (result.exit !== 0) throw new Error('CLI failed: ' + result.stderr);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  const matches = report.matches.filter(x => x.skillPath === 'neworg/react-hooks/react-hooks');
  if (matches.length !== 1) throw new Error('Expected one GitHub-verified, deduplicated skill');
  if (!matches[0].sources.includes('skillssh')) throw new Error('Missing Skills.sh provenance');
  if (matches[0].skillssh?.installs !== 234) throw new Error('Missing Skills.sh installs');
  if (matches[0].skillBlobSha !== sha || report.stats.uniqueSkillsShSkills !== 1)
    throw new Error('Expected immutable GitHub blob and one eligible Skills.sh entry');
  if (authorized < 3 || searched < 1) throw new Error('Missing authenticated listing, curated, or search requests');
  if (JSON.stringify(report).includes(token) || readFileSync(markdown, 'utf8').includes(token))
    throw new Error('Bearer token leaked into discovery report');
  if (!readFileSync(markdown, 'utf8').includes('Skills.sh'))
    throw new Error('Skills.sh missing from human-readable report');
});

test('Skills.sh requires explicit OIDC authentication', async t => {
  const root = fixture(t);
  const result = await run(['--repo-root', root, '--source', 'skillssh', '--no-interactive'],
    { VERCEL_OIDC_TOKEN: '' });
  if (result.exit === 0 || !result.stderr.includes('VERCEL_OIDC_TOKEN'))
    throw new Error('Expected missing-token error: ' + result.stderr);
});

test('--configure fails clearly when stdin is not a terminal', async () => {
  const result = await run(['--configure']);
  if (result.exit === 0 || !result.stderr.includes('TTY'))
    throw new Error('Expected TTY error: ' + result.stderr);
});
