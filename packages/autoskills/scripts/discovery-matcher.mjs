// Deterministic, skill-level relevance matching for discovery. No network access.
export const STOP = new Set([
  'a','an','and','app','application','best','build','cli','client','code','coding',
  'core','dev','development','developer','for','framework','guide','guides','js',
  'kit','lib','library','new','of','pattern','patterns','plugin','sdk','skill',
  'skills','test','tool','tools','the','ts','use','web','with'
]);

const ALIASES = {
  csharp: ['c#','c-sharp','c sharp','csharp'],
  cpp: ['c++','cpp','c plus plus'],
  dotnet: ['.net','dotnet','dot net','asp.net','aspnet'],
  nextjs: ['next.js','nextjs','next js'],
  node: ['node.js','nodejs','node js'],
  'react-native': ['react native','reactnative'],
  'tanstack-query': ['tanstack query','tan stack query'],
  'react-router': ['react router','reactrouter'],
  'react-hook-form': ['react hook form','rhf'],
  openai: ['openai','open ai','openai sdk'],
  langchain: ['langchain','lang chain'],
  'postgres-ruby': ['postgres','postgresql','postgres ruby'],
  go: ['golang','go programming','go language','go'],
  postgres: ['postgresql','postgres'],
  shadcn: ['shadcn/ui','shadcn ui','shadcn'],
  typescript: ['typescript','type script'],
  'github-actions': ['github actions','github action'],
  'anthropic-sdk': ['anthropic sdk','anthropic'],
  'mcp-sdk': ['model context protocol','mcp sdk','mcp'],
  'scikit-learn': ['scikit learn','sklearn'],
};

export function norm(value) {
  return String(value ?? '')
    // Preserve established mixed-case product spellings before splitting camel case.
    .replace(/\b(openai|github|postgresql|typescript|javascript|fastapi|fastmcp|graphql|langchain|tanstack|huggingface|nextjs|nodejs|golang)\b/gi,
      word => word.toLowerCase())
    .replace(/c\+\+/gi, ' cpp ')
    .replace(/c#/gi, ' csharp ')
    .replace(/(^|[^a-z])\.net\b/gi, '$1 dotnet ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function unique(xs) { return [...new Set(xs.filter(Boolean))]; }
export function basename(path) { return String(path).split('/').filter(Boolean).at(-1) || ''; }
export function phrase(hay, needle) {
  return !!needle && !!hay && (' ' + hay + ' ').includes(' ' + needle + ' ');
}
const noisy = new Set(['config','settings','application','project','version','manifest',
  'requirements','setup','main','global','package','source compatibility','target compatibility']);
const normalizedUnique = values => unique(values.map(norm));
function usable(value) {
  const words = value.split(' ');
  return value.length >= 3 && !noisy.has(value) && !words.every(w => STOP.has(w));
}

export function signals(tech) {
  const detect = tech.detect || {};
  const blocks = Array.isArray(detect.configFileContent) ? detect.configFileContent :
    detect.configFileContent ? [detect.configFileContent] : [];
  const aliases = normalizedUnique([tech.id, tech.name, ...(ALIASES[tech.id] || [])])
    .filter(x => x.length >= 2 || x === 'c');
  const packages = normalizedUnique([
    ...(detect.packages || []), ...(detect.pythonPackages || []), ...(detect.gems || []),
    ...blocks.flatMap(b => b.patterns || []).filter(p => {
      const n = norm(p);
      return n.length >= 5 && aliases.some(alias => phrase(n, alias) || phrase(alias, n));
    }),
  ]).filter(usable).filter(p => !aliases.includes(p));
  // Regex packagePatterns and generic filenames are detection rules, not skill names.
  const tokens = unique([...aliases, ...packages].flatMap(s => s.split(' ')))
    .filter(t => t.length >= 3 && !STOP.has(t) && !noisy.has(t));
  return {tech, strong:aliases, packages, tokens};
}

export function queriesFor(profile, count) {
  const original = [profile.tech.name, profile.tech.id.replaceAll('-', ' ')];
  const aliases = ALIASES[profile.tech.id] || [];
  const terms = [...original, ...aliases, ...profile.packages]
    .filter(x => norm(x).length >= 3);
  const seen = new Set();
  return terms.filter(q => {
    const n = norm(q);
    if (seen.has(n)) return false;
    seen.add(n); return true;
  }).slice(0, count);
}

export function createQueryPlanner(profiles, queriesPerTech, budget) {
  const pending = profiles.map(profile => ({
    profile, queries:queriesFor(profile, queriesPerTech), attempts:0,
  }));
  const used = new Set();
  let issued = 0;
  return {
    next(coverage = new Map()) {
      if (issued >= budget) return null;
      const available = pending.filter(row =>
        row.queries.some(q => !used.has(norm(q))));
      available.sort((a,b) =>
        ((coverage.get(a.profile.tech.id) || 0) - (coverage.get(b.profile.tech.id) || 0)) ||
        a.attempts-b.attempts ||
        (a.profile.tech.skills?.length || 0)-(b.profile.tech.skills?.length || 0) ||
        a.profile.tech.id.localeCompare(b.profile.tech.id));
      const row = available[0];
      if (!row) return null;
      const query = row.queries.find(q => !used.has(norm(q)));
      used.add(norm(query)); row.attempts++; issued++;
      return {query, profile:row.profile};
    },
    get issued() {return issued;},
  };
}

export function domain(tech) {
  const hay = norm([tech.id,tech.name,...(tech.detect?.packages || [])].join(' '));
  if (/postgres|database|mongo|prisma|drizzle|redis|sql|firebase|convex|supabase|neon|sqlite|graphql/.test(hay))
    return new Set(['databases','data-analytics','development']);
  if (/docker|kubernetes|helm|cloud|terraform|azure|vercel|netlify|github actions|gitlab|devops|deploy|observab|sentry/.test(hay))
    return new Set(['devops-cloud','development','tools-automation']);
  if (/vitest|jest|test|playwright|cypress|eslint|biome|prettier|lint|quality/.test(hay))
    return new Set(['testing-qa','code-review-quality','development']);
  if (/openai|anthropic|mcp|agent|langchain|hugging face|ai sdk/.test(hay))
    return new Set(['ai-agents','development','tools-automation']);
  if (/react|vue|svelte|angular|tailwind|css|next js|nuxt|design|storybook|frontend|flutter/.test(hay))
    return new Set(['development','design-ux','testing-qa']);
  if (/security|auth|clerk|oauth|sso/.test(hay)) return new Set(['security','development']);
  return new Set(['development','tools-automation','documentation']);
}

const negativeContexts = ['away from ', 'without ', 'replace ', 'replacing ',
  'remove ', 'removing ', 'stop using ', 'migrate from ', 'instead of ', 'deprecate '];
function rejectsTechnology(skill, profile) {
  const title = norm([skill.name, skill.slug].join(' '));
  const description = norm(skill.description);
  const aliases = profile.strong;
  if (aliases.some(a => negativeContexts.some(prefix => title.includes(prefix + a))))
    return true;
  if (aliases.some(a => negativeContexts.some(prefix => description.includes(prefix + a))) &&
    !aliases.some(a => phrase(title, a))) return true;
  // "Go" is a common English verb. A programming-context term is required.
  if (profile.tech.id === 'go') {
    const hay = norm([skill.name,skill.slug,skill.description,
      ...(skill.tags||[]), ...(skill.topics||[]), skill.body].join(' '));
    if (phrase(hay,'go to market') || (phrase(hay,'go to') && !phrase(hay,'golang'))) return true;
    if (/(golang|go mod|goroutine|go programming|go language|go compiler|go module|go package|go code|go backend|go concurrency|go function|go testing)/.test(hay)) return false;
    // For a Go-specific title, programming-domain context can disambiguate
    // legitimate short titles such as "Go routines" without accepting "go to".
    const inTitle=phrase(norm(skill.name),'go') || phrase(norm(skill.slug),'go');
    return !(inTitle && /(programming|developer|development|compiler|backend|concurrency|module|package|runtime|software|coding|api)/.test(hay));
  }
  return false;
}
function hit(fields, term) {
  return {
    title:phrase(fields.title,term), slug:phrase(fields.slug,term),
    tags:fields.tags.some(t=>phrase(t,term)),
    description:phrase(fields.description,term),
    body:phrase(fields.body,term),
  };
}
export function score(skill, profile, {stage='candidate'}={}) {
  const fields = {
    title:norm(skill.name),slug:norm(skill.slug),
    tags:normalizedUnique([...(skill.tags||[]), ...(skill.topics||[])]),
    description:norm(skill.description),body:norm(skill.body || ''),
  };
  if (rejectsTechnology(skill,profile)) return null;
  const reasons = [];
  let title=0,slug=0,tag=0,description=0,body=0;
  let packageTitle=0,packageSlug=0,packageTags=0,packageDesc=0,packageBody=0;
  for(const term of profile.strong) {
    const h=hit(fields,term);
    if(h.title) title=50;
    if(h.slug) slug=48;
    if(h.tags) tag=35;
    if(h.description) description=20;
    if(h.body) body=15;
    if(Object.values(h).some(Boolean))
      reasons.push('technology "'+term+'" in '+Object.entries(h).filter(([,v])=>v).map(([k])=>k).join('/'));
  }
  for(const term of profile.packages) {
    const h=hit(fields,term);
    if(h.title) packageTitle=30;
    if(h.slug) packageSlug=28;
    if(h.tags) packageTags=25;
    if(h.description) packageDesc=14;
    if(h.body) packageBody=12;
    if(Object.values(h).some(Boolean) && reasons.length<6)
      reasons.push('package "'+term+'"');
  }
  const identity = Math.max(title,slug,tag,packageTitle,packageSlug,packageTags);
  const text = Math.max(description,packageDesc) + Math.max(body,packageBody);
  const relevanceScore = Math.min(100, Math.max(identity, text) +
    (identity && (description || packageDesc) ? 8 : 0) +
    (identity && (body || packageBody) ? 7 : 0));
  if (!relevanceScore) return null;
  // Repo search metadata is only candidate-generation evidence. Final eligibility
  // must be based on fields parsed from the skill's own SKILL.md.
  const eligible = title>=50 || slug>=48 || tag>=35 ||
    packageTitle>=30 || (packageSlug>=28 && text>=12) ||
    (packageTags>=25 && text>=12) || text>=35;
  if (stage==='final' && !eligible) return null;
  const category = norm(skill.category).replaceAll(' ','-');
  let qualityScore=0;
  if(category && domain(profile.tech).has(category)) {qualityScore+=2;reasons.push('related category');}
  if(skill.verified===true) {qualityScore+=1;reasons.push('directory verification metadata');}
  if(skill.hot===true || skill.trending===true) qualityScore+=1;
  const installs=Number(skill.installs||0),stars=Number(skill.github?.stars??skill.stars??0);
  if((Number.isFinite(installs) && installs>=100) ||
     (Number.isFinite(stars) && stars>=100)) qualityScore+=1;
  qualityScore=Math.min(5,qualityScore);
  return {id:profile.tech.id,name:profile.tech.name,
    score:Math.min(100,relevanceScore+qualityScore),
    relevanceScore,qualityScore,eligible,
    reasons:unique(reasons).slice(0,7)};
}
export function bestMatches(skill, profiles, minScore, {stage='candidate'}={}) {
  const floor = stage==='candidate' ? Math.min(15,minScore) : minScore;
  return profiles.map(p => score(skill,p,{stage}))
    .filter(m => m && m.score>=floor)
    .sort((a,b)=>b.relevanceScore-a.relevanceScore || b.score-a.score ||
      a.id.localeCompare(b.id));
}

function scalar(s) {
  const v=String(s||'').trim().replace(/^['"]|['"]$/g,'');
  return v.replace(/\s+#.*$/,'').trim();
}
export function parseSkillMarkdown(markdown, fallbackName='') {
  const text=String(markdown||'');
  let meta='',body=text;
  const match=text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if(match) {meta=match[1];body=text.slice(match[0].length);}
  const values={};
  let current='', block=false;
  for(const line of meta.split(/\r?\n/)) {
    const key=line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if(key) {
      current=key[1].toLowerCase(); block=/^[>|][-+]?$/.test(key[2].trim());
      values[current]=block?'':scalar(key[2]);
    } else if(current && /^\s+\S/.test(line)) {
      const item=line.trim();
      values[current]+=(values[current]?' ':'')+(item.startsWith('- ')?item.slice(2):item);
    } else if(line.trim()) current='';
  }
  const tags=String(values.tags||values.keywords||'').replace(/^\[|\]$/g,'')
    .split(',').map(scalar).filter(Boolean);
  return {name:values.name || fallbackName,slug:fallbackName,
    description:values.description || '',tags,
    body:body.slice(0,12000)};
}

export function precisionAtK(ranked, relevantIds, k=5) {
  if(k<=0) return 0;
  return ranked.slice(0,k).filter(id=>relevantIds.has(id)).length/k;
}
export function recallAtK(ranked, relevantIds, k=10) {
  if(!relevantIds.size) return 1;
  return ranked.slice(0,k).filter(id=>relevantIds.has(id)).length/relevantIds.size;
}
