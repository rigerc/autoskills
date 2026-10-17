#!/usr/bin/env node
/**
 * Run deterministic AutoSkills discovery, then review GitHub-verified matches
 * via OpenCode Zen's Jev System One API. Never installs or edits skill mapping.
 */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateVerifiedSuggestions, jevConfig} from './discovery-jev.mjs';

const dir=dirname(fileURLToPath(import.meta.url));
function usage() {
  console.log(String.raw`Usage: node --experimental-strip-types scripts/discover-autoskills-jev.mjs [options]

Discover new skills using the existing deterministic/GitHub verification pipeline,
then evaluate verified skill/technology suggestions with OpenCode Zen Jev.

  --input FILE             Re-evaluate an existing discovery JSON report (skip discovery)
  --output FILE            Jev JSON report (default skills-discovery-jev.json)
  --markdown FILE          Jev Markdown report (default skills-discovery-jev.md)
  --jev-model MODEL        jev-1.13-free (default); jev-1.13 is paid
  --jev-threshold NUMBER   Likely-relevant cutoff (default 0.8)
  --jev-limit N            Max verified skills to evaluate (default 25)
  --jev-batch-size N       Questions per Jev request, 1..20 (default 8)
  --jev-url URL            Official OpenCode Zen endpoint (localhost allowed for tests)
  --help                   Print this help

Other options are passed to discover-autoskills.mjs, including --source, --tech,
--verify-limit, --min-score, --repo-root, --cache, and --no-cache.
Interactive selection is intentionally disabled: review the Jev report instead.
Original discovery and Jev reports are read-only, and do not install skills.

Requires OPENCODE_API_KEY or OPENCODE_ZEN_API_KEY (Zen API key).
Official endpoint: https://opencode.ai/zen/v1/systemone
`);
}
function parseArgs(argv) {
  const out={input:null,output:'skills-discovery-jev.json',
    markdown:'skills-discovery-jev.md', model:'jev-1.13-free',
    threshold:0.8,maxEvaluations:25,questionBatch:8,endpoint:undefined,
    forwarded:[]};
  const named=new Map([
    ['--input','input'],['--output','output'],['--markdown','markdown'],
    ['--jev-model','model'],['--jev-threshold','threshold'],
    ['--jev-limit','maxEvaluations'],['--jev-batch-size','questionBatch'],
    ['--jev-url','endpoint'],
  ]);
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i];
    if(flag==='--help' || flag==='-h') {usage();return null;}
    if(flag==='--interactive') throw new Error('Use Jev report for review; --interactive is not supported');
    if(flag==='--no-interactive') continue;
    if(named.has(flag)) {
      if(!argv[i+1] || argv[i+1].startsWith('--'))
        throw new Error('Missing value for '+flag);
      out[named.get(flag)]=argv[++i];
      continue;
    }
    // Any discovery flags and their values are validated by the original parser.
    out.forwarded.push(flag);
    if(flag.startsWith('--') && i+1<argv.length && !argv[i+1].startsWith('--')) {
      out.forwarded.push(argv[++i]);
    }
  }
  out.threshold=Number(out.threshold);
  out.maxEvaluations=Number(out.maxEvaluations);
  out.questionBatch=Number(out.questionBatch);
  if(out.input && out.forwarded.length)
    throw new Error('--input cannot be combined with live discovery options');
  if(out.output===out.markdown || [out.output,out.markdown].includes('-'))
    throw new Error('Output destinations must be distinct local file paths (not stdout)');
  if(resolve(out.output)===resolve(out.markdown) ||
      (out.input && [out.output,out.markdown].some(x=>resolve(x)===resolve(out.input))))
    throw new Error('Do not overwrite the input report or reuse an output path');
  return out;
}
async function runDiscovery(args,jsonPath,markdownPath) {
  const cmd=[process.execPath,'--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    join(dir,'discover-autoskills.mjs'),
    ...args,'--no-interactive','--output',jsonPath,'--markdown',markdownPath];
  const code=await new Promise((resolveCode,reject)=>{
    const child=spawn(cmd[0],cmd.slice(1),{stdio:'inherit'});
    child.once('error',reject);
    child.once('close',resolveCode);
  });
  if(code!==0) throw new Error('AutoSkills discovery failed with exit status '+code);
}
const safe = x=>String(x??'').replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|').replace(/`/g,"'");
export function markdownReport(report) {
  const j=report.jevEvaluation;
  const lines=[
    '# AutoSkills — Jev-reviewed skill discovery','',
    'Generated: '+report.generatedAt,'',
    'Model: '+j.model+' via OpenCode Zen','',
    'Jev reviewed '+j.evaluatedCandidates+' GitHub-verified skill candidates via '+
      j.requests+' System One calls. Relevant: '+j.likelyRelevant+
      ', needs review: '+j.needsReview+', unlikely: '+j.unlikelyRelevant+
      ', not evaluated: '+j.notEvaluated+'.','',
    '**Relevance only:** Jev is not a security review. Do not install these skills or edit skills-map.ts without manual review and normal sync security checks.','',
  ];
  const group=new Map();
  for(const item of report.matches) for(const match of item.matches) {
    if(!group.has(match.id)) group.set(match.id,[]);
    group.get(match.id).push({item,match});
  }
  const order={likely_relevant:0,needs_review:1,not_evaluated:2,unlikely_relevant:3};
  for(const tech of report.technologies) {
    const rows=group.get(tech.id)||[];
    if(!rows.length)continue;
    lines.push('## '+tech.name+' ('+tech.id+')','');
    rows.sort((a,b)=>{
      const aStatus=a.match.jev?.status||'not_evaluated';
      const bStatus=b.match.jev?.status||'not_evaluated';
      return (order[aStatus]??2)-(order[bStatus]??2) ||
        (b.match.jev?.probability??-1)-(a.match.jev?.probability??-1) ||
        b.match.score-a.match.score;
    });
    for(const {item,match} of rows) {
      const result=match.jev;
      const status=result?.status||'not_evaluated';
      const probability=Number.isFinite(result?.probability) ? result.probability.toFixed(3) : 'not scored';
      lines.push('- **'+safe(item.skillPath)+'** — **'+status+'**; Jev YES: '+
        probability+'; deterministic score: '+match.score);
      lines.push('  - Evidence: '+safe((match.reasons||[]).join('; ')));
      if(item.githubUrl) lines.push('  - [Verified skill source]('+item.githubUrl+')');
      if(result?.truncated) lines.push('  - **Warning:** Jev reported truncation; manual review required');
    }
    lines.push('');
  }
  if(!report.matches.length) lines.push('No GitHub-verified suggestions to evaluate.','');
  if(j.notEvaluated) lines.push('**Warning:** '+j.notEvaluated+
    ' candidates remain unscored due to --jev-limit.','');
  lines.push('## Next steps','',
    'Manually inspect the SKILL.md, provenance and license. Add only relevant reviewed paths to skills-map.ts, then run the normal audited sync and registry validation.','');
  return lines.join('\n');
}
async function outputFile(destination,body) {
  const file=resolve(destination);
  await mkdir(dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try {await writeFile(temp,body+'\n',{flag:'wx'});await rename(temp,file);}
  finally {await rm(temp,{force:true});}
  console.error('Wrote '+file);
}
async function main() {
  const args=parseArgs(process.argv.slice(2));
  if(!args)return;
  // Validate credentials/model/destination before discovery makes network requests.
  const options={endpoint:args.endpoint,model:args.model,threshold:args.threshold,
    questionBatch:args.questionBatch,maxEvaluations:args.maxEvaluations};
  jevConfig(options);
  let dirTmp;
  try {
    let report;
    if(args.input) {
      report=JSON.parse(await readFile(resolve(args.input),'utf8'));
    } else {
      dirTmp=await mkdtemp(join(tmpdir(),'autoskills-discovery-jev-'));
      const json=join(dirTmp,'discovery.json');
      await runDiscovery(args.forwarded,json,join(dirTmp,'discovery.md'));
      report=JSON.parse(await readFile(json,'utf8'));
    }
    const updated=await evaluateVerifiedSuggestions(report,options);
    // Do not leave a misleading partial report on Jev failure.
    await outputFile(args.output,JSON.stringify(updated,null,2));
    await outputFile(args.markdown,markdownReport(updated));
    console.error('Jev complete: '+updated.jevEvaluation.evaluatedCandidates+
      ' candidates, '+updated.jevEvaluation.requests+' requests.');
  } finally {
    if(dirTmp) await rm(dirTmp,{recursive:true,force:true});
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('Jev discovery failed: '+e.message);process.exitCode=1;});
