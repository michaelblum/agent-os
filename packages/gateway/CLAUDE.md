# aos-gateway

MCP server providing typed script execution and cross-harness coordination for agent-os.

## Quick Start

```bash
cd packages/gateway
npm install
npm run build
npm start          # Starts MCP server on stdio
```

## Configure in Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "aos-gateway": {
      "command": "node",
      "args": ["/path/to/agent-os/packages/gateway/dist/index.js"]
    }
  }
}
```

## Tools (9)

**Coordination:** register_session, set_state, get_state, post_message, read_stream
**Execution:** run_os_script, save_script, list_scripts, discover_capabilities

## State

All gateway state lives at `~/.config/aos-gateway/`:
- `gateway.db` — SQLite coordination store
- `sdk.sock` — SDK socket for subprocess communication
- `scripts/` — saved scripts
- `config.json` — gateway configuration (optional)

## Tests

```bash
npm test           # All tests
```
