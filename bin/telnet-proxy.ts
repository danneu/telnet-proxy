#!/usr/bin/env node
import { createServer, plugin, ServerConfig } from "../src/index.js";
import { z } from "zod";
import "dotenv/config";

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(8888),
  HEARTBEAT_INTERVAL: z.coerce.number().default(5000),
  TELNET_TIMEOUT: z.coerce.number().default(30000),
});

const env = ConfigSchema.parse(process.env);

const config: ServerConfig = {
  port: env.PORT,
  telnetTimeout: env.TELNET_TIMEOUT,
  logIncomingData: "control",
  plugins: [
    // telnet negotiations

    plugin.windowSize({ width: 100, height: 24 }),
    plugin.newEnviron({ reply: "reject" }),
    plugin.echo({ reply: "reject" }),
    plugin.charset({ reply: "reject" }),
    plugin.terminalSpeed({ reply: "reject" }),

    // extra plugins (not telnet negotiation)

    plugin.heartbeat({ interval: env.HEARTBEAT_INTERVAL }),

    // mud plugins

    plugin.mud.mssp({ reply: "accept" }),
    plugin.mud.mccp2({ reply: "accept" }),

    plugin.mud.mxp({ reply: "reject" }),
    plugin.mud.atcp({ reply: "reject" }),
    plugin.mud.gmcp({ reply: "reject" }),
    plugin.mud.msp({ reply: "reject" }),
    plugin.mud.msdp({
      reply: "reject",
      onVariable: (name, value) => {
        console.log(`MSDP variable ${name} received:`, value);
      },
    }),
  ],
};

const server = createServer(config);
server
  .listen()
  .then(() => {
    console.log(`Listening on port ${config.port}...`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
