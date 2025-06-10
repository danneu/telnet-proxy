import { PluginFactory } from "../../index.js";
import { Cmd } from "../../parser.js";

const mxp: PluginFactory<boolean> = (enabled) => (ctx) => {
  return {
    name: "mxp",
    onServerChunk: (chunk) => {
      if (
        // aarchonmud.com:7000 sends WILL MXP
        chunk.type === "NEGOTIATION" &&
        chunk.name === "WILL" &&
        chunk.target === Cmd.MXP
      ) {
        if (enabled) {
          console.log("[mxp]: Client->Server IAC DO MXP");
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.MXP]));
        } else {
          console.log("[mxp]: Client->Server IAC DONT MXP");
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.MXP]));
        }
        return { type: "handled" };
      } else if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "DO" &&
        chunk.target === Cmd.MXP
      ) {
        if (enabled) {
          console.log("[mxp]: Client->Server IAC WILL MXP");
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.WILL, Cmd.MXP]));
        } else {
          console.log("[mxp]: Client->Server IAC WONT MXP");
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.WONT, Cmd.MXP]));
        }
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default mxp;
