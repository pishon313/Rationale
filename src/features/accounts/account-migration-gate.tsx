"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Trade } from "@/features/trades/types";
import { loadCollection } from "@/lib/local-repository";
import { persistLegacyAccountMigration } from "./migrate-accounts";
import type { InvestmentAccount } from "./types";

let initialization: Promise<void> | null = null;

export function ensureAccountsMigrated() {
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

export function AccountMigrationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void ensureAccountsMigrated().then(
      () => { if (active) setReady(true); },
      () => { if (active) setReady(true); },
    );
    return () => { active = false; };
  }, []);

  return ready ? children : null;
}
