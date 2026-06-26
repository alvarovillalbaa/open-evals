"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpenCheck, ClipboardList, Flag, Layers3, Settings } from "lucide-react";

const items = [
  { href: "/runs", label: "Runs", icon: ClipboardList },
  { href: "/benchmarks", label: "Benchmarks", icon: BarChart3 },
  { href: "/scenarios", label: "Scenarios", icon: Layers3 },
  { href: "/instructions", label: "Instructions", icon: BookOpenCheck },
  { href: "/campaigns", label: "Campaigns", icon: Flag }
];

export function ProductSidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-border bg-panel lg:block">
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/runs" className="text-sm font-semibold">
            open-evals
          </Link>
        </div>
        <nav aria-label="Product" className="grid gap-1 p-2">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium ${
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border p-2">
          <Link href="/login" className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <Settings className="size-4" aria-hidden="true" />
            Account
          </Link>
        </div>
      </div>
    </aside>
  );
}
