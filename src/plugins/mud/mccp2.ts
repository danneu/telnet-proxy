import {
  Plugin,
  PluginFactory,
  PluginReturn,
  ServerChunkHandlerResult,
} from "../../index.js";
import { Chunk, Cmd } from "../../parser.js";
import * as zlib from "zlib";

const mccp2: PluginFactory<void> =
  (): Plugin =>
  (ctx): PluginReturn => {
    let removeDecompressor: (() => void) | null = null;

    const cleanupDecompressor = () => {
      if (removeDecompressor) {
        removeDecompressor();
        removeDecompressor = null;
      }
    };

    const onServerChunk = (chunk: Chunk): ServerChunkHandlerResult => {
      // Handle WILL MCCP2
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "WILL" &&
        chunk.target === Cmd.MCCP2
      ) {
        console.log("[mccp2]: Accepting compression");
        ctx.sendToServer(new Uint8Array([Cmd.IAC, Cmd.DO, Cmd.MCCP2]));
        return { type: "handled" };
      } else if (
        // Handle compression start

        chunk.type === "NEGOTIATION" &&
        chunk.name === "SB" &&
        chunk.target === Cmd.MCCP2
      ) {
        console.log("[mccp2]: Compression starting");
        const decompressor = zlib.createInflate({
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        });

        decompressor.on("error", (err) => {
          console.error("[mccp2]: Decompression error:", err);
          ctx.sendToClient({
            type: "error",
            message: "MCCP2 Decompression error",
          });
          cleanupDecompressor();
        });

        // This event happens when server sends Z_FINISH.
        decompressor.on("end", () => {
          console.log("[mccp2]: Compression ended by server");
          cleanupDecompressor();
        });

        // Add decompressor to pipeline
        ctx.pipeline.appendTransform(decompressor, "mccp2");
        removeDecompressor = () => {
          ctx.pipeline.removeTransform(decompressor);
        };
        console.log("[mccp2]: Enabled - server messages are now compressed");
        return { type: "handled" };
      } else {
        return { type: "continue" };
      }
    };

    return {
      name: "mccp2",
      onServerChunk,
    };
  };

export default mccp2;
