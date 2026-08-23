import type { Stock } from "@/features/stocks/types";
import { portfolioPlanStateId, type PortfolioAllocationTarget, type PortfolioPlanRevision, type PortfolioPlanState } from "./types";

export function validatePortfolioPlanStateRecord(value: Record<string, unknown>) {
  if (value.id !== portfolioPlanStateId || value.activeRevisionId !== null && !nonEmptyString(value.activeRevisionId) || !timestamp(value.updatedAt)) throw new Error("포트폴리오 계획 상태가 올바르지 않습니다.");
}

export function validatePortfolioPlanRevisionRecord(value: Record<string, unknown>) {
  if (!nonEmptyString(value.id) || !Number.isInteger(value.revisionNumber) || Number(value.revisionNumber) <= 0) throw new Error("포트폴리오 계획 리비전 번호가 올바르지 않습니다.");
  if (value.basedOnRevisionId !== null && !nonEmptyString(value.basedOnRevisionId)) throw new Error("포트폴리오 계획 기반 리비전이 올바르지 않습니다.");
  if (value.targetAmountKrw !== undefined && value.targetAmountKrw !== null && (!Number.isSafeInteger(value.targetAmountKrw) || Number(value.targetAmountKrw) < 0)) throw new Error("포트폴리오 목표 운용 금액이 올바르지 않습니다.");
  if (typeof value.thesis !== "string" || typeof value.changeNote !== "string") throw new Error("포트폴리오 계획 근거가 올바르지 않습니다.");
  if (!timestamp(value.createdAt) || !timestamp(value.updatedAt) || value.activatedAt !== null && !timestamp(value.activatedAt)) throw new Error("포트폴리오 계획 일시가 올바르지 않습니다.");
}

export function validatePortfolioAllocationTargetRecord(value: Record<string, unknown>) {
  if (!nonEmptyString(value.id) || !nonEmptyString(value.revisionId)) throw new Error("포트폴리오 배분 대상 연결이 올바르지 않습니다.");
  if (!Number.isInteger(value.targetWeightBps) || Number(value.targetWeightBps) < 0 || Number(value.targetWeightBps) > 10000) throw new Error("포트폴리오 목표 비중이 올바르지 않습니다.");
  if (!Number.isInteger(value.sortOrder) || Number(value.sortOrder) < 0 || !timestamp(value.updatedAt)) throw new Error("포트폴리오 배분 순서가 올바르지 않습니다.");
  if (value.targetType === "stock") {
    if (!nonEmptyString(value.stockId)) throw new Error("포트폴리오 종목 연결이 올바르지 않습니다.");
  } else if (value.targetType === "cash") {
    if (value.stockId !== null) throw new Error("현금 목표에는 종목을 연결할 수 없습니다.");
  } else throw new Error("포트폴리오 배분 대상 유형이 올바르지 않습니다.");
}

export function validatePortfolioPlanCollections(input: {
  states: readonly PortfolioPlanState[];
  revisions: readonly PortfolioPlanRevision[];
  targets: readonly PortfolioAllocationTarget[];
  stocks: readonly Stock[];
}) {
  if (input.states.length > 1) throw new Error("포트폴리오 계획 상태는 하나만 존재할 수 있습니다.");
  input.states.forEach((value) => validatePortfolioPlanStateRecord(value as unknown as Record<string, unknown>));
  input.revisions.forEach((value) => validatePortfolioPlanRevisionRecord(value as unknown as Record<string, unknown>));
  input.targets.forEach((value) => validatePortfolioAllocationTargetRecord(value as unknown as Record<string, unknown>));
  assertUniqueIds(input.revisions, "포트폴리오 계획 리비전");
  assertUniqueIds(input.targets, "포트폴리오 배분 대상");
  if (new Set(input.revisions.map((revision) => revision.revisionNumber)).size !== input.revisions.length) throw new Error("포트폴리오 계획 리비전 번호가 중복됩니다.");
  const revisions = new Map(input.revisions.map((revision) => [revision.id, revision]));
  const stocks = new Set(input.stocks.map((stock) => stock.id));
  for (const revision of input.revisions) if (revision.basedOnRevisionId !== null && !revisions.has(revision.basedOnRevisionId)) throw new Error("기반 포트폴리오 계획 리비전이 존재하지 않습니다.");
  const activeId = input.states[0]?.activeRevisionId ?? null;
  if (input.revisions.length > 0 && activeId === null) throw new Error("저장된 포트폴리오 계획에는 활성 리비전이 필요합니다.");
  if (activeId !== null && !revisions.has(activeId)) throw new Error("활성 포트폴리오 계획 리비전이 존재하지 않습니다.");
  if (activeId !== null && revisions.get(activeId)?.activatedAt === null) throw new Error("활성 포트폴리오 계획 리비전에는 활성화 일시가 필요합니다.");
  const grouped = new Map<string, PortfolioAllocationTarget[]>();
  for (const target of input.targets) {
    if (!revisions.has(target.revisionId)) throw new Error("배분 대상의 포트폴리오 계획 리비전이 존재하지 않습니다.");
    if (target.targetType === "stock" && !stocks.has(target.stockId)) throw new Error("배분 대상 종목이 존재하지 않습니다.");
    grouped.set(target.revisionId, [...(grouped.get(target.revisionId) ?? []), target]);
  }
  for (const values of grouped.values()) {
    const stockIds = values.filter((target): target is Extract<PortfolioAllocationTarget, { targetType: "stock" }> => target.targetType === "stock").map((target) => target.stockId);
    if (new Set(stockIds).size !== stockIds.length) throw new Error("한 리비전에 같은 종목을 두 번 배분할 수 없습니다.");
    if (values.filter((target) => target.targetType === "cash").length > 1) throw new Error("한 리비전에 현금 목표는 하나만 둘 수 있습니다.");
  }
  for (const revision of input.revisions) {
    if (revision.activatedAt === null) continue;
    const values = grouped.get(revision.id) ?? [];
    if (!values.length) throw new Error("활성화된 포트폴리오 계획에 배분 대상이 없습니다.");
    if (values.reduce((sum, target) => sum + target.targetWeightBps, 0) !== 10000) throw new Error("활성 포트폴리오 계획의 목표 비중 합계는 100%여야 합니다.");
  }
}

function assertUniqueIds(values: readonly { id: string }[], label: string) {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new Error(`${label} ID가 중복됩니다.`);
}
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()); }
function timestamp(value: unknown) { return nonEmptyString(value) && Number.isFinite(Date.parse(value)); }
