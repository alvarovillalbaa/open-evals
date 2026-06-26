import type { ReactNode } from "react";
import { ProductSidebar } from "./product-sidebar";

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <ProductSidebar />
      <div className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </div>
    </main>
  );
}
