export type ProductAreaId = "evals" | "improve";

type NavigationItem = { readonly href: string; readonly label: string };
type ProductArea = NavigationItem & { readonly id: ProductAreaId; readonly items: readonly NavigationItem[] };

export const productAreas = [
  {
    id: "evals", href: "/evals", label: "Evals",
    items: [
      { href: "/evals", label: "Catalogue" },
      { href: "/runs", label: "Runs" },
      { href: "/evals/sdk", label: "Connect SDK" }
    ]
  },
  {
    id: "improve", href: "/improve", label: "Improve",
    items: [
      { href: "/instructions", label: "Instructions" },
      { href: "/campaigns", label: "Campaigns" }
    ]
  }
] as const satisfies readonly ProductArea[];

const legacyEvalsPaths = ["/benchmarks", "/scenarios", "/runs/import"] as const;
const matchesPath = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

export function getProductArea(pathname: string): ProductAreaId | undefined {
  for (const area of productAreas) {
    if (matchesPath(pathname, area.href) || area.items.some(item => matchesPath(pathname, item.href))) return area.id;
  }
  return legacyEvalsPaths.some(href => matchesPath(pathname, href)) ? "evals" : undefined;
}

export function isNavigationActive(pathname: string, href: string): boolean {
  if (legacyEvalsPaths.some(legacy => matchesPath(pathname, legacy))) return false;
  if (!productAreas.some(area => area.items.some(item => item.href === href))) return false;
  return href === "/evals" ? pathname === href : matchesPath(pathname, href);
}
