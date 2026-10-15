import { createServer } from 'node:http';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import test from 'node:test';
import { rmSync } from 'node:fs';

// Offline integration coverage: Skills Directory, SkillsMD and mock GitHub.
test('discovers, ranks and deduplicates new skills without installing',async (t)=>{
const root=mkdtempSync(join(tmpdir(),'autoskills-test-'));
t.after(() => rmSync(root,{recursive:true,force:true}));
mkdirSync(join(root,'packages/autoskills/skills-registry'),{recursive:true});
writeFileSync(join(root,'packages/autoskills/skills-map.ts'),`export interface Technology { id: string; name: string; detect: Record<string, unknown>; skills: string[]; }\nexport const SKILLS_MAP: Technology[] = [
{id:'react',name:'React',detect:{packages:['react','react-dom']},skills:['vercel-labs/agent-skills/react-best-practices']},
{id:'docker',name:'Docker',detect:{configFiles:['Dockerfile','compose.yml']},skills:[]},
{id:'openai',name:'OpenAI SDK',detect:{packages:['openai']},skills:[]},
{id:'playwright',name:'Playwright',detect:{packages:['@playwright/test']},skills:[]}
];\nexport const COMBO_SKILLS_MAP = [];export const FRONTEND_BONUS_SKILLS = [];\n`);
writeFileSync(join(root,'packages/autoskills/skills-registry/index.json'),JSON.stringify({skills:{}}));
const data=[
 {name:'React Hook Patterns',slug:'neworg-react-hooks',description:'Build components using React hooks and accessible UI.',repository:'neworg/react-hooks',category:'development',stars:53,verified:true,tags:['react','hooks','frontend']},
 {name:'Docker CI',slug:'neworg-docker-ci',description:'Use Docker containers for builds.',repository:'neworg/docker-ci',category:'devops-cloud',stars:10,verified:true,tags:['docker','containers','automation']},
 {name:'Marketing Landing Pages',slug:'neworg-marketing',description:'Marketing campaign copywriting',repository:'neworg/marketing',category:'content-marketing',stars:99999,verified:true,tags:['marketing']},
 {name:'React Best Practices',slug:'vercel-labs-react-best-practices',description:'React advice',repository:'vercel-labs/agent-skills',category:'development',stars:100,verified:true,tags:['react']},
];
const md=[
 {id:'neworg/playwright-skills/playwright',repo:'neworg/playwright-skills',name:'Playwright',desc:'Playwright end-to-end testing',tags:['playwright','testing'],installs:301,stars:77,trending:true},
 {id:'neworg/react-hooks/react-hooks',repo:'neworg/react-hooks',name:'React Hooks',desc:'React hooks for developers',tags:['react','frontend'],installs:888,stars:200},
 {id:'multi-tech/toolkit',repo:'multi-tech/toolkit',name:'React Toolkit',desc:'Skills for React projects',tags:['react'],installs:200,stars:55},
];
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 let ret;
 if(u.pathname==='/api/registry'){
  const q=(u.searchParams.get('q')||'').toLowerCase();
  const sk=q?data.filter(x=>`${x.name} ${x.description}`.toLowerCase().includes(q)):data;
  ret={registry:'skillsdirectory',skills:sk,pagination:{hasMore:false,total:sk.length,offset:0,limit:50}};
 } else if(u.pathname==='/md/skills'){
  ret={skills:md,page:1,pages:1,total:md.length};
 } else if(u.pathname==='/md/search'){
  const q=(u.searchParams.get('q')||'').toLowerCase();ret={results:md.filter(x=>JSON.stringify(x).toLowerCase().includes(q))};
 } else if(u.pathname==='/md/skill'){
  ret={description:'Repo details',topics:['testing'],license:'Apache-2.0',language:'TypeScript'};
 } else if(u.pathname.startsWith('/api/registry/')) {
  const slug=decodeURIComponent(u.pathname.split('/').at(-1));ret={skill:{...data.find(x=>x.slug===slug),worksWith:['claude code'],github:{license:'MIT',stars:60}}};
 } else if(u.pathname.startsWith('/repos/')&&u.pathname.includes('/git/trees/')){
  const repo=u.pathname.split('/').slice(2,4).join('/');
  let path;
  if(repo==='neworg/react-hooks') path='skills/react-hooks/SKILL.md';
  else if(repo==='neworg/docker-ci') path='skills/docker-ci/SKILL.md';
  else if(repo==='neworg/playwright-skills') path='skills/playwright/SKILL.md';
  else if(repo==='multi-tech/toolkit') {ret={truncated:false,tree:[{path:'skills/react-forms/SKILL.md',type:'blob',mode:'100644'},{path:'skills/marketing/SKILL.md',type:'blob',mode:'100644'}]};}

  else path='skills/react-best-practices/SKILL.md';
  ret ??= {truncated:false,tree:[{path,type:'blob',mode:'100644'}]};
 } else if(u.pathname.startsWith('/repos/')) ret={default_branch:'main'};
 else {res.writeHead(404);res.end('{}');return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(ret));
});
t.after(() => server.close());
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const port=server.address().port,base=`http://127.0.0.1:${port}`;
const cmd=['--experimental-strip-types','--disable-warning=ExperimentalWarning',new URL('../scripts/discover-autoskills.mjs', import.meta.url).pathname,'--repo-root',root,'--api-base',`${base}/api/registry`,'--github-api',base,'--skillsmd-api',`${base}/md`,'--output',join(root,'out.json'),'--markdown',join(root,'out.md')];
const child=spawn('node',cmd,{stdio:['ignore','pipe','pipe']});
let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
const code=await new Promise(ok=>child.on('exit',ok));
console.log('code:',code,'stderr:',err);
if(code===0) {
 const r=JSON.parse(readFileSync(join(root,'out.json'),'utf8'));
 console.log(JSON.stringify({statistics:r.stats,matches:r.matches.map(x=>({path:x.skillPath,matches:x.matches.map(y=>[y.id,y.score])}))},null,2));
 console.log(readFileSync(join(root,'out.md'),'utf8').slice(0,4000));
 if(!r.matches.some(x=>x.skillPath==='neworg/playwright-skills/playwright')) throw new Error('Missing SkillsMD skill');
 if(r.matches.some(x=>x.skillPath==='multi-tech/toolkit/marketing')) throw new Error('Irrelevant multi-skill entry');
 if(r.matches.some(x=>x.skillPath==='vercel-labs/agent-skills/react-best-practices')) throw new Error('Already registered skill');
 if(!r.matches.some(x=>x.skillPath==='neworg/docker-ci/docker-ci')) throw new Error('Missing directory-tag Docker match');
 if(!r.matches.some(x=>x.skillPath==='neworg/react-hooks/react-hooks'&&x.sources.includes('skillsmd')&&x.sources.includes('skillsdirectory'))) throw new Error('Missing merged sources');
} else throw new Error(`Discovery CLI failed (${code}): ${err}\n${out}`);

});

test('forced interactive mode exits with guidance when no TTY is attached', async () => {
  const file = new URL('../scripts/discover-autoskills.mjs', import.meta.url).pathname;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', file, '--interactive'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  if (code === 0 || !stderr.includes('TTY')) {
    throw new Error(`Expected a non-TTY interactive error, got status ${code}: ${stderr}`);
  }
});
