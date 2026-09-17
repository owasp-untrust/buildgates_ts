import path from "node:path";
import ts from "typescript";
import type { BuildGatesPolicy, ForbiddenImportRule } from "./policy.js";

export type GateCode = "UBG001" | "UBG002" | "UBG003" | "UBG004" | "UBG005" | "UBG006";
export interface GateDiagnostic {
  readonly code: GateCode;
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}
interface ImportBinding {
  readonly moduleName: string;
  readonly exportedName: string;
  readonly forbidden: boolean;
}

export function analyzeProgram(program: ts.Program, policy: BuildGatesPolicy): readonly GateDiagnostic[] {
  const checker = program.getTypeChecker();
  const diagnostics: GateDiagnostic[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes("/node_modules/") || sourceFile.fileName.includes("\\node_modules\\")) continue;
    const bindings = collectImportBindings(sourceFile, checker, policy, diagnostics);
    visit(sourceFile, node => {
      analyzeNullish(sourceFile, node, policy, diagnostics);
      analyzeMemberState(sourceFile, node, policy, diagnostics);
      analyzeDynamicObjectAccess(sourceFile, node, checker, diagnostics);
      analyzeObjectComposition(sourceFile, node, diagnostics);
      analyzeCall(sourceFile, node, checker, bindings, policy, diagnostics);
    });
  }
  return diagnostics.sort(compareDiagnostics);
}

function collectImportBindings(sourceFile: ts.SourceFile, checker: ts.TypeChecker, policy: BuildGatesPolicy, diagnostics: GateDiagnostic[]): Map<ts.Symbol, ImportBinding> {
  const bindings = new Map<ts.Symbol, ImportBinding>();
  const add = (identifier: ts.Identifier, moduleName: string, exportedName: string, forbidden: boolean): void => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol !== undefined) bindings.set(symbol, { moduleName, exportedName, forbidden });
  };
  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      const rule = matchingImportRule(moduleName, sourceFile.fileName, policy.forbiddenImports);
      if (rule !== undefined) report(diagnostics, sourceFile, node.moduleSpecifier, "UBG004", "Import '" + moduleName + "' is forbidden: " + rule.message);
      const clause = node.importClause;
      if (clause?.name !== undefined) add(clause.name, moduleName, "default", rule !== undefined);
      if (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) add(clause.namedBindings.name, moduleName, "", rule !== undefined);
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) add(element.name, moduleName, element.propertyName?.text ?? element.name.text, rule !== undefined);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return bindings;
}

function visit(node: ts.Node, action: (node: ts.Node) => void): void {
  action(node);
  ts.forEachChild(node, child => visit(child, action));
}

function analyzeNullish(sourceFile: ts.SourceFile, node: ts.Node, policy: BuildGatesPolicy, diagnostics: GateDiagnostic[]): void {
  const isNull = node.kind === ts.SyntaxKind.NullKeyword;
  const isUndefined = ts.isIdentifier(node) && node.text === "undefined";
  if (!isNull && !isUndefined) return;
  if (!hasJustification(sourceFile, node, policy)) {
    report(diagnostics, sourceFile, node, "UBG001", node.getText(sourceFile) + " requires an immediately preceding '" + policy.nullishJustificationMarker + " <reason>' comment with at least " + policy.minimumJustificationCharacters + " characters.");
  }
}

function analyzeMemberState(sourceFile: ts.SourceFile, node: ts.Node, policy: BuildGatesPolicy, diagnostics: GateDiagnostic[]): void {
  if (!ts.isPropertyDeclaration(node) || ts.isPrivateIdentifier(node.name)) return;
  const name = propertyName(node.name);
  if (name === undefined) {
    report(diagnostics, sourceFile, node.name, "UBG002", "Computed class property names are forbidden; use a Map for dynamic key-value state.");
    return;
  }
  if (policy.memberPrefix.length > 0 && !name.startsWith(policy.memberPrefix)) {
    report(diagnostics, sourceFile, node.name, "UBG002", "Class property '" + name + "' must start with '" + policy.memberPrefix + "'.");
    return;
  }
  const mutable = !hasModifier(node, ts.SyntaxKind.ReadonlyKeyword);
  if (mutable && !hasModifier(node, ts.SyntaxKind.PrivateKeyword) && !hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
    report(diagnostics, sourceFile, node.name, "UBG002", "Mutable class property '" + name + "' must use ECMAScript #private state or be made readonly.");
  }
}

function analyzeDynamicObjectAccess(sourceFile: ts.SourceFile, node: ts.Node, checker: ts.TypeChecker, diagnostics: GateDiagnostic[]): void {
  if (ts.isElementAccessExpression(node) && !isStaticKey(node.argumentExpression) && !isIntrinsicIndexable(checker.getTypeAtLocation(node.expression), checker)) {
    report(diagnostics, sourceFile, node.argumentExpression, "UBG005", "Dynamic ordinary-object property access is forbidden. Use Map.get(), Map.set(), Map.has(), or Map.delete().");
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && !isStaticKey(node.left) && !isIntrinsicIndexable(checker.getTypeAtLocation(node.right), checker)) {
    report(diagnostics, sourceFile, node.left, "UBG005", "Dynamic ordinary-object property checks are forbidden. Use Map.has().");
  }
}

function analyzeObjectComposition(sourceFile: ts.SourceFile, node: ts.Node, diagnostics: GateDiagnostic[]): void {
  if (ts.isSpreadAssignment(node)) report(diagnostics, sourceFile, node, "UBG006", "Object spread merging is forbidden. Construct a validated fixed-shape object explicitly.");
  if (ts.isForInStatement(node)) report(diagnostics, sourceFile, node.expression, "UBG006", "for...in is forbidden because inherited and arbitrary properties can be copied. Use Map iteration.");
  if (ts.isComputedPropertyName(node) && ts.isObjectLiteralExpression(node.parent) && !isStaticKey(node.expression)) report(diagnostics, sourceFile, node, "UBG006", "Dynamic object property creation is forbidden. Use Map.set().");
  if (ts.isPropertyAccessExpression(node) && node.name.text === "__proto__") report(diagnostics, sourceFile, node.name, "UBG006", "Direct prototype access is forbidden.");
}

function analyzeCall(sourceFile: ts.SourceFile, node: ts.Node, checker: ts.TypeChecker, bindings: Map<ts.Symbol, ImportBinding>, policy: BuildGatesPolicy, diagnostics: GateDiagnostic[]): void {
  if (!ts.isCallExpression(node)) return;
  const resolved = resolveCall(node.expression, checker, bindings);
  if (resolved?.forbiddenImport === true) return;
  const rule = policy.forbiddenCalls.find(candidate => candidate.symbol === resolved?.symbol);
  if (rule !== undefined) report(diagnostics, sourceFile, node.expression, "UBG003", "Call to '" + rule.symbol + "' is forbidden: " + rule.message);
  if (resolved?.symbol === "Object.hasOwn" && node.arguments.length >= 2 && !isStaticKey(node.arguments[1]) && !isIntrinsicIndexable(checker.getTypeAtLocation(node.arguments[0]), checker)) {
    report(diagnostics, sourceFile, node.arguments[1], "UBG005", "Dynamic ordinary-object property checks are forbidden. Use Map.has().");
  }
}

function resolveCall(expression: ts.Expression, checker: ts.TypeChecker, bindings: Map<ts.Symbol, ImportBinding>): { symbol: string; forbiddenImport: boolean } | undefined {
  if (ts.isIdentifier(expression)) {
    const binding = bindingFor(expression, checker, bindings);
    return binding === undefined ? undefined : { symbol: binding.exportedName.length === 0 ? binding.moduleName : binding.moduleName + "." + binding.exportedName, forbiddenImport: binding.forbidden };
  }
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  if (ts.isIdentifier(expression.expression) && (expression.expression.text === "Object" || expression.expression.text === "Reflect")) return { symbol: expression.expression.text + "." + expression.name.text, forbiddenImport: false };
  if (ts.isIdentifier(expression.expression)) {
    const binding = bindingFor(expression.expression, checker, bindings);
    if (binding !== undefined) {
      const prefix = binding.exportedName.length === 0 ? binding.moduleName : binding.moduleName + "." + binding.exportedName;
      return { symbol: prefix + "." + expression.name.text, forbiddenImport: binding.forbidden };
    }
  }
  return undefined;
}

function bindingFor(identifier: ts.Identifier, checker: ts.TypeChecker, bindings: Map<ts.Symbol, ImportBinding>): ImportBinding | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return undefined;
  const target = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  return bindings.get(symbol) ?? bindings.get(target);
}
function matchingImportRule(moduleName: string, fileName: string, rules: readonly ForbiddenImportRule[]): ForbiddenImportRule | undefined {
  return rules.find(rule => rule.module === moduleName && !rule.allowPaths?.some(pattern => matchesPath(fileName, pattern)));
}
function matchesPath(fileName: string, pattern: string): boolean {
  const normalized = fileName.split(path.sep).join("/");
  if (pattern.endsWith("/**")) return normalized.includes("/" + pattern.slice(0, -3) + "/");
  return normalized.endsWith("/" + pattern);
}
function hasJustification(sourceFile: ts.SourceFile, node: ts.Node, policy: BuildGatesPolicy): boolean {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  if (line === 0) return false;
  const previous = sourceFile.text.split(/\r?\n/)[line - 1].trim();
  if (!previous.startsWith("//")) return false;
  const text = previous.substring(2).trim();
  if (!text.startsWith(policy.nullishJustificationMarker)) return false;
  return text.substring(policy.nullishJustificationMarker.length).trim().length >= policy.minimumJustificationCharacters;
}
function isStaticKey(node: ts.Expression | undefined): boolean {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}
function isIntrinsicIndexable(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (checker.isArrayType(type) || checker.isTupleType(type) || (type.flags & ts.TypeFlags.StringLike) !== 0) return true;
  const name = type.getSymbol()?.getName();
  return name !== undefined && ["Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array", "Float32Array", "Float64Array"].includes(name);
}
function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier: ts.Modifier) => modifier.kind === kind) === true;
}
function report(diagnostics: GateDiagnostic[], sourceFile: ts.SourceFile, node: ts.Node, code: GateCode, message: string): void {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  diagnostics.push({ code, fileName: sourceFile.fileName, line: position.line + 1, column: position.character + 1, message });
}
function compareDiagnostics(left: GateDiagnostic, right: GateDiagnostic): number {
  return left.fileName.localeCompare(right.fileName) || left.line - right.line || left.column - right.column || left.code.localeCompare(right.code);
}
