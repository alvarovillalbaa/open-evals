// T1: product navigation data and pathname matching only; no Next, browser, database or model execution.
// The explicit Node-only .mts file stays outside the existing Vitest **/*.test.ts collection.
import assert from "node:assert/strict";
import test from "node:test";
import { getProductArea, isNavigationActive, productAreas } from "../../apps/web/lib/product-navigation.ts";

const secondaryLinks = productAreas.flatMap(area => area.items.map((item): string => item.href));
const activeLinks = (pathname: string) => secondaryLinks.filter(href => isNavigationActive(pathname, href));

test("PN01 the product has exactly Evals and Improve with their canonical secondary links", () => {
  assert.deepEqual(productAreas, [
    { id: "evals", href: "/evals", label: "Evals", items: [
      { href: "/evals", label: "Catalogue" }, { href: "/runs", label: "Runs" }, { href: "/evals/sdk", label: "Connect SDK" }
    ] },
    { id: "improve", href: "/improve", label: "Improve", items: [
      { href: "/instructions", label: "Instructions" }, { href: "/campaigns", label: "Campaigns" }
    ] }
  ]);
});

test("PN02 all canonical top-level and secondary pages belong to their declared area", () => {
  for (const pathname of ["/evals", "/runs", "/evals/sdk"]) assert.equal(getProductArea(pathname), "evals", pathname);
  for (const pathname of ["/improve", "/instructions", "/campaigns"]) assert.equal(getProductArea(pathname), "improve", pathname);
});

test("PN03 instruction authoring and release descendants stay in Improve", () => {
  for (const pathname of ["/instructions/candidates", "/instructions/experiments", "/instructions/releases", "/instructions/instruction-1", "/instructions/instruction-1/versions/version-2", "/campaigns/campaign-1"]) {
    assert.equal(getProductArea(pathname), "improve", pathname);
    assert.deepEqual(activeLinks(pathname), [pathname.startsWith("/campaigns/") ? "/campaigns" : "/instructions"]);
  }
});

test("PN04 immutable run-batch descendants remain Evals and select only Runs", () => {
  for (const pathname of ["/runs/batch-1", "/runs/batch-1/rows/row-2", "/runs/batch-1/gates"]) {
    assert.equal(getProductArea(pathname), "evals", pathname);
    assert.deepEqual(activeLinks(pathname), ["/runs"]);
  }
});

test("PN05 legacy catalogue and import deep links retain Evals without selecting a canonical secondary link", () => {
  for (const pathname of ["/benchmarks", "/benchmarks/benchmark-1", "/scenarios", "/scenarios/scenario-1", "/runs/import", "/runs/import/jsonl"]) {
    assert.equal(getProductArea(pathname), "evals", pathname);
    assert.deepEqual(activeLinks(pathname), [], pathname);
  }
});

test("PN06 canonical secondary links are exclusive and the Catalogue does not absorb Connect SDK", () => {
  for (const [pathname, expected] of [
    ["/evals", "/evals"], ["/runs", "/runs"], ["/evals/sdk", "/evals/sdk"],
    ["/evals/sdk/typescript", "/evals/sdk"], ["/instructions", "/instructions"], ["/campaigns", "/campaigns"]
  ]) assert.deepEqual(activeLinks(pathname), [expected], pathname);
  assert.deepEqual(activeLinks("/evals/unknown"), []);
  assert.deepEqual(activeLinks("/improve"), []);
});

test("PN07 lookalike prefixes cannot select an area or a secondary navigation item", () => {
  for (const pathname of ["/evals-old", "/evalsmith", "/runs-old", "/runscape", "/improved", "/instructions-old", "/campaignship", "/benchmarks-old", "/scenarios-old"]) {
    assert.equal(getProductArea(pathname), undefined, pathname);
    assert.deepEqual(activeLinks(pathname), [], pathname);
  }
  assert.equal(isNavigationActive("/evals/sdk-old", "/evals/sdk"), false);
  assert.deepEqual(activeLinks("/evals/"), []);
});

test("PN08 root unknown account and trace paths do not invent another product area or parse URLs", () => {
  for (const pathname of ["/", "", "/unknown", "/login", "/account", "/traces", "/api/v1/traces", "evals", "https://example.test/evals", "/evals?mode=all", "/evals#benchmarks"]) {
    assert.equal(getProductArea(pathname), undefined, pathname);
    assert.deepEqual(activeLinks(pathname), [], pathname);
  }
  assert.equal(isNavigationActive("/traces", "/traces"), false);
  assert.equal(isNavigationActive("/improve", "/improve"), false);
});
