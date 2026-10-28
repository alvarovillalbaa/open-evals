import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The focused Node 24 checks load actual source, retaining the repo's extensionless imports.
const sourceRoot = new URL("../src/", import.meta.url);
const allowed = new Set(["prompt", "prompt-composition", "hash", "improvement"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith("./")) {
      const name = specifier.slice(2);
      if (!allowed.has(name)) throw new Error(`Unexpected focused source import: ${specifier}`);
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (!url.href.startsWith(sourceRoot.href) || !existsSync(fileURLToPath(url))) {
        throw new Error(`Missing focused source import: ${specifier}`);
      }
      return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  }
});
