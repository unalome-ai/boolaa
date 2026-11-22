import type { ReactNode } from "react";
import { CompactLocalePicker } from "@/i18n/locale-picker";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-16">
      <CompactLocalePicker className="absolute right-4 top-4" />
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-3xl font-black text-white shadow-float">
            b
          </span>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">{subtitle}</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
