import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Cache successful JSON GET responses only. No tokens appear in paths or files.
// Cache data may include private GitHub repository metadata; use private file modes.
const SCHEMA = 1;
const MAX_BYTES = 8 * 1024 * 1024;
const MINUTE = 60_000;
const DEFAULT_ROOT = join(
  process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'autoskills'
);

export function defaultCacheDir() { return DEFAULT_ROOT; }

export function createDiscoveryCache({
  enabled=true, cacheDir=DEFAULT_ROOT, ttlMinutes=360, clear=false, verbose=false,
}={}) {
  // Always operate below a fixed child; --clear-cache cannot remove the
  // provided cache root or unrelated files there.
  const dir=join(resolve(cacheDir), 'discovery-v1');
  const stats={hits:0,misses:0,writes:0,expired:0,errors:0,skipped:0};
  if(clear && existsSync(dir)) rmSync(dir,{recursive:true,force:true});
  const active=enabled && ttlMinutes>0;
  function key(url,kind,token) {
    const scope=token ? createHash('sha256').update(token).digest('hex') : 'public';
    return createHash('sha256').update(JSON.stringify([SCHEMA,kind,scope,url])).digest('hex');
  }
  function filename(url,kind,token) {
    const hash=key(url,kind,token);
    return join(dir,hash.slice(0,2),hash+'.json');
  }
  function ttl(url,kind) {
    if(kind==='github') {
      // Blob paths contain immutable SHAs; mutable branches/repos need short TTLs.
      if(/\/git\/blobs\/[0-9a-f]{40}(?:\?|$)/i.test(new URL(url).pathname)) return 30*24*60*MINUTE;
      return Math.min(ttlMinutes,60)*MINUTE;
    }
    return ttlMinutes*MINUTE;
  }
  return {
    stats,dir,enabled:active,
    get(url,kind='directory',token='') {
      if(!active) {stats.skipped++;return {hit:false};}
      const file=filename(url,kind,token);
      try {
        if(!existsSync(file)) {stats.misses++;return {hit:false};}
        if(statSync(file).size>MAX_BYTES+1024) {stats.misses++;return {hit:false};}
        const envelope=JSON.parse(readFileSync(file,'utf8'));
        if(envelope.schema!==SCHEMA || typeof envelope.expiresAt!=='number' ||
          !Object.hasOwn(envelope,'value')) {
          stats.misses++;return {hit:false};
        }
        if(Date.now()>envelope.expiresAt) {stats.expired++;stats.misses++;return {hit:false};}
        stats.hits++;
        if(verbose) console.error('CACHE HIT '+url);
        return {hit:true,value:envelope.value};
      } catch(e) {
        stats.errors++;stats.misses++;
        if(verbose) console.error('Cache read warning: '+e.message);
        return {hit:false};
      }
    },
    set(url,kind='directory',token='',value) {
      if(!active) return;
      const file=filename(url,kind,token);
      let temporary;
      try {
        const payload=JSON.stringify({schema:SCHEMA,
          expiresAt:Date.now()+ttl(url,kind),value});
        if(Buffer.byteLength(payload)>MAX_BYTES) {stats.skipped++;return;}
        mkdirSync(dirname(file),{recursive:true,mode:0o700});
        temporary=file+'.'+process.pid+'.'+randomBytes(6).toString('hex')+'.tmp';
        writeFileSync(temporary,payload,{mode:0o600,flag:'wx'});
        renameSync(temporary,file);
        stats.writes++;
      } catch(e) {
        stats.errors++;
        if(verbose) console.error('Cache write warning: '+e.message);
        if(temporary) {
          try {rmSync(temporary,{force:true});} catch {}
        }
      }
    },
  };
}
