import { PluginFactory, ServerChunkHandlerResult } from "../../index.js";
import { Chunk, Cmd } from "../../parser.js";
import * as zlib from "zlib";

const PLUGIN_NAME = "mccp2";

const mccp2: PluginFactory<void> = () => (ctx) => {
  let removeMiddleware: (() => void) | null = null;

  const onServerChunk = (chunk: Chunk): ServerChunkHandlerResult => {
    // Handle WILL MCCP2
    if (
      chunk.type === "NEGOTIATION" &&
      chunk.name === "WILL" &&
      chunk.target === Cmd.MCCP2
    ) {
      console.log(`[${PLUGIN_NAME}]: Accepting compression`);
      ctx.sendToServer(new Uint8Array([Cmd.IAC, Cmd.DO, Cmd.MCCP2]));
      return { type: "handled" };
    } else if (
      // Handle compression start

      chunk.type === "NEGOTIATION" &&
      chunk.name === "SB" &&
      chunk.target === Cmd.MCCP2
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
