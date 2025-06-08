// case Cmd.GMCP:
//   // TODO: Support GMCP. elephant.org:23 for example
//   if (chunk.name === "WILL") {
//     console.log("Client->Server IAC DONT GMCP");
//     telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.GMCP]));
//     return;
//   }
//   break;

import { PluginFactory } from "../../index.js";
import { Cmd } from "../../parser.js";

const gmcp: PluginFactory<false> = (_config) => (ctx) => {
  return {
    name: "gmcp",
    onServerChunk: (chunk) => {
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "WILL" &&
        chunk.target === Cmd.GMCP
      ) {
        console.log("[gmcp]: Client->Server IAC DONT GMCP");
        ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.GMCP]));
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default gmcp;
