#!/usr/bin/env node
import { chromium } from 'playwright';
import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { apiGet, defaultDir, deleteSession, filePath, hasLoggedInLocalStorage, loadSession, normalizedCookies, saveSession, stageConfig, stages, validate } from './core.mjs';
import { stat } from 'node:fs/promises';

const usage = `Magenta Canvas secure session CLI\n\nCommands:\n  canvas-session login <qa|preprod|prod|local> [--dir PATH]\n  canvas-session validate <stage> [--dir PATH]\n  canvas-session api-get <stage> /pageBuilder/magenta-canvas/RESOURCE [--dir PATH]\n  canvas-session status [--dir PATH]\n  canvas-session logout <stage> [--dir PATH]\n  canvas-session-mcp <stage> [--dir PATH]\n\nSessions are saved as owner-only plaintext JSON under ~/.config/magenta-canvas-mcp.\n`;
function args(argv) {
  let dir = defaultDir, positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') { if (!argv[i + 1]) throw Error('--dir requires a path'); dir = argv[++i]; }
    else if (argv[i].startsWith('--')) throw Error(`Unknown option: ${argv[i]}`);
    else positional.push(argv[i]);
  }
  return { dir, command: positional[0] || 'help', stage: positional[1], path: positional[2] };
}
async function login(dir, cfg) {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(cfg.cms, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.error(`Complete Keycloak/SSO and MFA for ${cfg.stage} in the browser (up to 3 minutes).`);
    const deadline = Date.now() + 180000;
    let profile;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      if (page.isClosed()) throw Error('Login browser was closed.');
      const cookies = normalizedCookies(await context.storageState(), cfg);
      try { profile = await validate({ cookies }, cfg); break; } catch { /* authentication may still be in progress */ }
    }
    if (!profile) throw Error('Timed out waiting for a validated Canvas dashboard session.');
    // API authentication may succeed before the Canvas SPA has finished initializing.
    // Capture storage only after the actual frontend has set its login flag.
    if (page.url().startsWith(cfg.cms) === false) {
      await page.goto(cfg.cms, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    console.error('Waiting for Canvas to finish initializing its login state...');
    try {
      await page.waitForFunction(
        () => window.localStorage.getItem('isUserLoggedIn') === 'true',
        undefined,
        { timeout: 45000, polling: 500 }
      );
    } catch {
      throw Error('Canvas API authenticated successfully, but the frontend did not set isUserLoggedIn=true within 45 seconds. Session was NOT overwritten. Check the Canvas login initialization or reload the app and retry.');
    }
    const browserState = await context.storageState();
    if (!hasLoggedInLocalStorage(browserState, cfg.cms)) {
      throw Error('Canvas login flag was not present in the captured storage state. Session was NOT overwritten.');
    }
    const cookies = normalizedCookies(browserState, cfg);
    await saveSession(dir, cfg.stage, { storageState: { ...browserState, cookies }, metadata: { username: profile.username, savedAt: new Date().toISOString(), lastValidatedAt: new Date().toISOString(), ...profile } });
    console.log(JSON.stringify({ authenticated: true, stage: cfg.stage, username: profile.username, isUserLoggedIn: true, canCreatePages: profile.canCreatePages, userPrivileges: profile.userPrivileges, sessionPath: filePath(dir, cfg.stage) }, null, 2));
    if (!profile.canCreatePages) console.error('Note: EDIT_CONTENT not present in dashboard response; page creation authorization has not been verified.');
  } finally { await browser.close(); }
}
async function main() {
  const { dir, command, stage, path } = args(process.argv.slice(2));
  if (['help', '-h'].includes(command)) { console.log(usage); return; }
  if (command === 'status') {
    const result = await Promise.all(Object.keys(stages).map(async s => ({ stage: s, saved: await stat(filePath(dir, s)).then(() => true).catch(() => false) })));
    console.log(JSON.stringify(result, null, 2)); return;
  }
  if (!stage) throw Error(`Stage required.\n${usage}`);
  const cfg = stageConfig(stage);
  if (command === 'logout') { await deleteSession(dir, cfg.stage); console.log(JSON.stringify({ loggedOutLocally: true, stage: cfg.stage, note: 'Remote identity-provider session is not revoked.' })); return; }
  if (!['login', 'validate', 'api-get'].includes(command)) throw Error(`Unknown command: ${command}`);
  if (command === 'login') return login(dir, cfg);
  const session = await loadSession(dir, cfg.stage);
  if (command === 'validate') {
    const profile = await validate(session, cfg);
    await saveSession(dir, cfg.stage, { ...session, metadata: { ...session.metadata, ...profile, lastValidatedAt: new Date().toISOString() } });
    console.log(JSON.stringify({ valid: true, stage: cfg.stage, ...profile }, null, 2)); return;
  }
  if (!path) throw Error('api-get requires a scoped API path.');
  console.log(JSON.stringify(await apiGet(session, cfg, path), null, 2));
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
