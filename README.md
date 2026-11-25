# Magenta Canvas plaintext session CLI

This build **does not use passphrases, scrypt, encryption or macOS Keychain**. It saves sessions in the original CLI's `storageState` + `metadata` JSON structure.

## Install

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
```

To avoid conflicts with an older globally linked `canvas-session`, run locally:

```bash
node src/cli.mjs login qa
node src/cli.mjs validate qa
node src/cli.mjs api-get qa /pageBuilder/magenta-canvas/dashboard
node src/cli.mjs status
node src/cli.mjs logout qa
node src/mcp.mjs qa
```

If you want global commands, inspect and unlink the old installation first, then run `npm link`.

## Storage

The default session files are `~/.config/magenta-canvas-mcp/session-qa.json`, `session-preprod.json`, `session-prod.json`, and `session-dev.json` (for local). Use `--dir PATH` to override.

Sessions are **plaintext credentials**. Keep them private: folder mode `0700`, file mode `0600`. Do not commit, share, or print them. Logout removes the local session only, not the remote SSO session. Existing encrypted `.enc.json` files are not read or migrated.

## MCP

Run `node /absolute/path/to/src/mcp.mjs qa` as a stdio MCP server. It exposes `canvas_session_validate`, `canvas_dashboard`, and `canvas_api_get`. The API GET tool is restricted to the configured Canvas API host and `/pageBuilder/magenta-canvas/` path. It does not expose cookies.

`canCreatePages` is based on the dashboard's `EDIT_CONTENT` field and is **not** an authoritative page creation permission check.

## Tests

```bash
npm test
```

## One-command setup and session creation

From the extracted `magenta-canvas-session-cli` folder, run:

```bash
npm run setup -- qa
```

Replace `qa` with `preprod`, `prod`, or `local` as needed. This command installs dependencies, downloads Playwright Chromium, runs `npm link`, opens the browser for SSO/MFA login, saves the plaintext session, and prints its absolute path. The resulting file is `~/.config/magenta-canvas-mcp/session-qa.json` for QA (and `session-preprod.json` for preprod). No passphrase is required.

If `npm link` encounters an existing executable (`EEXIST`), setup stops rather than overwriting another installation. Inspect and unlink the old CLI before retrying. The login itself requires interactive browser authentication; it cannot be automated past SSO/MFA.

### Frontend login flag validation

After the dashboard API validates authentication, login waits up to 45 seconds for the Canvas SPA to set `localStorage.isUserLoggedIn` to the string `true` on the Canvas origin. If it does not, login exits without overwriting an existing session file. This flag is checked, never fabricated; the dashboard API remains the source of truth for server-side authentication.
