#!/usr/bin/env node
/**
 * Discover skill candidates for rigerc/autoskills from Skills Directory and SkillsMD.
 *
 * Requirements: Node >=22.6 (no npm dependencies); run with:
 *   node --experimental-strip-types scripts/discover-autoskills.mjs --repo-root .
 *
 * This script DOES NOT install skills, edit skills-map.ts, or alter the registry.
 * Use its report to review suggestions, then run the repository's existing
 * audited sync workflow after manually updating skills-map.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_DIRECTORY_API = 'https://www.skillsdirectory.com/api/registry';
const DEFAULT_SKILLSMD_API = 'https://skillsmd.dev/api';
const DEFAULT_GITHUB_API = 'https://api.github.com';
const STOP = new Set([
  'a','an','and','app','application','best','build','cli','client','code','coding',
  'core','dev','development','developer','for','framework','guide','guides','js',
  'kit','lib','library','new','of','pattern','patterns','plugin','sdk','skill',
  'skills','test','tool','tools','the','ts','use','web','with'
]);
const REPO_RE = /^[a-z\d_.-]+\/[a-z\d_.-]+$/i;

function options(argv) {
  const out = {
    repoRoot: null, tech: [], category: '', sort: 'recent', limit: 50,
    pages: 1, recentPages: 1, categoryPages: 1, queriesPerTech: 1, directorySearches: 60, minScore: 35,
    detailsLimit: 35, verifyLimit: 25, maxPerTech: 5,
    output: 'skills-discovery.json', markdown: 'skills-discovery.md',
    apiBase: process.env.SKILLS_DIRECTORY_API || DEFAULT_DIRECTORY_API,
    skillsmdApi: process.env.SKILLSMD_API || DEFAULT_SKILLSMD_API,
    source: 'both', skillsmdPages: 3, skillsmdSearches: 25, skillsmdFilter: 'all',
    githubApi: process.env.GITHUB_API_URL || DEFAULT_GITHUB_API,
    verbose: false,
  };
  const names = {
    '--repo-root':'repoRoot', '--tech':'tech', '--category':'category',
    '--sort':'sort','--limit':'limit','--pages':'pages',
    '--recent-pages':'recentPages','--category-pages':'categoryPages','--queries-per-tech':'queriesPerTech',
    '--directory-searches':'directorySearches',
    '--min-score':'minScore','--details-limit':'detailsLimit',
    '--verify-limit':'verifyLimit','--max-per-tech':'maxPerTech',
    '--output':'output','--markdown':'markdown',
    '--api-base':'apiBase','--github-api':'githubApi',
    '--skillsmd-api':'skillsmdApi', '--source':'source',
    '--skillsmd-pages':'skillsmdPages', '--skillsmd-searches':'skillsmdSearches', '--skillsmd-filter':'skillsmdFilter',
  };
  for (let i=0; i<argv.length; i++) {
    const flag = argv[i];
    if (flag === '-h' || flag === '--help') {
      console.log(`Usage: node --experimental-strip-types discover-autoskills.mjs [options]

Find Skills Directory and SkillsMD entries related to autoskills' skills-map.ts.
Outputs reviewed-but-NOT-installed proposals; never edits the registry or map.

  --repo-root DIR       Repository checkout (auto-detected if omitted)
  --tech IDS            Comma-separated technology ids; default: all
  --source NAME         both | skillsdirectory | skillsmd (default: both)
  --category SLUG       Optional Skills Directory category filter
  --sort MODE           recent | stars | votes (default: recent)
  --limit N             API records per page, 1..100 (default: 50)
  --pages N             Pages per technology query (default: 1)
  --recent-pages N      Also scan N global recent pages (default: 1)
  --category-pages N    Scan N pages per relevant category for tag-only matches (default: 1)
  --queries-per-tech N  Name/ID/package queries per technology (default: 1)
  --directory-searches N Maximum total directory text searches (default: 60)
  --min-score N         Minimum semantic relevance (default: 35)
  --details-limit N     Fetch details for top N candidates (default: 35)
  --verify-limit N      Verify GitHub SKILL.md for top N (default: 25)
  --max-per-tech N      Suggestions per technology in markdown (default: 5)
  --output FILE|-       JSON report file (default: skills-discovery.json)
  --markdown FILE|-     Markdown report file (default: skills-discovery.md)
  --api-base URL        Skills Directory endpoint (for tests)
  --skillsmd-api URL    SkillsMD API base (for tests)
  --github-api URL      GitHub API base (for tests)
  --verbose             Log API fetches to stderr
  --help                Show help

Environment: GITHUB_TOKEN or GH_TOKEN (recommended for GitHub rate limits).
The older documented /api/registry route is used; no API key is required
by that documentation. --api-base/--github-api support local integration tests.
`);
      process.exit(0);
    }
    if (flag === '--verbose') { out.verbose = true; continue; }
    const prop = names[flag];
    if (!prop) throw new Error(`Unknown flag: ${flag} (try --help)`);
    if (argv[i+1] === undefined || argv[i+1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
    const raw = argv[++i];
    if (prop === 'tech') out.tech = raw.split(',').map(x=>x.trim()).filter(Boolean);
    else if (['limit','pages','recentPages','categoryPages','queriesPerTech','minScore','detailsLimit','verifyLimit','maxPerTech','skillsmdPages','skillsmdSearches','directorySearches'].includes(prop)) {
      const n = Number(raw);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${flag} must be a nonnegative integer`);
      out[prop] = n;
    } else out[prop] = raw;
  }
  if (!['both','skillsdirectory','skillsmd'].includes(out.source)) throw new Error('--source must be both, skillsdirectory, or skillsmd');
  if (!['all','hot','trending'].includes(out.skillsmdFilter)) throw new Error('--skillsmd-filter must be all, hot, or trending');
  if (!['recent','stars','votes'].includes(out.sort)) throw new Error('--sort must be recent, stars, or votes');
  if (out.limit < 1 || out.limit > 100) throw new Error('--limit must be 1..100');
  if (out.pages > 20 || out.recentPages > 20 || out.categoryPages > 20 || out.queriesPerTech > 6 || out.skillsmdPages > 30 || out.skillsmdSearches > 100 || out.directorySearches > 300) throw new Error('Page/query limits too high');
  return out;
}

function locateRoot(start) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current,'packages/autoskills/skills-map.ts'))) return current;
    if (existsSync(join(current,'skills-map.ts')) && existsSync(join(current,'skills-registry'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function pkgRoot(root) {
  const sub = join(root,'packages/autoskills');
  return existsSync(join(sub,'skills-map.ts')) ? sub : root;
}
function norm(value) {
  return String(value ?? '')
    .replace(/([a-z])([A-Z])/g,'$1 $2')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function tokens(v) { return norm(v).split(' ').filter(x=>x.length >= 2 && !STOP.has(x)); }
function phrase(hay, needle) {
  return !!needle && !!hay && (` ${hay} `).includes(` ${needle} `);
}
function unique(xs) { return [...new Set(xs.filter(Boolean))]; }
function basename(path) { return path.split('/').filter(Boolean).at(-1) || ''; }

function signals(tech) {
  const detect=tech.detect || {};
  const configBlocks = Array.isArray(detect.configFileContent)
    ? detect.configFileContent : detect.configFileContent ? [detect.configFileContent] : [];
  const distinctPatterns = configBlocks.flatMap(b=>b.patterns||[])
    .map(String).filter(x=>x.length>=4 && x.length<=60 && !/^(?:sourceCompatibility|targetCompatibility|manifest_version)$/i.test(x));
  const packagePatterns = (detect.packagePatterns||[])
    .map(String).map(x=>x.replace(/^\//,'').replace(/\/$/,'').replaceAll('\\',''))
    .filter(x=>x.length>=4 && x.length<=50 && !x.includes('.*'));
  const seeds = unique([
    tech.id, tech.name,
    ...(detect.packages || []), ...(detect.pythonPackages || []), ...(detect.gems || []),
    ...(detect.configFiles || []).map(v=>basename(v).replace(/\.[^.]+$/,'')),
    ...distinctPatterns, ...packagePatterns,
  ]);
  const strong = unique([norm(tech.id),norm(tech.name)]);
  const packageSignals = unique(seeds.slice(2).map(norm))
    .filter(s=>s.length>=3 && (s.includes(' ') || !STOP.has(s)));
  return { tech, strong, packages: packageSignals, tokens: unique(seeds.flatMap(tokens)) };
}
function queriesFor(profile, count) {
  const primary = unique([profile.tech.name, profile.tech.id.replaceAll('-',' ')]).filter(x=>norm(x).length>1);
  const extras = profile.packages
    .filter(x=>x.length>=4 && !primary.some(y=>norm(y)===x))
    .sort((a,b)=>b.length-a.length);
  return unique([...primary.slice(0,1),...extras,...primary.slice(1)])
    .slice(0,count);
}
function domain(tech) {
  const hay = norm([tech.id,tech.name,...(tech.detect?.packages||[])].join(' '));
  if (/postgres|database|mongo|prisma|drizzle|redis|sql|firebase|convex|supabase|neon|sqlite|graph ?ql/.test(hay)) return new Set(['databases','data-analytics','development']);
  if (/docker|kubernetes|helm|cloud|terraform|azure|vercel|netlify|ci|github actions|gitlab|devops|deploy|observab|sentry/.test(hay)) return new Set(['devops-cloud','development','tools-automation']);
  if (/vitest|jest|test|playwright|cypress|eslint|biome|prettier|lint|quality/.test(hay)) return new Set(['testing-qa','code-review-quality','development']);
  if (/openai|anthropic|mcp|agent|langchain|hugging ?face|ai sdk/.test(hay)) return new Set(['ai-agents','development','tools-automation']);
  if (/react|vue|svelte|angular|tailwind|css|next ?js|nuxt|design|storybook|frontend|flutter/.test(hay)) return new Set(['development','design-ux','testing-qa']);
  if (/security|auth|clerk|oauth|sso/.test(hay)) return new Set(['security','development']);
  return new Set(['development','tools-automation','documentation']);
}
function score(skill, profile) {
  const title=norm(skill.name),slug=norm(skill.slug),desc=norm(skill.description);
  const tags=unique([...(Array.isArray(skill.tags)?skill.tags:[]), ...(Array.isArray(skill.topics)?skill.topics:[])].map(norm));
  let strength=0;
  const reasons=[];
  for (const term of profile.strong) {
    if (!term || term.length<2) continue;
    const t=phrase(title,term), s=phrase(slug,term),d=phrase(desc,term),g=tags.some(x=>phrase(x,term));
    const value=Math.max(t?42:0,s?38:0,g?36:0,d?25:0);
    if (value>strength) strength=value;
    if (value) reasons.push(`technology "${term}" in ${t?'name':s?'slug':g?'tags':'description'}`);
  }
  // Package names from the map's existing detection rules are independent evidence.
  let packageStrength=0;
  for (const pkg of profile.packages) {
    if (!pkg || pkg.length<3) continue;
    const t=phrase(title,pkg),s=phrase(slug,pkg),g=tags.some(x=>phrase(x,pkg)),d=phrase(desc,pkg);
    const value=Math.max(t?30:0,s?28:0,g?28:0,d?18:0);
    if (value>packageStrength) packageStrength=value;
    if (value>=18 && reasons.length<6) reasons.push(`detected package "${pkg}"`);
  }
  const matched = Math.max(strength, packageStrength);
  // A shared category without any technology/package evidence is NOT a match.
  if (matched===0) return null;
  let points=matched;
  if (strength && packageStrength) points+=Math.min(10,Math.floor(packageStrength/3));
  const supportingTags=tags.filter(t=>profile.tokens.some(w=>w.length>=4 && phrase(t,w)));
  points+=Math.min(12,supportingTags.length*4);
  if (supportingTags.length) reasons.push(`related tags: ${supportingTags.slice(0,3).join(', ')}`);
  const category=norm(skill.category).replaceAll(' ','-');
  if (category && domain(profile.tech).has(category)) { points+=7; reasons.push(`category: ${skill.category}`); }
  else if (category && /marketing|lifestyle|health|education-personal|content/.test(category)) points-=8;
  if (skill.verified===true) {points+=5;reasons.push('Skills Directory verified (not a security audit)');}
  if (skill.trending===true || skill.hot===true) { points+=2; reasons.push('trending/hot on SkillsMD'); }
  const installs=Number(skill.installs||0);
  if(Number.isFinite(installs) && installs>0) { points+=Math.min(5,Math.floor(Math.log10(installs+1)*1.5)); reasons.push(`${installs} reported installs`); }
  if(skill.language && profile.strong.some(v=>v===norm(skill.language))) {points+=2;reasons.push(`repository language: ${skill.language}`);}
  const stars=Number(skill.github?.stars??skill.stars??0);
  if (Number.isFinite(stars) && stars>0) points+=Math.min(7,Math.floor(Math.log10(stars+1)*3));
  // Detail-only metadata: tool requirements and platform compatibility.
  const tools=Array.isArray(skill.requiresTools)?skill.requiresTools.map(norm):[];
  if (tools.some(t=>profile.strong.some(p=>phrase(t,p)) || profile.packages.some(p=>phrase(t,p)))) {
    points+=3; reasons.push('matching required tool');
  }
  return { id:profile.tech.id, name:profile.tech.name, score:points, reasons:unique(reasons).slice(0,7) };
}
function bestMatches(skill,profiles,minScore) {
  return profiles.map(p=>score(skill,p)).filter(m=>m && m.score>=minScore).sort((a,b)=>b.score-a.score);
}
function listSkillPaths(map,manifest) {
  const paths = new Set();
  const names = new Set();
  const add = p=>{
    if (typeof p!=='string') return;
    paths.add(p.toLowerCase());
    names.add(basename(p).toLowerCase());
  };
  for (const t of map.SKILLS_MAP) for (const p of t.skills||[]) add(p);
  for (const t of map.COMBO_SKILLS_MAP||[]) for (const p of t.skills||[]) add(p);
  for (const p of map.FRONTEND_BONUS_SKILLS||[]) add(p);
  for (const [name, entry] of Object.entries(manifest?.skills||{})) {
    names.add(name.toLowerCase());
    if (entry?.skillPath) add(entry.skillPath);
  }
  return {paths,names};
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function jsonFetch(url,{token='',verbose=false,kind='directory'}={}) {
  const headers={Accept:'application/json','User-Agent':'autoskills-discovery/1.0'};
  if (token) headers.Authorization=`Bearer ${token}`;
  if (kind==='github') headers['X-GitHub-Api-Version']='2022-11-28';
  for (let attempt=0;attempt<3;attempt++) {
    if(verbose) console.error(`GET ${url}`);
    let res;
    try { res=await fetch(url,{headers,signal:AbortSignal.timeout(25000)}); }
    catch (e) { if(attempt===2) throw e; await sleep(500*(attempt+1));continue; }
    if (res.ok) return res.json();
    const detail=(await res.text()).slice(0,300);
    if (![429,500,502,503,504].includes(res.status) || attempt===2) {
      throw new Error(`HTTP ${res.status} ${url}: ${detail}`);
    }
    // Do not sleep for unbounded rate-limit windows.
    const retryAfter=Number(res.headers.get('retry-after'));
    await sleep(Math.min(3500, Math.max(400, Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:500*(attempt+1))));
  }
}
function urlFor(base,path,params={}) {
  const u=new URL(base.replace(/\/$/,'')+path);
  for(const [key,val] of Object.entries(params)) if(val!==undefined && val!==null && val!=='') u.searchParams.set(key,String(val));
  return u.href;
}
async function findDirectory(opts,profiles) {
  const byKey=new Map(), errors=[];
  const stats={requests:0,rows:0};
  const jobs=[{q:'',category:opts.category,sort:'recent',pages:opts.recentPages}];
  // The API searches name/description, NOT tags. A category sweep is needed
  // to discover skills whose tags match technologies but whose titles do not.
  if (opts.categoryPages) {
    const cats=opts.category ? [opts.category] : unique(profiles.flatMap(p=>[...domain(p.tech)]));
    for(const category of cats) jobs.push({q:'',category,sort:opts.sort,pages:opts.categoryPages});
  }
  const firstGaps=[...profiles].sort((a,b)=>(a.tech.skills?.length||0)-(b.tech.skills?.length||0));
  const searches=unique(firstGaps.flatMap(p=>queriesFor(p,opts.queriesPerTech)));
  for(const q of searches.slice(0,opts.directorySearches)) {
    jobs.push({q,category:opts.category,sort:opts.sort,pages:opts.pages});
  }
  const seenJobs=new Set();
  for(const job of jobs) {
    const key=norm(job.q)+'|'+job.sort+'|'+(job.category||'');
    if (seenJobs.has(key)) continue;
    seenJobs.add(key);
    for(let page=0;page<job.pages;page++) {
      const url=urlFor(opts.apiBase,'',{q:job.q,category:job.category,sort:job.sort,limit:opts.limit,offset:page*opts.limit});
      try {
        const body=await jsonFetch(url,{verbose:opts.verbose});
        stats.requests++;
        if(!Array.isArray(body.skills)) throw new Error('Unexpected response: expected {skills:[]}');
        stats.rows+=body.skills.length;
        for(const item of body.skills) {
          if (!item || !REPO_RE.test(String(item.repository||'')) || !item.slug) continue;
          const k=`${item.repository.toLowerCase()}:${String(item.slug).toLowerCase()}`;
          if (!byKey.has(k)) byKey.set(k,item);
        }
        if(!body.pagination?.hasMore || body.skills.length===0) break;
        if(page+1<job.pages) await sleep(100);
      } catch(e) {
        const message=`${job.q||job.category||'(recent)'} page ${page}: ${e.message}`;
        errors.push(message);
        console.error(`Directory warning: ${message}`);
        break;
      }
    }
  }
  if (stats.requests===0) throw new Error(`Could not query Skills Directory; first error: ${errors[0]||'unknown'}`);
  return {items:[...byKey.values()], stats, errors};
}
/** SkillsMD indexes repositories, not individual SKILL.md files. */
function normalizeSkillsMd(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const repo = String(raw.repo || raw.full_name || raw.repository || '').trim();
  if (!REPO_RE.test(repo)) return null;
  const id = String(raw.id || '').trim();
  const hint = id.toLowerCase().startsWith(repo.toLowerCase()+'/') ? id.slice(repo.length+1) : '';
  const tags = unique([...(Array.isArray(raw.tags)?raw.tags:[]), ...(Array.isArray(raw.topics)?raw.topics:[])]);
  return {
    repository:repo, id, hint,
    name:String(raw.name || basename(hint) || basename(repo)),
    slug:String(basename(hint) || raw.name || basename(repo)),
    description:String(raw.desc || raw.description || ''),
    tags, topics:Array.isArray(raw.topics)?raw.topics:[],
    stars:Number(raw.stars||0), forks:Number(raw.forks||0),
    installs:Number(raw.installs||0), language:String(raw.language||''),
    updated:String(raw.updated||raw.updated_at||''),
    hot:raw.hot===true, trending:raw.trending===true,
    license:String(raw.license||''),
  };
}
function extractSkillsMdList(body) {
  if(Array.isArray(body)) return body;
  if(!body || typeof body!=='object') return [];
  for(const field of ['skills','results','data','items']) {
    if(Array.isArray(body[field])) return body[field];
  }
  return [];
}
async function findSkillsMd(opts,profiles) {
  const byKey=new Map(),errors=[],stats={requests:0,rows:0};
  const get=async (url,label)=>{
    try {
      const body=await jsonFetch(url,{verbose:opts.verbose});
      const rows=extractSkillsMdList(body);
      if(!Array.isArray(body) && !Array.isArray(body?.skills) && !Array.isArray(body?.results) && !Array.isArray(body?.data) && !Array.isArray(body?.items)) throw new Error('Unexpected response: no skills/results array');
      stats.requests++;stats.rows+=rows.length;
      for(const raw of rows){
        const item=normalizeSkillsMd(raw);
        if(!item) continue;
        const key=`${item.repository.toLowerCase()}:${item.hint.toLowerCase()}`;
        const old=byKey.get(key);
        byKey.set(key,old ? {...old,...item,tags:unique([...old.tags,...item.tags])} : item);
      }
      return {count:rows.length,body};
    }catch(e){const message=`${label}: ${e.message}`;errors.push(message);console.error(`SkillsMD warning: ${message}`);return null;}
  };
  for(let page=1;page<=opts.skillsmdPages;page++) {
    const r=await get(urlFor(opts.skillsmdApi,'/skills',{filter:opts.skillsmdFilter,page,limit:opts.limit}),`list page ${page}`);
    if(!r || r.count===0 || (typeof r.body.pages==='number' && page>=r.body.pages) ||
      (typeof r.body.total==='number' && page*opts.limit>=r.body.total)) break;
  }
  // Search is valuable because SkillsMD's leaderboard is a bounded list and
  // its search endpoint also searches tags (unlike Skills Directory's q).
  const priority=[...profiles].sort((a,b)=>(a.tech.skills?.length||0)-(b.tech.skills?.length||0));
  const searches=unique(priority.flatMap(p=>queriesFor(p,1))).slice(0,opts.skillsmdSearches);
  for(const q of searches) await get(urlFor(opts.skillsmdApi,'/search',{q}),`search ${q}`);
  return {items:[...byKey.values()],stats,errors};
}
async function enrichSkillsMd(entries,opts) {
  const seen=new Set();
  let count=0;
  for(const item of entries) {
    if(count>=opts.detailsLimit) break;
    const repo=item.skill.repository;
    if(seen.has(repo.toLowerCase())) continue;
    seen.add(repo.toLowerCase());count++;
    try {
      const detail=await jsonFetch(urlFor(opts.skillsmdApi,'/skill',{repo}),{verbose:opts.verbose});
      // Details are repository-scoped; do not treat the README as a specific skill description.
      const related=entries.filter(e=>e.skill.repository.toLowerCase()===repo.toLowerCase());
      for(const entry of related) {
        entry.skill={...entry.skill,
          topics:unique([...(entry.skill.topics||[]),...(Array.isArray(detail.topics)?detail.topics:[])]),
          tags:unique([...(entry.skill.tags||[]),...(Array.isArray(detail.topics)?detail.topics:[])]),
          license:String(detail.license||entry.skill.license||''),
          language:String(detail.language||entry.skill.language||''),
          description:String(entry.skill.description||detail.description||''),
          stars:Math.max(entry.skill.stars||0,Number(detail.stars||0)),
          forks:Math.max(entry.skill.forks||0,Number(detail.forks||0)),
        };
        entry.matches=bestMatches(entry.skill,opts.profiles,opts.minScore);
        entry.score=entry.matches[0]?.score??0;
      }
    }catch(e){item.notes.push(`SkillsMD detail unavailable: ${e.message}`);}
  }
  entries.sort((a,b)=>b.score-a.score);
}
async function enrich(entries,opts) {
  const count=Math.min(opts.detailsLimit,entries.length);
  for(let i=0;i<count;i++) {
    const item=entries[i];
    try {
      const u=urlFor(opts.apiBase,`/${encodeURIComponent(item.skill.slug)}`);
      const body=await jsonFetch(u,{verbose:opts.verbose});
      if(body?.skill && typeof body.skill==='object') {
        // Allow documented details to override list metadata, except missing fields.
        item.skill={...item.skill,...Object.fromEntries(Object.entries(body.skill).filter(([,v])=>v!==null&&v!==undefined))};
        item.matches=bestMatches(item.skill,opts.profiles,opts.minScore);
        item.score=item.matches[0]?.score??0;
      }
    } catch(e) {item.notes.push(`Directory detail unavailable: ${e.message}`);}
  }
  entries.sort((a,b)=>b.score-a.score);
}
async function treeFor(repo, opts, cache) {
  if(cache.has(repo)) return cache.get(repo);
  const promise=(async()=>{
    const api=opts.githubApi.replace(/\/$/,'');
    const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN||'';
    const auth={token,verbose:opts.verbose,kind:'github'};
    const info=await jsonFetch(`${api}/repos/${repo}`,auth);
    const branch=info.default_branch;
    if(typeof branch!=='string'||!branch) throw new Error(`Missing default branch for ${repo}`);
    const tree=await jsonFetch(`${api}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,auth);
    if(tree.truncated) throw new Error('GitHub returned truncated tree');
    if(!Array.isArray(tree.tree)) throw new Error('Invalid GitHub tree');
    const dirs=unique(tree.tree.filter(x=>x.type==='blob' && x.mode!=='120000' && (x.path==='SKILL.md'||x.path.endsWith('/SKILL.md')))
      .map(x=>x.path==='SKILL.md'?'':x.path.slice(0,-'/SKILL.md'.length)));
    return {branch,dirs};
  })();
  cache.set(repo,promise);
  return promise;
}
function resolveInTree(skill, tree) {
  const slug=norm(skill.slug), title=norm(skill.name);
  const matches=[];
  for(const dir of tree.dirs) {
    const base=norm(basename(dir));
    // Directory slugs sometimes include an author prefix; matching suffix is OK.
    let strength=0;
    if (base && base===slug) strength=4;
    else if(base && (phrase(slug,base) && slug.endsWith(base))) strength=3;
    else if(base && base===title) strength=3;
    else if(base && phrase(title,base) && base.length>=6) strength=1;
    if(strength) matches.push({dir,strength});
  }
  matches.sort((a,b)=>b.strength-a.strength);
  if(tree.dirs.length===1) return {dir:tree.dirs[0],confidence:'single-skill-repository'};
  if(matches.length && (matches.length===1 || matches[0].strength>matches[1].strength))
    return {dir:matches[0].dir,confidence:'directory-name-match'};
  return {error:`ambiguous: ${tree.dirs.length} SKILL.md paths; cannot identify directory for ${skill.slug}`};
}
function balanceSources(entries) {
  const dir=entries.filter(e=>e.source==='skillsdirectory');
  const md=entries.filter(e=>e.source==='skillsmd');
  if(!dir.length || !md.length) return entries;
  const out=[];
  while(dir.length || md.length) {
    // Keep a minimum discovery allocation for both APIs when candidates abound.
    for(let n=0;n<2&&dir.length;n++) out.push(dir.shift());
    if(md.length) out.push(md.shift());
    if(!dir.length) out.push(...md.splice(0));
    if(!md.length) out.push(...dir.splice(0));
  }
  return out;
}
function relatedSkillName(base,profiles) {
  // A multi-skill repository's summary/tags cannot be attributed to every skill.
  // Require independent signal from the SKILL.md directory name.
  const probe={name:base,slug:base,description:'',tags:[],category:''};
  return bestMatches(probe,profiles,20);
}
async function verify(entries,opts,existing) {
  const cache=new Map(), verified=[];
  let attempted=0;
  const usedPaths=new Set(), usedNames=new Map();
  // Limit GitHub verifications, not just successes, to respect rate limits.
  for(const item of entries) {
    if(attempted>=opts.verifyLimit) break;
    if(item.source==='skillsdirectory' && item.score<opts.minScore) continue;
    attempted++;
    const repo=item.skill.repository;
    try {
      const tree=await treeFor(repo,opts,cache);
      let paths=[];
      if(item.source==='skillsdirectory') {
        const resolved=resolveInTree(item.skill,tree);
        if(resolved.error){item.notes.push(resolved.error);continue;}
        paths=[resolved.dir];
      } else {
        // SkillsMD is repo-level: inspect actual SKILL.md directories and match
        // their names to skill-map technologies. Repo-wide tags are supporting
        // evidence only if there are multiple SKILL.md files.
        if(tree.dirs.length>250){item.notes.push('Too many SKILL.md paths for safe enumeration');continue;}
        paths=tree.dirs.filter(dir=>{
          if(tree.dirs.length===1) return true;
          const name=basename(dir)||basename(repo);
          return relatedSkillName(name,opts.profiles).length>0;
        });
        if(!paths.length){item.notes.push('No specific SKILL.md paths matched technologies');continue;}
      }
      for(const directory of paths) {
        const skillName=basename(directory)||basename(repo);
        if(!/^[a-z0-9][a-z0-9_.-]*$/i.test(skillName)) continue;
        const path=`${repo}/${skillName}`;
        if(existing.paths.has(path.toLowerCase()) || existing.names.has(skillName.toLowerCase())) continue;
        const skillLevel={...item.skill};
        if(item.source==='skillsmd') {
          skillLevel.name=skillName;
          skillLevel.slug=skillName;
          // In a multi-skill repo, score the skill's own directory name; repository
          // topics and description can corroborate but never establish its identity.
          if(tree.dirs.length>1) {
            skillLevel.description='';
            skillLevel.tags=[];
            skillLevel.topics=[];
          }
        }
        const matches=bestMatches(skillLevel,opts.profiles,opts.minScore);
        if(!matches.length) continue;
        const githubUrl=`https://github.com/${repo}/tree/${encodeURIComponent(tree.branch)}${directory?'/'+directory.split('/').map(encodeURIComponent).join('/'):''}`;
        const evidence={
          source:item.source, skill:item.skill, notes:item.notes,
          skillPath:path,skillName,directoryPath:directory,githubUrl,
          matches,score:matches[0].score,
          confidence:item.source==='skillsmd'?'GitHub SKILL.md path (repo-level directory)':'GitHub SKILL.md path (directory entry)',
        };
        const prev=usedPaths.has(path.toLowerCase()) ? verified.find(x=>x.skillPath.toLowerCase()===path.toLowerCase()) : null;
        if(prev) {
          prev.sources.push(item.source);
          prev.evidence.push(evidence);
          if(evidence.score>prev.score){prev.score=evidence.score;prev.matches=evidence.matches;}
          continue;
        }
        // Different sources cannot occupy the same registry basename.
        const collision=usedNames.get(skillName.toLowerCase());
        if(collision && collision.toLowerCase()!==path.toLowerCase()) {item.notes.push(`Registry name collision: ${skillName}`);continue;}
        usedNames.set(skillName.toLowerCase(),path);
        usedPaths.add(path.toLowerCase());
        verified.push({...evidence,sources:[item.source],evidence:[evidence]});
      }
    }catch(e){item.notes.push(`GitHub verification unavailable: ${e.message}`);}
  }
  return verified.sort((a,b)=>b.score-a.score);
}
function safeText(x) {return String(x??'').replace(/[\r\n]+/g,' ').replaceAll('|','\\|');}
function markdownReport(report,opts) {
  const lines=[
    '# AutoSkills — registry skill discoveries','',
    `Generated: ${report.generatedAt}`,'',
    `Mapped **${report.stats.technologies}** technologies. Skills Directory: **${report.stats.directoryRequests}** requests / **${report.stats.uniqueDirectorySkills}** entries. SkillsMD: **${report.stats.skillsmdRequests}** requests / **${report.stats.uniqueSkillsMdRepos}** repository entries.`,
    `Resolved **${report.matches.length}** new, non-colliding SKILL.md paths using GitHub (at most ${opts.verifyLimit} ranked verification attempts).`,'',
    '**These are suggestions, not installed or security-approved skills.** Review every upstream file and license before editing `skills-map.ts`.','',
  ];
  const grouped=new Map();
  for(const item of report.matches) for(const match of item.matches) {
    if(!grouped.has(match.id)) grouped.set(match.id,[]);
    grouped.get(match.id).push({item,match});
  }
  for(const tech of report.technologies) {
    const candidates=(grouped.get(tech.id)||[]).sort((a,b)=>b.match.score-a.match.score).slice(0,opts.maxPerTech);
    if(!candidates.length) continue;
    lines.push(`## ${tech.name} (${tech.id})`,'');
    for(const {item,match} of candidates) {
      const d=item.directory,sm=item.skillsmd;
      lines.push(`- **\`${item.skillPath}\`** — score **${match.score}**; sources: **${item.sources.join(', ')}**`);
      if(d?.description) lines.push(`  - Directory: ${safeText(d.name)} — ${safeText(d.description).slice(0,260)}`);
      if(sm?.description) lines.push(`  - SkillsMD repository: ${safeText(sm.name)} — ${safeText(sm.description).slice(0,260)}`);
      lines.push(`  - Evidence: ${safeText(match.reasons.join('; '))}`);
      const links=[`[SKILL.md directory](${item.githubUrl})`];
      if(d?.slug) links.push(`[Skills Directory](https://www.skillsdirectory.com/api/registry/${encodeURIComponent(d.slug)})`);
      if(sm?.repository) links.push(`[SkillsMD](https://skillsmd.dev/api/skill?repo=${encodeURIComponent(sm.repository)})`);
      lines.push(`  - ${links.join(' · ')}`);
      const tags=unique([...(d?.tags||[]),...(sm?.tags||[]),...(sm?.topics||[])]);
      if(tags.length) lines.push(`  - Tags/topics: ${tags.slice(0,15).map(safeText).join(', ')}`);
      const licenses=unique([d?.github?.license,sm?.license]);
      if(licenses.length) lines.push(`  - Reported license(s): ${licenses.map(safeText).join(', ')}`);
      const installs=sm?.installs;
      if(installs) lines.push(`  - SkillsMD installs: ${installs}`);
      if(Array.isArray(d?.requiresTools)&&d.requiresTools.length) lines.push(`  - Requires: ${d.requiresTools.map(safeText).join(', ')}`);
    }
    lines.push('');
  }
  if(!report.matches.length) lines.push('No non-colliding GitHub-verified paths met the criteria. Try `--tech <id> --verify-limit 80 --min-score 25`.','');
  if(report.errors.length) lines.push(`Warnings: ${report.errors.length}; see JSON report.`,'');
  lines.push('## Next steps','',
    'Add only reviewed `owner/repo/skill-name` identifiers to the relevant `skills` arrays in `packages/autoskills/skills-map.ts`.','',
    'Then run `pnpm --dir packages/autoskills sync:skills` with its normal security review enabled, and `pnpm --dir packages/autoskills validate:registry`. Do not bypass safety review.','');
  return lines.join('\n');
}
function outputFile(filepath,content) {
  if(filepath==='-') {console.log(content);return;}
  const dest=resolve(filepath);
  mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,content+'\n');
  console.error(`Wrote ${dest}`);
}
async function main() {
  const opts=options(process.argv.slice(2));
  const root=opts.repoRoot?locateRoot(opts.repoRoot):locateRoot(process.cwd())||locateRoot(dirname(fileURLToPath(import.meta.url)));
  if(!root) throw new Error('Cannot find autoskills checkout. Pass --repo-root /path/to/autoskills');
  const pkg=pkgRoot(root);
  const map=await import(pathToFileURL(join(pkg,'skills-map.ts')).href);
  const all=map.SKILLS_MAP;
  if(!Array.isArray(all)) throw new Error('Expected SKILLS_MAP export in skills-map.ts');
  const filtered=opts.tech.length?all.filter(t=>opts.tech.includes(t.id)):all;
  if(opts.tech.length && filtered.length!==new Set(opts.tech).size) {
    throw new Error(`Unknown --tech ids: ${opts.tech.filter(id=>!all.some(t=>t.id===id)).join(', ')}`);
  }
  const manifestFile=join(pkg,'skills-registry/index.json');
  let manifest={};
  if(existsSync(manifestFile)) manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  const existing=listSkillPaths(map,manifest);
  const profiles=filtered.map(signals);
  opts.profiles=profiles;
  const useDirectory=opts.source==='both'||opts.source==='skillsdirectory';
  const useMd=opts.source==='both'||opts.source==='skillsmd';
  const found=useDirectory ? await findDirectory(opts,profiles).catch(e=>{
    console.error(`Skills Directory unavailable: ${e.message}`);
    return {items:[],stats:{requests:0,rows:0},errors:[e.message]};
  }) : {items:[],stats:{requests:0,rows:0},errors:[]};
  const md=useMd ? await findSkillsMd(opts,profiles).catch(e=>{
    console.error(`SkillsMD unavailable: ${e.message}`);
    return {items:[],stats:{requests:0,rows:0},errors:[e.message]};
  }) : {items:[],stats:{requests:0,rows:0},errors:[]};
  if(found.stats.requests===0 && md.stats.requests===0) {
    throw new Error(`Neither requested discovery API returned results: ${[...found.errors,...md.errors].join('; ')}`);
  }
  const directoryCandidates=[];
  for(const skill of found.items) {
    if(!REPO_RE.test(String(skill.repository||''))) continue;
    const matches=bestMatches(skill,profiles,opts.minScore);
    if(!matches.length) continue;
    directoryCandidates.push({source:'skillsdirectory',skill,matches,score:matches[0].score,notes:[]});
  }
  directoryCandidates.sort((a,b)=>b.score-a.score);
  await enrich(directoryCandidates,opts);
  const mdCandidates=[];
  for(const skill of md.items) {
    const matches=bestMatches(skill,profiles,opts.minScore);
    if(!matches.length) continue;
    mdCandidates.push({source:'skillsmd',skill,matches,score:matches[0].score,notes:[]});
  }
  mdCandidates.sort((a,b)=>b.score-a.score);
  await enrichSkillsMd(mdCandidates,opts);
  const candidates=[...directoryCandidates,...mdCandidates]
    .filter(x=>x.score>=opts.minScore)
    .sort((a,b)=>b.score-a.score || a.skill.repository.localeCompare(b.skill.repository));
  const verified=await verify(balanceSources(candidates),opts,existing);
  const final=verified.map(item=>{
    const directoryE=item.evidence.find(e=>e.source==='skillsdirectory');
    const mdE=item.evidence.find(e=>e.source==='skillsmd');
    const directory=directoryE && {
      name:directoryE.skill.name,slug:directoryE.skill.slug,repository:directoryE.skill.repository,
      description:directoryE.skill.description,category:directoryE.skill.category,
      tags:directoryE.skill.tags||[],verified:directoryE.skill.verified===true,
      stars:directoryE.skill.github?.stars??directoryE.skill.stars??0,
      github:directoryE.skill.github,worksWith:directoryE.skill.worksWith,
      requiresTools:directoryE.skill.requiresTools,
    };
    const skillsmd=mdE && {
      name:mdE.skill.name,repository:mdE.skill.repository,description:mdE.skill.description,
      tags:mdE.skill.tags||[],topics:mdE.skill.topics||[],stars:mdE.skill.stars,
      forks:mdE.skill.forks,installs:mdE.skill.installs,language:mdE.skill.language,
      license:mdE.skill.license,updated:mdE.skill.updated,
      hot:mdE.skill.hot,trending:mdE.skill.trending,
    };
    return {
      skillPath:item.skillPath,skillName:item.skillName,directoryPath:item.directoryPath,
      githubUrl:item.githubUrl,confidence:item.confidence,sources:unique(item.sources),
      score:item.score,matches:item.matches,directory,skillsmd,
      notes:unique(item.evidence.flatMap(e=>e.notes)),
    };
  });
  const report={
    generatedAt:new Date().toISOString(),
    directoryApi:useDirectory?opts.apiBase:null,
    skillsmdApi:useMd?opts.skillsmdApi:null,
    repository:'rigerc/autoskills',
    stats:{technologies:filtered.length,directoryRequests:found.stats.requests,
      directoryRows:found.stats.rows,uniqueDirectorySkills:found.items.length,
      skillsmdRequests:md.stats.requests,skillsmdRows:md.stats.rows,
      uniqueSkillsMdRepos:new Set(md.items.map(x=>x.repository.toLowerCase())).size,
      semanticCandidates:candidates.length,githubVerified:final.length},
    technologies:filtered.map(x=>({id:x.id,name:x.name})),
    matches:final,
    errors:[...found.errors,...md.errors,...candidates.flatMap(x=>x.notes.map(n=>`${x.source} ${x.skill.repository}: ${n}`))],
  };
  if(opts.output===opts.markdown) throw new Error('JSON and Markdown output paths must differ (including stdout)');
  outputFile(opts.output,JSON.stringify(report,null,2));
  outputFile(opts.markdown,markdownReport(report,opts));
  console.error(`Done: ${report.stats.uniqueDirectorySkills} Skills Directory entries + ${report.stats.uniqueSkillsMdRepos} SkillsMD repos; ${candidates.length} matched entries; ${final.length} new GitHub-verified SKILL.md paths.`);
}
main().catch(e=>{console.error(`Discovery failed: ${e.stack||e}`);process.exitCode=1;});
