"use client";

import { FileSpreadsheet, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { convertCsvRows, csvFieldLabels, detectCsvMapping, parseTradeFile, type CsvField, type CsvMapping, type ParsedCsv } from "./csv-import";
import { translateTradeText } from "./trade-i18n";
import type { Trade } from "./types";
import type { InvestmentAccount } from "@/features/accounts/types";

const required: CsvField[] = ["tradedAt", "tradeType", "quantity", "price"];
const optional: CsvField[] = ["time", "ticker", "stockName", "fee", "tax", "currency", "exchangeRate", "accountName"];

export function CsvImportDialog({ stocks, accounts, existing, onCancel, onImport }: { stocks: Stock[]; accounts: InvestmentAccount[]; existing: Trade[]; onCancel: () => void; onImport: (trades: Trade[]) => Promise<boolean> }) {
  const { t, formatNumber } = useI18n();
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const [targetAccountId, setTargetAccountId] = useState(activeAccounts.find((account) => account.isDefault)?.id ?? activeAccounts[0]?.id ?? "");
  const missing = required.filter((field) => mapping[field] === undefined);
  const hasStockColumn = mapping.ticker !== undefined || mapping.stockName !== undefined;
  const result = useMemo(
    () => parsed && !missing.length && hasStockColumn ? convertCsvRows(parsed, mapping, stocks, existing, { accounts, targetAccountId }) : null,
    [accounts, existing, hasStockColumn, mapping, missing.length, parsed, stocks, targetAccountId],
  );

  async function load(file?: File) {
    if (!file) return;
    setFileError("");
    if (file.size > 10 * 1024 * 1024) {
      setFileError("10MB 이하 파일을 선택해 주세요.");
      return;
    }
    try {
      const next = await parseTradeFile(file);
      if (!next.headers.length || !next.rows.length) throw new Error("첫 번째 시트에서 헤더와 거래 행을 찾지 못했습니다.");
      setParsed(next);
      setMapping(detectCsvMapping(next.headers));
      setFileName(file.name);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "거래 내역 파일을 읽지 못했습니다.");
    }
  }

  function map(field: CsvField, nextValue: string) {
    setMapping((current) => {
      const next = { ...current };
      if (nextValue === "") delete next[field];
      else next[field] = Number(nextValue);
      return next;
    });
  }

  async function submit() {
    if (!result?.trades.length || saving) return;
    setSaving(true);
    try {
      await onImport(result.trades);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-[var(--surface)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] p-5">
          <div>
            <h2 id="csv-import-title" className="text-lg font-semibold">{t("증권사 거래 내역 가져오기")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("CSV·TSV·Excel의 열을 확인한 뒤 기존 원장에 안전하게 추가합니다.")}</p>
          </div>
          <button type="button" disabled={saving} onClick={onCancel} aria-label={t("닫기")} className="disabled:opacity-50"><X /></button>
        </div>

        <div className="space-y-5 p-5">
          <section className="rounded-xl border border-dashed p-6 text-center">
            <FileSpreadsheet className="mx-auto text-[var(--accent)]" />
            <p className="mt-3 text-sm font-medium">{fileName || t("CSV, TSV, XLS 또는 XLSX 파일을 선택하세요")}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("엑셀은 첫 번째 시트를 사용하며, 원본 파일은 업로드되지 않고 이 기기에서만 처리됩니다.")}</p>
            <label className="mt-4 inline-block cursor-pointer rounded-lg border px-4 py-2 text-sm">
              <input type="file" accept=".csv,.tsv,.xls,.xlsx,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={saving} onChange={(event) => void load(event.target.files?.[0])} />
              {t("파일 선택")}
            </label>
            {fileError && <p className="mt-3 text-sm text-red-600">{translateTradeText(fileError, t, formatNumber)}</p>}
          </section>

          {parsed && <>
            {mapping.accountName === undefined && <section className="rounded-xl border p-5"><label className="text-sm font-medium">{t("이 거래를 어느 계좌로 가져올까요?")}<select required className="mt-2 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)}><option value="">{t("계좌 추가 필요")}</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></section>}
            <section className="rounded-xl border p-5">
              <h3 className="font-semibold">{t("열 연결")}</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">{t("필수 열과 종목코드 또는 종목명 중 하나가 필요합니다.")}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...required, ...optional].map((field) => <label key={field} className="text-sm">
                  <span>{t(csvFieldLabels[field])}{required.includes(field) && " *"}</span>
                  <select className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={mapping[field] ?? ""} onChange={(event) => map(field, event.target.value)}>
                    <option value="">{t("연결 안 함")}</option>
                    {parsed.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}
                  </select>
                </label>)}
              </div>
              {(missing.length > 0 || !hasStockColumn) && <p className="mt-3 text-sm text-amber-700">{missing.length
                ? t("필수 열 미연결: {fields}", { fields: missing.map((field) => t(csvFieldLabels[field])).join(", ") })
                : t("종목코드 또는 종목명 열을 연결해 주세요.")}</p>}
            </section>

            <section className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <h3 className="font-semibold">{t("가져오기 미리보기")}</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("최대 10행을 표시합니다.")}</p>
                </div>
                {result && <div className="flex gap-2 text-xs">
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{t("추가 {count}", { count: formatNumber(result.trades.length) })}</span>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{t("중복 {count}", { count: formatNumber(result.skippedDuplicates) })}</span>
                  <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">{t("오류 {count}", { count: formatNumber(result.errors.length) })}</span>
                </div>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--surface-muted)]"><tr><th className="px-3 py-2">{t("행")}</th>{parsed.headers.map((header, index) => <th key={`${header}-${index}`} className="whitespace-nowrap px-3 py-2">{header}</th>)}</tr></thead>
                  <tbody>{parsed.rows.slice(0, 10).map((row, rowIndex) => <tr key={rowIndex} className="border-t"><td className="px-3 py-2">{formatNumber(rowIndex + 2)}</td>{parsed.headers.map((_, cellIndex) => <td key={cellIndex} className="max-w-48 truncate whitespace-nowrap px-3 py-2">{row[cellIndex]}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {result?.errors.length ? <div className="border-t p-4 text-sm text-red-600">
                {result.errors.slice(0, 5).map((error) => <p key={`${error.row}-${error.message}`}>{t("행 {row}: {message}", { row: formatNumber(error.row), message: translateTradeText(error.message, t, formatNumber) })}</p>)}
                {result.errors.length > 5 && <p>{t("외 {count}건", { count: formatNumber(result.errors.length - 5) })}</p>}
              </div> : null}
            </section>
          </>}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4">
          <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button>
          <button type="button" disabled={!result?.trades.length || saving} onClick={() => void submit()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-50">{saving ? t("저장 중...") : t("{count}건 가져오기", { count: formatNumber(result?.trades.length ?? 0) })}</button>
        </div>
      </div>
    </div>
  );
}
