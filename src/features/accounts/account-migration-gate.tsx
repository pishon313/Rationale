"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Trade } from "@/features/trades/types";
import { loadCollection } from "@/lib/local-repository";
import { persistLegacyAccountMigration } from "./migrate-accounts";
import type { InvestmentAccount } from "./types";

let initialization: Promise<void> | null = null;

export function ensureAccountsMigrated(options: { force?: boolean } = {}) {
  if (options.force) initialization = null;
  if (!initialization) {
    initialization = Promise.all([
      loadCollection<InvestmentAccount>("accounts", []),
      loadCollection<Trade>("trades", []),
    ]).then(async ([accounts, trades]) => {
      await persistLegacyAccountMigration(accounts, trades);
    });
  }
  return initialization;
}

export function resetAccountMigrationInitialization() { initialization = null; }

export function AccountMigrationGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  function initialize(force = false) {
    setState("loading");
    return ensureAccountsMigrated({ force }).then(
      () => setState("ready"),
      () => setState("error"),
    );
  }

  useEffect(() => {
    let active = true;
    void ensureAccountsMigrated().then(
      () => { if (active) setState("ready"); },
      () => { if (active) setState("error"); },
    );
    return () => { active = false; };
  }, []);

  if (state === "ready") return children;
  if (state === "loading") return null;
  return <main className="grid min-h-screen place-items-center bg-[var(--background)] p-6">
    <section role="alert" className="w-full max-w-lg rounded-xl border bg-[var(--surface)] p-6 text-center shadow-xl">
      <h1 className="text-xl font-semibold">기존 계좌 데이터를 준비하지 못했습니다.</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">원본 데이터는 삭제되지 않았습니다. 다시 시도하거나 설정의 백업·복원 안내를 확인해 주세요.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2"><button onClick={() => void initialize(true)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">다시 시도</button><a href="/settings#data-recovery" className="rounded-lg border px-4 py-2 text-sm">설정/복구 안내</a></div>
    </section>
  </main>;
}
