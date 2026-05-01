@../../AGENTS.md

# gateway Local Contract

`packages/gateway/` is the Node.js MCP adapter and cross-harness coordination
surface for external consumers. It is a peer consumer of AOS primitives, not
the middle layer between primitives and apps.

Consumer-facing gateway contracts belong in
[`docs/api/integration-broker.md`](../../docs/api/integration-broker.md) and
related schemas under `shared/schemas/`.

## Responsibilities

- MCP-facing tool surface for external agent stacks.
- Local integration broker and coordination state.
- Typed script execution and saved script discovery.
- Session registration and cross-harness pub/sub.

The daemon remains the source of truth for AOS runtime behavior. The gateway is
an adapter/view for consumers that need MCP integration.

## Local Workflow

```bash
cd packages/gateway
npm install
npm run build
npm test
```

Start the MCP server on stdio with:

```bash
npm start
```

Use an MCP server entry like:

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

## State

Gateway state lives at `~/.config/aos-gateway/`:

- `gateway.db` — SQLite coordination store
- `sdk.sock` — SDK socket for subprocess communication
- `scripts/` — saved scripts
- `config.json` — optional gateway configuration

Keep runtime-mode-sensitive AOS behavior in the daemon or shared runtime paths,
not in gateway-only state.
