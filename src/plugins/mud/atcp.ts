// https://www.ironrealms.com/rapture/manual/files/FeatATCP-txt.html

import { PluginFactory } from "../../index.js";
import { TELNET } from "../../telnet/index.js";

const atcp: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "atcp",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.WILL &&
          chunk.target === TELNET.ATCP
        ) {
          if (negotiate === "accept") {
            console.log("[atcp]: Client->Server IAC DO ATCP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DO, TELNET.ATCP]),
            );
          } else {
            console.log("[atcp]: Client->Server IAC DONT ATCP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DONT, TELNET.ATCP]),
            );
          }
          return { type: "handled" };
        } else if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.DO &&
          chunk.target === TELNET.ATCP
        ) {
          // aarchonmud.com:7000 sends DO ATCP
          if (negotiate === "accept") {
            console.log("[atcp]: Client->Server IAC WILL ATCP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.WILL, TELNET.ATCP]),
            );
          } else {
            console.log("[atcp]: Client->Server IAC WONT ATCP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.WONT, TELNET.ATCP]),
            );
          }
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default atcp;
