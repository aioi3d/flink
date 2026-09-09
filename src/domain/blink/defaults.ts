import type { TriggerMode } from '../../native/contracts';
import type { BlinkDetectorConfig } from './types';

export const blinkDefaults = Object.freeze({
  triggerMode: 'onReopen',
  closeThresholdLeft: 0.65,
  closeThresholdRight: 0.65,
  openThresholdLeft: 0.25,
  openThresholdRight: 0.25,
  maxBilateralSkewMs: 120,
  rearmOpenMs: 150,
  cooldownMs: 350,
  maxClosedMs: 1500,
  maxSampleGapMs: 150,
  maxSampleAgeMs: 250,
  minimumBilateralClosedSamples: 1,
} as const satisfies BlinkDetectorConfig);

function isTriggerMode(value: unknown): value is TriggerMode {
  return value === 'onClose' || value === 'onReopen';
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
}

export function assertValidBlinkConfig(config: BlinkDetectorConfig): void {
  if (!isTriggerMode(config.triggerMode)) {
    throw new RangeError('triggerMode must be onClose or onReopen.');
  }

  const thresholdPairs = [
    ['left', config.openThresholdLeft, config.closeThresholdLeft],
    ['right', config.openThresholdRight, config.closeThresholdRight],
  ] as const;

  for (const [eye, openThreshold, closeThreshold] of thresholdPairs) {
    if (
      !Number.isFinite(openThreshold) ||
      !Number.isFinite(closeThreshold) ||
      openThreshold < 0 ||
      openThreshold >= closeThreshold ||
      closeThreshold > 1
    ) {
      throw new RangeError(
        `${eye} thresholds must satisfy 0 <= openThreshold < closeThreshold <= 1.`,
      );
    }
  }

  assertFiniteNonNegative('maxBilateralSkewMs', config.maxBilateralSkewMs);
  assertFiniteNonNegative('rearmOpenMs', config.rearmOpenMs);
  assertFiniteNonNegative('cooldownMs', config.cooldownMs);
  assertFiniteNonNegative('maxClosedMs', config.maxClosedMs);
  assertFiniteNonNegative('maxSampleGapMs', config.maxSampleGapMs);
  assertFiniteNonNegative('maxSampleAgeMs', config.maxSampleAgeMs);

  if (
    !Number.isSafeInteger(config.minimumBilateralClosedSamples) ||
    config.minimumBilateralClosedSamples < 1
  ) {
    throw new RangeError('minimumBilateralClosedSamples must be a positive safe integer.');
  }
}

export function createBlinkConfig(
  overrides: Partial<BlinkDetectorConfig> = {},
): BlinkDetectorConfig {
  const config: BlinkDetectorConfig = { ...blinkDefaults, ...overrides };
  assertValidBlinkConfig(config);
  return config;
}

