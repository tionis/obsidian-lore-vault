export type UsageCostSource = 'provider_reported' | 'estimated' | 'unknown';

export interface UsageCostEstimate {
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  source: UsageCostSource;
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
  const normalizedReportedCost = reportedCostUsd !== undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd) && reportedCostUsd >= 0
    ? reportedCostUsd
    : null;

  if (normalizedReportedCost !== null) {
    return {
      reportedCostUsd: normalizedReportedCost,
      estimatedCostUsd: normalizedReportedCost,
      source: 'provider_reported'
    };
  }

  const normalizedInputRate = normalizeNumber(inputCostPerMillionUsd);
  const normalizedOutputRate = normalizeNumber(outputCostPerMillionUsd);
  if (normalizedInputRate <= 0 && normalizedOutputRate <= 0) {
    return {
      reportedCostUsd: null,
      estimatedCostUsd: null,
      source: 'unknown'
    };
  }

  const promptCost = (Math.max(0, promptTokens) / 1_000_000) * normalizedInputRate;
  const completionCost = (Math.max(0, completionTokens) / 1_000_000) * normalizedOutputRate;
  const estimatedCostUsd = promptCost + completionCost;

  return {
    reportedCostUsd: null,
    estimatedCostUsd,
    source: 'estimated'
  };
}
