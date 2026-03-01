import { UsageLedgerEntry } from './usage-ledger-store';

export interface UsageLedgerTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsdKnown: number;
  providerReportedCostUsd: number;
  estimatedOnlyCostUsd: number;
  providerReportedCount: number;
  estimatedCount: number;
  unknownCostCount: number;
}

export interface UsageLedgerBreakdownItem extends UsageLedgerTotals {
  key: string;
}

export interface UsageLedgerReportSnapshot {
  generatedAt: number;
  sessionStartAt: number;
  totals: {
    project: UsageLedgerTotals;
    day: UsageLedgerTotals;
    week: UsageLedgerTotals;
    month: UsageLedgerTotals;
    session: UsageLedgerTotals;
  };
  byOperation: UsageLedgerBreakdownItem[];
  byModel: UsageLedgerBreakdownItem[];
  byScope: UsageLedgerBreakdownItem[];
  byCostSource: UsageLedgerBreakdownItem[];
  warnings: string[];
}

export interface UsageLedgerReportOptions {
  nowMs: number;
  sessionStartAt: number;
  dailyBudgetUsd: number;
  sessionBudgetUsd: number;
  budgetByOperationUsd?: {[operation: string]: number};
  budgetByModelUsd?: {[providerModel: string]: number};
  budgetByScopeUsd?: {[scope: string]: number};
}

function createEmptyTotals(): UsageLedgerTotals {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsdKnown: 0,
    providerReportedCostUsd: 0,
    estimatedOnlyCostUsd: 0,
    providerReportedCount: 0,
    estimatedCount: 0,
    unknownCostCount: 0
  };
}

function addEntryToTotals(totals: UsageLedgerTotals, entry: UsageLedgerEntry): void {
  totals.requests += 1;
  totals.promptTokens += Math.max(0, Math.floor(entry.promptTokens));
  totals.completionTokens += Math.max(0, Math.floor(entry.completionTokens));
  totals.totalTokens += Math.max(0, Math.floor(entry.totalTokens));

  const costCandidate = entry.estimatedCostUsd ?? entry.reportedCostUsd;
  if (costCandidate !== null && Number.isFinite(costCandidate) && costCandidate >= 0) {
    totals.costUsdKnown += costCandidate;
    if (entry.costSource === 'provider_reported') {
      totals.providerReportedCount += 1;
      totals.providerReportedCostUsd += costCandidate;
    } else if (entry.costSource === 'estimated') {
      totals.estimatedCount += 1;
      totals.estimatedOnlyCostUsd += costCandidate;
    }
  } else {
    totals.unknownCostCount += 1;
  }
}

function toSortedBreakdown(map: Map<string, UsageLedgerTotals>): UsageLedgerBreakdownItem[] {
  return [...map.entries()]
    .sort((left, right) => (
      right[1].costUsdKnown - left[1].costUsdKnown ||
      right[1].totalTokens - left[1].totalTokens ||
      left[0].localeCompare(right[0])
    ))
    .map(([key, totals]) => ({
      key,
      ...totals
    }));
}

function startOfUtcDay(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function startOfUtcIsoWeek(nowMs: number): number {
  const now = new Date(nowMs);
  const day = now.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset);
}

function startOfUtcMonth(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function buildWarnings(
  totals: UsageLedgerReportSnapshot['totals'],
  options: UsageLedgerReportOptions,
  byOperation: UsageLedgerBreakdownItem[],
  byModel: UsageLedgerBreakdownItem[],
  byScope: UsageLedgerBreakdownItem[]
): string[] {
  const warnings: string[] = [];
  const dailyBudgetUsd = Number.isFinite(options.dailyBudgetUsd) && options.dailyBudgetUsd > 0
    ? options.dailyBudgetUsd
    : 0;
  const sessionBudgetUsd = Number.isFinite(options.sessionBudgetUsd) && options.sessionBudgetUsd > 0
    ? options.sessionBudgetUsd
    : 0;

  if (dailyBudgetUsd > 0 && totals.day.costUsdKnown > dailyBudgetUsd) {
    warnings.push(
      `Daily known cost ${totals.day.costUsdKnown.toFixed(4)} USD exceeds budget ${dailyBudgetUsd.toFixed(4)} USD.`
    );
  }

  if (sessionBudgetUsd > 0 && totals.session.costUsdKnown > sessionBudgetUsd) {
    warnings.push(
      `Session known cost ${totals.session.costUsdKnown.toFixed(4)} USD exceeds budget ${sessionBudgetUsd.toFixed(4)} USD.`
    );
  }

  if (totals.day.unknownCostCount > 0) {
    warnings.push(
      `Daily totals include ${totals.day.unknownCostCount} request(s) with unknown cost.`
    );
  }

  if (totals.session.unknownCostCount > 0) {
    warnings.push(
      `Session totals include ${totals.session.unknownCostCount} request(s) with unknown cost.`
    );
  }

  const operationBudgets = normalizeBudgetMap(options.budgetByOperationUsd);
  for (const item of byOperation) {
    const budget = operationBudgets.get(item.key);
    if (budget !== undefined && item.costUsdKnown > budget) {
      warnings.push(
        `Operation budget exceeded for "${item.key}": ${item.costUsdKnown.toFixed(4)} USD > ${budget.toFixed(4)} USD.`
      );
    }
  }

  const modelBudgets = normalizeBudgetMap(options.budgetByModelUsd);
  for (const item of byModel) {
    const budget = modelBudgets.get(item.key);
    if (budget !== undefined && item.costUsdKnown > budget) {
      warnings.push(
        `Model budget exceeded for "${item.key}": ${item.costUsdKnown.toFixed(4)} USD > ${budget.toFixed(4)} USD.`
      );
    }
  }

  const scopeBudgets = normalizeBudgetMap(options.budgetByScopeUsd);
  for (const item of byScope) {
    const budget = scopeBudgets.get(item.key);
    if (budget !== undefined && item.costUsdKnown > budget) {
      warnings.push(
        `Scope budget exceeded for "${item.key}": ${item.costUsdKnown.toFixed(4)} USD > ${budget.toFixed(4)} USD.`
      );
    }
  }

  return warnings;
}

function normalizeBudgetMap(raw: {[key: string]: number} | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!raw || typeof raw !== 'object') {
    return map;
  }
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.trim();
    const normalizedValue = Number(value);
    if (!normalizedKey || !Number.isFinite(normalizedValue) || normalizedValue <= 0) {
      continue;
    }
    map.set(normalizedKey, normalizedValue);
  }
  return map;
}

function resolveScopeKey(entry: UsageLedgerEntry): string {
  const directScope = typeof entry.metadata?.scope === 'string'
    ? entry.metadata.scope.trim()
    : '';
  if (directScope) {
    return directScope;
  }

  const scopesRaw = entry.metadata?.scopes;
  if (Array.isArray(scopesRaw)) {
    const first = scopesRaw
      .map(item => String(item ?? '').trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }

  return '(none)';
}

export function buildUsageLedgerReportSnapshot(
  entries: UsageLedgerEntry[],
  options: UsageLedgerReportOptions
): UsageLedgerReportSnapshot {
  const dayStart = startOfUtcDay(options.nowMs);
  const weekStart = startOfUtcIsoWeek(options.nowMs);
  const monthStart = startOfUtcMonth(options.nowMs);
  const sessionStartAt = Math.max(0, Math.floor(options.sessionStartAt));

  const project = createEmptyTotals();
  const day = createEmptyTotals();
  const week = createEmptyTotals();
  const month = createEmptyTotals();
  const session = createEmptyTotals();
  const byOperation = new Map<string, UsageLedgerTotals>();
  const byModel = new Map<string, UsageLedgerTotals>();
  const byScope = new Map<string, UsageLedgerTotals>();
  const byCostSource = new Map<string, UsageLedgerTotals>();

  const ordered = [...entries].sort((left, right) => (
    left.timestamp - right.timestamp || left.id.localeCompare(right.id)
  ));

  for (const entry of ordered) {
    addEntryToTotals(project, entry);
    if (entry.timestamp >= dayStart) {
      addEntryToTotals(day, entry);
    }
    if (entry.timestamp >= weekStart) {
      addEntryToTotals(week, entry);
    }
    if (entry.timestamp >= monthStart) {
      addEntryToTotals(month, entry);
    }
    if (entry.timestamp >= sessionStartAt) {
      addEntryToTotals(session, entry);
    }

    const operationTotals = byOperation.get(entry.operation) ?? createEmptyTotals();
    addEntryToTotals(operationTotals, entry);
    byOperation.set(entry.operation, operationTotals);

    const modelKey = `${entry.provider}:${entry.model}`;
    const modelTotals = byModel.get(modelKey) ?? createEmptyTotals();
    addEntryToTotals(modelTotals, entry);
    byModel.set(modelKey, modelTotals);

    const scopeKey = resolveScopeKey(entry);
    const scopeTotals = byScope.get(scopeKey) ?? createEmptyTotals();
    addEntryToTotals(scopeTotals, entry);
    byScope.set(scopeKey, scopeTotals);

    const sourceKey = entry.costSource;
    const sourceTotals = byCostSource.get(sourceKey) ?? createEmptyTotals();
    addEntryToTotals(sourceTotals, entry);
    byCostSource.set(sourceKey, sourceTotals);
  }

  const totals = {
    project,
    day,
    week,
    month,
    session
  };

  const sortedByOperation = toSortedBreakdown(byOperation);
  const sortedByModel = toSortedBreakdown(byModel);
  const sortedByScope = toSortedBreakdown(byScope);
  const sortedByCostSource = toSortedBreakdown(byCostSource);

  return {
    generatedAt: options.nowMs,
    sessionStartAt,
    totals,
    byOperation: sortedByOperation,
    byModel: sortedByModel,
    byScope: sortedByScope,
    byCostSource: sortedByCostSource,
    warnings: buildWarnings(totals, options, sortedByOperation, sortedByModel, sortedByScope)
  };
}

function escapeCsvCell(value: string): string {
  if (!/[,"\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeUsageLedgerEntriesCsv(entries: UsageLedgerEntry[]): string {
  const header = [
    'id',
    'timestamp',
    'timestamp_iso',
    'operation',
    'provider',
    'model',
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'reported_cost_usd',
    'estimated_cost_usd',
    'cost_source',
    'pricing_source',
    'input_cost_per_million_usd',
    'output_cost_per_million_usd',
    'pricing_rule',
    'pricing_snapshot_at',
    'metadata_json'
  ];

  const ordered = [...entries].sort((left, right) => (
    left.timestamp - right.timestamp || left.id.localeCompare(right.id)
  ));

  const rows = ordered.map(entry => {
    const metadata = JSON.stringify(entry.metadata ?? {});
    const rawValues = [
      entry.id,
      String(entry.timestamp),
      new Date(entry.timestamp).toISOString(),
      entry.operation,
      entry.provider,
      entry.model,
      String(entry.promptTokens),
      String(entry.completionTokens),
      String(entry.totalTokens),
      entry.reportedCostUsd === null ? '' : String(entry.reportedCostUsd),
      entry.estimatedCostUsd === null ? '' : String(entry.estimatedCostUsd),
      entry.costSource,
      entry.pricingSource,
      entry.inputCostPerMillionUsd === null ? '' : String(entry.inputCostPerMillionUsd),
      entry.outputCostPerMillionUsd === null ? '' : String(entry.outputCostPerMillionUsd),
      entry.pricingRule ?? '',
      entry.pricingSnapshotAt === null ? '' : String(entry.pricingSnapshotAt),
      metadata
    ];
    return rawValues.map(value => escapeCsvCell(value)).join(',');
  });

  return [header.join(','), ...rows].join('\n');
}
