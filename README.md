# BuildGates for TypeScript

@untrust/buildgates is a compiler-API command that makes policy violations fail a normal npm build.

## Gates

- UBG001: null and undefined require a directly preceding reviewed justification.
- UBG002: mutable class state must use native #private fields; public mutable fields and computed class fields are rejected.
- UBG003: configured unsafe APIs are rejected with their replacement guidance.
- UBG004: configured imports are rejected before call analysis.
- UBG005: dynamic ordinary-object property reads, writes, checks, and deletes are rejected; use Map.
- UBG006: object spread, for...in, direct prototype access, and known object mergers are rejected.

Array, tuple, string, and typed-array indexing remain valid. Map access uses its explicit methods, never brackets.

## Use

Install the package as a development dependency and add the gate before TypeScript emission:

~~~json
{
  "scripts": {
    "check:gates": "untrust-buildgates --project tsconfig.json --config buildgates.json",
    "build": "npm run check:gates && tsc -b"
  }
}
~~~

Copy buildgates.example.json to the consuming project as buildgates.json. The consuming project owns its policy additions and replacement messages.

UBG001 has one narrow escape hatch:

~~~ts
// UNTRUST-ALLOW-NULLISH: The external wire protocol represents a missing optional field with undefined; the boundary adapter immediately converts it to an explicit domain variant.
return undefined;
~~~

The explanation must be directly above the literal and meet the configured minimum length.

"# buildgates_ts" 
