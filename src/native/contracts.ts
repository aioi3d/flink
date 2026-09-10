/**
 * The TypeScript side of DES-CONTRACTS.
 *
 * Keep this file free of React and Expo imports so domain code and unit tests can
 * share the exact same wire contract without loading a native runtime.
 */

export const NATIVE_API_VERSION = 1 as const;

export type FileId = string;
export type FileRevision = string;
export type ReaderSessionId = string;
export type TrackingEpoch = string;
export type InputGeneration = string;
export type TriggerMode = 'onClose' | 'onReopen';

export interface DocumentRef {
  fileId: FileId;
  revision: FileRevision;
}

export type LibraryEntryStatus =
  | 'unknown'
  | 'ready'
  | 'locked'
  | 'invalid'
  | 'unavailable';

export interface LibraryEntry extends DocumentRef {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtUnixMs: number | null;
  status: LibraryEntryStatus;
}

export interface LibraryWarning {
  code: string;
  relativePath?: string;
}

export interface LibrarySnapshot {
  scanId: string;
  indexRevision: string;
  entries: LibraryEntry[];
  warnings: LibraryWarning[];
}

export type ReaderState =
  | 'ready'
  | 'navigating'
  | 'suspended'
  | 'closed'
  | 'error';

export interface ReaderSnapshot {
  readerSessionId: ReaderSessionId;
  document: DocumentRef;
  pageIndex: number;
  pageCount: number;
  stateRevision: number;
  state: ReaderState;
}

export interface InputContext {
  jsRuntimeId: string;
  readerSessionId: ReaderSessionId;
  generation: InputGeneration;
}

export interface FlinkError {
  code: string;
  operation: string;
  recoverable: boolean;
  /** Must never contain personal data, an absolute path, or PDF content. */
  detail?: string;
}

export interface ImportFailure {
  name: string;
  code: string;
}

export interface ImportResult {
  importId: string;
  cancelled: boolean;
  imported: DocumentRef[];
  failures: ImportFailure[];
}

export type ImportStage =
  | 'selecting'
  | 'waitingForProvider'
  | 'copying'
  | 'committing';

export interface ImportProgress {
  importId: string;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  stage: ImportStage;
  copiedBytes: number;
  totalBytes: number | null;
}

export type ThumbnailStatus =
  | 'ready'
  | 'locked'
  | 'invalid'
  | 'unavailable'
  | 'cancelled';

export interface ThumbnailResult {
  document: DocumentRef;
  /** URI of an image in Flink's cache only. */
  cacheUri: string | null;
  status: ThumbnailStatus;
}

export interface FlinkFilesAPI {
  initializeLibrary(): Promise<void>;
  scanLibrary(): Promise<LibrarySnapshot>;
  presentImportPicker(importId: string): Promise<ImportResult>;
  cancelImport(importId: string): Promise<void>;
  renameDocument(
    document: DocumentRef,
    newBaseName: string,
  ): Promise<DocumentRef>;
  deleteDocument(document: DocumentRef): Promise<void>;
  requestThumbnail(
    document: DocumentRef,
    requestId: string,
  ): Promise<ThumbnailResult>;
  cancelThumbnail(requestId: string): Promise<void>;
}

export interface LibraryInvalidatedEvent {
  reason: 'initial' | 'externalChange' | 'import' | 'rename' | 'delete';
  indexRevision: string | null;
}

export interface DocumentInvalidatedEvent {
  document: DocumentRef;
  reason: 'changed' | 'missing' | 'renamed' | 'deleted';
}

export interface FlinkFilesEventMap {
  onLibraryInvalidated: (event: LibraryInvalidatedEvent) => void;
  onImportProgress: (event: ImportProgress) => void;
  onDocumentInvalidated: (event: DocumentInvalidatedEvent) => void;
}

export interface ManualNavigateRequest {
  readerSessionId: ReaderSessionId;
  commandId: string;
  source: 'manual';
  move: { delta: -1 | 1 } | { pageIndex: number };
}

export interface BlinkNavigateRequest {
  readerSessionId: ReaderSessionId;
  commandId: string;
  source: 'blink';
  move: { delta: 1 };
  inputContext: InputContext;
  trackingEpoch: TrackingEpoch;
  sampleNativeMs: number;
}

export type NavigateRequest = ManualNavigateRequest | BlinkNavigateRequest;

export type NavigateDisposition =
  | 'applied'
  | 'boundary'
  | 'busy'
  | 'stale'
  | 'suspended'
  | 'duplicate';

export interface NavigateResult {
  commandId: string;
  result: NavigateDisposition;
  snapshot: ReaderSnapshot;
}

export interface OpenDocumentInput {
  openRequestId: string;
  document: DocumentRef;
}

export interface FlinkPDFViewRef {
  openDocument(input: OpenDocumentInput): Promise<ReaderSnapshot>;
  navigate(input: NavigateRequest): Promise<NavigateResult>;
  fitCurrentPage(readerSessionId: ReaderSessionId): Promise<ReaderSnapshot>;
  closeDocument(readerSessionId: ReaderSessionId): Promise<void>;
}

export interface ReaderStateChangedEvent {
  readerSessionId: ReaderSessionId;
  stateRevision: number;
  snapshot: ReaderSnapshot;
}

export interface ReaderViewReadyEvent {
  ready: true;
}

export interface PageChangedEvent {
  readerSessionId: ReaderSessionId;
  stateRevision: number;
  pageIndex: number;
  pageCount: number;
}

export interface ReaderErrorEvent {
  readerSessionId: ReaderSessionId;
  stateRevision: number;
  error: FlinkError;
}

export interface FlinkPDFViewEventMap {
  onViewReady: (event: ReaderViewReadyEvent) => void;
  onReaderStateChanged: (event: ReaderStateChangedEvent) => void;
  onPageChanged: (event: PageChangedEvent) => void;
  onReaderError: (event: ReaderErrorEvent) => void;
}

export type CameraAuthorization =
  | 'notDetermined'
  | 'authorized'
  | 'denied'
  | 'restricted';

export interface FaceCapabilities {
  faceTrackingSupported: boolean;
  cameraAuthorization: CameraAuthorization;
  nativeApiVersion: number;
  nativeRuntimeSignature: string;
}

export interface FaceSample {
  seq: number;
  /** Native monotonic clock; never compare this with a JavaScript clock. */
  nativeMs: number;
  /** ARFrame timestamp, used only for duplicate/order checks. */
  frameTimestamp: number;
  trackingEpoch: TrackingEpoch;
  context: InputContext;
  faceId: string | null;
  tracked: boolean;
  left: number | null;
  right: number | null;
  /** Debug-face mouth input. It is never a page-turn signal. */
  jawOpen: number | null;
}

export interface FaceBatch {
  trackingEpoch: TrackingEpoch;
  nativeNowMs: number;
  overflowed: boolean;
  /** Time ordered. Native must not average away a closed-eye peak. */
  samples: FaceSample[];
}

export interface FlinkFaceAPI {
  getCapabilities(): Promise<FaceCapabilities>;
  requestCameraPermission(): Promise<CameraAuthorization>;
  startTracking(
    context: InputContext,
  ): Promise<{ trackingEpoch: TrackingEpoch }>;
  stopTracking(context: InputContext, reason: string): Promise<void>;
  resetInput(
    context: InputContext,
  ): Promise<{ trackingEpoch: TrackingEpoch }>;
  drainSamples(trackingEpoch: TrackingEpoch): Promise<FaceBatch>;
}

export interface GestureIntent {
  eventId: string;
  kind: 'bilateralBlink';
  action: 'nextPage';
  triggerMode: TriggerMode;
  inputContext: InputContext;
  trackingEpoch: TrackingEpoch;
  sampleNativeMs: number;
}

export type NativeBuildProfile = 'development' | 'production' | 'unknown';

export interface NativeRuntimeInfo {
  nativeApiVersion: number;
  nativeRuntimeVersion: string;
  /** `unresolved` until a CI-resolved native signature is embedded. */
  nativeRuntimeSignature: string;
  buildProfile: NativeBuildProfile;
  /** Build metadata only; never inferred with Git at runtime. */
  sourceCommit: string | null;
}

export type FlinkNativeModuleEventMap = FlinkFilesEventMap;

export interface NativeEventSubscription {
  remove(): void;
}

export interface FlinkNativeEventAPI {
  addListener<EventName extends keyof FlinkNativeModuleEventMap>(
    eventName: EventName,
    listener: FlinkNativeModuleEventMap[EventName],
  ): NativeEventSubscription;
}

export interface FlinkNativeAPI
  extends FlinkFilesAPI,
    FlinkFaceAPI,
    FlinkNativeEventAPI {
  readonly nativeApiVersion: number;
  readonly nativeRuntimeVersion: string;
  readonly nativeRuntimeSignature: string;
  getRuntimeInfo(): Promise<NativeRuntimeInfo>;
}

export interface NativeViewEvent<T> {
  nativeEvent: T;
}

export interface FlinkPDFViewEventProps {
  onViewReady?: (event: NativeViewEvent<ReaderViewReadyEvent>) => void;
  onReaderStateChanged?: (
    event: NativeViewEvent<ReaderStateChangedEvent>,
  ) => void;
  onPageChanged?: (event: NativeViewEvent<PageChangedEvent>) => void;
  onReaderError?: (event: NativeViewEvent<ReaderErrorEvent>) => void;
}

export interface FlinkFaceDebugViewProps {
  /** Stops SceneKit rendering while false; it does not own or restart ARSession. */
  visible: boolean;
}
