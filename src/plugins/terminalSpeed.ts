import { PluginFactory } from "../index.js";
import { Cmd } from "../parser.js";

const terminalSpeed: PluginFactory<void> = () => (ctx) => {
  return {
    name: "terminalSpeed",
    onServerChunk: (chunk) => {
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "DO" &&
        chunk.target === Cmd.TERMINAL_SPEED
      ) {
        console.log("[terminalSpeed]: Client->Server IAC WONT TERMINAL_SPEED");
        ctx.sendToServer(
          Uint8Array.from([Cmd.IAC, Cmd.WONT, Cmd.TERMINAL_SPEED]),
        );
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default terminalSpeed;
