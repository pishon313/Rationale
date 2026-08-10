"use client";
import Link from "next/link";
import { Database, Plus } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { installSampleDataset } from "./sample-dataset-service";
export function SampleOnboarding() {
  const { t } = useI18n(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function install() { if (!window.confirm(t("샘플 데이터로 Rationale을 둘러볼까요? 기존 데이터는 변경되지 않습니다."))) return; setBusy(true); try { await installSampleDataset(); window.location.reload(); } catch { setError(t("샘플 데이터를 추가하지 못했습니다.")); setBusy(false); } }
  return <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-6"><h2 className="text-lg font-semibold">{t("아직 투자 기록이 없습니다.")}</h2><p className="mt-2 text-sm text-[var(--muted)]">{t("첫 종목을 추가하거나 가상의 샘플 데이터로 주요 기능을 둘러보세요.")}</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/stocks" className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-2 text-sm"><Plus size={16} />{t("첫 종목 추가")}</Link><button disabled={busy} onClick={() => void install()} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"><Database size={16} />{t("샘플 데이터로 둘러보기")}</button></div>{error && <p className="mt-2 text-sm text-red-600">{error}</p>}</section>;
}
