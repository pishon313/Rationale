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

export const portfolioPlanCategories = ["savings", "stocks", "bonds"] as const;
export type PortfolioPlanCategory = (typeof portfolioPlanCategories)[number];

export type PortfolioPlanEditorGroup = {
  id: string;
  category: PortfolioPlanCategory;
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
  return {
    contributionAmountInput: "0",
    contributionCurrency: currency,
    groups: portfolioPlanCategories.map((category, sortOrder) => ({
      id: `default:${category}`,
      category,
      name: portfolioPlanCategoryName(category),
      weightInput: formatBpsInput([3000, 6000, 1000][sortOrder] ?? 0),
      sortOrder,
      targets: [],
    })),
    thesis: "",
    changeNote: "",
  };
}

export function portfolioPlanDraftFromActive(input: {
  state: PortfolioPlanState | null;
  revision: PortfolioPlanRevision | null;
  groups: readonly PortfolioAllocationGroup[];
  targets: readonly PortfolioAllocationTarget[];
  fallbackCurrency: Currency;
}) {
  if (!input.state || !input.revision) return emptyPortfolioPlanDraft(input.state?.contributionCurrency ?? input.fallbackCurrency);
  const savedGroups = input.groups.filter((group) => group.revisionId === input.revision?.id).slice().sort(byOrder).map((group) => ({
    id: group.id,
    name: group.name,
    weightInput: formatBpsInput(group.targetWeightBps),
    sortOrder: group.sortOrder,
    targets: input.targets.filter((target) => target.groupId === group.id && target.revisionId === input.revision?.id).slice().sort(byOrder).map((target) => ({
      id: target.id,
      targetType: target.targetType,
      stockId: target.stockId,
      accountId: target.accountId ?? "",
      weightInput: formatBpsInput(target.weightWithinGroupBps),
      sortOrder: target.sortOrder,
    })),
  }));
  const groups = normalizePortfolioPlanCategories(savedGroups);
  return {
    contributionAmountInput: formatMinorAmountInput(input.state.contributionAmountMinor, input.state.contributionCurrency),
    contributionCurrency: input.state.contributionCurrency,
    groups,
    thesis: input.revision.thesis,
    changeNote: "",
  } satisfies PortfolioPlanEditorDraft;
}

export function portfolioPlanCategoryName(category: PortfolioPlanCategory) {
  return category === "savings" ? "적금" : category === "stocks" ? "주식 투자" : "채권";
}

export function portfolioPlanCategoryTargetType(category: PortfolioPlanCategory): PortfolioPlanEditorTarget["targetType"] {
  return category === "savings" ? "cash" : "stock";
}

function normalizePortfolioPlanCategories(groups: Array<Omit<PortfolioPlanEditorGroup, "category">>): PortfolioPlanEditorGroup[] {
  const categorized = new Map<PortfolioPlanCategory, Array<Omit<PortfolioPlanEditorGroup, "category">>>();
  for (const group of groups) {
    const category = inferPortfolioPlanCategory(group);
    categorized.set(category, [...(categorized.get(category) ?? []), group]);
  }
  return portfolioPlanCategories.map((category, sortOrder) => {
    const members = categorized.get(category) ?? [];
    if (!members.length) return {
      id: `default:${category}`,
      category,
      name: portfolioPlanCategoryName(category),
      weightInput: "0",
      sortOrder,
      targets: [],
    };
    const targetWeightBps = members.reduce((sum, group) => sum + (parsePercentageToBps(group.weightInput) ?? 0), 0);
    return {
      id: members[0]!.id,
      category,
      name: portfolioPlanCategoryName(category),
      weightInput: formatBpsInput(targetWeightBps),
      sortOrder,
      targets: mergeCategoryTargets(members),
    };
  });
}

function inferPortfolioPlanCategory(group: Omit<PortfolioPlanEditorGroup, "category">): PortfolioPlanCategory {
  const name = normalizeText(group.name).toLocaleLowerCase().replace(/[\s_-]+/g, "");
  if (["savings", "saving", "deposit", "fixeddeposit", "적금", "저축", "예금"].some((value) => name.includes(value))) return "savings";
  if (["bonds", "bond", "채권"].some((value) => name.includes(value))) return "bonds";
  if (["stocks", "stock", "equity", "주식", "주식투자"].some((value) => name.includes(value))) return "stocks";
  if (group.targets.length > 0 && group.targets.every((target) => target.targetType === "cash")) return "savings";
  return "stocks";
}

function mergeCategoryTargets(groups: Array<Omit<PortfolioPlanEditorGroup, "category">>): PortfolioPlanEditorTarget[] {
  if (groups.length === 1) return groups[0]!.targets.slice().sort(byOrder).map((target, sortOrder) => ({ ...target, sortOrder }));
  const targets = groups.flatMap((group) => {
    const groupWeight = parsePercentageToBps(group.weightInput) ?? 0;
    return group.targets.slice().sort(byOrder).map((target) => ({ target, score: groupWeight * (parsePercentageToBps(target.weightInput) ?? 0) }));
  });
  if (!targets.length) return [];
  let scoreTotal = targets.reduce((sum, item) => sum + item.score, 0);
  if (scoreTotal === 0) {
    targets.forEach((item) => { item.score = parsePercentageToBps(item.target.weightInput) ?? 0; });
    scoreTotal = targets.reduce((sum, item) => sum + item.score, 0);
  }
  const weights = proportionalBps(targets.map((item) => item.score), scoreTotal);
  return targets.map(({ target }, sortOrder) => ({ ...target, weightInput: formatBpsInput(weights[sortOrder] ?? 0), sortOrder }));
}

function proportionalBps(scores: number[], total: number) {
  if (total <= 0) return scores.map((_, index) => index === 0 ? 10000 : 0);
  const rows = scores.map((score, index) => {
    const numerator = BigInt(score) * 10000n;
    return { index, weight: numerator / BigInt(total), remainder: numerator % BigInt(total) };
  });
  let remaining = 10000n - rows.reduce((sum, row) => sum + row.weight, 0n);
  const order = rows.slice().sort((left, right) => left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) order[index % order.length]!.weight += 1n;
  const values = new Array<number>(scores.length);
  rows.forEach((row) => { values[row.index] = Number(row.weight); });
  return values;
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
    if (weight !== null && weight > 0 && !group.targets.length) addError(fields, summary, `${groupPath}.targets`, "0%보다 큰 카테고리에는 하나 이상의 세부 항목을 추가해 주세요.");
    if (weight !== null) parsedGroups.push({ id: group.id, name, targetWeightBps: weight, sortOrder: groupIndex });

    let targetTotal = 0;
    group.targets.slice().sort(byOrder).forEach((target, targetIndex) => {
      const targetPath = `${groupPath}.targets.${target.id}`;
      const expectedType = portfolioPlanCategoryTargetType(group.category);
      if (target.targetType !== expectedType) addError(fields, summary, `${targetPath}.type`, "카테고리에 맞는 세부 항목을 추가해 주세요.");
      const targetWeight = parsePercentageToBps(target.weightInput);
      if (targetWeight === null) addError(fields, summary, `${targetPath}.weight`, "비중은 0%부터 100%까지 소수점 둘째 자리로 입력해 주세요.");
      else targetTotal += targetWeight;
      if (target.accountId && !activeAccounts.has(target.accountId)) addError(fields, summary, `${targetPath}.account`, "선택한 계좌를 사용할 수 없습니다.");
      if (target.targetType === "stock") {
        if (!target.stockId || !activeStocks.has(target.stockId)) addError(fields, summary, `${targetPath}.stock`, "등록된 종목을 선택해 주세요.");
        else if (stockIds.has(target.stockId)) addError(fields, summary, `${targetPath}.stock`, "한 리비전에 같은 종목을 두 번 추가할 수 없습니다.");
        else stockIds.add(target.stockId);
      } else if (target.accountId) {
        if (cashAccountIds.has(target.accountId)) addError(fields, summary, `${targetPath}.account`, "한 리비전에 같은 계좌의 Cash Target을 두 번 추가할 수 없습니다.");
        else cashAccountIds.add(target.accountId);
      }
      if (targetWeight !== null && (target.targetType === "cash" || target.stockId)) parsedTargets.push(target.targetType === "stock"
        ? { groupId: group.id, accountId: target.accountId || null, targetType: "stock", stockId: target.stockId as string, weightWithinGroupBps: targetWeight, sortOrder: targetIndex }
        : { groupId: group.id, accountId: target.accountId || null, targetType: "cash", stockId: null, weightWithinGroupBps: targetWeight, sortOrder: targetIndex });
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
        category: group.category,
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
