// https://tintin.mudhalla.net/protocols/gmcp/

import { PluginFactory } from "../../index.js";
import { TELNET } from "../../parser.js";

const gmcp: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "gmcp",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.WILL &&
          chunk.target === TELNET.GMCP
        ) {
          if (negotiate === "accept") {
            console.log("[gmcp]: Client->Server IAC DO GMCP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DO, TELNET.GMCP]),
            );
          } else {
            console.log("[gmcp]: Client->Server IAC DONT GMCP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DONT, TELNET.GMCP]),
            );
          }
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default gmcp;
