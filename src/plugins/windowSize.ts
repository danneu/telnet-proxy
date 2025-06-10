import { z } from "zod";
import { PluginFactory } from "../index.js";
import { TELNET } from "../parser.js";

const ConfigSchema = z.discriminatedUnion("negotiate", [
  z.object({
    negotiate: z.literal("accept"),
    width: z.number().min(80).optional().default(80),
    height: z.number().min(24).optional().default(24),
  }),
  z.object({
    negotiate: z.literal("reject"),
  }),
]);

type Config = z.infer<typeof ConfigSchema>;

const windowSize: PluginFactory<Config> = (_config) => (ctx) => {
  const config = ConfigSchema.parse(_config);

  return {
    name: "windowSize",
    onServerChunk: (chunk) => {
      if (
        chunk.type === "negotiation" &&
        chunk.verb === TELNET.DO &&
        chunk.target === TELNET.WINDOW_SIZE
      ) {
        if (config.negotiate === "accept") {
          const { width, height } = config;
          console.log("[windowSize]: Client->Server IAC WILL WINDOW_SIZE");
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.WILL, TELNET.WINDOW_SIZE]),
          );
          console.log(
            "[windowSize]: Client->Server IAC SB WINDOW_SIZE ... IAC SE",
          );
          ctx.sendToServer(
            // prettier-ignore
            Uint8Array.from([
            TELNET.IAC, TELNET.SB, TELNET.WINDOW_SIZE,
            width >> 8, width & 0xff, // width as 16-bit big-endian
            height >> 8, height & 0xff, // height as 16-bit big-endian
            TELNET.IAC, TELNET.SE,
          ]),
          );
        } else {
          console.log("[windowSize]: Client->Server IAC WONT WINDOW_SIZE");
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.WONT, TELNET.WINDOW_SIZE]),
          );
        }

        return { type: "handled" };
      }
      return { type: "continue" };
    },
  };
};

export default windowSize;
