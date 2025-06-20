// index.ts
import * as ws from "ws";
import * as net from "net";
import {
  type Chunk,
  TELNET,
  getTelnetCodeName,
  isTelnetCode,
  createParserStream,
} from "./telnet/index.js";
import { IncomingMessage } from "http";
import { z } from "zod";
import { createHttpServer } from "./http-server.js";
import { createPipelineManager } from "./pipeline-manager.js";
import { Transform } from "stream";
import { autonegotiate } from "./util.js";
import {
  decodeMessage,
  encodeWsRawData,
  isEncodingSupported,
} from "./encoding.js";

// Server sends DO → You respond WILL or WONT
// Server sends WILL → You respond DO or DONT
// Server sends DONT -> You response WONT
// Server sends WONT -> You response DONT

export type ServerConfig = {
  port: number;
  telnetTimeout?: number;
  parserBufferSize?: number;
  plugins: ((ctx: PluginContext) => Plugin)[];
  // control is negotiation and commands like AYT, GA, etc. since other data is noisy
  logIncomingData: "none" | "all" | "control";
};

// https://users.cs.cf.ac.uk/Dave.Marshall/Internet/node141.html

const ConnectionOptionsSchema = z.object({
  host: z.string(),
  port: z.coerce.number().optional().default(23),
  format: z.enum(["raw", "json"]).optional().default("raw"),
  encoding: z
    .string()
    .optional()
    .default("auto")
    .transform((val) => val.toLowerCase())
    .refine((val) => val === "auto" || isEncodingSupported(val), {
      message: `Encoding must be "auto" or a string that iconv supports`,
    }),
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

      // Send error directly to websocket before options is available
      websocket.send(`Error: ${message}`);
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
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPIPE" || error.code === "ECONNRESET")
      ) {
        // Not an error
        console.log(`telnet connection closed unexpectedly: ${error.code}`);
      } else {
        console.error("telnet connection error:", error);
      }
      sendToClient({
        type: "error",
        message: `Connection failed: ${error.message}`,
      });
      websocket.close();
    });

    telnet.setTimeout(config.telnetTimeout ?? 30_000);
    telnet.on("timeout", () => {
      telnet.destroy();
      sendToClient({
        type: "error",
        message: "Connection timeout",
      });
      websocket.close();
    });

    let parserStream = createParserStream({
      maxBufferSize: config.parserBufferSize,
    });
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
      switch (config.logIncomingData) {
        case "none":
          // log nothing
          break;
        case "all":
          // log everything
          console.log("recv chunk", prettyChunk(chunk));
          break;
        case "control":
          // log non-DATA chunks
          if (chunk.type !== "text") {
            console.log("recv chunk", prettyChunk(chunk));
          }
          break;
        default: {
          const exhaustive: never = config.logIncomingData;
          throw new Error(`Invalid logIncomingData: ${exhaustive}`);
        }
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
        case "text": {
          const { text, charset } = decodeMessage(chunk.data, options.encoding);
          // turn auto into the actual encoding
          if (options.encoding === "auto") {
            options.encoding = charset;
          }
          sendToClient({
            type: "data",
            data: text,
          });
          return;
        }
        case "command":
          switch (chunk.code) {
            case TELNET.ARE_YOU_THERE:
              console.log(
                `Client->Server (Responding to AYT): "Present\\r\\n"`,
              );
              telnet.write("Present\r\n");
              break;
            case TELNET.GA:
              // GA marks end of prompt; nothing to do
              return;
            default:
              console.log(`⚠️ Unhandled CMD code: ${chunk.code}`);
          }
          break;
        case "negotiation": {
          // Auto-reject any unhandled negotiations
          const reply = autonegotiate(chunk.verb, "reject");
          console.log(
            `⚠️ [Auto-reject] Client->Server IAC ${getTelnetCodeName(reply)} ${chunk.option}`,
          );
          telnet.write(Uint8Array.from([TELNET.IAC, reply, chunk.option]));
          return;
        }
        case "subnegotiation": {
          // Ignore unhandled subneg data
          break;
        }
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
      let bytes = encodeWsRawData(_message, isBinary, options.encoding);

      // console.log("websocket on message", _message.toString());

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

      // Only write if telnet connection is still open
      if (!telnet.destroyed && telnet.writable) {
        // console.log("writing to telnet", bytes.length);
        try {
          telnet.write(
            // Escape IAC bytes in user data for telnet transmission
            // Plugins get pre-escaped bytes
            escapeIAC(bytes),
          );
        } catch (error) {
          console.log(
            "Failed to write to telnet (connection likely closed):",
            error instanceof Error && "code" in error ? error.code : error,
          );
          // Close the WebSocket since telnet connection is broken
          websocket.close();
        }
      }
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
      httpServer.listen(config.port, () => {
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
    if (byte === TELNET.IAC) {
      escaped[writeIndex++] = TELNET.IAC;
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
  if ("option" in chunk) {
    pretty.targetName = isTelnetCode(chunk.option)
      ? getTelnetCodeName(chunk.option)
      : `unknown(${chunk.option})`;
  }
  if ("code" in chunk) {
    pretty.codeName = isTelnetCode(chunk.code)
      ? getTelnetCodeName(chunk.code)
      : `unknown(${chunk.code})`;
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
