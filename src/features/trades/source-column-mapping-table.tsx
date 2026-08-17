"use client";

import { columnReferenceKey, importFieldLabels } from "@/features/import/column-mapping";
import { ignoredImportantField, importFieldDefinitions, importFieldGroupLabels, type SourceColumnAssignment, type SourceColumnAssignmentTarget } from "@/features/import/source-column-mapping";
import type { ImportField } from "@/features/import/import-types";
import { useI18n } from "@/i18n/i18n-provider";

const originLabels = { profile: "프로필", automatic: "자동 연결", manual: "직접 연결", needs_review: "확인 필요", ignored: "가져오지 않음" } as const;
const importantIgnoredMessages: Partial<Record<ImportField, string>> = {
  time: "이 열은 시간 후보입니다. 제외하면 거래 순서 확인이 제한될 수 있습니다.", fee: "이 열은 수수료 후보입니다. 제외하면 수수료가 0으로 계산됩니다.", tax: "이 열은 세금 후보입니다. 제외하면 세금이 0으로 계산됩니다.", currency: "이 열은 통화 후보입니다. 제외하면 등록된 종목 통화를 사용합니다.", exchangeRate: "이 열은 환율 후보입니다. 제외하면 기존 환율 기준을 사용할 수 있습니다.", accountName: "이 열은 계좌 후보입니다. 제외하면 선택한 대상 계좌를 사용합니다.", externalExecutionId: "이 열은 체결 ID 후보입니다. 제외하면 보수적인 재가져오기 식별을 사용합니다.",
};

export function SourceColumnMappingTable({ assignments, onAssign, readOnly = false }: { assignments: SourceColumnAssignment[]; onAssign: (assignment: SourceColumnAssignment, target: SourceColumnAssignmentTarget) => void; readOnly?: boolean }) {
  const { t } = useI18n();
  const ownerByField = new Map<ImportField, SourceColumnAssignment>();
  for (const assignment of assignments) if (assignment.target !== "ignore") ownerByField.set(assignment.target, assignment);
  const headerCounts = new Map<string, number>();
  for (const assignment of assignments) headerCounts.set(assignment.column.reference.normalizedHeader, (headerCounts.get(assignment.column.reference.normalizedHeader) ?? 0) + 1);
  const groups = [...new Set(importFieldDefinitions.map((definition) => definition.group))];

  return <div className="overflow-x-auto">
    <table className="w-full min-w-[760px] text-left text-sm">
      <thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr><th className="px-4 py-3">{t("업로드 파일 열")}</th><th className="px-4 py-3">{t("예시 값")}</th><th className="px-4 py-3">{t("Rationale 필드")}</th><th className="px-4 py-3">{t("매핑 상태")}</th></tr></thead>
      <tbody>{assignments.map((assignment) => {
        const key = columnReferenceKey(assignment.column.reference);
        const duplicate = (headerCounts.get(assignment.column.reference.normalizedHeader) ?? 0) > 1;
        const displayHeader = duplicate ? `${assignment.column.label} (${assignment.column.reference.occurrence + 1})` : assignment.column.label;
        const important = ignoredImportantField(assignment);
        return <tr key={key} className="border-t align-top">
          <th scope="row" className="px-4 py-3 font-medium"><span title={assignment.column.label}>{displayHeader}</span>{important && <p className="mt-1 max-w-64 text-xs font-normal text-amber-700">{t(importantIgnoredMessages[important] ?? "")}</p>}</th>
          <td className="max-w-72 px-4 py-3"><div className="flex flex-wrap gap-1">{assignment.sampleValues.length ? assignment.sampleValues.map((value, index) => <span key={`${value}-${index}`} title={value} className="max-w-40 truncate rounded bg-[var(--surface-muted)] px-2 py-1 text-xs">{value}</span>) : <span className="text-[var(--muted)]">—</span>}</div></td>
          <td className="px-4 py-3"><label className="sr-only" htmlFor={`source-map-${key}`}>{t("{source} 열 매핑", { source: displayHeader })}</label><select id={`source-map-${key}`} aria-label={t("{source} 열 매핑", { source: displayHeader })} disabled={readOnly} className="h-10 w-full min-w-52 rounded-lg border bg-[var(--surface)] px-3 disabled:opacity-70" value={assignment.target} onChange={(event) => onAssign(assignment, event.target.value as SourceColumnAssignmentTarget)}><option value="ignore">{t("가져오지 않음")}</option>{groups.map((group) => <optgroup key={group} label={t(importFieldGroupLabels[group])}>{importFieldDefinitions.filter((definition) => definition.group === group).map((definition) => { const owner = ownerByField.get(definition.field); const disabled = Boolean(owner && owner !== assignment); return <option key={definition.field} value={definition.field} disabled={disabled}>{t(definition.label)}{disabled ? ` · ${t("{source} 열에서 사용 중", { source: owner?.column.label ?? "" })}` : ""}</option>; })}</optgroup>)}</select>{assignment.target === "grossAmount" && <p className="mt-1 max-w-64 text-xs text-[var(--muted)]">{t("수량 × 단가에 해당하는 총 거래대금입니다. 수수료·세금·정산금액을 포함한 순현금액을 연결하지 마세요.")}</p>}</td>
          <td className="px-4 py-3"><span>{t(originLabels[assignment.origin])}</span>{assignment.origin === "needs_review" && <p className="mt-1 text-xs text-[var(--muted)]">{t("추천: {fields}", { fields: assignment.suggestedTargets.map((field) => t(importFieldLabels[field])).join(", ") })}</p>}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
