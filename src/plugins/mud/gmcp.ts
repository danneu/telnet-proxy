// https://tintin.mudhalla.net/protocols/gmcp/

import { PluginFactory } from "../../index.js";
import { Cmd } from "../../parser.js";

const gmcp: PluginFactory<boolean> = (enabled) => (ctx) => {
  return {
    name: "gmcp",
    onServerChunk: (chunk) => {
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "WILL" &&
        chunk.target === Cmd.GMCP
      ) {
        if (enabled) {
          console.log("[gmcp]: Client->Server IAC DO GMCP");
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.GMCP]));
        } else {
          console.log("[gmcp]: Client->Server IAC DONT GMCP");
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.GMCP]));
        }
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default gmcp;
