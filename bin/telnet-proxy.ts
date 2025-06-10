#!/usr/bin/env node
import { createServer, plugin, ServerConfig } from "../src/index.js";
import { z } from "zod";
import "dotenv/config";

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(8888),
  HEARTBEAT_INTERVAL: z.coerce.number().optional().default(5000),
  TELNET_TIMEOUT: z.coerce.number().optional(),
});

const env = ConfigSchema.parse(process.env);

const config: ServerConfig = {
  port: env.PORT,
  telnetTimeout: env.TELNET_TIMEOUT,
  logIncomingData: "control",
  plugins: [
    // telnet negotiations

    plugin.windowSize({ negotiate: "accept", width: 100, height: 24 }),
    plugin.newEnviron({ negotiate: "reject" }),
    plugin.echo({ negotiate: "reject" }),
    plugin.charset({ negotiate: "reject" }),
    plugin.terminalSpeed({ negotiate: "reject" }),

    // extra plugins (not telnet negotiation)

    plugin.heartbeat(),

    // mud plugins

    plugin.mud.mssp({ negotiate: "accept" }),
    plugin.mud.mccp2({ negotiate: "accept" }),

    plugin.mud.mxp({ negotiate: "reject" }),
    plugin.mud.atcp({ negotiate: "reject" }),
    plugin.mud.gmcp({ negotiate: "reject" }),
    plugin.mud.msp({ negotiate: "reject" }),
    plugin.mud.msdp({
      negotiate: "reject",
      onVariable: (name, value) => {
        console.log(`MSDP variable ${name} received:`, value);
      },
    }),
  ],
};

createServer(config)
  .listen()
  .then(() => {
    console.log(`Listening on port ${config.port}...`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
