#!/usr/bin/env node
import { createServer } from "../src/index.js";
import { z } from "zod";
import "dotenv/config";

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
const server = createServer(config);
server
  .listen()
  .then(() => {
    console.log(`Listening on port ${config.PORT}...`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
