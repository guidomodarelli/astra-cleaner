#!/usr/bin/env node
/** @module bin/cleaner `cleaner <limpieza> [--dry-run]`: runs one development environment cleanup. */
import process from "node:process";
import { runCli } from "../src/cli/run-cli.js";

process.exitCode = await runCli(process.argv.slice(2));
