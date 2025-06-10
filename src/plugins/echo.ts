// case Cmd.ECHO: {
//   if (chunk.name === "WILL") {
//     console.log("Client->Server IAC DONT ECHO");
//     telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.ECHO]));
//     return;
//   }
//   break;

import { PluginFactory } from "../index.js";
import { Cmd } from "../parser.js";

const echo: PluginFactory<{ reply: "reject" }> =
  ({ reply: _reply }) =>
  (ctx) => {
    return {
      name: "echo",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "NEGOTIATION" &&
          chunk.name === "WILL" &&
          chunk.target === Cmd.ECHO
        ) {
          console.log("[echo]: Client->Server IAC DONT ECHO");
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.ECHO]));
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default echo;
