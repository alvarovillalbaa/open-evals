import type {
  JsonValue, PromptBinding, PromptBlock, PromptComponent, PromptComponentSource,
  PromptComposition, PromptCompositionSnapshot, PromptVersion
} from "./types";
import { stableHash, stableStringify, textHash } from "./hash";

const SCHEMA = "prompt-composition-v1";
const MAX_BYTES = 1_048_576;
const MAX_DEPTH = 16;
const MAX_NODES = 2048;
const MAX_NAMES = 128;
const MAX_ITERATIONS = 10_000;
const MAX_STEPS = 100_000;
const MAX_JSON_NODES = 100_000;
const DANGEROUS = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();
const own = (value: object, key: PropertyKey) => Object.hasOwn(value, key);
type DataRecord = Record<string, unknown>;
type Bound = PromptBinding | { readonly type: "unknown" };
type Scope = ReadonlyMap<string, Bound>;
type Token = { literal: string } | { name: string; json: boolean };
interface SourceBudget { bytes: number; nodes: number; jsonNodes: number; active: Set<object> }
interface WalkBudget { steps: number; iterations: number; bytes: number }

export function promptRecord(value: unknown, label: string, allowed: readonly string[]): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}:plain_record_required`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key) || DANGEROUS.has(key)) throw new TypeError(`${label}:unknown_field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!own(descriptor, "value") || !descriptor.enumerable) throw new TypeError(`${label}:enumerable_data_required`);
  }
  return value as DataRecord;
}

export function promptField(record: DataRecord, key: string, label: string): unknown {
  if (!own(record, key)) throw new TypeError(`${label}:missing_${key}`);
  return record[key];
}

export function promptArray(value: unknown, label: string, maximum = MAX_NODES): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new TypeError(`${label}:bounded_array_required`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) throw new TypeError(`${label}:array_extra_field`);
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !own(descriptor, "value") || !descriptor.enumerable) throw new TypeError(`${label}:dense_data_array_required`);
  }
  return value;
}

export function promptIdentity(value: unknown, label: string, header = false): string {
  if (typeof value !== "string" || !value || value.length > 128 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value) || DANGEROUS.has(value)
    || (header && !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value))) throw new TypeError(`${label}:invalid_identifier`);
  return value;
}

function name(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value) || DANGEROUS.has(value)) throw new TypeError(`${label}:invalid_name`);
  return value;
}

function sourceBytes(budget: SourceBudget, bytes: number): void {
  budget.bytes += bytes;
  if (budget.bytes > MAX_BYTES) throw new RangeError("composition_source_byte_budget");
}

function text(value: unknown, label: string, budget?: SourceBudget): string {
  if (typeof value !== "string") throw new TypeError(`${label}:string_required`);
  if (value.length > MAX_BYTES) throw new RangeError("prompt_text_length_budget");
  if (budget) sourceBytes(budget, encoder.encode(JSON.stringify(value)).length);
  return value;
}

function enter<T>(value: object, budget: SourceBudget, action: () => T): T {
  if (budget.active.has(value)) throw new TypeError("composition_source_cycle");
  budget.active.add(value);
  try { return action(); } finally { budget.active.delete(value); }
}

function jsonValue(value: unknown, budget: SourceBudget, depth = 0): JsonValue {
  if (++budget.jsonNodes > MAX_JSON_NODES) throw new RangeError("composition_json_node_budget");
  if (depth > MAX_DEPTH) throw new RangeError("binding_json_depth_budget");
  if (typeof value === "string") return text(value, "binding_value", budget);
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    sourceBytes(budget, encoder.encode(JSON.stringify(value)).length);
    return value;
  }
  if (!value || typeof value !== "object") throw new TypeError("binding_value:plain_json_required");
  // Charge empty containers too: an acyclic shared graph can expand enormously.
  sourceBytes(budget, 2);
  return enter(value, budget, () => {
    if (Array.isArray(value)) {
      const items = promptArray(value, "binding_array", MAX_BYTES / 2);
      sourceBytes(budget, Math.max(0, items.length - 1));
      return items.map(item => jsonValue(item, budget, depth + 1));
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("binding_value:plain_json_required");
    const result: Record<string, JsonValue> = {};
    let fields = 0;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || DANGEROUS.has(key)) throw new TypeError("binding_value:dangerous_key");
      sourceBytes(budget, 1 + (fields++ > 0 ? 1 : 0));
      text(key, "binding_key", budget);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!own(descriptor, "value") || !descriptor.enumerable) throw new TypeError("binding_value:enumerable_data_required");
      result[key] = jsonValue(descriptor.value, budget, depth + 1);
    }
    return result;
  });
}

function namedRecord(value: unknown, label: string): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}:plain_record_required`);
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_NAMES) throw new RangeError(`${label}:name_budget`);
  for (const key of keys) {
    name(key, label);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!own(descriptor, "value") || !descriptor.enumerable) throw new TypeError(`${label}:enumerable_data_required`);
  }
  return value as DataRecord;
}

function bindingsFrom(value: unknown, budget: SourceBudget): Record<string, PromptBinding> {
  const source = namedRecord(value, "bindings"), bindings: Record<string, PromptBinding> = {};
  for (const key of Object.keys(source)) {
    const binding = promptRecord(source[key], "binding", ["type", "value"]);
    const type = promptField(binding, "type", "binding"), raw = promptField(binding, "value", "binding");
    if (type === "string") bindings[key] = { type, value: text(raw, "binding_value", budget) };
    else if (type === "number" && typeof raw === "number" && Number.isFinite(raw)) bindings[key] = { type, value: jsonValue(raw, budget) as number };
    else if (type === "boolean" && typeof raw === "boolean") bindings[key] = { type, value: jsonValue(raw, budget) as boolean };
    else if (type === "json") bindings[key] = { type, value: jsonValue(raw, budget) };
    else throw new TypeError("binding:type_value_mismatch");
  }
  return bindings;
}

function blocksFrom(value: unknown, budget: SourceBudget, depth = 1): PromptBlock[] {
  const values = promptArray(value, "blocks");
  if (values.length && depth > MAX_DEPTH) throw new RangeError("composition_depth_budget");
  return enter(values, budget, () => values.map((raw): PromptBlock => {
    if (++budget.nodes > MAX_NODES) throw new RangeError("composition_ast_node_budget");
    const block = promptRecord(raw, "block", ["op", "template", "name", "variable", "then", "else", "as", "indexAs", "body", "separator"]);
    return enter(block, budget, () => {
      const op = promptField(block, "op", "block");
      const exact = (keys: string[]) => promptRecord(block, "block", ["op", ...keys]);
      if (op === "text") { exact(["template"]); return { op, template: text(promptField(block, "template", "block"), "template", budget) }; }
      if (op === "include") { exact(["name"]); return { op, name: name(promptField(block, "name", "block"), "include") }; }
      if (op === "if") {
        exact(["variable", "then", "else"]);
        return { op, variable: name(promptField(block, "variable", "block"), "condition"), then: blocksFrom(promptField(block, "then", "block"), budget, depth + 1),
          ...(own(block, "else") ? { else: blocksFrom(block.else, budget, depth + 1) } : {}) };
      }
      if (op === "each") {
        exact(["variable", "as", "indexAs", "body", "separator"]);
        return { op, variable: name(promptField(block, "variable", "block"), "each"), as: name(promptField(block, "as", "block"), "alias"),
          ...(own(block, "indexAs") ? { indexAs: name(block.indexAs, "index_alias") } : {}),
          body: blocksFrom(promptField(block, "body", "block"), budget, depth + 1),
          ...(own(block, "separator") ? { separator: text(block.separator, "separator", budget) } : {}) };
      }
      throw new TypeError("block:unknown_operation");
    });
  }));
}

function sourcesFrom(value: unknown, budget: SourceBudget, templated: boolean): PromptComponentSource[] {
  const ids = new Set<string>();
  return promptArray(value, "components").map((raw): PromptComponentSource => {
    const source = promptRecord(raw, "component", ["id", "kind", "locked", "content", "operations"]);
    const id = promptIdentity(promptField(source, "id", "component"), "component_id", true);
    const kind = promptIdentity(promptField(source, "kind", "component"), "component_kind", true);
    if (ids.has(id)) throw new TypeError("component:duplicate_id");
    ids.add(id);
    const locked = promptField(source, "locked", "component");
    if (typeof locked !== "boolean") throw new TypeError("component:locked_boolean_required");
    if (own(source, "content") === own(source, "operations")) throw new TypeError("component:one_source_required");
    if (own(source, "content")) {
      if (++budget.nodes > MAX_NODES) throw new RangeError("composition_ast_node_budget");
      return { id, kind, locked, content: text(source.content, "component_content", budget) };
    }
    if (!templated) throw new TypeError("component:operations_require_composition");
    return { id, kind, locked, operations: blocksFrom(source.operations, budget) };
  });
}

function tokensFor(template: string): Token[] {
  const tokens: Token[] = [];
  let literal = "";
  const flush = () => { if (literal) tokens.push({ literal }); literal = ""; };
  for (let index = 0; index < template.length;) {
    if (template.startsWith("\\{{", index)) { literal += "{{"; index += 3; continue; }
    if (!template.startsWith("{{", index)) { literal += template[index++]; continue; }
    flush();
    const end = template.indexOf("}}", index + 2);
    if (end < 0) throw new TypeError("template:unclosed_placeholder");
    const match = /^(json:)?([A-Za-z_][A-Za-z0-9_]{0,63})$/.exec(template.slice(index + 2, end).trim());
    if (!match) throw new TypeError("template:unsupported_placeholder");
    tokens.push({ name: name(match[2], "placeholder"), json: Boolean(match[1]) });
    index = end + 2;
  }
  flush();
  return tokens;
}

function bindingAt(scope: Scope, key: string): Bound {
  const binding = scope.get(key);
  if (!binding) throw new TypeError(`template:unknown_binding:${key}`);
  return binding;
}

function itemBinding(value: JsonValue): PromptBinding {
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  return { type: "json", value };
}

function loopScope(scope: Scope, block: Extract<PromptBlock, { op: "each" }>, item: Bound, index: number): Scope {
  if (scope.has(block.as) || (block.indexAs && (scope.has(block.indexAs) || block.indexAs === block.as))) throw new TypeError("each:alias_shadowing");
  const next = new Map(scope); next.set(block.as, item);
  if (block.indexAs) next.set(block.indexAs, { type: "number", value: index });
  return next;
}

function step(budget: WalkBudget, depth: number): void {
  if (depth > MAX_DEPTH) throw new RangeError("composition_depth_budget");
  if (++budget.steps > MAX_STEPS) throw new RangeError("composition_work_budget");
}

export function freezePromptValue<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezePromptValue(child);
    Object.freeze(value);
  }
  return value;
}

export function promptText(components: readonly PromptComponent[]): string {
  return components.map(component => `<!-- ${component.id}:${component.kind} -->\n${component.content}`).join("\n\n");
}

export function materializePromptComponents(value: readonly PromptComponentSource[], composition?: PromptComposition): {
  components: readonly PromptComponent[]; compositionSnapshot?: PromptCompositionSnapshot;
} {
  const sourceBudget: SourceBudget = { bytes: 0, nodes: 0, jsonNodes: 0, active: new Set() };
  const source = sourcesFrom(value, sourceBudget, composition !== undefined);
  let bindings: Record<string, PromptBinding> = {}, library: Record<string, PromptBlock[]> = {};
  if (composition !== undefined) {
    const options = promptRecord(composition, "composition", ["schemaVersion", "bindings", "blocks"]);
    if (promptField(options, "schemaVersion", "composition") !== SCHEMA) throw new TypeError("composition:unsupported_schema_version");
    bindings = bindingsFrom(promptField(options, "bindings", "composition"), sourceBudget);
    const supplied = own(options, "blocks") ? namedRecord(options.blocks, "library") : {};
    for (const key of Object.keys(supplied)) library[key] = blocksFrom(supplied[key], sourceBudget);
  }
  const sourceSnapshot = { schemaVersion: SCHEMA as "prompt-composition-v1", components: source, bindings, blocks: library };
  if (encoder.encode(stableStringify(sourceSnapshot)).length > MAX_BYTES) throw new RangeError("composition_source_byte_budget");
  const root: Scope = new Map(Object.entries(bindings));
  const cache = new Map<string, Token[]>();
  const parsed = (template: string) => {
    let tokens = cache.get(template);
    if (!tokens) { tokens = tokensFor(template); cache.set(template, tokens); }
    return tokens;
  };
  const validateTemplate = (template: string, scope: Scope, depth = 1) => {
    for (const token of parsed(template)) {
      step(validation, depth);
      if ("literal" in token) continue;
      const binding = bindingAt(scope, token.name);
      if (!token.json && binding.type === "json") throw new TypeError("template:json_formatter_required");
    }
  };
  const validation: WalkBudget = { steps: 0, iterations: 0, bytes: 0 };
  function validate(blocks: readonly PromptBlock[], scope: Scope, depth: number, includes: readonly string[]): void {
    if (blocks.length && depth > MAX_DEPTH) throw new RangeError("composition_depth_budget");
    for (const block of blocks) {
      step(validation, depth);
      if (block.op === "text") validateTemplate(block.template, scope, depth);
      else if (block.op === "include") {
        if (!own(library, block.name)) throw new TypeError(`include:unknown_block:${block.name}`);
        if (includes.includes(block.name)) throw new TypeError("include:cycle");
        // Libraries are closed over root bindings, never a caller's loop aliases.
        validate(library[block.name], root, depth + 1, [...includes, block.name]);
      } else if (block.op === "if") {
        const binding = bindingAt(scope, block.variable);
        if (binding.type !== "boolean" && binding.type !== "unknown") throw new TypeError("if:boolean_required");
        validate(block.then, scope, depth + 1, includes);
        if (block.else) validate(block.else, scope, depth + 1, includes);
      } else {
        const binding = bindingAt(scope, block.variable);
        if (binding.type !== "unknown" && (binding.type !== "json" || !Array.isArray(binding.value))) throw new TypeError("each:json_array_required");
        const items = binding.type === "unknown" ? [] : binding.value as JsonValue[];
        if (items.length > MAX_ITERATIONS) throw new RangeError("composition_iteration_budget");
        // Empty arrays provide lexical scope, but no fictitious concrete item type.
        if (!items.length) validate(block.body, loopScope(scope, block, { type: "unknown" }, 0), depth + 1, includes);
        for (let index = 0; index < items.length; index++) {
          if (++validation.iterations > MAX_ITERATIONS) throw new RangeError("composition_iteration_budget");
          step(validation, depth);
          validate(block.body, loopScope(scope, block, itemBinding(items[index]), index), depth + 1, includes);
        }
      }
    }
  }
  if (composition !== undefined) {
    for (const key of Object.keys(library)) validate(library[key], root, 1, [key]);
    for (const component of source) {
      if ("content" in component && component.content !== undefined) validateTemplate(component.content, root);
      else validate(component.operations!, root, 1, []);
    }
  }
  const render: WalkBudget = { steps: 0, iterations: 0, bytes: 0 };
  const append = (parts: string[], value: string) => {
    render.bytes += encoder.encode(value).length;
    if (render.bytes > MAX_BYTES) throw new RangeError("compiled_prompt_byte_budget");
    parts.push(value);
  };
  function template(template: string, scope: Scope, parts: string[], depth = 1): void {
    for (const token of parsed(template)) {
      step(render, depth);
      if ("literal" in token) { append(parts, token.literal); continue; }
      const binding = bindingAt(scope, token.name);
      if (binding.type === "unknown") throw new TypeError("template:concrete_binding_required");
      if (!token.json && binding.type === "json") throw new TypeError("template:json_formatter_required");
      append(parts, token.json ? stableStringify(binding.value) : String(binding.value));
    }
  }
  function expand(blocks: readonly PromptBlock[], scope: Scope, depth: number, parts: string[]): void {
    for (const block of blocks) {
      step(render, depth);
      if (block.op === "text") template(block.template, scope, parts, depth);
      else if (block.op === "include") expand(library[block.name], root, depth + 1, parts);
      else if (block.op === "if") {
        const binding = bindingAt(scope, block.variable);
        if (binding.type !== "boolean") throw new TypeError("if:boolean_required");
        expand(binding.value ? block.then : block.else ?? [], scope, depth + 1, parts);
      } else {
        const binding = bindingAt(scope, block.variable);
        if (binding.type !== "json" || !Array.isArray(binding.value)) throw new TypeError("each:json_array_required");
        for (let index = 0; index < binding.value.length; index++) {
          if (++render.iterations > MAX_ITERATIONS) throw new RangeError("composition_iteration_budget");
          step(render, depth);
          if (index > 0) append(parts, block.separator ?? "");
          expand(block.body, loopScope(scope, block, itemBinding(binding.value[index]), index), depth + 1, parts);
        }
      }
    }
  }
  const components = source.map((component, index) => {
    append([], `${index ? "\n\n" : ""}<!-- ${component.id}:${component.kind} -->\n`);
    const parts: string[] = [];
    if ("content" in component && component.content !== undefined) {
      if (composition === undefined) append(parts, component.content);
      else template(component.content, root, parts);
    } else expand(component.operations!, root, 1, parts);
    return { id: component.id, kind: component.kind, locked: component.locked, content: parts.join("") };
  });
  return freezePromptValue({ components, ...(composition === undefined ? {} : {
    compositionSnapshot: { ...sourceSnapshot, sourceHash: stableHash(sourceSnapshot) }
  }) });
}

function materializedComponentsFrom(value: unknown): readonly PromptComponent[] {
  const ids = new Set<string>();
  let bytes = 0;
  const components = promptArray(value, "materialized_components").map((raw, index): PromptComponent => {
    const component = promptRecord(raw, "materialized_component", ["id", "kind", "locked", "content"]);
    const id = promptIdentity(promptField(component, "id", "materialized_component"), "component_id", true);
    const kind = promptIdentity(promptField(component, "kind", "materialized_component"), "component_kind", true);
    if (ids.has(id)) throw new TypeError("component:duplicate_id");
    ids.add(id);
    const locked = promptField(component, "locked", "materialized_component");
    if (typeof locked !== "boolean") throw new TypeError("component:locked_boolean_required");
    const content = text(promptField(component, "content", "materialized_component"), "component_content");
    // Rendered text is bounded as UTF-8, not by its escaped JSON representation.
    bytes += encoder.encode(`${index ? "\n\n" : ""}<!-- ${id}:${kind} -->\n`).length;
    bytes += encoder.encode(content).length;
    if (bytes > MAX_BYTES) throw new RangeError("compiled_prompt_byte_budget");
    return { id, kind, locked, content };
  });
  return freezePromptValue(components);
}

export function inspectPromptVersion(value: PromptVersion): PromptVersion {
  const version = promptRecord(value, "prompt_version", ["id", "definitionId", "components", "compiledText", "parentVersionIds", "contentHash", "status", "compositionSnapshot"]);
  const id = promptIdentity(promptField(version, "id", "prompt_version"), "prompt_id");
  promptIdentity(promptField(version, "definitionId", "prompt_version"), "definition_id");
  const parents = promptArray(promptField(version, "parentVersionIds", "prompt_version"), "parents").map(parent => promptIdentity(parent, "parent_id"));
  if (new Set(parents).size !== parents.length || parents.includes(id)) throw new TypeError("prompt_version:invalid_parents");
  const components = materializedComponentsFrom(promptField(version, "components", "prompt_version"));
  const compiledText = text(promptField(version, "compiledText", "prompt_version"), "compiled_text");
  if (promptText(components) !== compiledText || textHash(compiledText) !== promptField(version, "contentHash", "prompt_version")) throw new TypeError("prompt_version:text_hash_mismatch");
  promptStatus(promptField(version, "status", "prompt_version"));
  if (own(version, "compositionSnapshot")) {
    const source = promptRecord(version.compositionSnapshot, "composition_snapshot", ["schemaVersion", "components", "bindings", "blocks", "sourceHash"]);
    const restored = materializePromptComponents(promptField(source, "components", "composition_snapshot") as readonly PromptComponentSource[], {
      schemaVersion: promptField(source, "schemaVersion", "composition_snapshot") as PromptComposition["schemaVersion"],
      bindings: promptField(source, "bindings", "composition_snapshot") as PromptComposition["bindings"],
      blocks: promptField(source, "blocks", "composition_snapshot") as PromptComposition["blocks"]
    });
    if (restored.compositionSnapshot!.sourceHash !== promptField(source, "sourceHash", "composition_snapshot")
      || stableStringify(restored.components) !== stableStringify(components)) throw new TypeError("prompt_version:composition_snapshot_mismatch");
  }
  return value;
}

export function promptStatus(value: unknown): PromptVersion["status"] {
  if (!["draft", "searching", "offline_validated", "shadow", "canary", "active", "retired", "rolled_back"].includes(value as string)) throw new TypeError("prompt_version:invalid_status");
  return value as PromptVersion["status"];
}
