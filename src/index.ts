// index.ts - Cleaned version
import * as ws from "ws";
import * as net from "net";
import * as zlib from "zlib";
import { Parser, type Chunk, Cmd, Dmc } from "./parser.js";
import { IncomingMessage } from "http";
import { decodeText } from "./utils/decode-text.js";
import { z } from "zod";
import iconv from "iconv-lite";
import { createHttpServer } from "./http-server.js";

// Server sends DO → You respond WILL or WONT
// Server sends WILL → You respond DO or DONT

export type ServerConfig = {
  PORT: number;
  HEARTBEAT_INTERVAL: number;
  TELNET_TIMEOUT: number;
  PARSER_BUFFER_SIZE: number;
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

    type MessageToClient =
      | {
          type: "data";
          data: string;
        }
      | { type: "error"; message: string }
      | { type: "mud:mssp"; data: Record<string, string> };

    // Always use this instead of websocket.send() directly.
    function sendToClient(message: MessageToClient) {
      switch (options.format) {
        case "raw":
          switch (message.type) {
            case "data":
              websocket.send(message.data);
              break;
            case "error":
              // use asni red color
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

    // Our initial pipeline that may be unpiped and repiped later.
    let currentPipeline: NodeJS.ReadableStream = telnet;

    // Start with telnet -> parser
    currentPipeline.pipe(parserStream);

    parserStream.on("data", ondata);

    function ondata(chunk: Chunk) {
      if (chunk.type === "DATA") {
        console.log("recv chunk", prettyChunk(chunk));
      }

      // Only log negotiations and commands, not data chunks
      if (chunk.type !== "DATA") {
        console.log("recv chunk", prettyChunk(chunk));
      }

      // Handle MCCP2 compression start
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "SB" &&
        chunk.target === Cmd.MCCP2
      ) {
        console.log("MCCP2 compression starting...");

        // Extract any buffered data from the parser before destroying it
        const bufferedData = parserStream.drain();
        console.log(
          `[MCCP2] Recovered ${bufferedData.length} bytes from parser buffer`,
        );

        // Unpipe the current pipeline from parser
        currentPipeline.unpipe(parserStream);

        const decompressor = zlib.createInflate({
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        });

        decompressor.on("error", (err) => {
          console.error("Decompression error:", err);
          sendToClient({
            type: "error",
            message: "MCCP2 decompression error",
          });
          websocket.close();
        });

        // This should happen when server sends Z_FINISH.
        decompressor.on("end", () => {
          console.log("MCCP2 compression ended by server");
          const bufferedData = parserStream.drain();
          decompressor.unpipe(parserStream);

          // Switch back to direct telnet -> parser pipeline
          telnet.pipe(parserStream);
          currentPipeline = telnet;

          // Re-inject any buffered data
          if (bufferedData.length > 0) {
            parserStream.push(bufferedData);
          }

          console.log("Switched back to uncompressed mode");
        });

        // Set up new pipeline: telnet -> decompressor -> parser
        telnet.pipe(decompressor).pipe(parserStream);
        currentPipeline = decompressor;

        // Feed any buffered data into the decompressor
        if (bufferedData.length > 0) {
          decompressor.write(bufferedData);
        }

        console.log("MCCP2 enabled - server messages are now compressed");
        return;
      }

      switch (chunk.type) {
        case "DATA": {
          const { text, charset } = decodeText(chunk.data, options.encoding);
          // utf-8 can succeed on latin1 data, so we only know if we're in latin1 if utf-8 eventually fails.
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
              console.log("Client->Server (Responding to AYT) `Present\\r\\n`");
              telnet.write("Present\r\n");
              return;
            case Cmd.GO_AHEAD:
              // GA marks end of prompt - could be used for line buffering
              return;
          }
          console.log(`unhandled CMD code: ${chunk.code}`);
          break;
        case "NEGOTIATION":
          switch (chunk.target) {
            case Cmd.CHARSET: {
              // TODO: Handle CHARSET negotiation
              // Example server message if we DO:
              // NEGOTIATE SB [ 1, 59, 85, 84, 70, 45, 56 ] ('"\\u0001;UTF-8"')
              if (chunk.name === "WILL") {
                console.log("Client->Server IAC DONT CHARSET");
                telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.CHARSET]));
                return;
              }
              break;
            }
            case Cmd.TERMINAL_SPEED:
              if (chunk.name === "DO") {
                console.log("Client->Server IAC WONT TERMINAL_SPEED");
                telnet.write(
                  Uint8Array.from([Cmd.IAC, Cmd.WONT, Cmd.TERMINAL_SPEED]),
                );
                return;
              }
              break;
            case Cmd.WINDOW_SIZE: {
              if (chunk.name === "DO") {
                console.log("Client->Server IAC WILL WINDOW_SIZE");
                telnet.write(
                  Uint8Array.from([Cmd.IAC, Cmd.WILL, Cmd.WINDOW_SIZE]),
                );

                // Common terminal size: 80x24, but let's try 100 width
                const width = 100;
                const height = 24;

                console.log("Client->Server IAC SB WINDOW_SIZE ... IAC SE");
                const bytes = Uint8Array.from([
                  Cmd.IAC,
                  Cmd.SB,
                  Cmd.WINDOW_SIZE,
                  // width as 16-bit big-endian
                  width >> 8,
                  width & 0xff,
                  // height as 16-bit big-endian
                  height >> 8,
                  height & 0xff,
                  Cmd.IAC,
                  Cmd.SE,
                ]);
                telnet.write(bytes);
                return;
              }
              break;
            }
            case Cmd.NEW_ENVIRON: {
              if (chunk.name === "DO") {
                console.log("Client->Server IAC WONT NEW_ENVIRON");
                telnet.write(
                  Uint8Array.from([Cmd.IAC, Cmd.WONT, Cmd.NEW_ENVIRON]),
                );
                return;
              }
              break;
            }
            case Cmd.ECHO: {
              if (chunk.name === "WILL") {
                console.log("Client->Server IAC DONT ECHO");
                telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.ECHO]));
                return;
              }
              break;
            }
            case Cmd.MSSP: {
              if (chunk.name === "WILL") {
                console.log("Client->Server IAC DO MSSP");
                telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.MSSP]));
                return;
              }
              // Server responded to our DO MSSP negotiation with MSSP data
              if (chunk.name === "SB" && chunk.target === Cmd.MSSP) {
                const data = decodeMSSP(chunk.data);
                console.log("MSSP data:", data);
                sendToClient({
                  type: "mud:mssp",
                  data,
                });
                return;
              }
              break;
            }
            case Cmd.MXP: {
              if (chunk.name === "DO") {
                console.log("Client->Server IAC WONT MXP");
                telnet.write(Uint8Array.from([Cmd.IAC, Cmd.WONT, Cmd.MXP]));
                return;
              }
              break;
            }
            case Cmd.MSP: {
              if (chunk.name === "WILL") {
                console.log("Client->Server IAC DONT MSP");
                telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.MSP]));
                return;
              }
              break;
            }
            case Cmd.MCCP2:
              if (chunk.name === "WILL") {
                if (options.mccp2) {
                  console.log("Client->Server IAC DO MCCP2");
                  telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.MCCP2]));
                } else {
                  console.log("Client->Server IAC DONT MCCP2");
                  telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.MCCP2]));
                }
                return;
              }
              break;
            case Cmd.GMCP:
              // TODO: Support GMCP. elephant.org:23 for example
              if (chunk.name === "WILL") {
                console.log("Client->Server IAC DONT GMCP");
                telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.GMCP]));
                return;
              }
              break;
            default: {
              // For unhandled negotiations, reject and log them

              // For DO requests we don't handle
              if (chunk.name === "DO") {
                console.log(
                  `** [Auto-reject] Client->Server IAC WONT ${chunk.target}`,
                );
                telnet.write(
                  Uint8Array.from([Cmd.IAC, Cmd.WONT, chunk.target]),
                );
                return;
              }
              // For WILL requests we don't handle
              else if (chunk.name === "WILL") {
                console.log(
                  `** [Auto-reject] Client->Server IAC DONT ${chunk.target}`,
                );
                telnet.write(
                  Uint8Array.from([Cmd.IAC, Cmd.DONT, chunk.target]),
                );
                return;
              }
              break;
            }
          }

          // If we got here, we didn't handle a negotiation
          console.log("⚠️ Unhandled negotiation:", prettyChunk(chunk));
          return;
      }
    }

    telnet.on("close", () => {
      console.log("telnet close");
      websocket.close();
    });

    // Send data to server to avoid idle timeout
    let heartbeatTimeout: NodeJS.Timeout;
    function heartbeat() {
      // console.log("sending heartbeat to ", options.host, ":", options.port);

      // :: Cyberlife game seems to have problem with my next command after the IAC NOP heartbeat
      // console.log("[heartbeat] sending NOP");
      // telnet.write(Uint8Array.from([Cmd.IAC, Cmd.NOP]));

      // :: This seems to work better for Cyberlife. but not sure it actually works to keep conn alive
      // console.log("[heartbeat] sending <space><backspace>");
      telnet.write(Buffer.from(" \b"));

      heartbeatTimeout = setTimeout(heartbeat, config.HEARTBEAT_INTERVAL);
    }
    heartbeatTimeout = setTimeout(heartbeat, config.HEARTBEAT_INTERVAL);

    websocket.on("message", (_message: ws.RawData, isBinary: boolean) => {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = setTimeout(heartbeat, config.HEARTBEAT_INTERVAL);

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

      // Escape IAC bytes in user data for telnet transmission
      bytes = escapeIAC(bytes);

      telnet.write(bytes);
    });

    websocket.on("error", (error) => {
      console.log("WebSocket error:", error);
      clearTimeout(heartbeatTimeout);
      if (telnet && !telnet.destroyed) {
        telnet.destroy();
      }
    });

    websocket.on("close", () => {
      console.log("client websocket closed");
      clearTimeout(heartbeatTimeout);
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
  dataBytes?: number;
} {
  const pretty = { ...chunk } as Chunk & {
    targetName?: string;
    codeName?: string;
    dataText?: string;
    dataBytes?: number;
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
    pretty.dataBytes = chunk.data.length;
    delete pretty.data;
  }

  return pretty;
}

// Example data from elephant.org:23
// 1NAME2Elephant1PLAYERS271UPTIME21748842171
// { NAME: 'Elephant', PLAYERS: '7', UPTIME: '1748842171' }
// TODO: https://tintin.mudhalla.net/protocols/mssp/
function decodeMSSP(data: Uint8Array): Record<string, string> {
  const MSSP_VAR = 1;
  const MSSP_VAL = 2;
  const result: Record<string, string> = Object.create(null);
  let i = 0;

  while (i < data.length) {
    if (data[i] === MSSP_VAR) {
      i++;
      let key = "";
      while (i < data.length && data[i] !== MSSP_VAL) {
        key += String.fromCharCode(data[i]);
        i++;
      }

      if (data[i] === MSSP_VAL) {
        i++;
        let value = "";
        while (i < data.length && data[i] !== MSSP_VAR) {
          value += String.fromCharCode(data[i]);
          i++;
        }
        result[key] = value;
      }
    }
  }
  return result;
}
