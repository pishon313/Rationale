import { currencyMinorUnitDigits, type Currency } from "@/domain/currency";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type {
  PortfolioAllocationGroup,
  PortfolioAllocationGroupDraft,
  PortfolioAllocationTarget,
  PortfolioAllocationTargetDraft,
  PortfolioPlanRepairDraft,
  PortfolioPlanRevision,
  PortfolioPlanState,
} from "./types";

export type PortfolioPlanEditorTarget = {
  id: string;
  targetType: "stock" | "cash";
  stockId: string | null;
  accountId: string;
  weightInput: string;
  sortOrder: number;
};

export type PortfolioPlanEditorGroup = {
  id: string;
  name: string;
  weightInput: string;
  sortOrder: number;
  targets: PortfolioPlanEditorTarget[];
};

export type PortfolioPlanEditorDraft = {
  contributionAmountInput: string;
  contributionCurrency: Currency;
  groups: PortfolioPlanEditorGroup[];
  thesis: string;
  changeNote: string;
};

export type ParsedPortfolioPlanDraft = {
  contributionAmountMinor: number;
  contributionCurrency: Currency;
  groups: PortfolioAllocationGroupDraft[];
  targets: PortfolioAllocationTargetDraft[];
  thesis: string;
  changeNote: string;
};

export type PortfolioPlanDraftValidation = {
  valid: boolean;
  fields: Record<string, string>;
  summary: string[];
  parsed: ParsedPortfolioPlanDraft | null;
};

export type PortfolioPlanChangeKind = "none" | "initial" | "contribution" | "revision";

export function parsePercentageToBps(input: string) {
  const value = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return bps <= 10000n ? Number(bps) : null;
}

export function formatBpsInput(bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error("PORTFOLIO_BPS_INVALID");
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function parseMajorAmountToMinor(input: string, currency: Currency) {
  const value = input.trim();
  const digits = currencyMinorUnitDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function formatMinorAmountInput(amountMinor: number, currency: Currency) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("CONTRIBUTION_AMOUNT_INVALID");
  const digits = currencyMinorUnitDigits(currency);
  if (!digits) return String(amountMinor);
  const value = String(amountMinor).padStart(digits + 1, "0");
  const fraction = value.slice(-digits).replace(/0+$/, "");
  return fraction ? `${value.slice(0, -digits)}.${fraction}` : value.slice(0, -digits);
}

export function formatEffectiveAllocation(groupBps: number, targetBps: number) {
  const millionthsOfPercent = groupBps * targetBps;
  const whole = Math.floor(millionthsOfPercent / 1_000_000);
  const fraction = String(millionthsOfPercent % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

export function emptyPortfolioPlanDraft(currency: Currency): PortfolioPlanEditorDraft {
  return { contributionAmountInput: "0", contributionCurrency: currency, groups: [], thesis: "", changeNote: "" };
}

export function portfolioPlanDraftFromActive(input: {
  state: PortfolioPlanState | null;
  revision: PortfolioPlanRevision | null;
  groups: readonly PortfolioAllocationGroup[];
  targets: readonly PortfolioAllocationTarget[];
  fallbackCurrency: Currency;
}) {
  if (!input.state || !input.revision) return emptyPortfolioPlanDraft(input.state?.contributionCurrency ?? input.fallbackCurrency);
  const groups = input.groups.filter((group) => group.revisionId === input.revision?.id).slice().sort(byOrder).map((group) => ({
    id: group.id,
    name: group.name,
    weightInput: formatBpsInput(group.targetWeightBps),
    sortOrder: group.sortOrder,
    targets: input.targets.filter((target) => target.groupId === group.id && target.revisionId === input.revision?.id).slice().sort(byOrder).map((target) => ({
      id: target.id,
      targetType: target.targetType,
      stockId: target.stockId,
      accountId: target.accountId,
      weightInput: formatBpsInput(target.weightWithinGroupBps),
      sortOrder: target.sortOrder,
    })),
  }));
  return {
    contributionAmountInput: formatMinorAmountInput(input.state.contributionAmountMinor, input.state.contributionCurrency),
    contributionCurrency: input.state.contributionCurrency,
    groups,
    thesis: input.revision.thesis,
    changeNote: "",
  } satisfies PortfolioPlanEditorDraft;
}

export function portfolioPlanRepairAccountMap(draft: PortfolioPlanRepairDraft) {
  return { ...(draft.inferredAccountIdsByTargetId ?? {}) };
}

export function validatePortfolioPlanEditorDraft(draft: PortfolioPlanEditorDraft, stocks: readonly Stock[], accounts: readonly InvestmentAccount[]): PortfolioPlanDraftValidation {
  const fields: Record<string, string> = {};
  const summary: string[] = [];
  const amount = parseMajorAmountToMinor(draft.contributionAmountInput, draft.contributionCurrency);
  if (amount === null) addError(fields, summary, "contributionAmount", "Contribution Amount 형식이 올바르지 않습니다.");
  if (!draft.groups.length) addError(fields, summary, "groups", "하나 이상의 Allocation Group을 추가해 주세요.");

  const parsedGroups: PortfolioAllocationGroupDraft[] = [];
  const parsedTargets: PortfolioAllocationTargetDraft[] = [];
  const names = new Set<string>();
  const stockIds = new Set<string>();
  const cashAccountIds = new Set<string>();
  const activeStocks = new Map(stocks.filter((stock) => !stock.deletedAt).map((stock) => [stock.id, stock]));
  const activeAccounts = new Map(accounts.filter((account) => !account.archivedAt).map((account) => [account.id, account]));
  let groupTotal = 0;

  draft.groups.slice().sort(byOrder).forEach((group, groupIndex) => {
    const name = normalizeText(group.name);
    const nameKey = name.toLocaleLowerCase();
    const groupPath = `groups.${group.id}`;
    if (!name) addError(fields, summary, `${groupPath}.name`, "Allocation Group 이름을 입력해 주세요.");
    else if (names.has(nameKey)) addError(fields, summary, `${groupPath}.name`, "Allocation Group 이름은 중복될 수 없습니다.");
    else names.add(nameKey);
    const weight = parsePercentageToBps(group.weightInput);
    if (weight === null) addError(fields, summary, `${groupPath}.weight`, "비중은 0%부터 100%까지 소수점 둘째 자리로 입력해 주세요.");
    else groupTotal += weight;
    if (!group.targets.length) addError(fields, summary, `${groupPath}.targets`, "각 Allocation Group에 하나 이상의 Target을 추가해 주세요.");
    if (weight !== null) parsedGroups.push({ id: group.id, name, targetWeightBps: weight, sortOrder: groupIndex });

    let targetTotal = 0;
    group.targets.slice().sort(byOrder).forEach((target, targetIndex) => {
      const targetPath = `${groupPath}.targets.${target.id}`;
      const targetWeight = parsePercentageToBps(target.weightInput);
      if (targetWeight === null) addError(fields, summary, `${targetPath}.weight`, "비중은 0%부터 100%까지 소수점 둘째 자리로 입력해 주세요.");
      else targetTotal += targetWeight;
      if (!target.accountId || !activeAccounts.has(target.accountId)) addError(fields, summary, `${targetPath}.account`, "활성 계좌를 선택해 주세요.");
      if (target.targetType === "stock") {
        if (!target.stockId || !activeStocks.has(target.stockId)) addError(fields, summary, `${targetPath}.stock`, "등록된 종목을 선택해 주세요.");
        else if (stockIds.has(target.stockId)) addError(fields, summary, `${targetPath}.stock`, "한 리비전에 같은 종목을 두 번 추가할 수 없습니다.");
        else stockIds.add(target.stockId);
      } else if (target.accountId) {
        if (cashAccountIds.has(target.accountId)) addError(fields, summary, `${targetPath}.account`, "한 리비전에 같은 계좌의 Cash Target을 두 번 추가할 수 없습니다.");
        else cashAccountIds.add(target.accountId);
      }
      if (targetWeight !== null && target.accountId && (target.targetType === "cash" || target.stockId)) parsedTargets.push(target.targetType === "stock"
        ? { groupId: group.id, accountId: target.accountId, targetType: "stock", stockId: target.stockId as string, weightWithinGroupBps: targetWeight, sortOrder: targetIndex }
        : { groupId: group.id, accountId: target.accountId, targetType: "cash", stockId: null, weightWithinGroupBps: targetWeight, sortOrder: targetIndex });
    });
    if (group.targets.length && targetTotal !== 10000) addError(fields, summary, `${groupPath}.targetTotal`, "Group 내부 Target 비중 합계는 정확히 100%여야 합니다.");
  });
  if (draft.groups.length && groupTotal !== 10000) addError(fields, summary, "groupTotal", "Allocation Group 비중 합계는 정확히 100%여야 합니다.");

  const valid = summary.length === 0 && amount !== null && parsedGroups.length === draft.groups.length && parsedTargets.length === draft.groups.reduce((count, group) => count + group.targets.length, 0);
  return {
    valid,
    fields,
    summary: [...new Set(summary)],
    parsed: valid ? { contributionAmountMinor: amount, contributionCurrency: draft.contributionCurrency, groups: parsedGroups, targets: parsedTargets, thesis: draft.thesis.trim(), changeNote: draft.changeNote.trim() } : null,
  };
}

export function classifyPortfolioPlanChanges(input: {
  draft: PortfolioPlanEditorDraft;
  saved: PortfolioPlanEditorDraft;
  hasActiveRevision: boolean;
}): PortfolioPlanChangeKind {
  if (!input.hasActiveRevision) return semanticEditor(input.draft).groups.length ? "initial" : "none";
  const current = semanticEditor(input.draft);
  const saved = semanticEditor(input.saved);
  if (JSON.stringify(current.revision) !== JSON.stringify(saved.revision)) return "revision";
  if (JSON.stringify(current.contribution) !== JSON.stringify(saved.contribution)) return "contribution";
  return "none";
}

function semanticEditor(draft: PortfolioPlanEditorDraft) {
  return {
    contribution: { amount: parseMajorAmountToMinor(draft.contributionAmountInput, draft.contributionCurrency) ?? `invalid:${draft.contributionAmountInput.trim()}`, currency: draft.contributionCurrency },
    revision: {
      thesis: draft.thesis.trim(),
      groups: draft.groups.slice().sort(byOrder).map((group) => ({
        name: normalizeText(group.name),
        weight: parsePercentageToBps(group.weightInput) ?? `invalid:${group.weightInput.trim()}`,
        targets: group.targets.slice().sort(byOrder).map((target) => ({ type: target.targetType, stockId: target.stockId, accountId: target.accountId, weight: parsePercentageToBps(target.weightInput) ?? `invalid:${target.weightInput.trim()}` })),
      })),
    },
    groups: draft.groups,
  };
}

function addError(fields: Record<string, string>, summary: string[], path: string, message: string) {
  fields[path] ??= message;
  summary.push(message);
}
function normalizeText(value: string) { return value.trim().replace(/\s+/g, " "); }
function byOrder(left: { sortOrder: number; id: string }, right: { sortOrder: number; id: string }) { return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id); }
