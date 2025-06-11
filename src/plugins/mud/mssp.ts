import { PluginFactory } from "../../index.js";
import { TELNET } from "../../telnet/index.js";

const mssp: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "mssp",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "negotiation" &&
          chunk.verb === TELNET.WILL &&
          chunk.target === TELNET.MSSP
        ) {
          if (negotiate === "accept") {
            console.log("[mssp]: Client->Server IAC DO MSSP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DO, TELNET.MSSP]),
            );
          } else {
            console.log("[mssp]: Client->Server IAC DONT MSSP");
            ctx.sendToServer(
              Uint8Array.from([TELNET.IAC, TELNET.DONT, TELNET.MSSP]),
            );
          }
          return { type: "handled" };
        } else if (
          chunk.type === "subnegotiation" &&
          chunk.target === TELNET.MSSP
        ) {
          const data = decode(chunk.data);
          console.log("[mssp] MSSP data:", data);
          ctx.sendToClient({
            type: "mud:mssp",
            data,
          });
          return { type: "handled" };
        }
        return { type: "continue" };
      },
    };
  };

export default mssp;

// Example data from elephant.org:23
// 1NAME2Elephant1PLAYERS271UPTIME21748842171
// { NAME: 'Elephant', PLAYERS: '7', UPTIME: '1748842171' }
// TODO: https://tintin.mudhalla.net/protocols/mssp/
function decode(data: Uint8Array): Record<string, string> {
  const MSSP_VAR = 1;
  const MSSP_VAL = 2;
  const result: Record<string, string> = Object.create(null);
  let i = 0;

  while (i < data.length) {
    if (data[i] === MSSP_VAR) {
      i++;
      let key = "";
      while (i < data.length && data[i] !== MSSP_VAL) {
        key += String.fromCharCode(data[i]);
        i++;
      }

      if (data[i] === MSSP_VAL) {
        i++;
        let value = "";
        while (i < data.length && data[i] !== MSSP_VAR) {
          value += String.fromCharCode(data[i]);
          i++;
        }
        result[key] = value;
      }
    }
  }
  return result;
}
