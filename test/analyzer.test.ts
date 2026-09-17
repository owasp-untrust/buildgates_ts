import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeProgram } from "../src/analyzer.js";
import { defaultPolicy, parsePolicy } from "../src/policy.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("BuildGates", () => {
  it("rejects null and undefined without a reviewed justification", () => {
    const diagnostics = analyze("const m_a = null; const m_b = undefined;");
    expect(diagnostics.filter(item => item.code === "UBG001")).toHaveLength(2);
  });

  it("allows a reviewed nullish exception and native private state", () => {
    const reason = "This legacy wire adapter immediately transforms the missing value into a validated explicit domain variant before it reaches application behavior.";
    const diagnostics = analyze("// UNTRUST-ALLOW-NULLISH: " + reason + "\nconst m_a = undefined;\nclass Example { #value = 1; }");
    expect(diagnostics).toEqual([]);
  });

  it("rejects dynamic ordinary object access but permits array indexing", () => {
    const diagnostics = analyze("const data: Record<string, number> = {}; const key = 'x'; data[key]; const values = [1]; values[0];");
    expect(diagnostics.filter(item => item.code === "UBG005")).toHaveLength(1);
  });

  it("rejects object composition and configured imports before duplicate call diagnostics", () => {
    const policy = parsePolicy(JSON.stringify({
      forbiddenImports: [{ module: "blocked", message: "Use the approved adapter." }],
      forbiddenCalls: [{ symbol: "blocked.merge", message: "Use Map." }]
    }));
    const diagnostics = analyze("import * as blocked from 'blocked'; const merged = { ...input }; blocked.merge();", policy, "declare const input: object;");
    expect(diagnostics.map(item => item.code)).toContain("UBG004");
    expect(diagnostics.map(item => item.code)).toContain("UBG006");
    expect(diagnostics.map(item => item.code)).not.toContain("UBG003");
  });
});

function analyze(source: string, policy = defaultPolicy, declarations = "") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "buildgates-ts-"));
  directories.push(directory);
  const fileName = path.join(directory, "sample.ts");
  fs.writeFileSync(fileName, declarations + "\n" + source);
  const program = ts.createProgram([fileName], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true });
  return analyzeProgram(program, policy);
}

