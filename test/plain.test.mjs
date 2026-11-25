import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSession, loadSession, filePath, stageConfig, safeApiUrl } from '../src/core.mjs';
test('plaintext session matches original shape and round trips', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'canvas-test-'));
 try {
  await saveSession(dir, 'qa', {storageState:{cookies:[{name:'test',value:'abc',domain:'example.test'}],origins:[]},metadata:{username:'tester'}});
  const raw = JSON.parse(await readFile(filePath(dir,'qa'),'utf8'));
  assert.deepEqual(Object.keys(raw), ['storageState','metadata']);
  assert.equal(raw.storageState.cookies[0].name,'test');
  assert.equal((await loadSession(dir,'qa')).cookies[0].value,'abc');
  assert.equal((await stat(filePath(dir,'qa'))).mode & 0o777,0o600);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('API scope restriction',()=>{
 const cfg=stageConfig('qa');
 assert.ok(safeApiUrl(cfg,'/pageBuilder/magenta-canvas/dashboard'));
 assert.throws(()=>safeApiUrl(cfg,'//evil.example/path'));
});
