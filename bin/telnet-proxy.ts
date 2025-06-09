#!/usr/bin/env node
import { createServer } from "../src/index.js";
import { z } from "zod";
import "dotenv/config";
import heartbeat from "../src/plugins/heartbeat.js";
import mccp2 from "../src/plugins/mud/mccp2.js";
import terminalSpeed from "../src/plugins/terminalSpeed.js";
import windowSize from "../src/plugins/windowSize.js";
import newEnviron from "../src/plugins/newEnviron.js";
import echo from "../src/plugins/echo.js";
import mssp from "../src/plugins/mud/mssp.js";
import mxp from "../src/plugins/mud/mxp.js";
import gmcp from "../src/plugins/mud/gmcp.js";
import charset from "../src/plugins/charset.js";
import msp from "../src/plugins/mud/msp.js";
import msdp from "../src/plugins/mud/msdp.js";

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(8888),
  HEARTBEAT_INTERVAL: z.coerce.number().default(5000),
  TELNET_TIMEOUT: z.coerce.number().default(30000),
  PARSER_BUFFER_SIZE: z.coerce.number().default(1024 * 1024), // 1MB
});

const result = ConfigSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");
  result.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  });
  process.exit(1);
}

const config = result.data;
const server = createServer({
  ...config,
  logIncomingData: "control",
  plugins: [
    // telnet negotiation we reject
    newEnviron(false),
    echo(false),
    charset(false),
    // telnet negotiation we respond to
    terminalSpeed(),
    windowSize({ width: 100, height: 24 }),
    // extra plugins
    heartbeat({ interval: config.HEARTBEAT_INTERVAL }),
    // mud plugins
    mxp(false),
    gmcp(false),
    mssp(),
    mccp2(true),
    msp(false),
    msdp({
      enabled: true,
      onVariable: (name, value) => {
        console.log(`MSDP variable ${name} received:`, value);
      },
    }),
  ],
});
server
  .listen()
  .then(() => {
    console.log(`Listening on port ${config.PORT}...`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
