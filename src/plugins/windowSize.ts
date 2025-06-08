// case Cmd.WINDOW_SIZE: {
//   if (chunk.name === "DO") {
//     console.log("Client->Server IAC WILL WINDOW_SIZE");
//     telnet.write(
//       Uint8Array.from([Cmd.IAC, Cmd.WILL, Cmd.WINDOW_SIZE]),
//     );

import { z } from "zod";
import { PluginFactory } from "../index.js";
import { Cmd } from "../parser.js";

//     // Common terminal size: 80x24, but let's try 100 width
//     const width = 100;
//     const height = 24;

//     console.log("Client->Server IAC SB WINDOW_SIZE ... IAC SE");
//     const bytes = Uint8Array.from([
//       Cmd.IAC,
//       Cmd.SB,
//       Cmd.WINDOW_SIZE,
//       // width as 16-bit big-endian
//       width >> 8,
//       width & 0xff,
//       // height as 16-bit big-endian
//       height >> 8,
//       height & 0xff,
//       Cmd.IAC,
//       Cmd.SE,
//     ]);
//     telnet.write(bytes);
//     return;
//   }
//   break;
// }

const ConfigSchema = z.object({
  width: z.number().min(80).optional().default(80),
  height: z.number().min(24).optional().default(24),
});

type Config = z.infer<typeof ConfigSchema>;

const windowSize: PluginFactory<Config> = (config) => (ctx) => {
  const { width, height } = ConfigSchema.parse(config);

  return {
    name: "windowSize",
    onServerChunk: (chunk) => {
      if (
        chunk.type === "NEGOTIATION" &&
        chunk.name === "DO" &&
        chunk.target === Cmd.WINDOW_SIZE
      ) {
        console.log("[windowSize]: Client->Server IAC WILL WINDOW_SIZE");
        ctx.sendToServer(Uint8Array.from([Cmd.IAC, Cmd.WILL, Cmd.WINDOW_SIZE]));

        console.log(
          "[windowSize]: Client->Server IAC SB WINDOW_SIZE ... IAC SE",
        );
        ctx.sendToServer(
          // prettier-ignore
          Uint8Array.from([
            Cmd.IAC, Cmd.SB, Cmd.WINDOW_SIZE,
            width >> 8, width & 0xff, // width as 16-bit big-endian
            height >> 8, height & 0xff, // height as 16-bit big-endian
            Cmd.IAC, Cmd.SE,
          ]),
        );
        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default windowSize;
