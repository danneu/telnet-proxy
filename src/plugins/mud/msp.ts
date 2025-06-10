// MSP (Option 90) - MUD Sound Protocol
//
// https://www.zuggsoft.com/zmud/msp.htm
//
// For testing, thresholdrpg.com:3333 uses MSP.

import { PluginFactory } from "../../index.js";
import { Cmd } from "../../parser.js";

const msp: PluginFactory<{ reply: "accept" | "reject" }> =
  ({ reply }) =>
  (ctx) => {
    return {
      name: "msp",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "NEGOTIATION" &&
          chunk.name === "WILL" &&
          chunk.target === Cmd.MSP
        ) {
          if (reply === "accept") {
            console.log("[msp]: Client->Server IAC DO MSP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.MSP]));
          } else {
            console.log("[msp]: Client->Server IAC DONT MSP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.MSP]));
          }
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default msp;
