// index.ts
import * as ws from "ws";
import * as net from "net";
import { Parser, type Chunk, Cmd, Dmc } from "./parser.js";
import { IncomingMessage } from "http";
import { decodeText } from "./utils/decode-text.js";
import { z } from "zod";
import iconv from "iconv-lite";
import { createHttpServer } from "./http-server.js";
import { createPipelineManager } from "./pipeline-manager.js";
import { Transform } from "stream";

// Server sends DO → You respond WILL or WONT
// Server sends WILL → You respond DO or DONT

export type ServerConfig = {
  PORT: number;
  HEARTBEAT_INTERVAL: number;
  TELNET_TIMEOUT: number;
  PARSER_BUFFER_SIZE: number;
  plugins: ((ctx: PluginContext) => Plugin)[];
};

// https://users.cs.cf.ac.uk/Dave.Marshall/Internet/node141.html

const ConnectionOptionsSchema = z.object({
  host: z.string(),
  port: z.coerce.number().optional().default(23),
  format: z.enum(["raw", "json"]).optional().default("raw"),
  mccp2: z.preprocess((val) => val !== "false", z.boolean().optional()),
  encoding: z
    .enum(["auto", "latin1", "utf8", "gbk", "big5"])
    .optional()
    .default("auto"),
});

export type ConnectionOptions = z.infer<typeof ConnectionOptionsSchema>;

function createConnectionHandler(config: ServerConfig) {
  return (websocket: ws.WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url!, "ws://localhost");

    const result = ConnectionOptionsSchema.safeParse(
      urlParamsToRecord(url.searchParams),
    );

    if (!result.success) {
      const message = `Error with query param ${result.error.issues[0].path.join(
        ".",
      )}: ${result.error.issues[0].message}`;

      sendToClient({
        type: "error",
        message,
      });
      websocket.close();
      return;
    }

    const options = result.data;

    // Always use this instead of websocket.send() directly.
    function sendToClient(message: MessageToClient) {
      switch (options.format) {
        case "raw":
          switch (message.type) {
            case "data":
              websocket.send(message.data);
              break;
            case "error":
              // use ansi red color
              websocket.send(
                `\x1b[31m[telnet-proxy] Error: ${message.message}\x1b[0m\r\n`,
              );
              break;
            case "mud:mssp":
              break;
            default: {
              const exhaustive: never = message;
              throw new Error(`Invalid message type: ${exhaustive}`);
            }
          }
          break;
        case "json":
          websocket.send(JSON.stringify(message));
          break;
        default: {
          const exhaustive: never = options.format;
          throw new Error(`Invalid format: ${exhaustive}`);
        }
      }
    }

    console.log("client connected", {
      options,
    });

    const telnet = net.connect(options.port, options.host, () => {
      console.log("telnet connected");
    });

    telnet.on("error", (error) => {
      console.log("telnet connection error:", error);
      sendToClient({
        type: "error",
        message: `Connection failed: ${error.message}`,
      });
      websocket.close();
    });

    telnet.setTimeout(config.TELNET_TIMEOUT);
    telnet.on("timeout", () => {
      telnet.destroy();
      sendToClient({
        type: "error",
        message: "Connection timeout",
      });
      websocket.close();
    });

    let parserStream = Parser.createStream(config.PARSER_BUFFER_SIZE);
    const pipelineManager = createPipelineManager(
      telnet,
      parserStream,
      (owner, error) => {
        sendToClient({
          type: "error",
          message: `Pipeline error for plugin "${owner}": ${error.message}`,
        });
      },
    );

    // Initialize plugins; plugin names must be unique
    const pluginNameSet = new Set<string>();
    const plugins = config.plugins.map((createPlugin) => {
      const pluginContext: PluginContext = {
        sendToServer: (data) => {
          telnet.write(data);
        },
        sendToClient,
        addMiddleware: (transform) => {
          pipelineManager.add(plugin.name, transform);
          return () => {
            pipelineManager.remove(plugin.name);
          };
        },
      };
      const plugin = createPlugin(pluginContext);
      console.log("Initialized plugin", plugin.name);

      // Check for duplicate plugin names
      if (pluginNameSet.has(plugin.name)) {
        throw new Error(`Duplicate plugin name: "${plugin.name}"`);
      } else {
        pluginNameSet.add(plugin.name);
      }

      return plugin;
    });

    parserStream.on("data", (chunk: Chunk) => {
      // Log non-data chunks
      if (chunk.type !== "DATA") {
        console.log("recv chunk", prettyChunk(chunk));
      }

      // Let plugins handle the chunk first
      let handled = false;
      for (const plugin of plugins) {
        if (handled) {
          break;
        }
        if (plugin.onServerChunk) {
          const result = plugin.onServerChunk(chunk);
          switch (result.type) {
            case "handled":
              handled = true;
              break;
            case "continue":
              continue;
            default: {
              const exhaustive: never = result;
              throw new Error(`Invalid plugin result: ${exhaustive}`);
            }
          }
        }
      }

      // If no plugin handled it, use default handling

      if (handled) {
        return;
      }

      switch (chunk.type) {
        case "DATA": {
          const { text, charset } = decodeText(chunk.data, options.encoding);
          if (charset === "latin1") {
            options.encoding = "latin1";
          }
          sendToClient({
            type: "data",
            data: text,
          });
          return;
        }
        case "CMD":
          switch (chunk.code) {
            case Cmd.ARE_YOU_THERE:
              console.log(
                `Client->Server (Responding to AYT): "Present\\r\\n"`,
              );
              telnet.write("Present\r\n");
              break;
            case Cmd.GO_AHEAD:
              // GA marks end of prompt; nothing to do
              return;
            default:
              console.log(`⚠️ Unhandled CMD code: ${chunk.code}`);
          }
          break;
        case "NEGOTIATION":
          // Auto-reject any unhandled negotiations

          // For DO requests we don't handle
          if (chunk.name === "DO") {
            console.log(
              `⚠️ [Auto-reject] Client->Server IAC WONT ${chunk.target}`,
            );
            telnet.write(Uint8Array.from([Cmd.IAC, Cmd.WONT, chunk.target]));
            return;
          }
          // For WILL requests we don't handle
          else if (chunk.name === "WILL") {
            console.log(
              `⚠️ [Auto-reject] Client->Server IAC DONT ${chunk.target}`,
            );
            telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, chunk.target]));
            return;
          }
          break;
        default: {
          const exhaustive: never = chunk;
          throw new Error(`Invalid chunk type: ${exhaustive}`);
        }
      }

      console.log("⚠️ Unhandled chunk:", prettyChunk(chunk));
    });

    telnet.on("close", () => {
      console.log("telnet close");

      for (const plugin of plugins) {
        plugin.onClose?.();
      }

      websocket.close();
    });

    websocket.on("message", (_message: ws.RawData, isBinary: boolean) => {
      // Convert message to bytes
      let bytes = isBinary
        ? (_message as Uint8Array)
        : options.encoding === "utf8"
          ? new TextEncoder().encode(_message.toString()) // utf8
          : options.encoding === "gbk" || options.encoding === "big5"
            ? Uint8Array.from(
                iconv.encode(_message.toString(), options.encoding),
              )
            : Uint8Array.from(Buffer.from(_message.toString(), "latin1")); // latin1

      console.log("websocket on message", _message.toString());

      for (const plugin of plugins) {
        const result = plugin.onClientMessage?.(bytes);
        switch (result?.type) {
          case undefined:
          case "continue":
            continue;
          case "transform":
            bytes = result.data;
            break;
          case "handled":
            return;
          default: {
            const exhaustive: never = result;
            throw new Error(`Invalid plugin result: ${exhaustive}`);
          }
        }
      }

      telnet.write(
        // Escape IAC bytes in user data for telnet transmission
        // Plugins get pre-escaped bytes
        escapeIAC(bytes),
      );
    });

    websocket.on("error", (error) => {
      console.log("WebSocket error:", error);
      if (telnet && !telnet.destroyed) {
        telnet.destroy();
      }
    });

    websocket.on("close", () => {
      console.log("client websocket closed");
      telnet.end();
    });
  };
}

export function createServer(config: ServerConfig) {
  const server = new ws.WebSocketServer({ noServer: true });
  const httpServer = createHttpServer(server);

  httpServer.on("upgrade", (request, socket, head) => {
    server.handleUpgrade(request, socket, head, (ws) => {
      server.emit("connection", ws, request);
    });
  });

  server.on("connection", createConnectionHandler(config));

  function listen(): Promise<void> {
    return new Promise((resolve) => {
      httpServer.listen(config.PORT, () => {
        resolve();
      });

      // Graceful shutdown handling
      process.on("SIGTERM", gracefulShutdown);
      process.on("SIGINT", gracefulShutdown);

      function gracefulShutdown() {
        console.log("Shutting down gracefully...");
        server.close(() => {
          console.log("WebSocket server closed");
          httpServer.close(() => {
            console.log("HTTP server closed");
            process.exit(0);
          });
        });
      }
    });
  }

  return { listen };
}

// Escape IAC bytes in user data for telnet transmission
//
// In telnet protocol, the byte 255 (0xFF) is reserved as IAC (Interpret As Command).
// When user data contains this byte value, it must be escaped by doubling it.
// Example: [1, 255, 3] becomes [1, 255, 255, 3]
function escapeIAC(data: Uint8Array): Uint8Array {
  const escaped = new Uint8Array(data.length * 2);
  let writeIndex = 0;
  let foundIAC = false;

  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    escaped[writeIndex++] = byte;
    if (byte === Cmd.IAC) {
      escaped[writeIndex++] = Cmd.IAC;
      foundIAC = true;
    }
  }

  // If no IAC bytes were found, we can return the original data.
  if (!foundIAC) {
    return data;
  }

  // Return a view (slice) of the populated part of the new array.
  return escaped.slice(0, writeIndex);
}

function urlParamsToRecord(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function prettyChunk(chunk: Chunk): Chunk & {
  targetName?: string;
  codeName?: string;
  dataText?: string;
  dataLength?: number;
} {
  const pretty = { ...chunk } as Chunk & {
    targetName?: string;
    codeName?: string;
    dataText?: string;
    dataLength?: number;
    data?: Uint8Array;
  };

  // Add friendly names
  if ("target" in chunk) {
    pretty.targetName = Dmc[chunk.target] || `unknown(${chunk.target})`;
  }
  if ("code" in chunk) {
    pretty.codeName = Dmc[chunk.code] || `unknown(${chunk.code})`;
  }

  // Handle data
  if ("data" in chunk && chunk.data) {
    try {
      pretty.dataText = new TextDecoder().decode(chunk.data);
    } catch {
      pretty.dataText = "<binary data>";
    }
    pretty.dataLength = chunk.data.length;
    delete pretty.data;
  }

  return pretty;
}

type MessageToClient =
  | {
      type: "data";
      data: string;
    }
  | { type: "error"; message: string }
  | { type: "mud:mssp"; data: Record<string, string> };

////////////////////////////////////////////////////////////

// plugin-types.ts
// import { Transform, Duplex } from "stream";

export type PluginContext = {
  sendToServer(data: Uint8Array): void;
  sendToClient(message: MessageToClient): void;
  addMiddleware: (transform: Transform) => () => void;
};

export type ClientMessageResult =
  // Plugin handled the message so no other plugins should
  | { type: "handled" }
  | { type: "continue" }
  | { type: "transform"; data: Uint8Array };

export type ServerChunkHandlerResult =
  | { type: "handled" }
  | { type: "continue" };

export type Plugin = {
  name: string;

  // Called for each chunk from server
  // Return true to indicate chunk was handled (stop processing)
  onServerChunk?(chunk: Chunk): ServerChunkHandlerResult;

  // Called for each message from client
  // Return null to consume, Uint8Array to transform, void to pass through
  onClientMessage?(data: Uint8Array): ClientMessageResult;

  // Called when connection closes
  onClose?(): void;
};

export type PluginFactory<T = void> = (
  config: T,
) => (ctx: PluginContext) => Plugin;
