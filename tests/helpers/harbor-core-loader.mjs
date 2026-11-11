import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const root = new URL("../../packages/core/src/", import.meta.url);
export async function loadHarborCore() {
  const pins = [];
  const modules = new Map();
  const crypto = new vm.SyntheticModule(["createHash"], function () { this.setExport("createHash", createHash); });
  const source = async name => {
    if (!["hash.ts", "harbor-tasks.ts"].includes(name)) throw new Error("Unexpected test import");
    if (modules.has(name)) return modules.get(name);
    const url = new URL(name, root), bytes = await readFile(url);
    if (bytes.length > 65536) throw new Error("Unbounded test source");
    pins.push({ name, url, sha256: createHash("sha256").update(bytes).digest("hex") });
    const module = new vm.SourceTextModule(stripTypeScriptTypes(bytes.toString(), { mode: "strip" }), { identifier: url.href });
    modules.set(name, module);
    return module;
  };
  const module = await source("harbor-tasks.ts");
  await module.link(async specifier => specifier === "node:crypto" ? crypto : specifier === "./hash" ? source("hash.ts") : Promise.reject(new Error("Unexpected test import")));
  await module.evaluate();
  return { api: module.namespace, verifySources: async () => {
    for (const pin of pins) if (createHash("sha256").update(await readFile(pin.url)).digest("hex") !== pin.sha256) throw new Error("Test source changed");
    return pins.map(({ name, sha256 }) => ({ name, sha256 }));
  } };
}
