import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile, rename, unlink, chmod, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
export const stages = Object.freeze({
  qa: { cms: 'https://magentacanvas.qa.oa.yo-digital.com', api: 'https://oneuibuilder.qa.oa.yo-digital.com/api' },
  preprod: { cms: 'https://magentacanvas.preprod.oa.yo-digital.com', api: 'https://oneuibuilder.preprod.oa.yo-digital.com/api' },
  prod: { cms: 'https://magentacanvas.oa.yo-digital.com', api: 'https://oneuibuilder.oa.yo-digital.com/api' },
  local: { cms: 'https://magentacanvas.dev.oa.yo-digital.com', api: 'https://oneuibuilder.dev.oa.yo-digital.com/api' }
});
export const aliases = { dev: 'local', 'pre-prod': 'preprod', production: 'prod', prd: 'prod' };
export const defaultDir = resolve(process.env.MAGENTA_CANVAS_SESSION_DIR || join(homedir(), '.config', 'magenta-canvas-mcp'));
export function stageConfig(stage) { const key = aliases[stage] || stage; if (!Object.hasOwn(stages, key)) throw Error(`Invalid stage: ${stage}`); return { stage: key, ...stages[key] }; }
export function filePath(dir, stage) { return join(resolve(dir), `session-${stage === 'local' ? 'dev' : stage}.json`); }
export function domainMatches(cookie, host) { const d = String(cookie.domain || '').replace(/^\./, '').toLowerCase(); return !!d && (host === d || host.endsWith('.' + d)); }
function isFresh(cookie) { return !Number.isFinite(cookie.expires) || cookie.expires <= 0 || cookie.expires > Date.now() / 1000; }
export function normalizedCookies(state, cfg) {
  const apiHost = new URL(cfg.api).hostname, cmsHost = new URL(cfg.cms).hostname;
  const selected = new Map();
  for (const cookie of state.cookies || []) {
    if (!cookie.name || !cookie.value || !isFresh(cookie)) continue;
    if (!domainMatches(cookie, apiHost) && !domainMatches(cookie, cmsHost)) continue;
    const next = { ...cookie, value: String(cookie.value).replace(/^"(.*)"$/s, '$1') };
    const old = selected.get(next.name);
    const preferred = !old || (domainMatches(next, apiHost) && !domainMatches(old, apiHost)) || (domainMatches(next, apiHost) === domainMatches(old, apiHost) && (next.path || '/').length > (old.path || '/').length);
    if (preferred) selected.set(next.name, next);
  }
  return [...selected.values()];
}
export function cookieHeader(cookies, cfg) {
  // Existing Canvas MCP behavior forwards selected CMS/API cookies to the API host.
  // These are never returned through CLI or MCP interfaces.
  const apiHost = new URL(cfg.api).hostname, cmsHost = new URL(cfg.cms).hostname;
  return cookies.filter(c => isFresh(c) && (domainMatches(c, apiHost) || domainMatches(c, cmsHost))).map(c => `${c.name}=${c.value}`).join('; ');
}
export async function saveSession(dir, stage, payload) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(dir, 0o700);
  const file = filePath(dir, stage);
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const storageState = payload.storageState || { cookies: payload.cookies || [], origins: payload.origins || [] };
  const stored = { storageState, metadata: payload.metadata || {} };
  try {
    await writeFile(tmp, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(tmp, file);
    if (process.platform !== 'win32') await chmod(file, 0o600);
  } finally { await unlink(tmp).catch(() => {}); }
}
export async function loadSession(dir, stage) {
  const file = filePath(dir, stage);
  const info = await stat(file);
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw Error('Session permissions too broad. Run: chmod 600 ' + file);
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (!data.storageState?.cookies && !data.cookies) throw Error('Unrecognized plaintext session format. Log in again.');
  return { ...data, cookies: data.storageState?.cookies || data.cookies };
}
export async function deleteSession(dir, stage) { await unlink(filePath(dir, stage)); }
export function access(profile) { const privileges = Array.isArray(profile.userPrivileges) ? profile.userPrivileges.filter(x => typeof x === 'string') : []; return { username: profile.username, userPrivileges: privileges, canCreatePages: privileges.includes('EDIT_CONTENT') }; }
export function safeApiUrl(cfg, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw Error('API path must start with a single / and contain no backslashes.');
  const base = new URL(cfg.api + '/');
  const target = new URL(path.slice(1), base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname + 'pageBuilder/magenta-canvas/')) throw Error('API path is outside the allowed Canvas API scope.');
  if (target.username || target.password || target.hash) throw Error('Credentials and URL fragments are not allowed.');
  return target;
}
export async function apiGet(session, cfg, path, { timeoutMs = 15000 } = {}) {
  const target = safeApiUrl(cfg, path);
  const cookie = cookieHeader(session.cookies, cfg);
  if (!cookie) throw Error('No usable Canvas cookies. Run login again.');
  const response = await fetch(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', 'magenta-canvas': 'true', Cookie: cookie } });
  if (response.status >= 300 && response.status < 400) throw Error(`Unexpected redirect (HTTP ${response.status}); sign in again.`);
  if (response.status === 401 || response.status === 403) throw Error(`Canvas session rejected (HTTP ${response.status}); sign in again or check permissions.`);
  if (!response.ok) throw Error(`Canvas API returned HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > 2_000_000) throw Error('API response too large.');
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw Error('Unexpected non-JSON response from Canvas API.');
  try { return JSON.parse(body); } catch { throw Error('Canvas API returned invalid JSON.'); }
}
export async function validate(session, cfg) {
  const profile = await apiGet(session, cfg, '/pageBuilder/magenta-canvas/dashboard');
  if (!profile || typeof profile.username !== 'string' || !profile.username) throw Error('Dashboard did not return an authenticated username.');
  return access(profile);
}

/** Confirm the Canvas SPA, not the CLI, set its authenticated localStorage flag. */
export function hasLoggedInLocalStorage(state, cmsUrl) {
  const expectedOrigin = new URL(cmsUrl).origin;
  return (state.origins || []).some(entry =>
    entry.origin === expectedOrigin &&
    (entry.localStorage || []).some(item =>
      item.name === 'isUserLoggedIn' && item.value === 'true'
    )
  );
}
