import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateVerifiedSuggestions,jevConfig,skillState,validateJevEndpoint} from '../scripts/discovery-jev.mjs';

const sha='0123456789abcdef0123456789abcdef01234567';
function report() {
  return {
    generatedAt:'2026-10-17T00:00:00.000Z',
    technologies:[{id:'react',name:'React'},{id:'docker',name:'Docker'}],
    matches:[
      {skillPath:'alice/frontend/react-hooks',skillName:'react-hooks',skillBlobSha:sha,
        githubUrl:'https://github.com/alice/frontend/tree/main/react-hooks',
        skillProfile:{name:'react-hooks',description:'React hooks guidance',
          tags:['react','hooks'],intro:'Use React hooks and composable components.'},
        matches:[{id:'react',name:'React',score:92,reasons:['react tag match']},
          {id:'docker',name:'Docker',score:36,reasons:['incidental docker in markdown']}]},
      {skillPath:'bob/docker/docker-guide',skillName:'docker-guide',skillBlobSha:sha,
        skillProfile:{name:'docker-guide',description:'Docker production guide',
          tags:['docker'],intro:'Use containers for deployments.'},
        matches:[{id:'docker',name:'Docker',score:88,reasons:['docker title']}]}],
    stats:{githubVerified:2},
    errors:[],
  };
}
async function mock(t, {truncated=false, failStatus=0, malformed=false}={}) {
  const calls=[];
  const server=createServer(async(req,res)=>{
    let body='';
    for await(const chunk of req) body+=chunk;
    const payload=JSON.parse(body);
    calls.push({url:req.url,auth:req.headers.authorization,payload});
    if(failStatus){res.writeHead(failStatus).end('sensitive-server-error');return;}
    const answers=Object.fromEntries(Object.entries(payload.questions).map(([k,q])=>
      [k,malformed?{type:'choice',choice:'yes'}:
        {type:'noul',noul:q.instructions.includes('Docker')?0.08:0.96}]));
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({model:payload.model,answers,
      usage:{truncated,truncated_questions:truncated?['t0']:[]}}));
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  t.after(()=>new Promise(ok=>server.close(ok)));
  return {url:'http://127.0.0.1:'+server.address().port+'/v1/systemone',calls};
}
async function cli(args,env={}) {
  const script=fileURLToPath(new URL('../scripts/discover-autoskills-jev.mjs',import.meta.url));
  const child=spawn(process.execPath,[script,...args],{
    env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';
  child.stderr.on('data',x=>{stderr+=x;});
  child.stdout.on('data',x=>{stdout+=x;});
  const code=await new Promise((ok,reject)=>{child.on('error',reject);child.on('close',ok);});
  return {code,stderr,stdout};
}
test('Jev scores each verified suggestion and keeps deterministic scores', async t=>{
  const server=await mock(t);
  const evaluated=await evaluateVerifiedSuggestions(report(),{
    endpoint:server.url,apiKey:'fixture-key',questionBatch:2,maxEvaluations:10},);
  assert.equal(evaluated.jevEvaluation.evaluatedCandidates,2);
  assert.equal(evaluated.jevEvaluation.requests,2);
  assert.equal(evaluated.jevEvaluation.likelyRelevant,1);
  assert.equal(evaluated.jevEvaluation.unlikelyRelevant,2);
  assert.equal(evaluated.matches[0].matches[0].jev.status,'likely_relevant');
  assert.equal(evaluated.matches[0].matches[0].score,92);
  assert.equal(evaluated.matches[0].matches[1].jev.status,'unlikely_relevant');
  assert.equal(server.calls.length,2);
  assert.ok(server.calls.every(x=>x.url==='/v1/systemone'));
  assert.ok(server.calls.every(x=>x.auth==='Bearer fixture-key'));
  assert.ok(server.calls.every(x=>x.payload.model==='jev-1.13-free'));
  assert.ok(server.calls.every(x=>!JSON.stringify(x.payload).includes('sensitive-server-error')));
  assert.ok(server.calls.some(x=>Object.keys(x.payload.questions).length===2));
});
test('limit marks unscored candidates instead of dropping them',async t=>{
  const server=await mock(t);
  const result=await evaluateVerifiedSuggestions(report(),{
    endpoint:server.url,apiKey:'fixture-key',maxEvaluations:1});
  assert.equal(result.matches.length,2);
  assert.equal(result.matches[1].jev.status,'not_evaluated');
  assert.equal(result.jevEvaluation.notEvaluated,1);
});
test('truncated model responses never become likely relevant',async t=>{
  const server=await mock(t,{truncated:true});
  const result=await evaluateVerifiedSuggestions(report(),{
    endpoint:server.url,apiKey:'fixture-key',maxEvaluations:1});
  assert.equal(result.matches[0].jev.status,'needs_review');
  assert.ok(result.matches[0].matches.every(m=>m.jev.status==='needs_review'));
});
test('missing or malformed model results abort rather than approving guesses',async t=>{
  const server=await mock(t,{malformed:true});
  await assert.rejects(()=>evaluateVerifiedSuggestions(report(),{
    endpoint:server.url,apiKey:'fixture-key'}),/missing or invalid noul/);
});
test('rejects credential leaks and incomplete GitHub verification',async()=>{
  assert.throws(()=>validateJevEndpoint('https://evil.test/zen/v1/systemone'),/official OpenCode/);
  assert.throws(()=>validateJevEndpoint('https://opencode.ai/zen/v1/systemone?token=a'),/official OpenCode/);
  assert.throws(()=>jevConfig({apiKey:'',endpoint:'https://opencode.ai/zen/v1/systemone'}),/OPENCODE_API_KEY/);
  const untrusted=report();untrusted.matches[0].skillBlobSha='';
  await assert.rejects(()=>evaluateVerifiedSuggestions(untrusted,{apiKey:'test'}),
    /no verified GitHub SKILL.md blob/);
});
test('full pipeline can re-evaluate a previous discovery report without fetching sources',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'autoskills-jev-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=join(dir,'original.json'),output=join(dir,'jev.json'),md=join(dir,'jev.md');
  await writeFile(input,JSON.stringify(report()));
  const server=await mock(t);
  const r=await cli(['--input',input,'--output',output,'--markdown',md,
    '--jev-url',server.url,'--jev-batch-size','1','--jev-limit','1'],
    {OPENCODE_API_KEY:'test-secret'});
  assert.equal(r.code,0,r.stderr);
  const generated=JSON.parse(await readFile(output,'utf8'));
  assert.equal(generated.matches[0].matches[0].jev.status,'likely_relevant');
  assert.equal(generated.matches[1].jev.status,'not_evaluated');
  const markdown=await readFile(md,'utf8');
  assert.match(markdown,/Jev-reviewed skill discovery/);
  assert.match(markdown,/not_evaluated/);
  assert.doesNotMatch(markdown,/test-secret/);
  assert.ok(server.calls.length>=2);
});
test('CLI fails closed on auth errors without leaving result files',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'autoskills-jev-error-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=join(dir,'original.json'),output=join(dir,'jev.json'),md=join(dir,'jev.md');
  await writeFile(input,JSON.stringify(report()));
  const server=await mock(t,{failStatus:403});
  const r=await cli(['--input',input,'--output',output,'--markdown',md,'--jev-url',server.url],
    {OPENCODE_API_KEY:'dont-print'});
  assert.notEqual(r.code,0);
  assert.match(r.stderr,/Jev HTTP 403/);
  assert.doesNotMatch(r.stderr,/dont-print|sensitive-server-error/);
  await assert.rejects(()=>readFile(output,'utf8'),/ENOENT/);
});
test('metadata is compact and never includes full source text',()=>{
  const r=report().matches[0];r.skillProfile.intro='x'.repeat(5000);
  const state=skillState(r);
  assert.ok(state.length<1800);
  assert.ok(!state.includes('x'.repeat(501)));
});
