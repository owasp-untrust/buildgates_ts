export interface ForbiddenImportRule {
  readonly module: string;
  readonly message: string;
  readonly allowPaths?: readonly string[];
}

export interface ForbiddenCallRule {
  readonly symbol: string;
  readonly message: string;
}

export interface BuildGatesPolicy {
  readonly minimumJustificationCharacters: number;
  readonly nullishJustificationMarker: string;
  readonly memberPrefix: string;
  readonly forbiddenImports: readonly ForbiddenImportRule[];
  readonly forbiddenCalls: readonly ForbiddenCallRule[];
}

const defaultForbiddenCalls: readonly ForbiddenCallRule[] = [
  { symbol: "Object.assign", message: "Do not merge arbitrary object properties. Construct a validated fixed-shape object explicitly." },
  { symbol: "Object.defineProperties", message: "Do not bulk-define object properties. Construct a validated fixed-shape object explicitly." },
  { symbol: "Object.fromEntries", message: "Use Map for arbitrary key-value data rather than creating an object from dynamic entries." },
  { symbol: "Object.setPrototypeOf", message: "Changing prototypes is forbidden because it enables prototype-pollution hazards." },
  { symbol: "Reflect.set", message: "Use Map for dynamic key-value data; do not dynamically set ordinary object properties." },
  { symbol: "Reflect.setPrototypeOf", message: "Changing prototypes is forbidden because it enables prototype-pollution hazards." },
  { symbol: "lodash.assign", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.assignIn", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.assignWith", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.defaults", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.defaultsDeep", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.extend", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.merge", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.mergeWith", message: "Do not merge arbitrary object properties. Use Map or construct a fixed-shape object." },
  { symbol: "lodash.set", message: "Use Map for dynamic key-value data; path-based object mutation is forbidden." },
  { symbol: "lodash.setWith", message: "Use Map for dynamic key-value data; path-based object mutation is forbidden." },
  { symbol: "lodash.update", message: "Use Map for dynamic key-value data; path-based object mutation is forbidden." },
  { symbol: "lodash.updateWith", message: "Use Map for dynamic key-value data; path-based object mutation is forbidden." },
  { symbol: "lodash.zipObject", message: "Use Map for dynamic key-value data rather than constructing an object from keys." },
  { symbol: "lodash.zipObjectDeep", message: "Use Map for dynamic key-value data rather than constructing an object from keys." },
  { symbol: "lodash.fromPairs", message: "Use Map for dynamic key-value data rather than constructing an object from entries." },
  { symbol: "deepmerge.default", message: "Deep object merging is forbidden. Use a fixed-shape constructor or Map." },
  { symbol: "deep-extend.default", message: "Deep object merging is forbidden. Use a fixed-shape constructor or Map." },
  { symbol: "merge-deep.default", message: "Deep object merging is forbidden. Use a fixed-shape constructor or Map." },
  { symbol: "object-assign.default", message: "Object merging is forbidden. Use a fixed-shape constructor or Map." },
  { symbol: "jquery.extend", message: "Object merging is forbidden. Use a fixed-shape constructor or Map." }
];

export const defaultPolicy: BuildGatesPolicy = {
  minimumJustificationCharacters: 120,
  nullishJustificationMarker: "UNTRUST-ALLOW-NULLISH:",
  memberPrefix: "",
  forbiddenImports: [],
  forbiddenCalls: defaultForbiddenCalls
};

export function parsePolicy(text: string): BuildGatesPolicy {
  const candidate: unknown = JSON.parse(text);
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error("BuildGates policy must be a JSON object.");
  }
  const value = candidate as Record<string, unknown>;
  return {
    minimumJustificationCharacters: positiveInteger(value.minimumJustificationCharacters, defaultPolicy.minimumJustificationCharacters),
    nullishJustificationMarker: nonEmptyString(value.nullishJustificationMarker, defaultPolicy.nullishJustificationMarker),
    memberPrefix: stringValue(value.memberPrefix, defaultPolicy.memberPrefix),
    forbiddenImports: importRules(value.forbiddenImports),
    forbiddenCalls: [...defaultForbiddenCalls, ...callRules(value.forbiddenCalls)]
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}
function importRules(value: unknown): readonly ForbiddenImportRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const rule = item as Record<string, unknown>;
    if (typeof rule.module !== "string" || typeof rule.message !== "string" || rule.module.length === 0 || rule.message.length === 0) return [];
    const allowPaths = Array.isArray(rule.allowPaths) && rule.allowPaths.every(path => typeof path === "string") ? rule.allowPaths as string[] : undefined;
    return [{ module: rule.module, message: rule.message, ...(allowPaths === undefined ? {} : { allowPaths }) }];
  });
}
function callRules(value: unknown): readonly ForbiddenCallRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const rule = item as Record<string, unknown>;
    return typeof rule.symbol === "string" && typeof rule.message === "string" && rule.symbol.length > 0 && rule.message.length > 0 ? [{ symbol: rule.symbol, message: rule.message }] : [];
  });
}

