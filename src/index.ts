#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import prompts from "prompts";

void prompts;

const program = new Command();

program
  .name("ai-commit-helper")
  .description("A CLI helper for creating commit messages.")
  .version("0.1.0")
  .action(() => {
    console.log(chalk.green("AI Commit Helper is running"));
  });

program.parse();
