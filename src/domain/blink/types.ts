import type {
  FaceSample,
  GestureIntent,
  InputContext,
  TrackingEpoch,
  TriggerMode,
} from '../../native/contracts';

export type BlinkDetectorState =
  | 'DISABLED'
  | 'WAIT_OPEN'
  | 'ARMED'
  | 'CLOSING'
  | 'CLOSED'
  | 'CONSUMED';

export type EyeState = 'unknown' | 'open' | 'closed';

export interface BlinkDetectorConfig {
  triggerMode: TriggerMode;
  closeThresholdLeft: number;
  closeThresholdRight: number;
  openThresholdLeft: number;
  openThresholdRight: number;
  maxBilateralSkewMs: number;
  rearmOpenMs: number;
  cooldownMs: number;
  maxClosedMs: number;
  maxSampleGapMs: number;
  maxSampleAgeMs: number;
  minimumBilateralClosedSamples: number;
}

export interface DetectorInput {
  sample: FaceSample;
  /** batch.nativeNowMs - sample.nativeMs. Do not calculate this with a JS clock. */
  sampleAgeMs: number;
  enabled: boolean;
  /** The input context currently owned by the reader controller. */
  context: InputContext;
  /**
   * The epoch requested from native for this drain. Supplying it prevents an old
   * epoch from being mistaken for a newly-started epoch.
   */
  expectedTrackingEpoch?: TrackingEpoch;
  /** An overflowed native batch is never eligible to produce an event. */
  overflowed?: boolean;
}

export interface DetectorDiagnostic {
  state: BlinkDetectorState;
  lastResetReason: string | null;
  detectedCount: number;
  triggerMode: TriggerMode;
  leftEyeState: EyeState;
  rightEyeState: EyeState;
  activeTrackingEpoch: TrackingEpoch | null;
  activeFaceId: string | null;
  lastAcceptedSeq: number | null;
}

export interface BlinkDetectorLike {
  push(input: DetectorInput): GestureIntent[];
  reset(reason: string): void;
  setMode(mode: TriggerMode): void;
  snapshot(): DetectorDiagnostic;
}

