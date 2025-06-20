import { PluginFactory } from "../index.js";
import { TELNET } from "../telnet/index.js";

// TODO: Handle CHARSET negotiation
// Example server message if we DO:
// NEGOTIATE SB [ 1, 59, 85, 84, 70, 45, 56 ] ('"\\u0001;UTF-8"')
//
// - thresholdrpg.com:3333 sends DO CHARSET
// Only supports reject for now.
const charset: PluginFactory<{ negotiate: "reject" }> =
  ({ negotiate: _negotiate }) =>
  (ctx) => {
    return {
      name: "charset",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.WILL &&
          chunk.option === TELNET.CHARSET
        ) {
          console.log("[charset]: Client->Server IAC DONT CHARSET");
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.DONT, TELNET.CHARSET]),
          );
          return { type: "handled" };
        }
        // Also handle DO CHARSET
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.DO &&
          chunk.option === TELNET.CHARSET
        ) {
          console.log("[charset]: Client->Server IAC WONT CHARSET");
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.WONT, TELNET.CHARSET]),
          );
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default charset;
