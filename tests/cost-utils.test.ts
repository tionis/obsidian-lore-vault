import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateUsageCostUsd } from '../src/cost-utils';

test('estimateUsageCostUsd prefers provider-reported cost', () => {
  const result = estimateUsageCostUsd(1200, 400, 0.8, 1.2, 0.0042);
  assert.equal(result.source, 'provider_reported');
  assert.equal(result.reportedCostUsd, 0.0042);
  assert.equal(result.estimatedCostUsd, 0.0042);
  assert.equal(result.pricingSource, 'provider_reported');
});

test('estimateUsageCostUsd computes fallback estimate from token rates', () => {
  const result = estimateUsageCostUsd(1000, 500, 2, 4, null);
  assert.equal(result.source, 'estimated');
  assert.equal(result.reportedCostUsd, null);
  assert.equal(result.estimatedCostUsd, 0.004);
  assert.equal(result.pricingSource, 'default_rates');
  assert.equal(result.inputCostPerMillionUsd, 2);
  assert.equal(result.outputCostPerMillionUsd, 4);
});

test('estimateUsageCostUsd returns unknown when no rates and no provider cost', () => {
  const result = estimateUsageCostUsd(1000, 500, 0, 0, null);
  assert.equal(result.source, 'unknown');
  assert.equal(result.reportedCostUsd, null);
  assert.equal(result.estimatedCostUsd, null);
  assert.equal(result.pricingSource, 'none');
});
