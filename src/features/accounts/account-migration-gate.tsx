"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Trade } from "@/features/trades/types";
import { loadCollection } from "@/lib/local-repository";
import { persistLegacyAccountMigration } from "./migrate-accounts";
import type { InvestmentAccount } from "./types";
import { useI18n } from "@/i18n/i18n-provider";

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
  const { t } = useI18n();
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
      <h1 className="text-xl font-semibold">{t("기존 계좌 데이터를 준비하지 못했습니다.")}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{t("원본 데이터는 삭제되지 않았습니다. 다시 시도하거나 설정의 백업·복원 안내를 확인해 주세요.")}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2"><button onClick={() => void initialize(true)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">{t("다시 시도")}</button><a href="/settings#data-recovery" className="rounded-lg border px-4 py-2 text-sm">{t("설정/복구 안내")}</a></div>
    </section>
  </main>;
}
