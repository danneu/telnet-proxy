import { PluginFactory } from "../index.js";
import { TELNET } from "../telnet/index.js";

const terminalSpeed: PluginFactory<{ negotiate: "reject" }> =
  ({ negotiate: _negotiate }) =>
  (ctx) => {
    return {
      name: "terminalSpeed",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.DO &&
          chunk.target === TELNET.TERMINAL_SPEED
        ) {
          console.log(
            "[terminalSpeed]: Client->Server IAC WONT TERMINAL_SPEED",
          );
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.WONT, TELNET.TERMINAL_SPEED]),
          );
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default terminalSpeed;
