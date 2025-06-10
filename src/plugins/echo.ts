import { PluginFactory } from "../index.js";
import { Cmd, getCmdName } from "../parser.js";
import { autonegotiate } from "../util.js";

const echo: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "echo",
      onServerChunk: (chunk) => {
        if (chunk.type === "NEGOTIATION" && chunk.target === Cmd.ECHO) {
          // Trying out simpler way to automatically negotiate
          const reply = autonegotiate(chunk.verb, negotiate);
          console.log(`[echo]: Client->Server IAC ${getCmdName(reply)} ECHO`);
          ctx.sendToServer(Uint8Array.from([Cmd.IAC, reply, Cmd.ECHO]));
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default echo;
