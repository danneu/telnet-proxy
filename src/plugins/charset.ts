import { PluginFactory } from "../index.js";
import { Cmd } from "../parser.js";

// TODO: Handle CHARSET negotiation
// Example server message if we DO:
// NEGOTIATE SB [ 1, 59, 85, 84, 70, 45, 56 ] ('"\\u0001;UTF-8"')
const charset: PluginFactory<false> = (_config) => (ctx) => {
  return {
    name: "charset",
    onServerChunk: (chunk) => {
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "WILL" &&
        chunk.target === Cmd.CHARSET
      ) {
        console.log("[charset]: Client->Server IAC DONT CHARSET");
        ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.CHARSET]));
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default charset;
