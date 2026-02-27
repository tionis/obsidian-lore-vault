import { UsageLedgerEntry } from './usage-ledger-store';

export interface UsageLedgerTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsdKnown: number;
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
    session: UsageLedgerTotals;
  };
  byOperation: UsageLedgerBreakdownItem[];
  byModel: UsageLedgerBreakdownItem[];
  warnings: string[];
}

export interface UsageLedgerReportOptions {
  nowMs: number;
  sessionStartAt: number;
  dailyBudgetUsd: number;
  sessionBudgetUsd: number;
}

function createEmptyTotals(): UsageLedgerTotals {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsdKnown: 0,
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

function buildWarnings(
  totals: UsageLedgerReportSnapshot['totals'],
  options: UsageLedgerReportOptions
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

  return warnings;
}

export function buildUsageLedgerReportSnapshot(
  entries: UsageLedgerEntry[],
  options: UsageLedgerReportOptions
): UsageLedgerReportSnapshot {
  const dayStart = startOfUtcDay(options.nowMs);
  const sessionStartAt = Math.max(0, Math.floor(options.sessionStartAt));

  const project = createEmptyTotals();
  const day = createEmptyTotals();
  const session = createEmptyTotals();
  const byOperation = new Map<string, UsageLedgerTotals>();
  const byModel = new Map<string, UsageLedgerTotals>();

  const ordered = [...entries].sort((left, right) => (
    left.timestamp - right.timestamp || left.id.localeCompare(right.id)
  ));

  for (const entry of ordered) {
    addEntryToTotals(project, entry);
    if (entry.timestamp >= dayStart) {
      addEntryToTotals(day, entry);
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
  }

  const totals = {
    project,
    day,
    session
  };

  return {
    generatedAt: options.nowMs,
    sessionStartAt,
    totals,
    byOperation: toSortedBreakdown(byOperation),
    byModel: toSortedBreakdown(byModel),
    warnings: buildWarnings(totals, options)
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
      metadata
    ];
    return rawValues.map(value => escapeCsvCell(value)).join(',');
  });

  return [header.join(','), ...rows].join('\n');
}
