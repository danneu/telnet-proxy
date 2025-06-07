import * as ws from "ws";
import * as net from "net";
import * as zlib from "zlib";
import * as http from "http";
import { Parser, type Chunk, Cmd, Dmc } from "./parser.ts";
import { IncomingMessage } from "http";
import { decodeText } from "./utils/decode-text.ts";
import { z } from "zod";
import { config } from "./config.ts";
import iconv from "iconv-lite";

// https://users.cs.cf.ac.uk/Dave.Marshall/Internet/node141.html

// Create HTTP server to handle both WebSocket upgrades and health endpoint
const httpServer = http.createServer((req, res) => {
  const info = {
    uptime: Math.floor(process.uptime()),
    connectedClients: server.clients.size,
  };

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info));
  } else if (req.url === "/") {
    const acceptsHtml = req.headers.accept?.includes("text/html");

    if (acceptsHtml) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Telnet Proxy</title>
</head>
<body>
  <h1>Telnet Proxy running</h1>
  <p>More info: <a href="https://github.com/danneu/telnet-proxy">https://github.com/danneu/telnet-proxy</a></p>
  <ul>
    <li>Uptime: ${info.uptime} seconds</li>
    <li>Connected clients: ${info.connectedClients}</li>
  </ul>
</body>
</html>`);
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info));
    }
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

const server = new ws.WebSocketServer({
  server: httpServer,
});

const OptionsSchema = z.object({
  host: z.string(),
  port: z.coerce.number().optional().default(23),
  mccp2: z.preprocess(
    (val) => val === "true",
    z.boolean().optional().default(false)
  ),
  encoding: z
    .enum(["auto", "latin1", "utf8", "gbk", "big5"])
    .optional()
    .default("auto"),
});

server.on("connection", (socket: ws.WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url!, "ws://localhost");

  const result = OptionsSchema.safeParse(urlParamsToRecord(url.searchParams));

  if (!result.success) {
    socket.send(
      `[telnet-proxy] Error with query param "${result.error.issues[0].path.join(
        "."
      )}": ${result.error.issues[0].message}`
    );
    socket.close();
    return;
  }

  const options = result.data;

  console.log("client connected", {
    options,
  });

  const telnet = net
    .connect(options.port, options.host, () => {
      console.log("telnet connected");
    })
    .on("error", (error) => {
      console.log("telnet connection error:", error);
      socket.send(`[telnet-proxy] Connection failed: ${error.message}`);
      socket.close();
    });

  telnet.setTimeout(config.TELNET_TIMEOUT);
  telnet.on("timeout", () => {
    telnet.destroy();
    socket.send("[telnet-proxy] Connection timeout");
    socket.close();
  });

  const parserStream = Parser.createStream(config.PARSER_BUFFER_SIZE);
  parserStream.on("data", ondata);

  // Our initial pipeline that may be unpiped and repiped later.
  telnet.pipe(parserStream);

  function prettyChunk(chunk: Chunk): Chunk & {
    targetName?: string | undefined;
    codeName?: string | undefined;
  } {
    if ("target" in chunk && chunk.target) {
      return { ...chunk, targetName: Dmc[chunk.target] || "<unknown>" };
    }
    if ("code" in chunk && chunk.code) {
      return { ...chunk, codeName: Dmc[chunk.code] || "<unknown>" };
    }
    return chunk;
  }

  function ondata(chunk: Chunk) {
    console.log("[ondata] recv chunk", prettyChunk(chunk));
    if (chunk.type === "DATA") {
      console.log("last data:", chunk.data.slice(chunk.data.length - 5));
    }

    // Negotiate MCCP2
    if (
      chunk.type === "NEGOTIATION" &&
      chunk.name === "SB" &&
      chunk.target === Cmd.MCCP2
    ) {
      console.log(
        "server sent IAC SB MCCP2 IAC SE. setting up new pipeline..."
      );

      // Handle the pipeline switch
      telnet.unpipe(parserStream);
      const decompressor = zlib.createInflate({
        // Avoids crashing when partial data is flushed
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });

      decompressor.on("error", (err) => {
        console.log("Decompression error:", err);
        socket.send("[telnet-proxy] MCCP2 decompression error");
        socket.close();
      });

      telnet.pipe(decompressor).pipe(parserStream);
      return;
    }

    switch (chunk.type) {
      case "DATA": {
        const { text, charset } = decodeText(chunk.data, options.encoding);
        // utf-8 can succeed on latin1 data, so we only know if we're in latin1 if utf-8 eventually fails.
        if (charset === "latin1") {
          options.encoding = "latin1";
        }
        socket.send(text);
        return;
      }
      case "CMD":
        switch (chunk.code) {
          case Cmd.ARE_YOU_THERE:
            telnet.write("Present\r\n");
            break;
          default:
            console.log(`unhandled CMD code: ${chunk.code}`);
            break;
        }
        break;
      case "NEGOTIATION":
        switch (chunk.target) {
          case Cmd.TERMINAL_SPEED:
            if (chunk.target === Cmd.WILL) {
              console.log("sending IAC DONT TERMINAL_SPEED to server");
              telnet.write(
                Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.TERMINAL_SPEED])
              );
            }
            return;
          case Cmd.WINDOW_SIZE:
            // Here's how we could negotiate window size:
            //
            // const windowCharWidth = 80
            // const windowCharHeight = 0
            // const dvWidth = new ArrayBuffer(2)
            // new DataView(dvWidth).setInt16(0, windowCharWidth, false)
            // const dvHeight = new ArrayBuffer(2)
            // new DataView(dvHeight).setInt16(0, windowCharHeight, false)
            //
            // const bytes = Uint8Array.from([
            //   Cmd.IAC,
            //   Cmd.SB,
            //   ...new Uint8Array(dvWidth),
            //   ...new Uint8Array(dvHeight),
            //   Cmd.IAC,
            //   Cmd.SE,
            // ])
            // telnet.write(bytes)
            // return

            if (chunk.target === Cmd.WILL) {
              console.log("sending IAC DONT NAWS to server");
              telnet.write(
                Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.WINDOW_SIZE])
              );
            }
            return;
          case Cmd.NEW_ENVIRON:
            if (chunk.target === Cmd.WILL) {
              console.log("sending IAC DONT NEW_ENVIRON to server");
              telnet.write(
                Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.NEW_ENVIRON])
              );
            }
            return;
          case Cmd.ECHO:
            if (chunk.target === Cmd.WILL) {
              console.log("sending IAC DONT ECHO to server");
              // telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.ECHO]))
              telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.ECHO]));
            }
            return;
          case Cmd.MCCP2:
            if (chunk.target === Cmd.WILL) {
              console.log("sending IAC DO MCCP2 to server");
              telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.MCCP2]));
              // console.log('sending IAC DONT MCCP2 to server')
              // telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.MCCP2]))
            }
            return;
          case Cmd.GMCP:
            if (chunk.target === Cmd.WILL) {
              console.log("sending IAC DO GMCP to server");
              telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.GMCP]));
            }
            return;
          default:
            console.log("unhandled negotation:", chunk);
            return;
        }
    }
  }

  telnet.on("error", (error) => {
    console.log("telnet error", error);
  });

  telnet.on("close", () => {
    console.log("telnet close");
    socket.close();
  });

  telnet.on("end", () => {
    console.log("telnet end");
    socket.close();
  });

  // Send NOP's to server to avoid connection close
  let heartbeatTimeout: NodeJS.Timeout;
  function heartbeat() {
    // console.log("[heartbeat] sending NOP");
    // Cyberlife game seems to have problem with my next command after the IAC NOP heartbeat
    // telnet.write(Uint8Array.from([Cmd.IAC, Cmd.NOP]));

    // This seems to work better for Cyberlife. but not sure it actuallykeeps alove
    // it's a space folowed by a backspace.
    console.log("[heartbeat] sending <space><backspace>");
    telnet.write(Buffer.from(" \b"));

    heartbeatTimeout = setTimeout(heartbeat, config.HEARTBEAT_INTERVAL);
  }
  heartbeatTimeout = setTimeout(heartbeat, config.HEARTBEAT_INTERVAL);

  socket.on("message", (_message: ws.RawData, isBinary: boolean) => {
    console.log(`[binary=${isBinary}] recv: %s`, _message);

    let bytes = isBinary
      ? (_message as Uint8Array)
      : options.encoding === "utf8"
        ? new TextEncoder().encode(_message.toString()) // utf8
        : options.encoding === "gbk" || options.encoding === "big5"
          ? Uint8Array.from(iconv.encode(_message.toString(), options.encoding))
          : Uint8Array.from(Buffer.from(_message.toString(), "latin1")); // latin1
    bytes = escapeIAC(bytes);

    // reset heartbeat timer
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = setTimeout(heartbeat, config.HEARTBEAT_INTERVAL);

    console.log("sending message:", JSON.stringify(bytes));
    telnet.write(bytes);
  });

  socket.on("error", (error) => {
    console.log("WebSocket error:", error);
    clearTimeout(heartbeatTimeout);
    if (telnet && !telnet.destroyed) {
      telnet.destroy();
    }
  });

  socket.on("close", () => {
    console.log("client websocket closed");
    clearTimeout(heartbeatTimeout);
    telnet.end();
  });
});

httpServer.listen(config.PORT);
console.log(`Listening on port ${config.PORT}...`);
console.log(`Health check endpoint available at :${config.PORT}/health`);

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

// Escape IAC bytes in user data for telnet transmission
//
// In telnet protocol, the byte 255 (0xFF) is reserved as IAC (Interpret As Command).
// When user data contains this byte value, it must be escaped by doubling it.
// Example: [1, 255, 3] becomes [1, 255, 255, 3]
//
// This function efficiently handles the common case where no IACs exist by
// returning the original data unchanged. When IACs are present, it allocates
// exactly the right amount of memory (original size + IAC count).
function escapeIAC(data: Uint8Array): Uint8Array {
  // Count IAC bytes first to determine exact buffer size needed
  let iacCount = 0;
  for (const byte of data) {
    if (byte === Cmd.IAC) iacCount++;
  }

  // Optimization: return original data if no escaping needed (common case)
  if (iacCount === 0) return data;

  // Allocate exact buffer size: original length + one extra byte per IAC
  const escaped = new Uint8Array(data.length + iacCount);
  let i = 0;
  for (const byte of data) {
    escaped[i++] = byte;
    if (byte === Cmd.IAC) {
      escaped[i++] = Cmd.IAC; // Double the IAC byte
    }
  }
  return escaped;
}

function urlParamsToRecord(params: URLSearchParams): Record<string, string> {
  return Array.from(params.entries()).reduce(
    (acc, [key, value]) => {
      return { ...acc, [key]: value };
    },
    Object.create(null) as Record<string, string>
  );
}
