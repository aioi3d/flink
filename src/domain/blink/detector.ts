import type {
  FaceSample,
  GestureIntent,
  InputContext,
  TrackingEpoch,
  TriggerMode,
} from '../../native/contracts';
import { assertValidBlinkConfig, createBlinkConfig } from './defaults';
import type {
  BlinkDetectorConfig,
  BlinkDetectorLike,
  BlinkDetectorState,
  DetectorDiagnostic,
  DetectorInput,
  EyeState,
} from './types';

type Eye = 'left' | 'right';

const MAX_RETIRED_EPOCHS = 16;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidContext(value: unknown): value is InputContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const context = value as Partial<InputContext>;
  return (
    isNonEmptyString(context.jsRuntimeId) &&
    isNonEmptyString(context.readerSessionId) &&
    isNonEmptyString(context.generation)
  );
}

function contextsEqual(left: InputContext, right: InputContext): boolean {
  return (
    left.jsRuntimeId === right.jsRuntimeId &&
    left.readerSessionId === right.readerSessionId &&
    left.generation === right.generation
  );
}

function cloneContext(context: InputContext): InputContext {
  return {
    jsRuntimeId: context.jsRuntimeId,
    readerSessionId: context.readerSessionId,
    generation: context.generation,
  };
}

function isValidCoefficient(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidStreamSample(sample: FaceSample): boolean {
  return (
    Number.isSafeInteger(sample.seq) &&
    sample.seq >= 0 &&
    Number.isFinite(sample.nativeMs) &&
    sample.nativeMs >= 0 &&
    Number.isFinite(sample.frameTimestamp) &&
    sample.frameTimestamp >= 0 &&
    isNonEmptyString(sample.trackingEpoch)
  );
}

export class BlinkDetector implements BlinkDetectorLike {
  private readonly config: BlinkDetectorConfig;

  private mode: TriggerMode;

  private state: BlinkDetectorState = 'DISABLED';

  private enabled = false;

  private lastResetReason: string | null = null;

  private detectedCount = 0;

  private leftEyeState: EyeState = 'unknown';

  private rightEyeState: EyeState = 'unknown';

  private openSinceNativeMs: number | null = null;

  private firstClosingEye: Eye | null = null;

  private firstCloseNativeMs: number | null = null;

  private secondCloseNativeMs: number | null = null;

  private bilateralClosedAtNativeMs: number | null = null;

  private bilateralClosedSamples = 0;

  private lastEventNativeMs: number | null = null;

  private activeContext: InputContext | null = null;

  private activeTrackingEpoch: TrackingEpoch | null = null;

  private readonly retiredTrackingEpochs: TrackingEpoch[] = [];

  private activeFaceId: string | null = null;

  private lastAcceptedSeq: number | null = null;

  private lastAcceptedNativeMs: number | null = null;

  private lastAcceptedFrameTimestamp: number | null = null;

  constructor(overrides: Partial<BlinkDetectorConfig> = {}) {
    this.config = createBlinkConfig(overrides);
    this.mode = this.config.triggerMode;
  }

  push(input: DetectorInput): GestureIntent[] {
    if (!input.enabled) {
      this.disable('disabled');
      return [];
    }

    if (!this.enabled) {
      this.enabled = true;
      this.clearStreamIdentity();
      this.resetCandidate('enabled');
    }

    if (!isValidContext(input.context)) {
      this.resetCandidate('invalid-context');
      return [];
    }

    if (this.activeContext === null) {
      this.activeContext = cloneContext(input.context);
    } else if (!contextsEqual(this.activeContext, input.context)) {
      this.activeContext = cloneContext(input.context);
      this.retiredTrackingEpochs.length = 0;
      this.clearStreamIdentity({ keepContext: true });
      this.resetCandidate('context-changed');
    }

    if (input.overflowed === true) {
      this.clearStreamIdentity({ keepContext: true });
      this.resetCandidate('overflow');
      return [];
    }

    const { sample } = input;

    if (!isValidContext(sample.context) || !contextsEqual(sample.context, input.context)) {
      this.resetCandidate('stale-context');
      return [];
    }

    if (
      !Number.isFinite(input.sampleAgeMs) ||
      input.sampleAgeMs < 0 ||
      input.sampleAgeMs > this.config.maxSampleAgeMs
    ) {
      this.resetCandidate(
        Number.isFinite(input.sampleAgeMs) && input.sampleAgeMs > this.config.maxSampleAgeMs
          ? 'stale-sample'
          : 'invalid-sample-age',
      );
      return [];
    }

    if (!isValidStreamSample(sample)) {
      this.resetCandidate('invalid-stream-sample');
      return [];
    }

    if (
      input.expectedTrackingEpoch !== undefined &&
      !isNonEmptyString(input.expectedTrackingEpoch)
    ) {
      this.resetCandidate('invalid-expected-epoch');
      return [];
    }

    if (
      input.expectedTrackingEpoch !== undefined &&
      sample.trackingEpoch !== input.expectedTrackingEpoch
    ) {
      this.resetCandidate('stale-tracking-epoch');
      return [];
    }

    if (!this.acceptTrackingEpoch(sample.trackingEpoch, input.expectedTrackingEpoch)) {
      return [];
    }

    if (this.lastAcceptedSeq !== null) {
      if (sample.seq === this.lastAcceptedSeq) {
        return [];
      }

      if (sample.seq < this.lastAcceptedSeq) {
        this.resetCandidate('sequence-reversed');
        return [];
      }
    }

    if (this.lastAcceptedNativeMs !== null && sample.nativeMs < this.lastAcceptedNativeMs) {
      this.resetCandidate('native-time-reversed');
      return [];
    }

    if (this.lastAcceptedFrameTimestamp !== null) {
      if (sample.frameTimestamp === this.lastAcceptedFrameTimestamp) {
        return [];
      }

      if (sample.frameTimestamp < this.lastAcceptedFrameTimestamp) {
        this.resetCandidate('frame-time-reversed');
        return [];
      }
    }

    const hasSampleGap =
      this.lastAcceptedNativeMs !== null &&
      sample.nativeMs - this.lastAcceptedNativeMs > this.config.maxSampleGapMs;

    this.lastAcceptedSeq = sample.seq;
    this.lastAcceptedNativeMs = sample.nativeMs;
    this.lastAcceptedFrameTimestamp = sample.frameTimestamp;

    if (hasSampleGap) {
      this.resetCandidate('sample-gap');
    }

    if (
      sample.tracked !== true ||
      !isNonEmptyString(sample.faceId) ||
      !isValidCoefficient(sample.left) ||
      !isValidCoefficient(sample.right)
    ) {
      this.activeFaceId = null;
      this.resetCandidate(sample.tracked === true ? 'invalid-face-sample' : 'face-lost');
      return [];
    }

    if (this.activeFaceId === null) {
      this.activeFaceId = sample.faceId;
    } else if (this.activeFaceId !== sample.faceId) {
      this.activeFaceId = sample.faceId;
      this.resetCandidate('face-changed');
    }

    this.leftEyeState = this.classifyEye(
      sample.left,
      this.leftEyeState,
      this.config.openThresholdLeft,
      this.config.closeThresholdLeft,
    );
    this.rightEyeState = this.classifyEye(
      sample.right,
      this.rightEyeState,
      this.config.openThresholdRight,
      this.config.closeThresholdRight,
    );

    return this.advance(sample);
  }

  reset(reason: string): void {
    this.clearStreamIdentity({ keepContext: true });
    this.resetCandidate(reason);
  }

  setMode(mode: TriggerMode): void {
    const prospective = { ...this.config, triggerMode: mode };
    assertValidBlinkConfig(prospective);

    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    this.resetCandidate('mode-changed');
  }

  snapshot(): DetectorDiagnostic {
    return {
      state: this.state,
      lastResetReason: this.lastResetReason,
      detectedCount: this.detectedCount,
      triggerMode: this.mode,
      leftEyeState: this.leftEyeState,
      rightEyeState: this.rightEyeState,
      activeTrackingEpoch: this.activeTrackingEpoch,
      activeFaceId: this.activeFaceId,
      lastAcceptedSeq: this.lastAcceptedSeq,
    };
  }

  private advance(sample: FaceSample): GestureIntent[] {
    switch (this.state) {
      case 'DISABLED':
        // An enabled detector never evaluates a closed startup sample as a blink.
        this.state = 'WAIT_OPEN';
        this.observeWaitOpen(sample);
        return [];
      case 'WAIT_OPEN':
        this.observeWaitOpen(sample);
        return [];
      case 'ARMED':
        return this.observeArmed(sample);
      case 'CLOSING':
        return this.observeClosing(sample);
      case 'CLOSED':
        return this.observeClosed(sample);
      case 'CONSUMED':
        this.observeConsumed(sample);
        return [];
    }
  }

  private observeWaitOpen(sample: FaceSample): void {
    if (!this.isRawBilateralOpen(sample)) {
      this.openSinceNativeMs = null;
      return;
    }

    if (this.openSinceNativeMs === null) {
      this.openSinceNativeMs = sample.nativeMs;
    }

    if (
      sample.nativeMs - this.openSinceNativeMs >= this.config.rearmOpenMs &&
      this.cooldownHasElapsed(sample.nativeMs)
    ) {
      this.state = 'ARMED';
      this.openSinceNativeMs = null;
    }
  }

  private observeArmed(sample: FaceSample): GestureIntent[] {
    const leftAtCloseThreshold = sample.left! >= this.config.closeThresholdLeft;
    const rightAtCloseThreshold = sample.right! >= this.config.closeThresholdRight;

    if (!leftAtCloseThreshold && !rightAtCloseThreshold) {
      return [];
    }

    if (leftAtCloseThreshold && rightAtCloseThreshold) {
      this.firstClosingEye = 'left';
      this.firstCloseNativeMs = sample.nativeMs;
      this.secondCloseNativeMs = sample.nativeMs;
      this.bilateralClosedAtNativeMs = sample.nativeMs;
      this.bilateralClosedSamples = 1;
      return this.completeBilateralClosureIfReady(sample);
    }

    this.state = 'CLOSING';
    this.firstClosingEye = leftAtCloseThreshold ? 'left' : 'right';
    this.firstCloseNativeMs = sample.nativeMs;
    this.secondCloseNativeMs = null;
    this.bilateralClosedAtNativeMs = null;
    this.bilateralClosedSamples = 0;
    return [];
  }

  private observeClosing(sample: FaceSample): GestureIntent[] {
    if (this.firstClosingEye === null || this.firstCloseNativeMs === null) {
      this.resetCandidate('invalid-closing-state');
      this.observeWaitOpen(sample);
      return [];
    }

    if (this.secondCloseNativeMs === null) {
      const firstEyeState =
        this.firstClosingEye === 'left' ? this.leftEyeState : this.rightEyeState;

      if (firstEyeState !== 'closed') {
        this.resetCandidate('first-eye-reopened');
        this.observeWaitOpen(sample);
        return [];
      }

      const skewMs = sample.nativeMs - this.firstCloseNativeMs;
      if (skewMs > this.config.maxBilateralSkewMs) {
        this.resetCandidate('bilateral-skew-exceeded');
        this.observeWaitOpen(sample);
        return [];
      }

      const otherReachedCloseThreshold =
        this.firstClosingEye === 'left'
          ? sample.right! >= this.config.closeThresholdRight
          : sample.left! >= this.config.closeThresholdLeft;

      if (!otherReachedCloseThreshold) {
        return [];
      }

      this.secondCloseNativeMs = sample.nativeMs;
      this.bilateralClosedAtNativeMs = sample.nativeMs;
      this.bilateralClosedSamples = 1;
      return this.completeBilateralClosureIfReady(sample);
    }

    if (this.leftEyeState !== 'closed' || this.rightEyeState !== 'closed') {
      this.resetCandidate('bilateral-close-interrupted');
      this.observeWaitOpen(sample);
      return [];
    }

    this.bilateralClosedSamples += 1;
    return this.completeBilateralClosureIfReady(sample);
  }

  private completeBilateralClosureIfReady(sample: FaceSample): GestureIntent[] {
    if (this.bilateralClosedSamples < this.config.minimumBilateralClosedSamples) {
      this.state = 'CLOSING';
      return [];
    }

    if (this.mode === 'onClose') {
      this.state = 'CONSUMED';
      return [this.emitIntent(sample)];
    }

    this.state = 'CLOSED';
    return [];
  }

  private observeClosed(sample: FaceSample): GestureIntent[] {
    if (this.bilateralClosedAtNativeMs === null) {
      this.resetCandidate('invalid-closed-state');
      this.observeWaitOpen(sample);
      return [];
    }

    if (sample.nativeMs - this.bilateralClosedAtNativeMs > this.config.maxClosedMs) {
      this.resetCandidate('closed-too-long');
      this.observeWaitOpen(sample);
      return [];
    }

    if (!this.isRawBilateralOpen(sample)) {
      return [];
    }

    this.state = 'CONSUMED';
    this.openSinceNativeMs = sample.nativeMs;
    return [this.emitIntent(sample)];
  }

  private observeConsumed(sample: FaceSample): void {
    if (!this.isRawBilateralOpen(sample)) {
      this.openSinceNativeMs = null;
      return;
    }

    if (this.openSinceNativeMs === null) {
      this.openSinceNativeMs = sample.nativeMs;
    }

    if (
      sample.nativeMs - this.openSinceNativeMs >= this.config.rearmOpenMs &&
      this.cooldownHasElapsed(sample.nativeMs)
    ) {
      this.state = 'ARMED';
      this.openSinceNativeMs = null;
      this.clearClosingCandidate();
    }
  }

  private emitIntent(sample: FaceSample): GestureIntent {
    this.detectedCount += 1;
    this.lastEventNativeMs = sample.nativeMs;

    return {
      eventId: [
        'bilateralBlink',
        sample.context.jsRuntimeId,
        sample.context.readerSessionId,
        sample.context.generation,
        sample.trackingEpoch,
        sample.seq,
      ].join(':'),
      kind: 'bilateralBlink',
      action: 'nextPage',
      triggerMode: this.mode,
      inputContext: cloneContext(sample.context),
      trackingEpoch: sample.trackingEpoch,
      sampleNativeMs: sample.nativeMs,
    };
  }

  private classifyEye(
    value: number,
    previous: EyeState,
    openThreshold: number,
    closeThreshold: number,
  ): EyeState {
    if (value >= closeThreshold) {
      return 'closed';
    }

    if (value <= openThreshold) {
      return 'open';
    }

    return previous;
  }

  private isRawBilateralOpen(sample: FaceSample): boolean {
    return (
      sample.left! <= this.config.openThresholdLeft &&
      sample.right! <= this.config.openThresholdRight
    );
  }

  private cooldownHasElapsed(nativeMs: number): boolean {
    return (
      this.lastEventNativeMs === null ||
      nativeMs - this.lastEventNativeMs >= this.config.cooldownMs
    );
  }

  private acceptTrackingEpoch(
    sampleEpoch: TrackingEpoch,
    expectedEpoch: TrackingEpoch | undefined,
  ): boolean {
    const epoch = expectedEpoch ?? sampleEpoch;

    if (this.activeTrackingEpoch === null) {
      this.activeTrackingEpoch = epoch;
      return true;
    }

    if (this.activeTrackingEpoch === epoch) {
      return true;
    }

    if (this.retiredTrackingEpochs.includes(epoch)) {
      this.resetCandidate('stale-tracking-epoch');
      return false;
    }

    this.retireEpoch(this.activeTrackingEpoch);
    this.activeTrackingEpoch = epoch;
    this.activeFaceId = null;
    this.lastAcceptedSeq = null;
    this.lastAcceptedNativeMs = null;
    this.lastAcceptedFrameTimestamp = null;
    this.resetCandidate('tracking-epoch-changed');
    return true;
  }

  private retireEpoch(epoch: TrackingEpoch): void {
    if (this.retiredTrackingEpochs.includes(epoch)) {
      return;
    }

    this.retiredTrackingEpochs.push(epoch);
    if (this.retiredTrackingEpochs.length > MAX_RETIRED_EPOCHS) {
      this.retiredTrackingEpochs.shift();
    }
  }

  private disable(reason: string): void {
    if (!this.enabled && this.state === 'DISABLED') {
      return;
    }

    this.enabled = false;
    this.state = 'DISABLED';
    this.lastResetReason = reason;
    this.clearCandidateData();
    this.clearStreamIdentity();
  }

  private resetCandidate(reason: string): void {
    this.state = this.enabled ? 'WAIT_OPEN' : 'DISABLED';
    this.lastResetReason = reason;
    this.clearCandidateData();
  }

  private clearCandidateData(): void {
    this.leftEyeState = 'unknown';
    this.rightEyeState = 'unknown';
    this.openSinceNativeMs = null;
    this.clearClosingCandidate();
  }

  private clearClosingCandidate(): void {
    this.firstClosingEye = null;
    this.firstCloseNativeMs = null;
    this.secondCloseNativeMs = null;
    this.bilateralClosedAtNativeMs = null;
    this.bilateralClosedSamples = 0;
  }

  private clearStreamIdentity(options: { keepContext?: boolean } = {}): void {
    if (options.keepContext !== true) {
      this.activeContext = null;
      this.retiredTrackingEpochs.length = 0;
    }

    this.activeTrackingEpoch = null;
    this.activeFaceId = null;
    this.lastAcceptedSeq = null;
    this.lastAcceptedNativeMs = null;
    this.lastAcceptedFrameTimestamp = null;
  }
}
