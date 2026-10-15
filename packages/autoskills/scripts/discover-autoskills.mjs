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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { norm, phrase, unique, basename, signals, domain,
  bestMatches, createQueryPlanner, parseSkillMarkdown } from './discovery-matcher.mjs';

const DEFAULT_DIRECTORY_API = 'https://www.skillsdirectory.com/api/registry';
const DEFAULT_SKILLSMD_API = 'https://skillsmd.dev/api';
const DEFAULT_GITHUB_API = 'https://api.github.com';

const REPO_RE = /^[a-z\d_.-]+\/[a-z\d_.-]+$/i;

function options(argv) {
  const out = {
    repoRoot: null, tech: [], category: '', sort: 'recent', limit: 50,
    pages: 1, recentPages: 1, categoryPages: 1, queriesPerTech: 3, directorySearches: 60, minScore: 35,
    detailsLimit: 35, verifyLimit: 25, maxPerTech: 5,
    output: 'skills-discovery.json', markdown: 'skills-discovery.md',
    selectionOutput: 'skills-discovery.selected.json',
    selectionMarkdown: 'skills-discovery.selected.md', interactive: 'auto',
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
    '--selection-output':'selectionOutput','--selection-markdown':'selectionMarkdown',
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
  --queries-per-tech N  Name/ID/package queries per technology (default: 3)
  --directory-searches N Maximum total directory text searches (default: 60)
  --min-score N         Minimum semantic relevance (default: 35)
  --details-limit N     Fetch details for top N candidates (default: 35)
  --verify-limit N      Verify GitHub SKILL.md for top N (default: 25)
  --max-per-tech N      Suggestions per technology in markdown (default: 5)
  --output FILE|-       JSON report file (default: skills-discovery.json)
  --markdown FILE|-     Markdown report file (default: skills-discovery.md)
  --interactive         Force terminal review after discovery (requires a TTY)
  --no-interactive      Disable terminal review (also automatic in CI/pipes)
  --selection-output F  Shortlisted candidates JSON (default: skills-discovery.selected.json)
  --selection-markdown F Shortlisted candidates Markdown (default: skills-discovery.selected.md)
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
    if (flag === '--interactive') { out.interactive = 'on'; continue; }
    if (flag === '--no-interactive') { out.interactive = 'off'; continue; }
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
  const sweepJobs=[{q:'',category:opts.category,sort:'recent',pages:opts.recentPages}];
  // Category sweeps also expose tag-only matches, since q does not search tags.
  if(opts.categoryPages) {
    const cats=opts.category ? [opts.category] : unique(profiles.flatMap(p=>[...domain(p.tech)]));
    for(const category of cats) sweepJobs.push({q:'',category,sort:opts.sort,pages:opts.categoryPages});
  }
  const seenJobs=new Set();
  const fetchJob=async (job,onRows=()=>{}) => {
    const key=norm(job.q)+'|'+job.sort+'|'+(job.category||'');
    if(seenJobs.has(key)) return;
    seenJobs.add(key);
    for(let page=0;page<job.pages;page++) {
      const url=urlFor(opts.apiBase,'',{q:job.q,category:job.category,
        sort:job.sort,limit:opts.limit,offset:page*opts.limit});
      try {
        const body=await jsonFetch(url,{verbose:opts.verbose});
        stats.requests++;
        if(!Array.isArray(body.skills)) throw new Error('Unexpected response: expected {skills:[]}');
        stats.rows+=body.skills.length;
        for(const item of body.skills) {
          if(!item || !REPO_RE.test(String(item.repository||'')) || !item.slug) continue;
          const k=item.repository.toLowerCase()+':'+String(item.slug).toLowerCase();
          if(!byKey.has(k)) {byKey.set(k,item);onRows(item);}
        }
        if(!body.pagination?.hasMore || body.skills.length===0) break;
        if(page+1<job.pages) await sleep(100);
      } catch(e) {
        const message=(job.q||job.category||'(recent)')+' page '+page+': '+e.message;
        errors.push(message);console.error('Directory warning: '+message);break;
      }
    }
  };
  const coverage=new Map(profiles.map(p=>[p.tech.id,0]));
  const record=item=>{
    for(const m of bestMatches(item,profiles,opts.minScore))
      coverage.set(m.id,(coverage.get(m.id)||0)+1);
  };
  for(const job of sweepJobs) await fetchJob(job,record);
  const planner=createQueryPlanner(profiles,opts.queriesPerTech,opts.directorySearches);
  for(let next; (next=planner.next(coverage));)
    await fetchJob({q:next.query,category:opts.category,sort:opts.sort,pages:opts.pages},record);
  if(stats.requests===0) throw new Error('Could not query Skills Directory; first error: '+(errors[0]||'unknown'));
  return {items:[...byKey.values()],stats,errors};
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
  const coverage=new Map(profiles.map(p=>[p.tech.id,0]));
  const get=async (url,label)=>{
    try {
      const body=await jsonFetch(url,{verbose:opts.verbose});
      const rows=extractSkillsMdList(body);
      if(!Array.isArray(body) && !['skills','results','data','items'].some(k=>Array.isArray(body?.[k])))
        throw new Error('Unexpected response: no skills/results array');
      stats.requests++;stats.rows+=rows.length;
      for(const raw of rows){
        const item=normalizeSkillsMd(raw);
        if(!item) continue;
        const key=item.repository.toLowerCase()+':'+item.hint.toLowerCase();
        const old=byKey.get(key);
        byKey.set(key,old ? {...old,...item,tags:unique([...old.tags,...item.tags])} : item);
        if(!old) for(const m of bestMatches(item,profiles,opts.minScore))
          coverage.set(m.id,(coverage.get(m.id)||0)+1);
      }
      return {count:rows.length,body};
    }catch(e){
      const message=label+': '+e.message;
      errors.push(message);console.error('SkillsMD warning: '+message);return null;
    }
  };
  for(let page=1;page<=opts.skillsmdPages;page++) {
    const r=await get(urlFor(opts.skillsmdApi,'/skills',
      {filter:opts.skillsmdFilter,page,limit:opts.limit}),'list page '+page);
    if(!r || r.count===0 || (typeof r.body.pages==='number' && page>=r.body.pages) ||
      (typeof r.body.total==='number' && page*opts.limit>=r.body.total)) break;
  }
  const planner=createQueryPlanner(profiles,Math.max(2,opts.queriesPerTech),opts.skillsmdSearches);
  for(let next; (next=planner.next(coverage));)
    await get(urlFor(opts.skillsmdApi,'/search',{q:next.query}),'search '+next.query);
  return {items:[...byKey.values()],stats,errors};
}
function enrichmentOrder(entries, budget) {
  // Reserve a small portion of detail requests for candidates whose list
  // metadata is too sparse to match, rather than silently discarding them.
  const positive=entries.filter(e=>e.score>0);
  const unknown=entries.filter(e=>e.score===0);
  const reserve=Math.min(unknown.length,Math.ceil(budget/5));
  const preferred=[...positive.slice(0,Math.max(0,budget-reserve)),...unknown.slice(0,reserve)];
  const chosen=new Set(preferred);
  return [...preferred,...entries.filter(e=>!chosen.has(e))];
}
async function enrichSkillsMd(entries,opts) {
  const seen=new Set();
  let count=0;
  for(const item of enrichmentOrder(entries,opts.detailsLimit)) {
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
  for(const item of enrichmentOrder(entries,count).slice(0,count)) {
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
    const info=await jsonFetch(api+'/repos/'+repo,auth);
    const branch=info.default_branch;
    if(typeof branch!=='string'||!branch) throw new Error('Missing default branch for '+repo);
    const tree=await jsonFetch(api+'/repos/'+repo+'/git/trees/'+encodeURIComponent(branch)+'?recursive=1',auth);
    if(tree.truncated) throw new Error('GitHub returned truncated tree');
    if(!Array.isArray(tree.tree)) throw new Error('Invalid GitHub tree');
    const blobs=new Map();
    for(const entry of tree.tree) {
      if(entry.type!=='blob'||entry.mode==='120000'||typeof entry.sha!=='string') continue;
      if(entry.path!=='SKILL.md' && !entry.path.endsWith('/SKILL.md')) continue;
      const dir=entry.path==='SKILL.md'?'':entry.path.slice(0,-'/SKILL.md'.length);
      blobs.set(dir,entry.sha);
    }
    return {branch,dirs:[...blobs.keys()],blobs};
  })();
  cache.set(repo,promise);
  return promise;
}
async function fetchSkillMarkdown(repo, blobSha, opts) {
  const api=opts.githubApi.replace(/\/$/,'');
  const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN||'';
  // Fetch the immutable blob referenced by the Git tree, not a moving branch.
  const blob=await jsonFetch(api+'/repos/'+repo+'/git/blobs/'+blobSha,
    {token,verbose:opts.verbose,kind:'github'});
  if(blob.encoding!=='base64'||typeof blob.content!=='string')
    throw new Error('Unexpected GitHub blob response');
  if(blob.size>256000) throw new Error('SKILL.md exceeds 256 KB inspection limit');
  return Buffer.from(blob.content.replace(/\s+/g,''),'base64').toString('utf8');
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
  const probe={name:base,slug:base,description:'',tags:[],category:''};
  return bestMatches(probe,profiles,20).length>0;
}
async function verify(entries,opts,existing) {
  const cache=new Map(),verified=[],usedPaths=new Map(),usedNames=new Map();
  const repositories=new Map(),coverage=new Map(opts.profiles.map(p=>[p.tech.id,0]));
  for(const item of entries) {
    if(item.score<Math.min(15,opts.minScore)) continue;
    const key=item.skill.repository.toLowerCase();
    if(!repositories.has(key)) repositories.set(key,[]);
    repositories.get(key).push(item);
  }
  const remaining=[...repositories.values()];
  let attempted=0;
  while(remaining.length && attempted<opts.verifyLimit) {
    // A limited verification budget is allocated across unique repos, favoring
    // candidates for technologies not yet represented in verified results.
    remaining.sort((a,b)=>{
      const priority=group=>Math.max(...group.flatMap(item=>item.matches.map(m=>
        m.relevanceScore+Math.max(0,3-(coverage.get(m.id)||0))*20)),0);
      return priority(b)-priority(a) ||
        b[0].score-a[0].score ||
        a[0].skill.repository.localeCompare(b[0].skill.repository);
    });
    const group=remaining.shift();
    const repo=group[0].skill.repository;
    attempted++;
    try {
      const tree=await treeFor(repo,opts,cache);
      const candidates=new Map();
      for(const item of group) {
        let paths=[];
        if(item.source==='skillsdirectory') {
          const resolved=resolveInTree(item.skill,tree);
          if(resolved.error){item.notes.push(resolved.error);continue;}
          paths=[resolved.dir];
        } else {
          if(tree.dirs.length>250) {
            item.notes.push('Too many SKILL.md paths for safe enumeration');continue;
          }
          // Small repositories may have descriptive frontmatter but generic
          // directory names; inspect their actual content instead of dropping them.
          paths=tree.dirs.length<=25 ? tree.dirs :
            tree.dirs.filter(dir=>relatedSkillName(basename(dir)||basename(repo),opts.profiles) ||
              norm(dir).includes(norm(item.skill.hint)));
        }
        for(const dir of paths) {
          if(!candidates.has(dir)) candidates.set(dir,[]);
          candidates.get(dir).push(item);
        }
      }
      let checked=0;
      for(const [directory,items] of candidates) {
        if(checked>=25) {for(const item of items)item.notes.push('Per-repository content inspection capped at 25');break;}
        checked++;
        const skillName=basename(directory)||basename(repo);
        if(!/^[a-z0-9][a-z0-9_.-]*$/i.test(skillName)) continue;
        const path=repo+'/'+skillName;
        if(existing.paths.has(path.toLowerCase()) || existing.names.has(skillName.toLowerCase())) continue;
        if(!tree.blobs.has(directory)) continue;
        let parsed;
        try {parsed=parseSkillMarkdown(await fetchSkillMarkdown(repo,tree.blobs.get(directory),opts),skillName);}
        catch(e) {for(const item of items)item.notes.push('Skill content unavailable: '+e.message);continue;}
        const level={...parsed,slug:skillName,
          verified:items.some(e=>e.skill.verified===true),
          category:items.find(e=>e.skill.category)?.skill.category||'',
          stars:Math.max(...items.map(e=>Number(e.skill.stars||e.skill.github?.stars||0)),0),
          installs:Math.max(...items.map(e=>Number(e.skill.installs||0)),0)};
        const matches=bestMatches(level,opts.profiles,opts.minScore,{stage:'final'});
        if(!matches.length) continue;
        const collision=usedNames.get(skillName.toLowerCase());
        if(collision && collision!==path.toLowerCase()) {
          for(const item of items)item.notes.push('Registry name collision: '+skillName);
          continue;
        }
        const prev=usedPaths.get(path.toLowerCase());
        const githubUrl='https://github.com/'+repo+'/tree/'+encodeURIComponent(tree.branch)+
          (directory?'/'+directory.split('/').map(encodeURIComponent).join('/'):'' );
        const evidence=items.map(item=>({
          source:item.source,skill:item.skill,notes:item.notes,skillPath:path,
          skillName,directoryPath:directory,githubUrl,matches,score:matches[0].score,
          confidence:'GitHub SKILL.md blob and frontmatter verified',
        }));
        if(prev) {
          prev.sources=unique([...prev.sources,...evidence.map(e=>e.source)]);
          prev.evidence.push(...evidence);
          continue;
        }
        const result={...evidence[0],sources:unique(evidence.map(e=>e.source)),evidence};
        usedPaths.set(path.toLowerCase(),result);
        usedNames.set(skillName.toLowerCase(),path.toLowerCase());
        verified.push(result);
        for(const m of matches) coverage.set(m.id,(coverage.get(m.id)||0)+1);
      }
    }catch(e){for(const item of group)item.notes.push('GitHub verification unavailable: '+e.message);}
  }
  return verified.sort((a,b)=>b.score-a.score ||
    a.skillPath.localeCompare(b.skillPath));
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
async function interactiveReview(report, opts) {
  const { emitKeypressEvents } = await import('node:readline');
  const input = process.stdin, output = process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Interactive review requires a TTY. Re-run in a terminal, or use --no-interactive.');
  }
  if (opts.output === '-' || opts.markdown === '-') {
    throw new Error('Interactive review cannot be combined with --output - or --markdown -.');
  }
  const paths = [opts.output, opts.markdown, opts.selectionOutput, opts.selectionMarkdown].map(p => resolve(p));
  if (new Set(paths).size !== paths.length) {
    throw new Error('Selection export paths must be distinct from each other and the main report paths.');
  }
  const selected = new Set();
  const techs = ['all', ...unique(report.matches.flatMap(x => x.matches.map(m => m.id)))];
  const sources = ['all', 'skillsdirectory', 'skillsmd'];
  let techIndex = 0, sourceIndex = 0, cursor = 0, top = 0, detailOffset = 0;
  let search = '', pendingSearch = '', searching = false, selectedOnly = false;
  let view = 'list', status = 'Space selects candidates; e exports a review shortlist. No skills are installed.';
  const clean = x => String(x ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();
  const width = () => Math.max(30, output.columns || 100);
  const height = () => Math.max(12, output.rows || 25);
  const fit = x => clean(x).slice(0, width() - 1);
  const visible = () => report.matches.filter(x => {
    if (selectedOnly && !selected.has(x.skillPath)) return false;
    if (techs[techIndex] !== 'all' && !x.matches.some(m => m.id === techs[techIndex])) return false;
    if (sources[sourceIndex] !== 'all' && !x.sources.includes(sources[sourceIndex])) return false;
    if (search) {
      const hay = norm([
        x.skillPath, x.skillName, x.directory?.name, x.directory?.description,
        x.skillsmd?.name, x.skillsmd?.description, x.directory?.category,
        ...(x.directory?.tags || []), ...(x.skillsmd?.tags || []),
        ...(x.skillsmd?.topics || []), ...x.matches.flatMap(m => [m.id, m.name, ...m.reasons])
      ].join(' '));
      if (!hay.includes(norm(search))) return false;
    }
    return true;
  });
  const render = () => {
    const items = visible();
    cursor = Math.min(Math.max(0, cursor), Math.max(0, items.length - 1));
    const limit = Math.max(1, height() - 8);
    top = Math.max(0, Math.min(top, Math.max(0, items.length - limit)));
    if (cursor < top) top = cursor;
    if (cursor >= top + limit) top = cursor - limit + 1;
    const lines = [
      fit(`AutoSkills discovery | ${items.length}/${report.matches.length} results | ${selected.size} selected`),
      fit(`Technology [t]: ${techs[techIndex]} | Source [s]: ${sources[sourceIndex]} | Selected only [v]: ${selectedOnly ? 'yes' : 'no'}`),
      fit(searching ? `Search: ${pendingSearch}_ (Enter apply, Esc cancel)` : `Search [/]: ${search || '(all)'}`),
      '-'.repeat(width() - 1)
    ];
    if (view === 'help') {
      lines.push(
        'Up/Down or j/k: move       PageUp/PageDown: page       Home/End: jump',
        'Enter: details             Space: select/deselect      a: select visible',
        '/: search tags, category, description and match evidence',
        't: change technology      s: change source            v: selected only',
        'u: deselect all           e: export JSON + Markdown shortlist',
        'Escape: close details or clear search       q / Ctrl-C: quit',
        '',
        'Selections are review suggestions, NOT approved or installed skills.'
      );
    } else if (view === 'detail') {
      const item = items[cursor];
      if (!item) { view = 'list'; lines.push('No candidates match these filters.'); }
      else {
        const details = [
          `Skill: ${item.skillPath}`,
          `Score: ${item.score} | ${selected.has(item.skillPath) ? 'SELECTED' : 'not selected'}`,
          `GitHub directory: ${item.githubUrl}`,
          `Sources: ${item.sources.join(', ')} | Confidence: ${item.confidence}`,
          `Category: ${item.directory?.category || 'not provided'}`,
          `License: ${item.directory?.github?.license || item.skillsmd?.license || 'unknown'}`,
          `GitHub stars: ${item.directory?.stars ?? item.skillsmd?.stars ?? 'unknown'} | SkillsMD installs: ${item.skillsmd?.installs ?? 'unknown'}`,
          `Description: ${item.directory?.description || item.skillsmd?.description || '(none)'}`,
          `Tags: ${unique([...(item.directory?.tags || []), ...(item.skillsmd?.tags || []), ...(item.skillsmd?.topics || [])]).join(', ') || '(none)'}`,
          ...item.matches.flatMap(m => [
            `${m.name} (${m.id}): ${m.score} points`,
            ...m.reasons.map(r => `   - ${r}`)
          ]),
          ...(item.notes || []).map(n => `Note: ${n}`),
          '',
          'Enter/Esc: back | Space: select | Up/Down: scroll details'
        ];
        detailOffset = Math.min(Math.max(0, detailOffset), Math.max(0, details.length - limit));
        lines.push(...details.slice(detailOffset, detailOffset + limit).map(fit));
        lines.push(fit(`Detail rows ${detailOffset + 1}-${Math.min(details.length, detailOffset + limit)} of ${details.length}`));
      }
    } else {
      if (!items.length) lines.push('No matches. Change filters with /, t, s or v.');
      for (let i = top; i < Math.min(items.length, top + limit); i++) {
        const item = items[i];
        const mark = selected.has(item.skillPath) ? 'x' : ' ';
        const tech = item.matches[0]?.id || '?';
        const src = item.sources.map(s => s === 'skillsdirectory' ? 'D' : 'M').join('+');
        lines.push(fit(`${cursor === i ? '>' : ' '} [${mark}] ${String(item.score).padStart(3)} ${tech.padEnd(16).slice(0, 16)} ${item.skillPath} [${src}]`));
      }
      lines.push(fit(`Showing ${items.length ? top + 1 : 0}-${Math.min(items.length, top + limit)} of ${items.length}`));
    }
    lines.push('-'.repeat(width() - 1));
    lines.push(fit('Up/Down: move | Enter: details | Space: select | /: search | t/s: filters | e: export | ?: help | q: quit'));
    lines.push(fit(`Status: ${status}`));
    output.write('\x1b[H\x1b[2J' + lines.slice(0, height()).join('\n'));
  };
  const exportShortlist = () => {
    const matches = report.matches.filter(x => selected.has(x.skillPath));
    if (!matches.length) { status = 'No selection to export. Use Space or a first.'; return; }
    const result = { ...report, selectedAt: new Date().toISOString(), matches, stats: { ...report.stats, selected: matches.length } };
    const write = (path, value) => {
      const dest = resolve(path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, value + '\n');
    };
    write(opts.selectionOutput, JSON.stringify(result, null, 2));
    write(opts.selectionMarkdown, markdownReport(result, opts).replace(
      '# AutoSkills — registry skill discoveries', '# AutoSkills — review shortlist (not approved)'));
    status = `Exported ${matches.length} suggestions to ${opts.selectionOutput} and ${opts.selectionMarkdown}`;
  };
  return new Promise((done, fail) => {
    const oldRaw = input.isRaw || false;
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.off('keypress', onKey);
      output.off('resize', render);
      process.off('SIGTERM', onTermination);
      input.setRawMode(oldRaw);
      if (!oldRaw) input.pause();
      output.write('\x1b[?25h\x1b[?1049l\n');
      if (error) fail(error);
      else { console.error(`Interactive review closed. ${selected.size} shortlisted (not approved).`); done(); }
    };
    const onTermination = () => { process.exitCode = 143; finish(); };
    const onKey = (character, key = {}) => {
      try {
        if (key.ctrl && key.name === 'c') { finish(); return; }
        if (searching) {
          if (key.name === 'escape') { searching = false; status = 'Search cancelled.'; }
          else if (key.name === 'return') { search = pendingSearch.trim(); searching = false; cursor = 0; top = 0; status = `Filter: ${search || '(all)'}`; }
          else if (key.name === 'backspace') pendingSearch = pendingSearch.slice(0, -1);
          else if (character && !key.ctrl && !key.meta && character.length === 1 && character.charCodeAt(0) >= 32 && pendingSearch.length < 120) pendingSearch += character;
          render(); return;
        }
        const items = visible();
        if (character === 'q') { finish(); return; }
        if (view === 'help') {
          if (key.name === 'escape' || key.name === 'return' || character === '?') view = 'list';
          render(); return;
        }
        if (view === 'detail') {
          if (key.name === 'escape' || key.name === 'return') { view = 'list'; detailOffset = 0; }
          else if (key.name === 'up' || character === 'k') detailOffset = Math.max(0, detailOffset - 1);
          else if (key.name === 'down' || character === 'j') detailOffset++;
          else if (key.name === 'pageup') detailOffset = Math.max(0, detailOffset - Math.max(1, height() - 8));
          else if (key.name === 'pagedown') detailOffset += Math.max(1, height() - 8);
          else if (key.name === 'space' || character === ' ') {
            const item = items[cursor];
            if (item) selected.has(item.skillPath) ? selected.delete(item.skillPath) : selected.add(item.skillPath);
          }
          render(); return;
        }
        if (key.name === 'escape') { search = ''; cursor = 0; top = 0; status = 'Search cleared.'; }
        else if (key.name === 'up' || character === 'k') cursor = Math.max(0, cursor - 1);
        else if (key.name === 'down' || character === 'j') cursor = Math.min(Math.max(0, items.length - 1), cursor + 1);
        else if (key.name === 'pageup') cursor = Math.max(0, cursor - Math.max(1, height() - 8));
        else if (key.name === 'pagedown') cursor = Math.min(Math.max(0, items.length - 1), cursor + Math.max(1, height() - 8));
        else if (key.name === 'home') cursor = 0;
        else if (key.name === 'end') cursor = Math.max(0, items.length - 1);
        else if (key.name === 'space' || character === ' ') {
          const item = items[cursor];
          if (item) selected.has(item.skillPath) ? selected.delete(item.skillPath) : selected.add(item.skillPath);
        }
        else if (key.name === 'return') { if (items.length) { view = 'detail'; detailOffset = 0; } }
        else if (character === '/') { searching = true; pendingSearch = search; }
        else if (character === '?') view = 'help';
        else if (character === 't') { techIndex = (techIndex + 1) % techs.length; cursor = 0; top = 0; }
        else if (character === 's') { sourceIndex = (sourceIndex + 1) % sources.length; cursor = 0; top = 0; }
        else if (character === 'v') { selectedOnly = !selectedOnly; cursor = 0; top = 0; }
        else if (character === 'a') { for (const item of items) selected.add(item.skillPath); status = `Selected ${selected.size} suggestions.`; }
        else if (character === 'u') { selected.clear(); status = 'Selection cleared.'; }
        else if (character === 'e') exportShortlist();
        render();
      } catch (e) { status = `Error: ${e.message}`; render(); }
    };
    try {
      emitKeypressEvents(input);
      input.setRawMode(true);
      input.resume();
      output.write('\x1b[?1049h\x1b[?25l');
      input.on('keypress', onKey);
      output.on('resize', render);
      process.on('SIGTERM', onTermination);
      render();
    } catch (e) { finish(e); }
  });
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
  if(opts.interactive==='on' && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('--interactive requires a TTY terminal; use --no-interactive in pipes and CI.');
  }
  if(opts.interactive==='on' && (opts.output==='-' || opts.markdown==='-')) {
    throw new Error('--interactive cannot be used with --output - or --markdown -.');
  }
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
    // Retain sparse list entries for bounded detail enrichment; richer metadata
    // may reveal an actual skill-level match that the list omitted.
    directoryCandidates.push({source:'skillsdirectory',skill,matches,score:matches[0]?.score??0,notes:[]});
  }
  directoryCandidates.sort((a,b)=>b.score-a.score);
  await enrich(directoryCandidates,opts);
  const mdCandidates=[];
  for(const skill of md.items) {
    const matches=bestMatches(skill,profiles,opts.minScore);
    mdCandidates.push({source:'skillsmd',skill,matches,score:matches[0]?.score??0,notes:[]});
  }
  mdCandidates.sort((a,b)=>b.score-a.score);
  await enrichSkillsMd(mdCandidates,opts);
  const candidates=[...directoryCandidates,...mdCandidates]
    // Provisional retrieval cutoff: final min-score and eligibility are applied
    // only after reading the immutable SKILL.md content.
    .filter(x=>x.score>=Math.min(15,opts.minScore))
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
  if (opts.interactive==='on' || (opts.interactive==='auto' && process.stdin.isTTY && process.stdout.isTTY && opts.output!=='-' && opts.markdown!=='-')) {
    await interactiveReview(report,opts);
  }
}
main().catch(e=>{console.error(`Discovery failed: ${e.stack||e}`);process.exitCode=1;});
