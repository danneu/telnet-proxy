// case Cmd.MSSP: {
//   if (chunk.name === "WILL") {
//     console.log("Client->Server IAC DO MSSP");
//     telnet.write(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.MSSP]));
//     return;
//   }
//   // Server responded to our DO MSSP negotiation with MSSP data
//   if (chunk.name === "SB" && chunk.target === Cmd.MSSP) {
//     const data = decodeMSSP(chunk.data);
//     console.log("MSSP data:", data);
//     sendToClient({
//       type: "mud:mssp",
//       data,
//     });
//     return;
//   }
//   break;
// }

import { PluginFactory } from "../../index.js";
import { Cmd } from "../../parser.js";

const mssp: PluginFactory<{ negotiate: "accept" | "reject" }> =
  ({ negotiate }) =>
  (ctx) => {
    return {
      name: "mssp",
      onServerChunk: (chunk) => {
        if (
          chunk.type === "NEGOTIATION" &&
          chunk.name === "WILL" &&
          chunk.target === Cmd.MSSP
        ) {
          if (negotiate === "accept") {
            console.log("[mssp]: Client->Server IAC DO MSSP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DO, Cmd.MSSP]));
          } else {
            console.log("[mssp]: Client->Server IAC DONT MSSP");
            ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.DONT, Cmd.MSSP]));
          }
          return { type: "handled" };
        } else if (
          chunk.type === "NEGOTIATION" &&
          chunk.name === "SB" &&
          chunk.target === Cmd.MSSP
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
