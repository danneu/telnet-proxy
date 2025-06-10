// MSP (Option 90) - MUD Sound Protocol
//
// https://www.zuggsoft.com/zmud/msp.htm
//
// For testing, thresholdrpg.com:3333 uses MSP.

import { PluginFactory } from "../../index.js";
import { TELNET } from "../../parser.js";

const msp: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "msp",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.WILL &&
          chunk.target === TELNET.MSP
        ) {
          if (negotiate === "accept") {
            console.log("[msp]: Client->Server IAC DO MSP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DO, TELNET.MSP]),
            );
          } else {
            console.log("[msp]: Client->Server IAC DONT MSP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DONT, TELNET.MSP]),
            );
          }
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default msp;
