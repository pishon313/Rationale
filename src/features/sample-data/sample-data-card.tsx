"use client";
import { Database, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { buildSampleDataset } from "./sample-dataset";
import { deriveSampleDatasetState, installSampleDataset, loadSampleCollections, removeSampleDataset, SampleDependencyError, type SampleDatasetState } from "./sample-dataset-service";

export function SampleDataCard() {
  const { t } = useI18n(); const [state, setState] = useState<SampleDatasetState | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { void loadSampleCollections().then((items) => setState(deriveSampleDatasetState(items, buildSampleDataset(new Date())))).catch(() => setMessage(t("샘플 데이터 상태를 확인하지 못했습니다."))); }, [t]);
  async function add() {
    if (!window.confirm(t("현재 기록에 샘플 데이터를 추가할까요?\n\n기존 데이터는 변경되지 않습니다. 가상의 계좌, 종목, 매매, 계획, 관찰 및 회고가 추가됩니다."))) return;
    setBusy(true); setMessage("");
    try { await installSampleDataset(); setMessage(t("샘플 데이터를 추가했습니다.")); window.setTimeout(() => window.location.reload(), 400); }
    catch (error) { setMessage(t(String(error).includes("손상된 데이터") ? "손상된 데이터를 먼저 복구한 뒤 샘플 데이터를 추가해 주세요." : "샘플 데이터를 추가하지 못했습니다.")); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(t("샘플 데이터를 제거할까요?\n\n샘플 데이터에 직접 수정한 내용도 함께 제거됩니다. 직접 추가한 데이터는 삭제되지 않습니다."))) return;
    setBusy(true); setMessage("");
    try { await removeSampleDataset(); setMessage(t("샘플 데이터를 제거했습니다.")); window.setTimeout(() => window.location.reload(), 400); }
    catch (error) { setMessage(error instanceof SampleDependencyError ? t("직접 작성한 기록이 샘플 종목 또는 계좌에 연결되어 있어 샘플 데이터를 제거할 수 없습니다. 연결된 기록을 먼저 정리해 주세요.") : t("샘플 데이터를 제거하지 못했습니다.")); setBusy(false); }
  }
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><Database size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("샘플 데이터")}</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("Rationale의 주요 기능을 둘러볼 수 있는 가상의 투자 기록을 추가합니다. 기존 기록은 변경하지 않습니다.")}</p>{state === null ? <p className="mt-4 text-sm text-[var(--muted)]">{t("샘플 데이터 상태 확인 중")}</p> : <><p className="mt-4 text-sm">{t(state === "installed" ? "현재 샘플 데이터가 포함되어 있습니다." : state === "partial" ? "일부 샘플 데이터가 존재합니다." : "샘플 데이터가 없습니다.")}</p><div className="mt-4 flex flex-wrap gap-2">{state !== "installed" && <button disabled={busy} onClick={() => void add()} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50">{busy && <LoaderCircle size={15} className="animate-spin" />}{t(state === "partial" ? "누락된 샘플 데이터 추가" : "샘플 데이터 불러오기")}</button>}{state !== "none" && <button disabled={busy} onClick={() => void remove()} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("샘플 데이터 제거")}</button>}</div></>}{message && <p role="status" className="mt-3 text-sm text-[var(--accent)]">{message}</p>}</section>;
}
