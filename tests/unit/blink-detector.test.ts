import { describe, expect, it } from 'vitest';

import { BlinkDetector } from '../../src/domain/blink/detector';
import {
  assertValidBlinkConfig,
  blinkDefaults,
  createBlinkConfig,
} from '../../src/domain/blink/defaults';
import type { DetectorInput } from '../../src/domain/blink/types';
import type {
  FaceSample,
  InputContext,
  TrackingEpoch,
  TriggerMode,
} from '../../src/native/contracts';

const DEFAULT_CONTEXT: InputContext = {
  jsRuntimeId: 'js-1',
  readerSessionId: 'reader-1',
  generation: 'generation-1',
};

interface PushOverrides extends Partial<FaceSample> {
  ageMs?: number;
  enabled?: boolean;
  controllerContext?: InputContext;
  expectedTrackingEpoch?: TrackingEpoch;
  overflowed?: boolean;
}

function createHarness(mode: TriggerMode = 'onReopen') {
  const detector = new BlinkDetector({ triggerMode: mode });
  let nextSeq = 1;

  function push(
    nativeMs: number,
    left: number | null,
    right: number | null,
    overrides: PushOverrides = {},
  ) {
    const {
      ageMs = 0,
      enabled = true,
      controllerContext = DEFAULT_CONTEXT,
      expectedTrackingEpoch = 'epoch-1',
      overflowed = false,
      ...sampleOverrides
    } = overrides;
    const assignedSeq = sampleOverrides.seq ?? nextSeq;
    nextSeq = Math.max(nextSeq, assignedSeq + 1);

    const sample: FaceSample = {
      seq: assignedSeq,
      nativeMs,
      frameTimestamp: nativeMs / 1000 + assignedSeq / 1_000_000,
      trackingEpoch: expectedTrackingEpoch,
      context: controllerContext,
      faceId: 'face-1',
      tracked: true,
      left,
      right,
      jawOpen: 0,
      ...sampleOverrides,
    };
    const input: DetectorInput = {
      sample,
      sampleAgeMs: ageMs,
      enabled,
      context: controllerContext,
      expectedTrackingEpoch,
      overflowed,
    };

    return detector.push(input);
  }

  function arm(startNativeMs = 0): number {
    push(startNativeMs, 0.05, 0.05);
    push(startNativeMs + 75, 0.05, 0.05);
    push(startNativeMs + 150, 0.05, 0.05);
    expect(detector.snapshot().state).toBe('ARMED');
    return startNativeMs + 150;
  }

  return { detector, push, arm };
}

describe('blink detector configuration', () => {
  it('uses every DES-BLINK-FSM default', () => {
    expect(blinkDefaults).toEqual({
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
    });
    expect(createBlinkConfig({ triggerMode: 'onClose' }).triggerMode).toBe('onClose');
  });

  it('rejects invalid thresholds and timing parameters', () => {
    expect(() =>
      assertValidBlinkConfig(createBlinkConfig({ openThresholdLeft: 0.65 })),
    ).toThrow(RangeError);
    expect(() => createBlinkConfig({ closeThresholdRight: 1.01 })).toThrow(RangeError);
    expect(() => createBlinkConfig({ openThresholdRight: -0.01 })).toThrow(RangeError);
    expect(() => createBlinkConfig({ cooldownMs: Number.NaN })).toThrow(RangeError);
    expect(() => createBlinkConfig({ maxSampleGapMs: -1 })).toThrow(RangeError);
    expect(() => createBlinkConfig({ minimumBilateralClosedSamples: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('DES-BLINK-FSM artificial timelines', () => {
  it('emits at bilateral close in onClose mode and never repeats while held closed', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();

    const event = push(180, 0.9, 0.9);
    expect(event).toHaveLength(1);
    expect(event[0]).toMatchObject({
      kind: 'bilateralBlink',
      action: 'nextPage',
      triggerMode: 'onClose',
      inputContext: DEFAULT_CONTEXT,
      trackingEpoch: 'epoch-1',
      sampleNativeMs: 180,
    });
    expect(push(280, 1, 1)).toEqual([]);
    expect(push(380, 0.8, 0.8)).toEqual([]);
    expect(detector.snapshot()).toMatchObject({ state: 'CONSUMED', detectedCount: 1 });
  });

  it('emits only when both eyes reopen in onReopen mode', () => {
    const { detector, push, arm } = createHarness('onReopen');
    arm();

    expect(push(180, 0.9, 0.9)).toEqual([]);
    expect(detector.snapshot().state).toBe('CLOSED');
    expect(push(220, 0.05, 0.9)).toEqual([]);
    expect(push(260, 0.05, 0.05)).toHaveLength(1);
    expect(detector.snapshot()).toMatchObject({ state: 'CONSUMED', detectedCount: 1 });
  });

  it.each<[number, number]>([
    [0.9, 0.05],
    [0.05, 0.9],
    [1, 0.4],
    [0.4, 1],
  ])('never treats unilateral closure (%s, %s) as bilateral', (left, right) => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(200, left, right)).toEqual([]);
    expect(push(300, left, right)).toEqual([]);
    expect(push(400, 0.05, 0.05)).toEqual([]);
    expect(detector.snapshot().detectedCount).toBe(0);
  });

  it('ignores eyes that are closed at startup until a stable open interval occurs', () => {
    const { detector, push } = createHarness('onClose');
    expect(push(0, 0.9, 0.9)).toEqual([]);
    expect(push(100, 1, 1)).toEqual([]);
    expect(push(200, 0.05, 0.05)).toEqual([]);
    expect(push(350, 0.05, 0.05)).toEqual([]);
    expect(detector.snapshot().state).toBe('ARMED');
    expect(push(370, 0.9, 0.9)).toHaveLength(1);
  });

  it('accepts exactly 120ms bilateral skew', () => {
    const { push, arm } = createHarness('onClose');
    arm();
    expect(push(200, 0.9, 0.05)).toEqual([]);
    expect(push(320, 0.9, 0.9)).toHaveLength(1);
  });

  it('rejects bilateral skew greater than 120ms', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(200, 0.9, 0.05)).toEqual([]);
    expect(push(321, 0.9, 0.9)).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'bilateral-skew-exceeded',
      detectedCount: 0,
    });
  });

  it('uses hysteresis for the first closed eye without averaging the eyes', () => {
    const { push, arm } = createHarness('onClose');
    arm();
    expect(push(180, 0.65, 0.05)).toEqual([]);
    // Left is between thresholds, so it remains closed while right reaches close.
    expect(push(250, 0.4, 0.65)).toHaveLength(1);
  });

  it('accepts reopening at exactly 1500ms of closure', () => {
    const { push, arm } = createHarness('onReopen');
    arm();
    expect(push(200, 0.9, 0.9)).toEqual([]);
    for (let time = 350; time <= 1550; time += 150) {
      expect(push(time, 0.9, 0.9)).toEqual([]);
    }
    expect(push(1700, 0.25, 0.25)).toHaveLength(1);
  });

  it('rejects reopening after more than 1500ms of closure', () => {
    const { detector, push, arm } = createHarness('onReopen');
    arm();
    expect(push(200, 0.9, 0.9)).toEqual([]);
    for (let time = 350; time <= 1700; time += 150) {
      expect(push(time, 0.9, 0.9)).toEqual([]);
    }
    expect(push(1701, 0.25, 0.25)).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'closed-too-long',
      detectedCount: 0,
    });
  });

  it('emits only one onClose event during 3000ms continuous closure', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(200, 0.9, 0.9)).toHaveLength(1);
    for (let time = 300; time <= 3200; time += 100) {
      expect(push(time, 0.9, 0.9)).toEqual([]);
    }
    expect(detector.snapshot().detectedCount).toBe(1);
  });

  it('rearms only after both 150ms open and 350ms cooldown have elapsed', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(200, 0.9, 0.9)).toHaveLength(1);
    expect(push(250, 0.05, 0.05)).toEqual([]);
    expect(push(400, 0.05, 0.05)).toEqual([]);
    expect(detector.snapshot().state).toBe('CONSUMED');
    expect(push(550, 0.05, 0.05)).toEqual([]);
    expect(detector.snapshot().state).toBe('ARMED');
    expect(push(570, 0.9, 0.9)).toHaveLength(1);
  });

  it('detects two separate blinks with a 500ms open interval', () => {
    const { detector, push, arm } = createHarness('onReopen');
    arm();
    expect(push(180, 0.9, 0.9)).toEqual([]);
    expect(push(240, 0.05, 0.05)).toHaveLength(1);
    for (const time of [340, 440, 540, 640, 740]) {
      expect(push(time, 0.05, 0.05)).toEqual([]);
    }
    expect(detector.snapshot().state).toBe('ARMED');
    expect(push(760, 0.9, 0.9)).toEqual([]);
    expect(push(820, 0.05, 0.05)).toHaveLength(1);
    expect(detector.snapshot().detectedCount).toBe(2);
  });

  it('supports requiring multiple consecutive bilateral-closed samples', () => {
    const detector = new BlinkDetector({
      triggerMode: 'onClose',
      minimumBilateralClosedSamples: 2,
    });
    // Use a tiny local adapter to feed the configured detector.
    let seq = 1;
    const feed = (nativeMs: number, left: number, right: number) =>
      detector.push({
        enabled: true,
        sampleAgeMs: 0,
        context: DEFAULT_CONTEXT,
        expectedTrackingEpoch: 'epoch-1',
        sample: {
          seq: seq++,
          nativeMs,
          frameTimestamp: nativeMs / 1000,
          trackingEpoch: 'epoch-1',
          context: DEFAULT_CONTEXT,
          faceId: 'face-1',
          tracked: true,
          left,
          right,
          jawOpen: null,
        },
      });
    feed(0, 0.05, 0.05);
    feed(75, 0.05, 0.05);
    feed(150, 0.05, 0.05);
    expect(feed(180, 0.9, 0.9)).toEqual([]);
    expect(feed(200, 0.9, 0.9)).toHaveLength(1);
  });
});

describe('DES-BLINK-FSM stale input and reset rules', () => {
  it('allows sample age 250ms and rejects age greater than 250ms', () => {
    const valid = createHarness('onClose');
    valid.arm();
    expect(valid.push(180, 0.9, 0.9, { ageMs: 250 })).toHaveLength(1);

    const stale = createHarness('onClose');
    stale.arm();
    expect(stale.push(180, 0.9, 0.9, { ageMs: 250.001 })).toEqual([]);
    expect(stale.detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'stale-sample',
    });
  });

  it('allows a 150ms sample gap and resets on a greater gap', () => {
    const exact = createHarness('onClose');
    exact.arm();
    expect(exact.push(300, 0.9, 0.9)).toHaveLength(1);

    const exceeded = createHarness('onClose');
    exceeded.arm();
    expect(exceeded.push(301, 0.9, 0.9)).toEqual([]);
    expect(exceeded.detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'sample-gap',
    });
  });

  it('does not reprocess a duplicate sequence number', () => {
    const { detector, push, arm } = createHarness('onReopen');
    arm();
    expect(push(180, 0.9, 0.9, { seq: 10 })).toEqual([]);
    expect(push(220, 0.05, 0.05, { seq: 10 })).toEqual([]);
    expect(detector.snapshot().state).toBe('CLOSED');
    expect(push(240, 0.05, 0.05, { seq: 11 })).toHaveLength(1);
  });

  it('resets on reversed sequence, native time, or frame time', () => {
    const sequence = createHarness('onClose');
    sequence.arm();
    sequence.push(180, 0.9, 0.05, { seq: 20 });
    expect(sequence.push(200, 0.9, 0.9, { seq: 19 })).toEqual([]);
    expect(sequence.detector.snapshot().lastResetReason).toBe('sequence-reversed');

    const nativeTime = createHarness('onClose');
    nativeTime.arm();
    expect(nativeTime.push(149, 0.9, 0.9)).toEqual([]);
    expect(nativeTime.detector.snapshot().lastResetReason).toBe('native-time-reversed');

    const frameTime = createHarness('onClose');
    frameTime.arm();
    expect(frameTime.push(180, 0.9, 0.9, { frameTimestamp: 0.01 })).toEqual([]);
    expect(frameTime.detector.snapshot().lastResetReason).toBe('frame-time-reversed');
  });

  it('ignores a duplicate AR frame even if it has a new sequence number', () => {
    const { detector, push, arm } = createHarness('onReopen');
    arm();
    expect(push(180, 0.9, 0.9, { frameTimestamp: 10 })).toEqual([]);
    expect(push(220, 0.05, 0.05, { frameTimestamp: 10 })).toEqual([]);
    expect(detector.snapshot().state).toBe('CLOSED');
    expect(push(240, 0.05, 0.05, { frameTimestamp: 10.1 })).toHaveLength(1);
  });

  it.each<[string, number | null, number | null]>([
    ['left null', null, 0.05],
    ['right null', 0.05, null],
    ['NaN', Number.NaN, 0.05],
    ['infinite', 0.05, Number.POSITIVE_INFINITY],
    ['below range', -0.01, 0.05],
    ['above range', 0.05, 1.01],
  ])('rejects invalid coefficients: %s', (_label, left, right) => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(180, left, right)).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'invalid-face-sample',
      detectedCount: 0,
    });
  });

  it('discards a candidate on face loss or replacement', () => {
    const lost = createHarness('onReopen');
    lost.arm();
    lost.push(180, 0.9, 0.9);
    expect(lost.push(200, null, null, { tracked: false, faceId: null })).toEqual([]);
    expect(lost.push(220, 0.05, 0.05)).toEqual([]);
    expect(lost.detector.snapshot().detectedCount).toBe(0);

    const changed = createHarness('onReopen');
    changed.arm();
    changed.push(180, 0.9, 0.9);
    expect(changed.push(220, 0.05, 0.05, { faceId: 'face-2' })).toEqual([]);
    expect(changed.detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'face-changed',
      detectedCount: 0,
    });
  });

  it('rejects sample context mismatch and rearms after controller context change', () => {
    const { detector, push, arm } = createHarness('onReopen');
    arm();
    push(180, 0.9, 0.9);

    const staleContext: InputContext = { ...DEFAULT_CONTEXT, generation: 'old-generation' };
    expect(push(220, 0.05, 0.05, { context: staleContext })).toEqual([]);
    expect(detector.snapshot().lastResetReason).toBe('stale-context');

    const nextContext: InputContext = {
      jsRuntimeId: 'js-2',
      readerSessionId: 'reader-2',
      generation: 'generation-2',
    };
    expect(
      push(240, 0.9, 0.9, {
        context: nextContext,
        controllerContext: nextContext,
      }),
    ).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'context-changed',
      detectedCount: 0,
    });
  });

  it('rearms on a new tracking epoch and never re-adopts a retired epoch', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(
      push(180, 0.9, 0.9, {
        trackingEpoch: 'epoch-2',
        expectedTrackingEpoch: 'epoch-2',
      }),
    ).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'tracking-epoch-changed',
      activeTrackingEpoch: 'epoch-2',
    });

    expect(
      push(200, 0.05, 0.05, {
        trackingEpoch: 'epoch-1',
        expectedTrackingEpoch: 'epoch-1',
      }),
    ).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'stale-tracking-epoch',
      activeTrackingEpoch: 'epoch-2',
    });
  });

  it('rejects a sample whose epoch differs from the requested drain epoch', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(180, 0.9, 0.9, { trackingEpoch: 'old-epoch' })).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'stale-tracking-epoch',
      detectedCount: 0,
    });
  });

  it('discards an overflowed batch without evaluating its sample', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(180, 0.9, 0.9, { overflowed: true })).toEqual([]);
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'overflow',
      detectedCount: 0,
    });
  });

  it('discards candidates on mode change and waits for fresh open state', () => {
    const { detector, push, arm } = createHarness('onReopen');
    arm();
    push(180, 0.9, 0.9);
    detector.setMode('onClose');
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'mode-changed',
      detectedCount: 0,
    });
    expect(push(200, 0.9, 0.9)).toEqual([]);
    expect(push(250, 0.05, 0.05)).toEqual([]);
    expect(push(400, 0.05, 0.05)).toEqual([]);
    expect(push(420, 0.9, 0.9)).toHaveLength(1);
  });

  it('disables immediately and ignores a closed sample on re-enable', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(180, 0.9, 0.05)).toEqual([]);
    expect(push(200, 0.9, 0.9, { enabled: false })).toEqual([]);
    expect(detector.snapshot().state).toBe('DISABLED');
    expect(push(220, 0.9, 0.9)).toEqual([]);
    expect(detector.snapshot().state).toBe('WAIT_OPEN');
    expect(detector.snapshot().detectedCount).toBe(0);
  });

  it('honors an explicit reset without clearing diagnostics or retrying an event', () => {
    const { detector, push, arm } = createHarness('onClose');
    arm();
    expect(push(180, 0.9, 0.9)).toHaveLength(1);
    detector.reset('navigate-busy');
    expect(detector.snapshot()).toMatchObject({
      state: 'WAIT_OPEN',
      lastResetReason: 'navigate-busy',
      detectedCount: 1,
    });
    expect(push(200, 0.9, 0.9)).toEqual([]);
  });
});
