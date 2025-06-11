import { PluginFactory, ServerChunkHandlerResult } from "../../index.js";
import { Chunk, TELNET } from "../../telnet/index.js";
import * as zlib from "zlib";

const PLUGIN_NAME = "mccp2";

const mccp2: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    let removeMiddleware: (() => void) | null = null;

    const onServerChunk = (chunk: Chunk): ServerChunkHandlerResult => {
      // Handle WILL MCCP2
      if (
        chunk.type === "negotiation" &&
        chunk.verb === TELNET.WILL &&
        chunk.option === TELNET.MCCP2
      ) {
        if (negotiate === "accept") {
          console.log(`[${PLUGIN_NAME}]: Accepting compression`);
          ctx.sendToServer(
            new Uint8Array([TELNET.IAC, TELNET.DO, TELNET.MCCP2]),
          );
        } else {
          console.log(`[${PLUGIN_NAME}]: Rejecting compression`);
          ctx.sendToServer(
            new Uint8Array([TELNET.IAC, TELNET.DONT, TELNET.MCCP2]),
          );
        }
        return { type: "handled" };
      } else if (
        // Handle compression start
        chunk.type === "subnegotiation" &&
        chunk.option === TELNET.MCCP2
      ) {
        console.log(`[${PLUGIN_NAME}]: Compression starting`);
        const decompressor = zlib.createInflate({
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        });

        decompressor.on("error", (err) => {
          console.error(`[${PLUGIN_NAME}]: Decompression error:`, err);
          ctx.sendToClient({
            type: "error",
            message: "MCCP2 Decompression error",
          });
          removeMiddleware?.();
        });

        // This event happens when server sends Z_FINISH.
        decompressor.on("end", () => {
          console.log(`[${PLUGIN_NAME}]: Compression ended by server`);
          removeMiddleware?.();
        });

        removeMiddleware = ctx.addMiddleware(decompressor);

        console.log(
          `[${PLUGIN_NAME}]: Enabled - server messages are now compressed`,
        );
        return { type: "handled" };
      } else {
        return { type: "continue" };
      }
    };

    return {
      name: PLUGIN_NAME,
      onServerChunk,
    };
  };

export default mccp2;
