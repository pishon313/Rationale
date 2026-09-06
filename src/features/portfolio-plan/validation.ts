import { currencies } from "@/domain/currency";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import {
  portfolioPlanStateId,
  type LegacyPortfolioAllocationTargetV6,
  type LegacyPortfolioPlanRevisionV6,
  type LegacyPortfolioPlanStateV6,
  type PortfolioAllocationGroup,
  type PortfolioAllocationTarget,
  type PortfolioBalancePolicy,
  type PortfolioPlanRepairDraft,
  type PortfolioPlanRevision,
  type PortfolioPlanState,
} from "./types";

export function validatePortfolioPlanStateRecord(value: Record<string, unknown>) {
  if (value.id !== portfolioPlanStateId || value.activeRevisionId !== null && !nonEmptyString(value.activeRevisionId)) throw new Error("포트폴리오 계획 상태가 올바르지 않습니다.");
  validateContributionAmount(value.contributionAmountMinor);
  if (!currencies.includes(value.contributionCurrency as typeof currencies[number])) throw new Error("포트폴리오 Contribution Currency가 올바르지 않습니다.");
  if (!timestamp(value.updatedAt)) throw new Error("포트폴리오 계획 상태가 올바르지 않습니다.");
  if (value.repairDraft !== undefined && value.repairDraft !== null) validatePortfolioPlanRepairDraft(value.repairDraft);
  if (value.balancePolicy !== undefined && value.balancePolicy !== null) validatePortfolioBalancePolicy(value.balancePolicy);
}

function validatePortfolioBalancePolicy(value: unknown): asserts value is PortfolioBalancePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Portfolio 전체 목표 비율이 올바르지 않습니다.");
  const policy = value as Partial<PortfolioBalancePolicy>;
  if (policy.version !== 1 || policy.mode !== "fixed" && policy.mode !== "balanceAssist" || !timestamp(policy.updatedAt)) throw new Error("Portfolio 전체 목표 비율이 올바르지 않습니다.");
  const weights = policy.targetWeightsBps;
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) throw new Error("Portfolio 전체 목표 비율이 올바르지 않습니다.");
  validateBps(weights.savings, "Portfolio 적금 목표 비율이 올바르지 않습니다.");
  validateBps(weights.stocks, "Portfolio 주식 목표 비율이 올바르지 않습니다.");
  validateBps(weights.bonds, "Portfolio 채권 목표 비율이 올바르지 않습니다.");
  if (weights.savings + weights.stocks + weights.bonds !== 10000) throw new Error("Portfolio 전체 목표 비율 합계는 100%여야 합니다.");
  validateBps(policy.toleranceBps, "Portfolio 허용 오차가 올바르지 않습니다.");
  if (policy.stockTargets !== undefined) {
    if (!Array.isArray(policy.stockTargets) || !policy.stockTargets.length) throw new Error("Portfolio 주식 세부 목표가 올바르지 않습니다.");
    const stockIds = new Set<string>();
    let total = 0;
    for (const target of policy.stockTargets) {
      if (!target || typeof target !== "object" || !nonEmptyString(target.stockId) || stockIds.has(target.stockId)) throw new Error("Portfolio 주식 세부 목표 종목이 올바르지 않습니다.");
      validateBps(target.targetWeightBps, "Portfolio 주식 세부 목표 비율이 올바르지 않습니다.");
      stockIds.add(target.stockId);
      total += target.targetWeightBps;
    }
    if (total !== 10000) throw new Error("Portfolio 주식 세부 목표 비율 합계는 100%여야 합니다.");
    validateBps(policy.stockToleranceBps, "Portfolio 주식 세부 허용 오차가 올바르지 않습니다.");
  } else if (policy.stockToleranceBps !== undefined) throw new Error("Portfolio 주식 세부 목표 없이 허용 오차를 저장할 수 없습니다.");
}

export function validatePortfolioPlanRevisionRecord(value: Record<string, unknown>) {
  if (!nonEmptyString(value.id) || !Number.isInteger(value.revisionNumber) || Number(value.revisionNumber) <= 0) throw new Error("포트폴리오 계획 리비전 번호가 올바르지 않습니다.");
  if (value.basedOnRevisionId !== null && !nonEmptyString(value.basedOnRevisionId)) throw new Error("포트폴리오 계획 기반 리비전이 올바르지 않습니다.");
  if (typeof value.thesis !== "string" || typeof value.changeNote !== "string") throw new Error("포트폴리오 계획 근거가 올바르지 않습니다.");
  if (!timestamp(value.createdAt) || !timestamp(value.updatedAt) || value.activatedAt !== null && !timestamp(value.activatedAt)) throw new Error("포트폴리오 계획 일시가 올바르지 않습니다.");
  if ("targetAmountKrw" in value) throw new Error("Contribution Amount는 포트폴리오 리비전에 저장할 수 없습니다.");
}

export function validatePortfolioAllocationGroupRecord(value: Record<string, unknown>) {
  if (!nonEmptyString(value.id) || !nonEmptyString(value.revisionId) || !nonEmptyString(value.name)) throw new Error("포트폴리오 Allocation Group이 올바르지 않습니다.");
  validateBps(value.targetWeightBps, "포트폴리오 Group Target Weight가 올바르지 않습니다.");
  validateOrderAndTimestamp(value, "포트폴리오 Allocation Group 순서가 올바르지 않습니다.");
}

export function validatePortfolioAllocationTargetRecord(value: Record<string, unknown>) {
  if (!nonEmptyString(value.id) || !nonEmptyString(value.revisionId) || !nonEmptyString(value.groupId) || value.accountId !== null && !nonEmptyString(value.accountId)) throw new Error("포트폴리오 배분 대상 연결이 올바르지 않습니다.");
  validateBps(value.weightWithinGroupBps, "포트폴리오 Group 내부 Target Weight가 올바르지 않습니다.");
  validateOrderAndTimestamp(value, "포트폴리오 배분 순서가 올바르지 않습니다.");
  if (value.targetType === "stock") {
    if (!nonEmptyString(value.stockId)) throw new Error("포트폴리오 종목 연결이 올바르지 않습니다.");
  } else if (value.targetType === "cash") {
    if (value.stockId !== null) throw new Error("현금 목표에는 종목을 연결할 수 없습니다.");
  } else throw new Error("포트폴리오 배분 대상 유형이 올바르지 않습니다.");
  if ("targetWeightBps" in value) throw new Error("Target의 전체 Portfolio 비중은 중복 저장할 수 없습니다.");
}

export function validatePortfolioPlanCollections(input: {
  states: readonly PortfolioPlanState[];
  revisions: readonly PortfolioPlanRevision[];
  groups: readonly PortfolioAllocationGroup[];
  targets: readonly PortfolioAllocationTarget[];
  stocks: readonly Stock[];
  accounts: readonly InvestmentAccount[];
}) {
  if (input.states.length > 1) throw new Error("포트폴리오 계획 상태는 하나만 존재할 수 있습니다.");
  input.states.forEach((value) => validatePortfolioPlanStateRecord(value as unknown as Record<string, unknown>));
  input.revisions.forEach((value) => validatePortfolioPlanRevisionRecord(value as unknown as Record<string, unknown>));
  input.groups.forEach((value) => validatePortfolioAllocationGroupRecord(value as unknown as Record<string, unknown>));
  input.targets.forEach((value) => validatePortfolioAllocationTargetRecord(value as unknown as Record<string, unknown>));
  assertUniqueIds(input.revisions, "포트폴리오 계획 리비전");
  assertUniqueIds(input.groups, "포트폴리오 Allocation Group");
  assertUniqueIds(input.targets, "포트폴리오 배분 대상");
  if (new Set(input.revisions.map((revision) => revision.revisionNumber)).size !== input.revisions.length) throw new Error("포트폴리오 계획 리비전 번호가 중복됩니다.");

  const revisions = new Map(input.revisions.map((revision) => [revision.id, revision]));
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const stocks = new Set(input.stocks.map((stock) => stock.id));
  const accounts = new Set(input.accounts.map((account) => account.id));
  for (const revision of input.revisions) if (revision.basedOnRevisionId !== null && !revisions.has(revision.basedOnRevisionId)) throw new Error("기반 포트폴리오 계획 리비전이 존재하지 않습니다.");
  const activeId = input.states[0]?.activeRevisionId ?? null;
  if (input.revisions.length > 0 && activeId === null) throw new Error("저장된 포트폴리오 계획에는 활성 리비전이 필요합니다.");
  if (activeId !== null && !revisions.has(activeId)) throw new Error("활성 포트폴리오 계획 리비전이 존재하지 않습니다.");
  if (activeId !== null && revisions.get(activeId)?.activatedAt === null) throw new Error("활성 포트폴리오 계획 리비전에는 활성화 일시가 필요합니다.");
  if (input.states[0]?.repairDraft && activeId !== null) throw new Error("계정 선택이 필요한 Portfolio repair draft는 활성화할 수 없습니다.");
  const repairDraft = input.states[0]?.repairDraft;
  if (repairDraft) {
    validateLegacyPortfolioPlanV6Collections({
      states: repairDraft.legacyState ? [repairDraft.legacyState] : [],
      revisions: repairDraft.legacyRevisions,
      targets: repairDraft.legacyTargets,
      stocks: input.stocks,
    });
    const legacyTargetIds = new Set(repairDraft.legacyTargets.map((target) => target.id));
    if (repairDraft.unresolvedTargetIds.some((id) => !legacyTargetIds.has(id))) throw new Error("Portfolio repair draft의 미지정 Target이 존재하지 않습니다.");
    const inferredMappings = Object.entries(repairDraft.inferredAccountIdsByTargetId ?? {});
    if (inferredMappings.some(([targetId, accountId]) => !legacyTargetIds.has(targetId) || !nonEmptyString(accountId))) throw new Error("Portfolio repair draft의 Account mapping이 올바르지 않습니다.");
    if (inferredMappings.some(([targetId]) => repairDraft.unresolvedTargetIds.includes(targetId))) throw new Error("Portfolio repair draft의 resolved/unresolved mapping이 충돌합니다.");
  }

  const groupsByRevision = new Map<string, PortfolioAllocationGroup[]>();
  for (const group of input.groups) {
    if (!revisions.has(group.revisionId)) throw new Error("Allocation Group의 포트폴리오 계획 리비전이 존재하지 않습니다.");
    groupsByRevision.set(group.revisionId, [...(groupsByRevision.get(group.revisionId) ?? []), group]);
  }
  const targetsByGroup = new Map<string, PortfolioAllocationTarget[]>();
  const targetsByRevision = new Map<string, PortfolioAllocationTarget[]>();
  for (const target of input.targets) {
    if (!revisions.has(target.revisionId)) throw new Error("배분 대상의 포트폴리오 계획 리비전이 존재하지 않습니다.");
    const group = groups.get(target.groupId);
    if (!group || group.revisionId !== target.revisionId) throw new Error("배분 대상의 Allocation Group이 존재하지 않습니다.");
    if (target.accountId !== null && !accounts.has(target.accountId)) throw new Error("배분 대상 계좌가 존재하지 않습니다.");
    if (target.targetType === "stock" && !stocks.has(target.stockId)) throw new Error("배분 대상 종목이 존재하지 않습니다.");
    targetsByGroup.set(target.groupId, [...(targetsByGroup.get(target.groupId) ?? []), target]);
    targetsByRevision.set(target.revisionId, [...(targetsByRevision.get(target.revisionId) ?? []), target]);
  }

  for (const revision of input.revisions) {
    const revisionGroups = groupsByRevision.get(revision.id) ?? [];
    if (!revisionGroups.length) throw new Error("포트폴리오 계획에는 Allocation Group이 하나 이상 필요합니다.");
    if (revisionGroups.reduce((sum, group) => sum + group.targetWeightBps, 0) !== 10000) throw new Error("Allocation Group Target Weight 합계는 100%여야 합니다.");
    const normalizedNames = revisionGroups.map((group) => normalizeGroupName(group.name));
    if (new Set(normalizedNames).size !== normalizedNames.length) throw new Error("한 리비전에 같은 Allocation Group 이름을 두 번 사용할 수 없습니다.");
    for (const group of revisionGroups) {
      const groupTargets = targetsByGroup.get(group.id) ?? [];
      if (!groupTargets.length && group.targetWeightBps > 0) throw new Error("0%보다 큰 Allocation Group에는 Target이 하나 이상 필요합니다.");
      if (!groupTargets.length) continue;
      if (groupTargets.reduce((sum, target) => sum + target.weightWithinGroupBps, 0) !== 10000) throw new Error("Group 내부 Target Weight 합계는 100%여야 합니다.");
    }
    const revisionTargets = targetsByRevision.get(revision.id) ?? [];
    const stockIds = revisionTargets.filter((target): target is Extract<PortfolioAllocationTarget, { targetType: "stock" }> => target.targetType === "stock").map((target) => target.stockId);
    if (new Set(stockIds).size !== stockIds.length) throw new Error("한 리비전에 같은 종목을 두 번 배분할 수 없습니다.");
    const cashAccounts = revisionTargets.filter((target) => target.targetType === "cash" && target.accountId !== null).map((target) => target.accountId);
    if (new Set(cashAccounts).size !== cashAccounts.length) throw new Error("한 리비전에 같은 계좌의 Cash Target을 두 번 배분할 수 없습니다.");
  }
}

export function validateNewPortfolioTargetReferences(targets: readonly PortfolioAllocationTarget[], stocks: readonly Stock[], accounts: readonly InvestmentAccount[]) {
  const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  for (const target of targets) {
    if (target.accountId === null) {
      if (target.targetType === "stock") {
        const stock = stockById.get(target.stockId);
        if (!stock) throw new Error("배분 대상 종목이 존재하지 않습니다.");
        if (stock.deletedAt) throw new Error("삭제된 종목은 새 Contribution Target에 사용할 수 없습니다.");
      }
      continue;
    }
    const account = accountById.get(target.accountId);
    if (!account) throw new Error("배분 대상 계좌가 존재하지 않습니다.");
    if (account.archivedAt) throw new Error("보관된 계좌는 새 Contribution Target에 사용할 수 없습니다.");
    if (target.targetType === "stock") {
      const stock = stockById.get(target.stockId);
      if (!stock) throw new Error("배분 대상 종목이 존재하지 않습니다.");
      if (stock.deletedAt) throw new Error("삭제된 종목은 새 Contribution Target에 사용할 수 없습니다.");
    }
  }
}

export function validateContributionAmount(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Contribution Amount는 0 이상의 안전한 minor-unit 정수여야 합니다.");
}

export function validateLegacyPortfolioPlanStateV6Record(value: Record<string, unknown>) {
  if (value.id !== portfolioPlanStateId || value.activeRevisionId !== null && !nonEmptyString(value.activeRevisionId) || !timestamp(value.updatedAt)) throw new Error("V6 포트폴리오 계획 상태가 올바르지 않습니다.");
}

export function validateLegacyPortfolioPlanRevisionV6Record(value: Record<string, unknown>) {
  const withoutAmount = { ...value };
  delete withoutAmount.targetAmountKrw;
  validatePortfolioPlanRevisionRecord(withoutAmount);
  if (value.targetAmountKrw !== undefined && value.targetAmountKrw !== null) validateContributionAmount(value.targetAmountKrw);
}

export function validateLegacyPortfolioAllocationTargetV6Record(value: Record<string, unknown>) {
  if (!nonEmptyString(value.id) || !nonEmptyString(value.revisionId)) throw new Error("V6 포트폴리오 배분 대상 연결이 올바르지 않습니다.");
  validateBps(value.targetWeightBps, "V6 포트폴리오 Target Weight가 올바르지 않습니다.");
  validateOrderAndTimestamp(value, "V6 포트폴리오 배분 순서가 올바르지 않습니다.");
  if (value.targetType === "stock") {
    if (!nonEmptyString(value.stockId)) throw new Error("V6 포트폴리오 종목 연결이 올바르지 않습니다.");
  } else if (value.targetType === "cash") {
    if (value.stockId !== null) throw new Error("V6 Cash Target에는 종목을 연결할 수 없습니다.");
  } else throw new Error("V6 포트폴리오 배분 대상 유형이 올바르지 않습니다.");
}

export function validateLegacyPortfolioPlanV6Collections(input: {
  states: readonly LegacyPortfolioPlanStateV6[];
  revisions: readonly LegacyPortfolioPlanRevisionV6[];
  targets: readonly LegacyPortfolioAllocationTargetV6[];
  stocks: readonly Stock[];
}) {
  if (input.states.length > 1) throw new Error("V6 포트폴리오 계획 상태는 하나만 존재할 수 있습니다.");
  input.states.forEach((value) => validateLegacyPortfolioPlanStateV6Record(value as unknown as Record<string, unknown>));
  input.revisions.forEach((value) => validateLegacyPortfolioPlanRevisionV6Record(value as unknown as Record<string, unknown>));
  input.targets.forEach((value) => validateLegacyPortfolioAllocationTargetV6Record(value as unknown as Record<string, unknown>));
  assertUniqueIds(input.revisions, "V6 포트폴리오 계획 리비전");
  assertUniqueIds(input.targets, "V6 포트폴리오 배분 대상");
  if (new Set(input.revisions.map((revision) => revision.revisionNumber)).size !== input.revisions.length) throw new Error("V6 포트폴리오 계획 리비전 번호가 중복됩니다.");
  const revisions = new Map(input.revisions.map((revision) => [revision.id, revision]));
  const stocks = new Set(input.stocks.map((stock) => stock.id));
  const activeId = input.states[0]?.activeRevisionId ?? null;
  if (input.revisions.length > 0 && activeId === null) throw new Error("저장된 V6 포트폴리오 계획에는 활성 리비전이 필요합니다.");
  if (activeId !== null && !revisions.has(activeId)) throw new Error("활성 V6 포트폴리오 계획 리비전이 존재하지 않습니다.");
  if (activeId !== null && revisions.get(activeId)?.activatedAt === null) throw new Error("활성 V6 포트폴리오 계획 리비전에는 활성화 일시가 필요합니다.");
  const grouped = new Map<string, LegacyPortfolioAllocationTargetV6[]>();
  for (const target of input.targets) {
    if (!revisions.has(target.revisionId)) throw new Error("V6 배분 대상의 리비전이 존재하지 않습니다.");
    if (target.targetType === "stock" && !stocks.has(target.stockId)) throw new Error("V6 배분 대상 종목이 존재하지 않습니다.");
    grouped.set(target.revisionId, [...(grouped.get(target.revisionId) ?? []), target]);
  }
  for (const revision of input.revisions) {
    const targets = grouped.get(revision.id) ?? [];
    if (!targets.length || targets.reduce((sum, target) => sum + target.targetWeightBps, 0) !== 10000) throw new Error("V6 포트폴리오 Target Weight 합계는 100%여야 합니다.");
    const stockIds = targets.filter((target): target is Extract<LegacyPortfolioAllocationTargetV6, { targetType: "stock" }> => target.targetType === "stock").map((target) => target.stockId);
    if (new Set(stockIds).size !== stockIds.length) throw new Error("V6 리비전에 같은 종목을 두 번 배분할 수 없습니다.");
    if (targets.filter((target) => target.targetType === "cash").length > 1) throw new Error("V6 리비전에 Cash Target은 하나만 둘 수 있습니다.");
  }
}

function validatePortfolioPlanRepairDraft(value: unknown): asserts value is PortfolioPlanRepairDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Portfolio repair draft가 올바르지 않습니다.");
  const draft = value as Partial<PortfolioPlanRepairDraft>;
  if (draft.version !== 1 || draft.status !== "needsAccountSelection" || !("legacyState" in draft) || !Array.isArray(draft.legacyRevisions) || !Array.isArray(draft.legacyTargets) || !Array.isArray(draft.unresolvedTargetIds)) throw new Error("Portfolio repair draft가 올바르지 않습니다.");
  if (draft.legacyState !== null) validateLegacyPortfolioPlanStateV6Record(draft.legacyState as unknown as Record<string, unknown>);
  draft.legacyRevisions.forEach((item) => validateLegacyPortfolioPlanRevisionV6Record(item as unknown as Record<string, unknown>));
  draft.legacyTargets.forEach((item) => validateLegacyPortfolioAllocationTargetV6Record(item as unknown as Record<string, unknown>));
  if (!draft.unresolvedTargetIds.length || draft.unresolvedTargetIds.some((id) => !nonEmptyString(id)) || new Set(draft.unresolvedTargetIds).size !== draft.unresolvedTargetIds.length) throw new Error("Portfolio repair draft의 미지정 Target이 올바르지 않습니다.");
  if (draft.inferredAccountIdsByTargetId !== undefined && (!draft.inferredAccountIdsByTargetId || typeof draft.inferredAccountIdsByTargetId !== "object" || Array.isArray(draft.inferredAccountIdsByTargetId) || Object.entries(draft.inferredAccountIdsByTargetId).some(([targetId, accountId]) => !nonEmptyString(targetId) || !nonEmptyString(accountId)))) throw new Error("Portfolio repair draft의 Account mapping이 올바르지 않습니다.");
}

function validateBps(value: unknown, message: string) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 10000) throw new Error(message);
}
function validateOrderAndTimestamp(value: Record<string, unknown>, message: string) {
  if (!Number.isInteger(value.sortOrder) || Number(value.sortOrder) < 0 || !timestamp(value.updatedAt)) throw new Error(message);
}
function assertUniqueIds(values: readonly { id: string }[], label: string) {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new Error(`${label} ID가 중복됩니다.`);
}
function normalizeGroupName(value: string) { return value.trim().replace(/\s+/g, " ").toLowerCase(); }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()); }
function timestamp(value: unknown) { return nonEmptyString(value) && Number.isFinite(Date.parse(value)); }
