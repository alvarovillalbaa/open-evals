"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, Settings, Sparkles } from "lucide-react";
import { getProductArea, isNavigationActive, productAreas } from "@/lib/product-navigation";

export function ProductSidebar() {
  const pathname = usePathname();
  const areaId = getProductArea(pathname);
  const currentArea = productAreas.find((area) => area.id === areaId);

  return (
    <aside className="border-b border-border bg-panel lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex flex-col lg:h-full">
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Link href="/evals" className="text-sm font-semibold">open-evals</Link>
          <Link href="/login" className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Account">
            <Settings className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <nav aria-label="Product areas" className="flex gap-1 p-2 lg:grid">
          {productAreas.map((area) => {
            const active = area.id === areaId;
            const Icon = area.id === "evals" ? ListChecks : Sparkles;
            return (
              <Link
                key={area.id}
                href={area.href}
                aria-current={active ? "location" : undefined}
                className={`flex min-h-9 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium ${active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {area.label}
              </Link>
            );
          })}
        </nav>
        {currentArea ? (
          <nav aria-label={`${currentArea.label} pages`} className="flex flex-wrap gap-1 border-t border-border p-2 lg:mx-2 lg:grid lg:border-t-0 lg:border-l lg:py-1">
            {currentArea.items.map((item) => {
              const active = isNavigationActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? (pathname === item.href ? "page" : "location") : undefined}
                  className={`flex min-h-9 items-center rounded-md px-3 py-2 text-sm ${active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
        <div className="mt-auto hidden border-t border-border p-2 lg:block">
          <Link href="/login" className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <Settings className="size-4" aria-hidden="true" />Account
          </Link>
        </div>
      </div>
    </aside>
  );
}
