#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { analyzeProgram } from "./analyzer.js";
import { defaultPolicy, parsePolicy } from "./policy.js";

interface Arguments {
  readonly projectPath: string;
  readonly policyPath?: string;
}

function parseArguments(args: readonly string[]): Arguments {
  let projectPath = "tsconfig.json";
  let policyPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--project" && args[index + 1] !== undefined) projectPath = args[++index];
    else if (args[index] === "--config" && args[index + 1] !== undefined) policyPath = args[++index];
    else throw new Error("Unknown or incomplete argument '" + args[index] + "'. Use --project <tsconfig> and optional --config <buildgates.json>.");
  }
  return { projectPath, ...(policyPath === undefined ? {} : { policyPath }) };
}

function main(): void {
  const args = parseArguments(process.argv.slice(2));
  const projectPath = path.resolve(args.projectPath);
  const parsedConfig = ts.getParsedCommandLineOfConfigFile(projectPath, {}, ts.sys as unknown as ts.ParseConfigFileHost);
  if (parsedConfig === undefined) throw new Error("Unable to read TypeScript project '" + projectPath + "'.");
  const policy = args.policyPath === undefined ? defaultPolicy : parsePolicy(fs.readFileSync(path.resolve(args.policyPath), "utf8"));
  const program = ts.createProgram({ rootNames: parsedConfig.fileNames, options: parsedConfig.options, ...(parsedConfig.projectReferences === undefined ? {} : { projectReferences: parsedConfig.projectReferences }) });
  const diagnostics = analyzeProgram(program, policy);
  for (const diagnostic of diagnostics) console.error(diagnostic.fileName + ":" + diagnostic.line + ":" + diagnostic.column + " " + diagnostic.code + " " + diagnostic.message);
  if (diagnostics.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
