export type UsageCostSource = 'provider_reported' | 'estimated' | 'unknown';
export type UsagePricingSource = 'provider_reported' | 'model_override' | 'default_rates' | 'none';

export interface UsageCostRateSelection {
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
  source: Exclude<UsagePricingSource, 'provider_reported'>;
  rule?: string;
  snapshotAt?: number | null;
}

export interface UsageCostEstimate {
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  source: UsageCostSource;
  pricingSource: UsagePricingSource;
  inputCostPerMillionUsd: number | null;
  outputCostPerMillionUsd: number | null;
  pricingRule: string | null;
  pricingSnapshotAt: number | null;
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

export function estimateUsageCostUsd(
  promptTokens: number,
  completionTokens: number,
  inputCostPerMillionUsd: number,
  outputCostPerMillionUsd: number,
  reportedCostUsd?: number | null
): UsageCostEstimate {
  return estimateUsageCostUsdWithRateSelection(
    promptTokens,
    completionTokens,
    {
      inputCostPerMillionUsd,
      outputCostPerMillionUsd,
      source: (normalizeNumber(inputCostPerMillionUsd) > 0 || normalizeNumber(outputCostPerMillionUsd) > 0)
        ? 'default_rates'
        : 'none'
    },
    reportedCostUsd
  );
}

export function estimateUsageCostUsdWithRateSelection(
  promptTokens: number,
  completionTokens: number,
  rateSelection: UsageCostRateSelection,
  reportedCostUsd?: number | null
): UsageCostEstimate {
  const normalizedReportedCost = reportedCostUsd !== undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd) && reportedCostUsd >= 0
    ? reportedCostUsd
    : null;

  if (normalizedReportedCost !== null) {
    return {
      reportedCostUsd: normalizedReportedCost,
      estimatedCostUsd: normalizedReportedCost,
      source: 'provider_reported',
      pricingSource: 'provider_reported',
      inputCostPerMillionUsd: null,
      outputCostPerMillionUsd: null,
      pricingRule: null,
      pricingSnapshotAt: null
    };
  }

  const normalizedInputRate = normalizeNumber(rateSelection.inputCostPerMillionUsd);
  const normalizedOutputRate = normalizeNumber(rateSelection.outputCostPerMillionUsd);
  if (normalizedInputRate <= 0 && normalizedOutputRate <= 0) {
    return {
      reportedCostUsd: null,
      estimatedCostUsd: null,
      source: 'unknown',
      pricingSource: 'none',
      inputCostPerMillionUsd: null,
      outputCostPerMillionUsd: null,
      pricingRule: rateSelection.rule?.trim() || null,
      pricingSnapshotAt: Number.isFinite(Number(rateSelection.snapshotAt))
        ? Math.max(0, Math.floor(Number(rateSelection.snapshotAt)))
        : null
    };
  }

  const promptCost = (Math.max(0, promptTokens) / 1_000_000) * normalizedInputRate;
  const completionCost = (Math.max(0, completionTokens) / 1_000_000) * normalizedOutputRate;
  const estimatedCostUsd = promptCost + completionCost;

  return {
    reportedCostUsd: null,
    estimatedCostUsd,
    source: 'estimated',
    pricingSource: rateSelection.source === 'model_override' ? 'model_override' : 'default_rates',
    inputCostPerMillionUsd: normalizedInputRate,
    outputCostPerMillionUsd: normalizedOutputRate,
    pricingRule: rateSelection.rule?.trim() || null,
    pricingSnapshotAt: Number.isFinite(Number(rateSelection.snapshotAt))
      ? Math.max(0, Math.floor(Number(rateSelection.snapshotAt)))
      : null
  };
}
