import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node 24 strips types; only these actual core modules may enter this focused check graph.
const sourceRoot = new URL("../src/", import.meta.url);
const names = new Set(["prompt-authoring", "prompt", "prompt-composition", "hash"]);
const sources = new Set([...names].map(name => new URL(`${name}.ts`, sourceRoot).href));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && sources.has(context.parentURL)) {
      if (specifier === "node:crypto") return nextResolve(specifier, context);
      if (!specifier.startsWith("./")) throw new Error(`Unexpected authoring source import: ${specifier}`);
      const name = specifier.slice(2).replace(/\.ts$/, "");
      if (!names.has(name)) throw new Error(`Unexpected authoring source import: ${specifier}`);
      const url = new URL(`${name}.ts`, sourceRoot);
      if (!existsSync(fileURLToPath(url))) throw new Error(`Missing authoring source import: ${specifier}`);
      return nextResolve(url.href, context);
    }
    if (specifier.endsWith(".ts")) {
      const url = new URL(specifier, context.parentURL);
      if (!sources.has(url.href)) throw new Error(`Unexpected authoring TypeScript entry: ${specifier}`);
    }
    return nextResolve(specifier, context);
  }
});
