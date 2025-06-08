import { PluginFactory } from "../index.js";
import { Cmd } from "../parser.js";

const newEnviron: PluginFactory<false> = (_config) => (ctx) => {
  return {
    name: "newEnviron",
    onServerChunk: (chunk) => {
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "DO" &&
        chunk.target === Cmd.NEW_ENVIRON
      ) {
        console.log("[newEnviron]: Client->Server IAC WONT NEW_ENVIRON");
        ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.WONT, Cmd.NEW_ENVIRON]));
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default newEnviron;
