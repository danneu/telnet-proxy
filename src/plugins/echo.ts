import { PluginFactory } from "../index.js";
import { getTelnetCodeName, TELNET } from "../telnet/index.js";
import { autonegotiate } from "../util.js";

const echo: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "echo",
      onServerChunk: (chunk) => {
        if (chunk.type === "negotiation" && chunk.option === TELNET.ECHO) {
          // Trying out simpler way to automatically negotiate
          const reply = autonegotiate(chunk.verb, negotiate);
          console.log(
            `[echo]: Client->Server IAC ${getTelnetCodeName(reply)} ECHO`,
          );
          ctx.sendToServer(Uint8Array.from([TELNET.IAC, reply, TELNET.ECHO]));
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default echo;
