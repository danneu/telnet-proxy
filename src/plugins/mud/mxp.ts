import { PluginFactory } from "../../index.js";
import { Cmd } from "../../parser.js";

const mxp: PluginFactory<boolean> = (enabled) => (ctx) => {
  return {
    name: "mxp",
    onServerChunk: (chunk) => {
      if (
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
