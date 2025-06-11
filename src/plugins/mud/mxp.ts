import { PluginFactory } from "../../index.js";
import { TELNET } from "../../telnet/index.js";

const mxp: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "mxp",
      onServerChunk: (chunk) => {
        if (
          // aarchonmud.com:7000 sends WILL MXP
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.WILL &&
          chunk.target === TELNET.MXP
        ) {
          if (negotiate === "accept") {
            console.log("[mxp]: Client->Server IAC DO MXP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DO, TELNET.MXP]),
            );
          } else {
            console.log("[mxp]: Client->Server IAC DONT MXP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DONT, TELNET.MXP]),
            );
          }
          return { type: "handled" };
        } else if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.DO &&
          chunk.target === TELNET.MXP
        ) {
          if (negotiate === "accept") {
            console.log("[mxp]: Client->Server IAC WILL MXP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.WILL, TELNET.MXP]),
            );
          } else {
            console.log("[mxp]: Client->Server IAC WONT MXP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.WONT, TELNET.MXP]),
            );
          }
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default mxp;
