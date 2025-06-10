# telnet-proxy [![NPM Version](https://img.shields.io/npm/v/telnet-proxy)](https://www.npmjs.com/package/telnet-proxy)

A Telnet to WebSocket proxy server.

## Installation

### Global Installation (Recommended)

```sh
npm install -g telnet-proxy
telnet-proxy
```

### Local Development

```sh
git clone https://github.com/danneu/telnet-proxy.git
cd telnet-proxy
pnpm install
pnpm run dev # dev
pnpm run start # prod
```

## Connect

```
wss://telnet-proxy.fly.dev/?host=elephant.org&port=23
```

Use query params when connecting to the server:

- `host`: string (required)
- `port`: number (optional, default: 23)
- `format`: `"raw"` | `"json"` (optional)
  - `raw` (default): websocket message is raw chunks of server data
  - `json`: sends structured data:
    - `{ type: "data", data: string }`: raw data from server
    - `{ type: "error", message: string }`: proxy or client errors
    - `{ type: "mud:mssp", data: Record<string, string> }`: parsed [mssp](https://tintin.mudhalla.net/protocols/mssp/) data from server
- `encoding`: `"auto"` | `"utf8"` | `"latin1"` | `"big5"` | `"gbk"`(optional)
  - `auto` (default): server detects `utf8` vs `latin1` for you
  - `big5`, `gbk`: you must specify these in advance

## Plugin System

The proxy uses a plugin system to handle telnet protocol negotiations and transformations. Plugins can intercept and modify data flowing between the client and server.

### Plugin Interface

```typescript
interface Plugin {
  name: string;
  onServerChunk?(chunk: ParsedChunk): { type: "continue" | "handled" };
  onClientMessage?(data: Buffer): { type: "continue" | "handled" };
  onClose?(): void;
}
```

### Simple Plugin Example

```typescript
import { PluginFactory } from "../index.js";
import { Cmd } from "../parser.js";

const echo: PluginFactory<{ enabled: boolean }> = (config) => (ctx) => {
  return {
    name: "echo",
    onServerChunk: (chunk) => {
      // Handle server echo negotiation
      if (chunk.type === "NEGOTIATION" && 
          chunk.name === "WILL" && 
          chunk.target === Cmd.ECHO) {
        const response = config.enabled ? Cmd.DO : Cmd.DONT;
        console.log(`[echo]: ${config.enabled ? 'Accepting' : 'Rejecting'} server echo`);
        ctx.sendToServer(Uint8Array.from([Cmd.IAC, response, Cmd.ECHO]));
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};
```

Built-in plugins handle common telnet options like window size, compression (MCCP2), and MUD protocols (GMCP, MSSP).
