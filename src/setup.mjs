#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { filePath, defaultDir, stageConfig } from './core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = process.argv[2] || 'qa';
let cfg;
try { cfg = stageConfig(stage); } catch (e) { console.error(e.message); process.exit(1); }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function run(command, args) {
  console.error(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} ${args.join(' ')} failed (exit ${result.status ?? 'unknown'}).`);
}
try {
  run(npm, ['install']);
  run(npx, ['playwright', 'install', 'chromium']);
  // Avoid forcibly overwriting an unrelated global canvas-session executable.
  run(npm, ['link']);
  run(process.execPath, ['src/cli.mjs', 'login', cfg.stage]);
  const saved = filePath(defaultDir, cfg.stage);
  await stat(saved);
  console.log(`\nSession saved successfully:\n${saved}`);
  console.log(`Validate with: canvas-session validate ${cfg.stage}`);
} catch (error) {
  console.error(`\nSetup incomplete: ${error.message}`);
  console.error('If npm link reports EEXIST, inspect the existing canvas-session executable before replacing it.');
  process.exitCode = 1;
}
