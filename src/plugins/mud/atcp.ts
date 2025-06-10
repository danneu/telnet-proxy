// https://www.ironrealms.com/rapture/manual/files/FeatATCP-txt.html

import { PluginFactory } from "../../index.js";
import { Cmd } from "../../parser.js";

const atcp: PluginFactory<{ reply: "accept" | "reject" }> =
  ({ reply }) =>
  (ctx) => {
    return {
      name: "atcp",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "NEGOTIATION" &&
          chunk.name === "WILL" &&
          chunk.target === Cmd.ATCP
        ) {
          if (reply === "accept") {
            console.log("[atcp]: Client->Server IAC DO ATCP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.ATCP]));
          } else {
            console.log("[atcp]: Client->Server IAC DONT ATCP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.ATCP]));
          }
          return { type: "handled" };
        } else if (
          chunk.type === "NEGOTIATION" &&
          chunk.name === "DO" &&
          chunk.target === Cmd.ATCP
        ) {
          // aarchonmud.com:7000 sends DO ATCP
          if (reply === "accept") {
            console.log("[atcp]: Client->Server IAC WILL ATCP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.WILL, Cmd.ATCP]));
          } else {
            console.log("[atcp]: Client->Server IAC WONT ATCP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.WONT, Cmd.ATCP]));
          }
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default atcp;
