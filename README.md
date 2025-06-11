# telnet-proxy [![NPM Version](https://img.shields.io/npm/v/telnet-proxy)](https://www.npmjs.com/package/telnet-proxy)

A Telnet to WebSocket proxy server.

## Install

```sh
npm install -g telnet-proxy
```

## Run

```sh
PORT=8888 telnet-proxy
# Listening on port 8888
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

## Use as Library

```typescript
import { createServer, plugin, ServerConfig } from "telnet-proxy";

const config: ServerConfig = {
  port: 8888,
  logIncomingData: "none", // no logging
  plugins: [
    // Basic telnet options
    plugin.windowSize({ negotiate: "accept", width: 100, height: 24 }),
    plugin.echo({ negotiate: "reject" }), // always reject echo attempts

    // Periodically send empty data to keep connection alive
    plugin.heartbeat(),

    // MUD protocols
    plugin.mud.mccp2({ negotiate: "accept" }), // allow client<-server zlib compression
    plugin.mud.mssp({ negotiate: "accept" }), // send mud:mssp json events to client (when format=json)
  ],
};

const server = createServer(config);
server.listen().then(() => {
  console.log(`Listening on port ${config.port}...`);
});
```

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

### Negotiation

The server will send us negotiation messages and we should respond.

| Sender | Receiver | Sender means                          | Receiver means     | Option now in effect |
| ------ | -------- | ------------------------------------- | ------------------ | -------------------- |
| WILL   | DO       | I want to X if you can handle it      | I can handle it    | ✅ Yes               |
| WILL   | DONT     | I want to X if you can handle it      | I cannot handle it | ❌ No                |
| DO     | WILL     | I can handle X if you wish to send it | I will send X      | ❎ Yes               |
| DO     | WONT     | I can handle X if you wish to send it | I can't send X     | ❌ No                |
| WONT   | DONT     | I don't want to X                     | I won't expect X   | ❌ No                |
| DONT   | WONT     | I don't want you to X                 | I won't send X     | ❌ No                |

### Simple Plugin Example

A real plugin would want to handle all negotiation verbs: `DO`, `DONT`, `WILL`, `WONT`.

By default, if no plugins handle a negotiation `<verb> <option>` pair, the proxy auto-responds with `DONT` and `WONT`.

```typescript
import { PluginFactory } from "../index.js";
import { Cmd } from "../parser.js";

const echo: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "echo",
      onServerChunk: (chunk) => {
        // Handle server echo negotiation
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.WILL &&
          chunk.option === TELNET.ECHO
        ) {
          const response = negotiate === "accept" ? TELNET.DO : TELNET.DONT;
          console.log(
            `[echo]: ${negotiate === "accept" ? "Accepting" : "Rejecting"} server echo`,
          );
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, response, TELNET.ECHO]),
          );

          // Important: no other plugins should handle this chunk
          return { type: "handled" };
        }

        // Let other plugins handle the chunk
        return { type: "continue" };
      },
    };
  };
```

## Development

```sh
git clone https://github.com/danneu/telnet-proxy.git
cd telnet-proxy
pnpm install
pnpm run dev # dev
pnpm run start # prod
```
