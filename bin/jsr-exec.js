#!/usr/bin/env node
import process from "node:process";

import { main } from "../src/cli.js";

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`jsr-exec: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
