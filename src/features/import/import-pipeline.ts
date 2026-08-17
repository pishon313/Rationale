import { fallbackRatesToKrw, type Currency } from "@/domain/currency";
import Decimal from "decimal.js";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { validateTradeMutation } from "@/features/trades/trade-mutations";
import { tradeOriginOf, type Trade } from "@/features/trades/types";
import { resolveColumnIndex, validateImportMapping } from "./column-mapping";
import type { CanonicalExecution, ImportCandidate, ImportCandidateAction, ImportCandidateStatus, ImportContext, ImportField, ImportIssue, ImportIssueCode, ImportMapping, ImportMutationPlan, ImportPreview, ParsedTabularFile, PreparedBrokerLedgerRow } from "./import-types";

type ResolutionIndexes = {
  stocksByTicker: Map<string, Stock[]>;
  stocksByName: Map<string, Stock[]>;
  accountsByName: Map<string, InvestmentAccount[]>;
  activeAccountsById: Map<string, InvestmentAccount>;
};

type ResolvedExecution = {
  canonical: CanonicalExecution;
  stock: Stock;
  account: InvestmentAccount;
  currency: Currency;
  exchangeRate: number;
};

type ExistingTradeIndexes = {
  bySourceKey: Map<string, Trade[]>;
  byExternalExecution: Map<string, Trade[]>;
  possibleActive: Map<string, Trade[]>;
  activeIntraday: Set<string>;
};

type TrustedBatchIdentity = { key: string; accountId: string; externalExecutionId: string };
type ProvisionalCandidate = { candidate: ImportCandidate; sourceSequence: number; trustedIdentity: TrustedBatchIdentity | null; economicKey: string | null };
type PreviewBuildState = { occurrences: Map<string, number>; existing: ExistingTradeIndexes; indexes: ResolutionIndexes; importedAt: string };

export async function buildImportPreview(parsed: ParsedTabularFile, mapping: ImportMapping, context: ImportContext): Promise<ImportPreview> {
  const mappingIssues = validateImportMapping(mapping, parsed.columns);
  if (mappingIssues.some((issue) => issue.severity === "error")) return emptyPreview(mappingIssues);
  const importedAt = context.importedAt ?? new Date().toISOString();
  const importBatchId = context.importBatchId ?? `file:v1:batch:${crypto.randomUUID()}`;
  const provider = context.provider?.trim() || null;
  const indexes = buildResolutionIndexes(context.stocks, context.accounts);
  const state: PreviewBuildState = { occurrences: new Map(), existing: buildExistingTradeIndexes(context.existingTrades), indexes, importedAt };
  const provisional: ProvisionalCandidate[] = [];

  for (const [index, row] of parsed.rows.entries()) {
    const rowNumber = index + 2;
    const candidateId = await buildCandidateId(importBatchId, index, rowNumber);
    const trustedIdentity = probeTrustedIdentity(parsed, row, mapping, context.targetAccountId, indexes);
    try {
      const canonical = adaptTabularRow(parsed, row, rowNumber, index, mapping, importBatchId, provider);
      provisional.push(await buildCanonicalCandidate(canonical, candidateId, trustedIdentity, context.targetAccountId, state));
    } catch (error) {
      const importError = toImportError(error, rowNumber);
      importError.candidateId = candidateId;
      provisional.push({ candidate: { id: candidateId, row: rowNumber, status: "rejected", action: "none", selectedByDefault: false, matchedTradeIds: [], issues: [importError] }, sourceSequence: index, trustedIdentity, economicKey: null });
    }
  }

  return finalizePreview(provisional, mappingIssues, state.existing.activeIntraday);
}

export async function buildPreparedImportPreview(preparedRows: PreparedBrokerLedgerRow[], context: ImportContext): Promise<ImportPreview> {
  const importedAt = context.importedAt ?? new Date().toISOString();
  const state: PreviewBuildState = {
    occurrences: new Map(),
    existing: buildExistingTradeIndexes(context.existingTrades),
    indexes: buildResolutionIndexes(context.stocks, context.accounts),
    importedAt,
  };
  const importBatchId = context.importBatchId ?? `file:v1:batch:${crypto.randomUUID()}`;
  const provisional: ProvisionalCandidate[] = [];
  for (const prepared of preparedRows) {
    const candidateId = await buildCandidateId(importBatchId, prepared.sourceSequence, prepared.sourceRow);
    if (prepared.disposition !== "execution" || !prepared.execution) {
      const status: ImportCandidateStatus = prepared.disposition === "settlement_mirror" ? "excluded_settlement"
        : prepared.disposition === "non_trade_activity" ? "excluded_non_trade"
          : prepared.disposition === "unsupported_activity" ? "unsupported_activity" : "rejected";
      provisional.push({
        candidate: { id: candidateId, row: prepared.sourceRow, status, action: "none", selectedByDefault: false, matchedTradeIds: [], issues: prepared.issues.map((issue) => ({ ...issue, candidateId })), sourceActivity: prepared.activityLabel },
        sourceSequence: prepared.sourceSequence, trustedIdentity: null, economicKey: null,
      });
      continue;
    }
    try {
      const item = await buildCanonicalCandidate(prepared.execution, candidateId, null, context.targetAccountId, state);
      item.candidate.sourceActivity = prepared.activityLabel;
      item.candidate.issues.push(...prepared.issues.map((issue) => ({ ...issue, candidateId })));
      if (prepared.issues.some((issue) => issue.severity === "error")) {
        item.candidate.status = "rejected";
        item.candidate.action = "none";
      }
      provisional.push(item);
    } catch (error) {
      const importError = toImportError(error, prepared.sourceRow);
      importError.candidateId = candidateId;
      provisional.push({ candidate: { id: candidateId, row: prepared.sourceRow, status: "rejected", action: "none", selectedByDefault: false, matchedTradeIds: [], issues: [...prepared.issues.map((issue) => ({ ...issue, candidateId })), importError], sourceActivity: prepared.activityLabel }, sourceSequence: prepared.sourceSequence, trustedIdentity: null, economicKey: null });
    }
  }
  return finalizePreview(provisional, [], state.existing.activeIntraday);
}

async function buildCanonicalCandidate(canonical: CanonicalExecution, candidateId: string, trustedIdentity: TrustedBatchIdentity | null, targetAccountId: string | undefined, state: PreviewBuildState): Promise<ProvisionalCandidate> {
  const resolved = resolveExecution(canonical, targetAccountId, state.indexes);
  validatePriceEvidence(canonical, resolved.currency);
  const identity = sourceIdentityWithoutOccurrence(resolved);
  const occurrence = state.occurrences.get(identity) ?? 0;
  state.occurrences.set(identity, occurrence + 1);
  const sourceKey = canonical.externalExecutionId
    ? `file:v2:${await sha256(canonicalSerialize([canonical.adapter, resolved.account.id, canonical.externalExecutionId]))}`
    : `file:v2:${await sha256(canonicalSerialize([identity, occurrence]))}`;
  const tradeId = `import:${await sha256(sourceKey)}`;
  const trade = resolvedExecutionToTrade(resolved, sourceKey, tradeId, state.importedAt);
  const legacySourceKey = canonical.externalExecutionId
    ? `file:v1:${await sha256(`${canonical.provider ?? "generic-file"}|${resolved.account.id}|${canonical.externalExecutionId}`)}`
    : `file:v1:${await sha256(`${identity}|${occurrence}`)}`;
  const sourceMatches = uniqueTrades([
    ...(state.existing.bySourceKey.get(sourceKey) ?? []),
    ...(state.existing.bySourceKey.get(legacySourceKey) ?? []),
    ...(canonical.externalExecutionId ? state.existing.byExternalExecution.get(externalExecutionKey(resolved.account.id, canonical.externalExecutionId)) ?? [] : []),
  ]);
  const matchedTradeIds: string[] = [];
  let status: ImportCandidateStatus = "ready";
  let action: ImportCandidateAction = "insert";
  const issues: ImportIssue[] = [];
  if (sourceMatches.length > 1) {
    status = "source_conflict"; action = "none";
    matchedTradeIds.push(...sourceMatches.map((item) => item.id));
    issues.push(candidateIssue("IMPORT_SOURCE_IDENTITY_AMBIGUOUS", "error", canonical.sourceRow, candidateId));
  } else if (sourceMatches.length === 1) {
    const sameSource = sourceMatches[0];
    const sameEconomics = economicTradeKey(sameSource) === economicResolvedKey(resolved);
    if (!sameEconomics) { status = "source_conflict"; action = "none"; }
    else if (sameSource.deletedAt) { status = "previously_deleted"; action = "restore"; }
    else { status = "exact_duplicate"; action = "none"; }
    matchedTradeIds.push(sameSource.id);
    const code = status === "previously_deleted" ? "IMPORT_PREVIOUSLY_DELETED" : status === "exact_duplicate" ? "IMPORT_EXACT_DUPLICATE" : "IMPORT_SOURCE_CONFLICT";
    issues.push(candidateIssue(code, status === "source_conflict" ? "error" : status === "previously_deleted" ? "warning" : "info", canonical.sourceRow, candidateId));
  } else {
    const possibleMatches = state.existing.possibleActive.get(possibleResolvedKey(resolved)) ?? [];
    if (possibleMatches.length || (!canonical.externalExecutionId && occurrence > 0)) {
      status = "possible_duplicate"; action = "insert";
      matchedTradeIds.push(...possibleMatches.map((item) => item.id));
      issues.push(candidateIssue(occurrence > 0 ? "IMPORT_AMBIGUOUS_IDENTICAL_ROW" : "IMPORT_POSSIBLE_DUPLICATE", "warning", canonical.sourceRow, candidateId));
    }
  }
  if (canonical.timePrecision === "date") issues.push(candidateIssue("IMPORT_TIME_MISSING", "warning", canonical.sourceRow, candidateId));
  if (canonical.currency === null) issues.push(candidateIssue("IMPORT_CURRENCY_FALLBACK", "info", canonical.sourceRow, candidateId));
  if (canonical.exchangeRate === null && resolved.currency !== "KRW") issues.push(candidateIssue("IMPORT_EXCHANGE_RATE_FALLBACK", "warning", canonical.sourceRow, candidateId));
  if (canonical.priceEvidence?.kind === "gross_amount_divided_by_quantity") issues.push({ ...candidateIssue("IMPORT_PRICE_DERIVED_FROM_GROSS_AMOUNT", "warning", canonical.sourceRow, candidateId), details: { grossAmount: canonical.priceEvidence.grossAmount ?? 0, quantity: canonical.quantity, derivedPrice: canonical.price } });
  return { candidate: { id: candidateId, row: canonical.sourceRow, status, action, selectedByDefault: false, execution: canonical, trade, matchedTradeIds, issues }, sourceSequence: canonical.sourceSequence, trustedIdentity, economicKey: economicResolvedKey(resolved) };
}

function finalizePreview(provisional: ProvisionalCandidate[], leadingIssues: ImportIssue[], existingIntraday: ReadonlySet<string>): ImportPreview {
  reconcileTrustedGroups(provisional);
  const candidates = provisional.map((item) => item.candidate);
  blockAmbiguousDateOnlyOrdering(candidates, existingIntraday);
  for (const candidate of candidates) candidate.selectedByDefault = candidate.status === "ready" && candidate.action === "insert";
  const issues = [...leadingIssues, ...candidates.flatMap((candidate) => candidate.issues)];
  return { candidates, issues, requiresTimezoneConfirmation: false, summary: summarize(candidates) };
}

export function preflightImport(preview: ImportPreview, selectedIds: ReadonlySet<string>, context: Pick<ImportContext, "existingTrades" | "accounts">) {
  const selected = preview.candidates.filter((candidate) => selectedIds.has(candidate.id) && candidate.trade && candidate.action !== "none");
  if (!selected.length) return { ok: false as const, plan: emptyPlan(context.existingTrades), issues: [{ code: "IMPORT_NOTHING_SELECTED", severity: "error" } satisfies ImportIssue] };
  const planResult = buildImportMutationPlan(selected, context.existingTrades);
  if (!planResult.ok) return { ok: false as const, plan: emptyPlan(context.existingTrades), issues: [planResult.issue] };
  const validation = validateTradeMutation(context.existingTrades, planResult.plan.nextTrades, context.accounts);
  if (!validation.ok) {
    const candidate = selected.find((item) => item.trade && validation.error.includes(item.trade.id));
    return { ok: false as const, plan: planResult.plan, issues: [{ code: "IMPORT_LEDGER_CONFLICT", severity: "error", ...(candidate ? { row: candidate.row, candidateId: candidate.id } : {}), details: { reason: validation.error } } satisfies ImportIssue] };
  }
  return { ok: true as const, plan: planResult.plan, issues: [] as ImportIssue[] };
}

export function buildImportMutationPlan(selected: ImportCandidate[], existingTrades: Trade[]): { ok: true; plan: ImportMutationPlan } | { ok: false; issue: ImportIssue } {
  const latestById = new Map<string, Trade>();
  for (const trade of existingTrades) {
    if (latestById.has(trade.id)) return { ok: false, issue: { code: "IMPORT_PREVIEW_STALE", severity: "error", details: { reason: "중복된 거래 ID가 있습니다." } } };
    latestById.set(trade.id, trade);
  }
  const indexes = buildExistingTradeIndexes(existingTrades);
  const insertedTrades: Trade[] = [];
  const restoredTradeIds: string[] = [];
  const restored = new Map<string, Trade>();
  const selectedIds = new Set<string>();
  const selectedTradeIds = new Set<string>();
  for (const candidate of selected) {
    if (!candidate.trade || candidate.action === "none" || selectedIds.has(candidate.id)) return staleIssue(candidate);
    selectedIds.add(candidate.id);
    if (selectedTradeIds.has(candidate.trade.id)) return staleIssue(candidate);
    selectedTradeIds.add(candidate.trade.id);
    if (candidate.action === "restore") {
      if (candidate.matchedTradeIds.length !== 1) return staleIssue(candidate);
      const current = latestById.get(candidate.matchedTradeIds[0]);
      if (!current?.deletedAt || economicTradeKey(current) !== economicTradeKey(candidate.trade)) return staleIssue(candidate);
      restoredTradeIds.push(current.id);
      restored.set(current.id, { ...current, deletedAt: null, updatedAt: new Date().toISOString() });
      continue;
    }
    const origin = tradeOriginOf(candidate.trade);
    const matches = uniqueTrades([
      ...(origin.sourceKey ? indexes.bySourceKey.get(origin.sourceKey) ?? [] : []),
      ...(origin.externalExecutionId && candidate.trade.accountId ? indexes.byExternalExecution.get(externalExecutionKey(candidate.trade.accountId, origin.externalExecutionId)) ?? [] : []),
    ]);
    if (matches.length) return staleIssue(candidate);
    if (latestById.has(candidate.trade.id) || restored.has(candidate.trade.id)) return staleIssue(candidate);
    insertedTrades.push(candidate.trade);
    latestById.set(candidate.trade.id, candidate.trade);
  }
  const nextTrades = [...insertedTrades, ...existingTrades.map((trade) => restored.get(trade.id) ?? trade)];
  if (new Set(nextTrades.map((trade) => trade.id)).size !== nextTrades.length) return { ok: false, issue: { code: "IMPORT_PREVIEW_STALE", severity: "error", details: { reason: "중복된 거래 ID가 있습니다." } } };
  return { ok: true, plan: { insertedTrades, restoredTradeIds, nextTrades } };
}

function staleIssue(candidate: ImportCandidate): { ok: false; issue: ImportIssue } {
  return { ok: false, issue: { code: "IMPORT_PREVIEW_STALE", severity: "error", row: candidate.row, candidateId: candidate.id } };
}

function emptyPlan(existingTrades: Trade[]): ImportMutationPlan { return { insertedTrades: [], restoredTradeIds: [], nextTrades: existingTrades }; }

export function adaptTabularRow(parsed: ParsedTabularFile, row: string[], rowNumber: number, sourceSequence: number, mapping: ImportMapping, importBatchId: string, provider: string | null): CanonicalExecution {
  const dateTime = parseExecutionDateTime(cell(parsed, row, mapping.tradedAt), cell(parsed, row, mapping.time));
  const currencyValue = cell(parsed, row, mapping.currency);
  const rateValue = cell(parsed, row, mapping.exchangeRate);
  const quantityDecimal = parsePositiveDecimal(cell(parsed, row, mapping.quantity), "quantity");
  const directPriceValue = cell(parsed, row, mapping.price);
  const grossAmountValue = cell(parsed, row, mapping.grossAmount);
  const directPrice = directPriceValue ? parsePositiveDecimal(directPriceValue, "price") : null;
  const grossAmount = grossAmountValue ? parsePositiveDecimal(grossAmountValue, "grossAmount") : null;
  if (!directPrice && !grossAmount) throw importFailure("IMPORT_NON_POSITIVE_NUMBER", "price");
  const price = directPrice ?? grossAmount!.div(quantityDecimal);
  if (!price.isFinite() || !price.greaterThan(0)) throw importFailure("IMPORT_NON_POSITIVE_NUMBER", "price");
  return {
    importBatchId, adapter: "generic-tabular-v1", sourceRow: rowNumber, sourceSequence, provider,
    externalAccountReference: cell(parsed, row, mapping.accountName) || null,
    externalExecutionId: cell(parsed, row, mapping.externalExecutionId) || null,
    externalOrderId: cell(parsed, row, mapping.orderId) || null,
    ticker: cell(parsed, row, mapping.ticker) || null,
    stockName: cell(parsed, row, mapping.stockName) || null,
    market: null,
    side: parseSide(cell(parsed, row, mapping.tradeType)), executedAt: dateTime.value, timePrecision: dateTime.timePrecision,
    quantity: quantityDecimal.toNumber(),
    price: price.toNumber(),
    priceEvidence: directPrice
      ? { kind: "direct", ...(grossAmount ? { grossAmount: grossAmount.toNumber() } : {}) }
      : { kind: "gross_amount_divided_by_quantity", grossAmount: grossAmount!.toNumber() },
    fee: parseNonNegativeNumber(cell(parsed, row, mapping.fee), "fee"),
    feeProvided: resolveColumnIndex(parsed.columns, mapping.fee) !== undefined,
    tax: parseNonNegativeNumber(cell(parsed, row, mapping.tax), "tax"),
    currency: currencyValue ? parseCurrency(currencyValue) : null,
    exchangeRate: rateValue ? parsePositiveNumber(rateValue, "exchangeRate") : null,
  };
}

export function parseExecutionDateTime(dateValue: string, timeValue = "") {
  if (!dateValue.trim()) throw importFailure("IMPORT_DATE_MISSING", "tradedAt");
  const raw = dateValue.trim();
  let year = 0; let month = 0; let day = 0; let embeddedTime = "";
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[T\s]+(.+))?$/);
  const yearFirst = raw.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:[T\s]+(.+))?$/);
  const dayOrMonthFirst = raw.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})(?:[T\s]+(.+))?$/);
  if (compact) { year = Number(compact[1]); month = Number(compact[2]); day = Number(compact[3]); embeddedTime = compact[4] ?? ""; }
  else if (yearFirst) { year = Number(yearFirst[1]); month = Number(yearFirst[3]); day = Number(yearFirst[4]); embeddedTime = yearFirst[5] ?? ""; }
  else if (dayOrMonthFirst) {
    const first = Number(dayOrMonthFirst[1]); const second = Number(dayOrMonthFirst[3]); year = Number(dayOrMonthFirst[4]); embeddedTime = dayOrMonthFirst[5] ?? "";
    if (first <= 12 && second <= 12) throw importFailure("IMPORT_AMBIGUOUS_DATE", "tradedAt");
    if (first > 12 && second <= 12) { day = first; month = second; }
    else if (second > 12 && first <= 12) { month = first; day = second; }
    else throw importFailure("IMPORT_INVALID_DATE", "tradedAt");
  } else throw importFailure("IMPORT_INVALID_DATE", "tradedAt");
  if (!isValidCalendarDate(year, month, day)) throw importFailure("IMPORT_INVALID_DATE", "tradedAt");
  const embedded = embeddedTime.trim() ? parseSourceTime(embeddedTime.trim()) : null;
  const separate = timeValue.trim() ? parseSourceTime(timeValue.trim()) : null;
  if (embedded?.hasTimezone || separate?.hasTimezone) throw importFailure("IMPORT_UNSUPPORTED_TIMEZONE", "time");
  if (embedded && separate && embedded.clock !== separate.clock) throw importFailure("IMPORT_TIME_CONFLICT", "time");
  const normalized = separate ?? embedded ?? { clock: "09:00:00", hasTimezone: false, precision: "date" as const };
  const timePrecision = embedded && separate
    ? embedded.precision === "second" || separate.precision === "second" ? "second" : "minute"
    : normalized.precision;
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { value: `${date}T${normalized.clock}`, timePrecision } as const;
}

function parseSourceTime(value: string) {
  const normalized = normalizeTime(value);
  if (!normalized) throw importFailure("IMPORT_INVALID_TIME", "time");
  return { ...normalized, precision: isMinuteTime(value) ? "minute" as const : "second" as const };
}

function isMinuteTime(value: string) { return /^\d{4}$|^\d{1,2}:\d{2}(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/i.test(value); }

function normalizeTime(value: string): { clock: string; hasTimezone: boolean } | null {
  let hours = 0; let minutes = 0; let seconds = 0; let timezone = "";
  if (/^\d{6}$/.test(value)) { hours = Number(value.slice(0, 2)); minutes = Number(value.slice(2, 4)); seconds = Number(value.slice(4, 6)); }
  else if (/^\d{4}$/.test(value)) { hours = Number(value.slice(0, 2)); minutes = Number(value.slice(2, 4)); }
  else {
    const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!match) return null;
    hours = Number(match[1]); minutes = Number(match[2]); seconds = Number(match[3] ?? 0); timezone = match[4] ?? "";
    if (timezone && timezone !== "Z" && timezone.toLowerCase() !== "z") {
      const compact = timezone.replace(":", ""); const offsetHours = Number(compact.slice(1, 3)); const offsetMinutes = Number(compact.slice(3, 5));
      if (offsetHours > 23 || offsetMinutes > 59) return null;
    }
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return { clock: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`, hasTimezone: Boolean(timezone) };
}

function buildResolutionIndexes(stocks: Stock[], accounts: InvestmentAccount[]): ResolutionIndexes {
  const indexes: ResolutionIndexes = { stocksByTicker: new Map(), stocksByName: new Map(), accountsByName: new Map(), activeAccountsById: new Map() };
  for (const stock of stocks.filter((item) => !item.deletedAt)) {
    addIndex(indexes.stocksByTicker, normalizeTicker(stock.ticker), stock);
    addIndex(indexes.stocksByName, normalizeName(stock.name), stock);
  }
  for (const account of accounts) {
    addIndex(indexes.accountsByName, normalizeName(account.name), account);
    if (!account.archivedAt) indexes.activeAccountsById.set(account.id, account);
  }
  return indexes;
}

function buildExistingTradeIndexes(trades: Trade[]): ExistingTradeIndexes {
  const result: ExistingTradeIndexes = { bySourceKey: new Map(), byExternalExecution: new Map(), possibleActive: new Map(), activeIntraday: new Set() };
  for (const trade of trades) {
    const origin = tradeOriginOf(trade);
    if (origin.sourceKey) addIndex(result.bySourceKey, origin.sourceKey, trade);
    if (origin.kind === "fileImport" && origin.externalExecutionId && trade.accountId) addIndex(result.byExternalExecution, externalExecutionKey(trade.accountId, origin.externalExecutionId), trade);
    if (!trade.deletedAt && (trade.tradeType === "매수" || trade.tradeType === "매도")) {
      addIndex(result.possibleActive, possibleTradeKey(trade), trade);
      result.activeIntraday.add(intradayKey(trade));
    }
  }
  return result;
}

function probeTrustedIdentity(parsed: ParsedTabularFile, row: string[], mapping: ImportMapping, targetAccountId: string | undefined, indexes: ResolutionIndexes): TrustedBatchIdentity | null {
  const externalExecutionId = cell(parsed, row, mapping.externalExecutionId).trim();
  if (!externalExecutionId) return null;
  try {
    const account = resolveAccount(cell(parsed, row, mapping.accountName) || null, targetAccountId, indexes);
    return { key: canonicalSerialize(["generic-tabular-v1", account.id, externalExecutionId]), accountId: account.id, externalExecutionId };
  } catch {
    return null;
  }
}

function reconcileTrustedGroups(provisional: ProvisionalCandidate[]) {
  const groups = new Map<string, ProvisionalCandidate[]>();
  for (const item of provisional) if (item.trustedIdentity) addIndex(groups, item.trustedIdentity.key, item);
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((left, right) => left.sourceSequence - right.sourceSequence);
    const invalidMember = members.some((item) => !item.economicKey || !item.candidate.trade || item.candidate.status === "rejected");
    const economics = new Set(members.flatMap((item) => item.economicKey ? [item.economicKey] : []));
    const existingConflict = members.some((item) => item.candidate.status === "source_conflict");
    if (invalidMember || economics.size !== 1 || existingConflict) {
      for (const item of members) {
        const candidate = item.candidate;
        if (candidate.status !== "rejected") candidate.status = "source_conflict";
        candidate.action = "none";
        candidate.selectedByDefault = false;
        candidate.issues.push(candidateIssue("IMPORT_BATCH_SOURCE_IDENTITY_CONFLICT", "error", candidate.row, candidate.id));
      }
      continue;
    }
    const representative = members[0].candidate;
    for (const item of members.slice(1)) {
      const candidate = item.candidate;
      candidate.status = "exact_duplicate";
      candidate.action = "none";
      candidate.selectedByDefault = false;
      candidate.issues.push({ ...candidateIssue("IMPORT_BATCH_EXACT_DUPLICATE", "info", candidate.row, candidate.id), details: { duplicateOfRow: representative.row } });
    }
  }
}

function resolveExecution(canonical: CanonicalExecution, targetAccountId: string | undefined, indexes: ResolutionIndexes): ResolvedExecution {
  const tickerMatches = canonical.ticker ? indexes.stocksByTicker.get(normalizeTicker(canonical.ticker)) ?? [] : [];
  const nameMatches = canonical.stockName ? indexes.stocksByName.get(normalizeName(canonical.stockName)) ?? [] : [];
  if (tickerMatches.length > 1 || nameMatches.length > 1) throw importFailure("IMPORT_AMBIGUOUS_INSTRUMENT", "ticker");
  if (tickerMatches[0] && nameMatches[0] && tickerMatches[0].id !== nameMatches[0].id) throw importFailure("IMPORT_INSTRUMENT_CONFLICT", "ticker");
  const stock = tickerMatches[0] ?? nameMatches[0];
  if (!stock) throw importFailure("IMPORT_INSTRUMENT_NOT_FOUND", "ticker");
  const account = resolveAccount(canonical.externalAccountReference, targetAccountId, indexes);
  if (canonical.currency && canonical.currency !== stock.currency) throw importFailure("IMPORT_CURRENCY_CONFLICT", "currency");
  const currency = stock.currency;
  const exchangeRate = currency === "KRW" ? 1 : canonical.exchangeRate ?? fallbackRatesToKrw[currency];
  return { canonical, stock, account, currency, exchangeRate };
}

function validatePriceEvidence(canonical: CanonicalExecution, currency: Currency) {
  if (canonical.priceEvidence?.kind !== "direct" || canonical.priceEvidence.grossAmount === undefined) return;
  const expected = new Decimal(canonical.price).times(canonical.quantity);
  const actual = new Decimal(canonical.priceEvidence.grossAmount);
  const absoluteTolerance = new Decimal(currency === "KRW" || currency === "JPY" ? 1 : 0.01);
  const relativeTolerance = Decimal.max(expected.abs(), actual.abs()).times("0.000000001");
  if (expected.minus(actual).abs().greaterThan(Decimal.max(absoluteTolerance, relativeTolerance))) throw importFailure("IMPORT_PRICE_AMOUNT_CONFLICT", "grossAmount");
}

function resolveAccount(externalAccountReference: string | null, targetAccountId: string | undefined, indexes: ResolutionIndexes) {
  let account: InvestmentAccount | undefined;
  if (externalAccountReference) {
    const matches = indexes.accountsByName.get(normalizeName(externalAccountReference)) ?? [];
    if (matches.length > 1) throw importFailure("IMPORT_AMBIGUOUS_ACCOUNT", "accountName");
    if (!matches.length) throw importFailure("IMPORT_ACCOUNT_NOT_FOUND", "accountName");
    if (matches[0].archivedAt) throw importFailure("IMPORT_ARCHIVED_ACCOUNT", "accountName");
    account = matches[0];
  } else account = targetAccountId ? indexes.activeAccountsById.get(targetAccountId) : undefined;
  if (!account) throw importFailure("IMPORT_ACCOUNT_REQUIRED", "accountName");
  return account;
}

function resolvedExecutionToTrade(resolved: ResolvedExecution, sourceKey: string, id: string, importedAt: string): Trade {
  const { canonical, stock, account, currency, exchangeRate } = resolved;
  return {
    id, stockId: stock.id, stockName: stock.name, planId: null, tradeType: canonical.side === "buy" ? "매수" : "매도",
    tradedAt: canonical.executedAt, quantity: canonical.quantity, price: canonical.price, currency, exchangeRate,
    fee: canonical.fee, feeMode: canonical.feeProvided ? "sourceProvided" : "unknown", feeCalculation: null,
    tax: canonical.tax, accountId: account.id, accountName: account.name,
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3,
    ruleViolations: [], journalStatus: "unreviewed",
    origin: {
      kind: "fileImport", sourceKey, importBatchId: canonical.importBatchId, importedAt, sourceRow: canonical.sourceRow,
      timePrecision: canonical.timePrecision,
      ...(canonical.provider ? { provider: canonical.provider } : {}),
      ...(canonical.externalExecutionId ? { externalExecutionId: canonical.externalExecutionId } : {}),
      ...(canonical.externalOrderId ? { externalOrderId: canonical.externalOrderId } : {}),
    },
    createdAt: importedAt, updatedAt: importedAt, deletedAt: null,
  };
}

function sourceIdentityWithoutOccurrence(resolved: ResolvedExecution) {
  const { canonical, account, stock, currency } = resolved;
  return [account.id, stock.id, canonical.executedAt, canonical.side, canonical.quantity, canonical.price, currency].join("|");
}

function economicResolvedKey(resolved: ResolvedExecution) {
  const { canonical, account, stock, currency, exchangeRate } = resolved;
  return [canonical.executedAt, account.id, stock.id, canonical.side, canonical.quantity, canonical.price, canonical.fee, canonical.tax, currency, exchangeRate].join("|");
}

function economicTradeKey(trade: Trade) {
  return [withSeconds(trade.tradedAt), trade.accountId ?? trade.accountName, trade.stockId, trade.tradeType === "매수" ? "buy" : "sell", trade.quantity, trade.price, trade.fee, trade.tax, trade.currency, trade.exchangeRate].join("|");
}

function possibleResolvedKey(resolved: ResolvedExecution) {
  const { canonical, account, stock, currency } = resolved;
  return [account.id, stock.id, canonical.executedAt, canonical.side, canonical.quantity, canonical.price, currency].join("|");
}

function possibleTradeKey(trade: Trade) {
  return [trade.accountId, trade.stockId, withSeconds(trade.tradedAt), trade.tradeType === "매수" ? "buy" : "sell", trade.quantity, trade.price, trade.currency].join("|");
}

function externalExecutionKey(accountId: string, externalExecutionId: string) { return canonicalSerialize([accountId, externalExecutionId.trim()]); }
function canonicalSerialize(values: Array<string | number>) { return JSON.stringify(values); }
async function buildCandidateId(importBatchId: string, sourceSequence: number, sourceRow: number) { return `candidate:v1:${await sha256(canonicalSerialize([importBatchId, sourceSequence, sourceRow]))}`; }
function uniqueTrades(trades: Trade[]) { return [...new Map(trades.map((trade) => [trade.id, trade])).values()]; }

function intradayKey(trade: Trade) { return [trade.accountId, trade.stockId, trade.tradedAt.slice(0, 10)].join("|"); }

function blockAmbiguousDateOnlyOrdering(candidates: ImportCandidate[], existingIntraday: ReadonlySet<string>) {
  const candidateCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.trade || candidate.action === "none") continue;
    const key = intradayKey(candidate.trade);
    candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1);
  }
  const dateCandidates = candidates.filter((candidate) => candidate.execution?.timePrecision === "date" && candidate.trade && (candidate.status === "ready" || candidate.status === "possible_duplicate"));
  for (const candidate of dateCandidates) {
    const key = intradayKey(candidate.trade as Trade);
    if ((candidateCounts.get(key) ?? 0) < 2 && !existingIntraday.has(key)) continue;
    candidate.status = "rejected"; candidate.action = "none"; candidate.selectedByDefault = false;
    candidate.issues.push(candidateIssue("IMPORT_AMBIGUOUS_INTRADAY_ORDER", "error", candidate.row, candidate.id));
  }
}

function parseSide(value: string): "buy" | "sell" {
  const normalized = normalizeTerm(value);
  const buys = new Set(["매수", "매입", "買", "買い", "買付", "買付け", "購入", "buy", "b", "purchase", "buyorder", "achat", "acheter", "achete", "ordredachat", "acquisto", "comprare", "comprato", "ordinediacquisto", "compra", "comprar", "comprado", "ordendecompra"]);
  const sells = new Set(["매도", "매각", "売", "売り", "売却", "sell", "s", "sale", "sold", "sellorder", "vente", "vendre", "vendu", "ordredevente", "vendita", "vendere", "venduto", "ordinedivendita", "venta", "vender", "vendido", "ordendeventa"]);
  const buy = buys.has(normalized) || normalized.includes("매수") || normalized.includes("買付");
  const sell = sells.has(normalized) || normalized.includes("매도") || normalized.includes("売却");
  if (buy !== sell) return buy ? "buy" : "sell";
  throw importFailure("IMPORT_INVALID_SIDE", "tradeType");
}

function parseCurrency(value: string): Currency {
  const raw = value.trim();
  if (raw === "₩") return "KRW"; if (raw === "$" || raw.toUpperCase() === "US$") return "USD"; if (raw === "¥" || raw === "￥") return "JPY"; if (raw === "€") return "EUR"; if (raw.toUpperCase() === "C$") return "CAD";
  const normalized = normalizeTerm(raw);
  const terms: Record<Currency, string[]> = {
    KRW: ["krw", "원", "원화", "ウォン", "韓国ウォン", "won", "koreanwon", "southkoreanwon", "wonsudcoreen", "woncoreen", "wonsudcoreano", "woncoreano"],
    USD: ["usd", "달러", "米ドル", "ドル", "dollar", "dollars", "usdollar", "usdollars", "dollaramericain", "dollarsamericains", "dollarostatunitense", "dollaristatunitensi", "dolarestadounidense", "dolaresestadounidenses"],
    JPY: ["jpy", "엔", "엔화", "円", "日本円", "yen", "yens", "japaneseyen", "yenjaponais", "yengiapponese", "yenjapones"], EUR: ["eur", "유로", "ユーロ", "euro", "euros"], CAD: ["cad", "canadiandollar", "canadiandollars", "캐나다달러"], HKD: ["hkd", "hongkongdollar", "hongkongdollars", "홍콩달러"],
  };
  for (const currency of Object.keys(terms) as Currency[]) if (terms[currency].includes(normalized)) return currency;
  throw importFailure("IMPORT_INVALID_CURRENCY", "currency");
}

function parsePositiveDecimal(value: string, field: ImportField) { const number = parseOptionalDecimal(value); if (!number.greaterThan(0)) throw importFailure("IMPORT_NON_POSITIVE_NUMBER", field); return number; }
function parsePositiveNumber(value: string, field: ImportField) { return parsePositiveDecimal(value, field).toNumber(); }
function parseNonNegativeNumber(value: string, field: ImportField) { const number = parseOptionalNumber(value); if (number < 0) throw importFailure("IMPORT_NEGATIVE_NUMBER", field); return number; }

export function parseOptionalNumber(value: string) {
  return parseOptionalDecimal(value).toNumber();
}

export function parseOptionalDecimal(value: string) {
  if (!value.trim()) return new Decimal(0);
  const trimmed = value.trim(); const negative = /^\(.*\)$/.test(trimmed);
  const unsigned = trimmed.replace(/[()$₩€¥￥원]/g, "").replace(/[\s\u00A0\u202F]/g, "");
  const normalized = normalizeLocaleNumber(unsigned);
  try {
    const parsed = new Decimal(normalized);
    if (!parsed.isFinite()) throw new Error("not finite");
    return negative ? parsed.negated() : parsed;
  } catch {
    throw importFailure("IMPORT_INVALID_NUMBER");
  }
}

function normalizeLocaleNumber(value: string) {
  if (!/^\d+(?:[.,]\d+)*$/.test(value)) return "NaN";
  const comma = value.lastIndexOf(","); const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : "."; const thousands = decimal === "," ? "." : ","; const parts = value.split(decimal);
    if (parts.length !== 2 || !parts[1]) return "NaN";
    const groups = parts[0].split(thousands); if (groups.length > 1 && (groups[0].length > 3 || groups.slice(1).some((group) => group.length !== 3))) return "NaN";
    return `${groups.join("")}.${parts[1]}`;
  }
  if (comma >= 0) { const groups = value.split(","); if (groups.length > 2) return groups.slice(1).every((group) => group.length === 3) ? groups.join("") : "NaN"; return groups[1].length === 3 ? groups.join("") : `${groups[0]}.${groups[1]}`; }
  if ((value.match(/\./g) ?? []).length > 1) { const groups = value.split("."); return groups.slice(1).every((group) => group.length === 3) ? groups.join("") : "NaN"; }
  return value;
}

function addIndex<T>(index: Map<string, T[]>, key: string, value: T) { if (key) index.set(key, [...(index.get(key) ?? []), value]); }
function cell(parsed: ParsedTabularFile, row: string[], reference?: ImportMapping[keyof ImportMapping]) { const index = resolveColumnIndex(parsed.columns, reference); return index === undefined ? "" : row[index]?.trim() ?? ""; }
function withSeconds(value: string) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value; }
function normalizeTicker(value: string) { return value.trim().replace(/^'/, "").toUpperCase().replace(/\s/g, ""); }
function normalizeName(value: string) { return value.trim().toLowerCase().replace(/\s/g, ""); }
function normalizeTerm(value: string) { return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").normalize("NFC").replace(/[^\p{L}\p{N}]/gu, ""); }
function isValidCalendarDate(year: number, month: number, day: number) { return Number.isInteger(year) && year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function candidateIssue(code: ImportIssueCode, severity: ImportIssue["severity"], row: number, candidateId: string): ImportIssue { return { code, severity, row, candidateId }; }
function importFailure(code: ImportIssueCode, field?: ImportField) { return Object.assign(new Error(code), { code, field }); }
function toImportError(error: unknown, row: number): ImportIssue { const value = error as Error & { code?: ImportIssueCode; field?: ImportField }; return { code: value.code ?? "IMPORT_ROW_REJECTED", severity: "error", row, field: value.field }; }
function emptyPreview(issues: ImportIssue[]): ImportPreview { return { candidates: [], issues, requiresTimezoneConfirmation: false, summary: emptySummary() }; }
function emptySummary(): Record<ImportCandidateStatus, number> { return { ready: 0, exact_duplicate: 0, possible_duplicate: 0, previously_deleted: 0, source_conflict: 0, rejected: 0, excluded_settlement: 0, excluded_non_trade: 0, unsupported_activity: 0 }; }
function summarize(candidates: ImportCandidate[]) { return candidates.reduce((result, candidate) => ({ ...result, [candidate.status]: result[candidate.status] + 1 }), emptySummary()); }
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
