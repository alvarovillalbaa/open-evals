import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const root = new URL("../../packages/core/src/", import.meta.url);
export async function loadHarborCore(entry = "harbor-tasks.ts") {
  const pins = [];
  const modules = new Map();
  const crypto = new vm.SyntheticModule(["createHash", "randomUUID"], function () { this.setExport("createHash", createHash); this.setExport("randomUUID", randomUUID); });
  const source = async name => {
    if (!["hash.ts", "harbor-tasks.ts", "harbor-evals.ts"].includes(name)) throw new Error("Unexpected test import");
    if (modules.has(name)) return modules.get(name);
    const url = new URL(name, root), bytes = await readFile(url);
    if (bytes.length > 65536) throw new Error("Unbounded test source");
    pins.push({ name, url, sha256: createHash("sha256").update(bytes).digest("hex") });
    const module = new vm.SourceTextModule(stripTypeScriptTypes(bytes.toString(), { mode: "strip" }), { identifier: url.href });
    modules.set(name, module);
    return module;
  };
  const module = await source(entry);
  await module.link(async specifier => specifier === "node:crypto" ? crypto : ["./hash", "./harbor-tasks"].includes(specifier) ? source(specifier.slice(2) + ".ts") : Promise.reject(new Error("Unexpected test import")));
  await module.evaluate();
  return { api: module.namespace, verifySources: async () => {
    for (const pin of pins) if (createHash("sha256").update(await readFile(pin.url)).digest("hex") !== pin.sha256) throw new Error("Test source changed");
    return pins.map(({ name, sha256 }) => ({ name, sha256 }));
  } };
}
