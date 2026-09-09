import { requireOptionalNativeModule } from 'expo';

import {
  NATIVE_API_VERSION,
  type CameraAuthorization,
  type DocumentRef,
  type FaceBatch,
  type FaceCapabilities,
  type FlinkNativeAPI,
  type FlinkNativeModuleEventMap,
  type ImportResult,
  type InputContext,
  type LibrarySnapshot,
  type NativeEventSubscription,
  type NativeRuntimeInfo,
  type ThumbnailResult,
  type TrackingEpoch,
} from './contracts';
import { FlinkNativeError, normalizeNativeError } from './errors';

const MODULE_NAME = 'FlinkNative';

interface NativeFlinkModule {
  readonly nativeApiVersion: number;
  readonly nativeRuntimeVersion: string;
  readonly nativeRuntimeSignature: string;
  getRuntimeInfo(): Promise<NativeRuntimeInfo>;
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
  addListener<EventName extends keyof FlinkNativeModuleEventMap>(
    eventName: EventName,
    listener: FlinkNativeModuleEventMap[EventName],
  ): NativeEventSubscription;
}

let resolvedModule: NativeFlinkModule | null | undefined;

function unavailable(operation: string): FlinkNativeError {
  return new FlinkNativeError({
    code: 'E_NATIVE_RUNTIME_MISMATCH',
    operation,
    recoverable: false,
    detail: `${MODULE_NAME} is not linked into this runtime.`,
  });
}

function incompatible(
  operation: string,
  actualVersion: unknown,
): FlinkNativeError {
  const printableVersion =
    typeof actualVersion === 'number' || typeof actualVersion === 'string'
      ? String(actualVersion)
      : 'missing';

  return new FlinkNativeError({
    code: 'E_NATIVE_RUNTIME_MISMATCH',
    operation,
    recoverable: false,
    detail: `Expected native API ${NATIVE_API_VERSION}; received ${printableVersion}.`,
  });
}

export function requireCompatibleFlinkNativeModule(
  operation: string,
): NativeFlinkModule {
  if (resolvedModule === undefined) {
    resolvedModule = requireOptionalNativeModule<NativeFlinkModule>(MODULE_NAME);
  }

  if (resolvedModule === null) {
    throw unavailable(operation);
  }

  if (resolvedModule.nativeApiVersion !== NATIVE_API_VERSION) {
    throw incompatible(operation, resolvedModule.nativeApiVersion);
  }

  return resolvedModule;
}

async function invoke<Result>(
  operation: string,
  call: (module: NativeFlinkModule) => Promise<Result>,
): Promise<Result> {
  try {
    return await call(requireCompatibleFlinkNativeModule(operation));
  } catch (error) {
    throw normalizeNativeError(error, operation);
  }
}

export function createProductionFlinkNative(): FlinkNativeAPI {
  return {
    get nativeApiVersion() {
      return requireCompatibleFlinkNativeModule('nativeApiVersion')
        .nativeApiVersion;
    },
    get nativeRuntimeVersion() {
      return requireCompatibleFlinkNativeModule('nativeRuntimeVersion')
        .nativeRuntimeVersion;
    },
    get nativeRuntimeSignature() {
      return requireCompatibleFlinkNativeModule('nativeRuntimeSignature')
        .nativeRuntimeSignature;
    },
    getRuntimeInfo: () =>
      invoke('getRuntimeInfo', async (module) => {
        const info = await module.getRuntimeInfo();
        if (info.nativeApiVersion !== NATIVE_API_VERSION) {
          throw incompatible('getRuntimeInfo', info.nativeApiVersion);
        }
        return info;
      }),
    initializeLibrary: () =>
      invoke('initializeLibrary', (module) => module.initializeLibrary()),
    scanLibrary: () =>
      invoke('scanLibrary', (module) => module.scanLibrary()),
    presentImportPicker: (importId) =>
      invoke('presentImportPicker', (module) =>
        module.presentImportPicker(importId),
      ),
    cancelImport: (importId) =>
      invoke('cancelImport', (module) => module.cancelImport(importId)),
    renameDocument: (document, newBaseName) =>
      invoke('renameDocument', (module) =>
        module.renameDocument(document, newBaseName),
      ),
    deleteDocument: (document) =>
      invoke('deleteDocument', (module) => module.deleteDocument(document)),
    requestThumbnail: (document, requestId) =>
      invoke('requestThumbnail', (module) =>
        module.requestThumbnail(document, requestId),
      ),
    cancelThumbnail: (requestId) =>
      invoke('cancelThumbnail', (module) =>
        module.cancelThumbnail(requestId),
      ),
    getCapabilities: () =>
      invoke('getCapabilities', (module) => module.getCapabilities()),
    requestCameraPermission: () =>
      invoke('requestCameraPermission', (module) =>
        module.requestCameraPermission(),
      ),
    startTracking: (context) =>
      invoke('startTracking', (module) => module.startTracking(context)),
    stopTracking: (context, reason) =>
      invoke('stopTracking', (module) =>
        module.stopTracking(context, reason),
      ),
    resetInput: (context) =>
      invoke('resetInput', (module) => module.resetInput(context)),
    drainSamples: (trackingEpoch) =>
      invoke('drainSamples', (module) =>
        module.drainSamples(trackingEpoch),
      ),
    addListener: <EventName extends keyof FlinkNativeModuleEventMap>(
      eventName: EventName,
      listener: FlinkNativeModuleEventMap[EventName],
    ): NativeEventSubscription => {
      try {
        return requireCompatibleFlinkNativeModule('addListener').addListener(
          eventName,
          listener,
        );
      } catch (error) {
        throw normalizeNativeError(error, 'addListener');
      }
    },
  };
}

/** Production adapter. It never falls back to test data. */
export const flinkNative = createProductionFlinkNative();

export default flinkNative;
