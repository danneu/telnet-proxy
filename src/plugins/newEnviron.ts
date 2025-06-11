import { PluginFactory } from "../index.js";
import { TELNET } from "../telnet/index.js";

const newEnviron: PluginFactory<{ negotiate: "reject" }> =
  ({ negotiate: _negotiate }) =>
  (ctx) => {
    return {
      name: "newEnviron",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.DO &&
          chunk.target === TELNET.NEW_ENVIRON
        ) {
          console.log("[newEnviron]: Client->Server IAC WONT NEW_ENVIRON");
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.WONT, TELNET.NEW_ENVIRON]),
          );
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default newEnviron;
