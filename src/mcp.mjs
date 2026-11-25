#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { apiGet, defaultDir, loadSession, stageConfig, validate } from './core.mjs';

async function main() {
  const argv = process.argv.slice(2);
  const stage = argv[0];
  if (!stage) throw Error('Usage: canvas-session-mcp <qa|preprod|prod|local> [--dir PATH]');
  const dirIndex = argv.indexOf('--dir');
  const dir = dirIndex >= 0 ? argv[dirIndex + 1] : defaultDir;
  if (!dir) throw Error('--dir requires a path.');
  const cfg = stageConfig(stage);
  const server = new McpServer({ name: 'magenta-canvas-session', version: '2.0.0' });
  const withSession = async fn => {
    try {
      const session = await loadSession(dir, cfg.stage);
      return { content: [{ type: 'text', text: JSON.stringify(await fn(session)) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  };
  server.tool('canvas_session_validate', 'Validate the logged-in Canvas user and report privileges without exposing credentials.', {}, async () => withSession(session => validate(session, cfg)));
  server.tool('canvas_dashboard', 'Read the authenticated Magenta Canvas dashboard API response.', {}, async () => withSession(session => apiGet(session, cfg, '/pageBuilder/magenta-canvas/dashboard')));
  server.tool('canvas_api_get', 'GET a JSON resource under /pageBuilder/magenta-canvas/ on the configured Canvas API host. Never returns cookies.', { path: z.string().describe('Path starting /pageBuilder/magenta-canvas/') }, async ({ path }) => withSession(session => apiGet(session, cfg, path)));
  await server.connect(new StdioServerTransport());
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
