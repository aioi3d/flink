import {
  NATIVE_API_VERSION,
  type FlinkNativeAPI,
  type FlinkNativeModuleEventMap,
  type FlinkPDFViewRef,
  type NativeEventSubscription,
  type NativeRuntimeInfo,
} from './contracts';
import { FlinkNativeError } from './errors';

type NativeMethodOverrides = Partial<
  Omit<
    FlinkNativeAPI,
    | 'nativeApiVersion'
    | 'nativeRuntimeVersion'
    | 'nativeRuntimeSignature'
    | 'addListener'
  >
>;

export interface FlinkNativeMockOptions extends NativeMethodOverrides {
  runtimeInfo?: Partial<NativeRuntimeInfo>;
}

export interface FlinkNativeMockController {
  /** Explicitly inject this value; production code never selects it itself. */
  api: FlinkNativeAPI;
  emit<EventName extends keyof FlinkNativeModuleEventMap>(
    eventName: EventName,
    ...args: Parameters<FlinkNativeModuleEventMap[EventName]>
  ): void;
}

function missingOverride<Result>(operation: string): Promise<Result> {
  return Promise.reject(
    new FlinkNativeError({
      code: 'E_TEST_OVERRIDE_REQUIRED',
      operation,
      recoverable: false,
      detail: 'Provide an explicit test override for this operation.',
    }),
  );
}

/**
 * Creates a test-only native double. There is intentionally no ambient flag or
 * automatic fallback that can cause this object to be used in production.
 */
export function createFlinkNativeMock(
  options: FlinkNativeMockOptions = {},
): FlinkNativeMockController {
  const runtimeInfo: NativeRuntimeInfo = {
    nativeApiVersion: NATIVE_API_VERSION,
    nativeRuntimeVersion: 'test',
    nativeRuntimeSignature: 'test-only',
    buildProfile: 'unknown',
    sourceCommit: null,
    ...options.runtimeInfo,
  };
  const listeners: {
    [EventName in keyof FlinkNativeModuleEventMap]: Set<
      FlinkNativeModuleEventMap[EventName]
    >;
  } = {
    onLibraryInvalidated: new Set(),
    onImportProgress: new Set(),
    onDocumentInvalidated: new Set(),
  };

  const api: FlinkNativeAPI = {
    nativeApiVersion: runtimeInfo.nativeApiVersion,
    nativeRuntimeVersion: runtimeInfo.nativeRuntimeVersion,
    nativeRuntimeSignature: runtimeInfo.nativeRuntimeSignature,
    getRuntimeInfo: options.getRuntimeInfo ?? (async () => runtimeInfo),
    initializeLibrary:
      options.initializeLibrary ?? (() => missingOverride('initializeLibrary')),
    scanLibrary: options.scanLibrary ?? (() => missingOverride('scanLibrary')),
    presentImportPicker:
      options.presentImportPicker ??
      (() => missingOverride('presentImportPicker')),
    cancelImport:
      options.cancelImport ?? (() => missingOverride('cancelImport')),
    renameDocument:
      options.renameDocument ?? (() => missingOverride('renameDocument')),
    deleteDocument:
      options.deleteDocument ?? (() => missingOverride('deleteDocument')),
    requestThumbnail:
      options.requestThumbnail ?? (() => missingOverride('requestThumbnail')),
    cancelThumbnail:
      options.cancelThumbnail ?? (() => missingOverride('cancelThumbnail')),
    getCapabilities:
      options.getCapabilities ?? (() => missingOverride('getCapabilities')),
    requestCameraPermission:
      options.requestCameraPermission ??
      (() => missingOverride('requestCameraPermission')),
    startTracking:
      options.startTracking ?? (() => missingOverride('startTracking')),
    stopTracking:
      options.stopTracking ?? (() => missingOverride('stopTracking')),
    resetInput: options.resetInput ?? (() => missingOverride('resetInput')),
    drainSamples:
      options.drainSamples ?? (() => missingOverride('drainSamples')),
    addListener: <EventName extends keyof FlinkNativeModuleEventMap>(
      eventName: EventName,
      listener: FlinkNativeModuleEventMap[EventName],
    ): NativeEventSubscription => {
      const eventListeners = listeners[eventName] as Set<
        FlinkNativeModuleEventMap[EventName]
      >;
      eventListeners.add(listener);
      return {
        remove: () => eventListeners.delete(listener),
      };
    },
  };

  return {
    api,
    emit: (eventName, ...args) => {
      const eventListeners = listeners[eventName] as Set<
        FlinkNativeModuleEventMap[typeof eventName]
      >;
      for (const listener of eventListeners) {
        (listener as (...eventArgs: typeof args) => void)(...args);
      }
    },
  };
}

export type FlinkPDFViewRefMockOverrides = Partial<FlinkPDFViewRef>;

export function createFlinkPDFViewRefMock(
  overrides: FlinkPDFViewRefMockOverrides = {},
): FlinkPDFViewRef {
  return {
    openDocument:
      overrides.openDocument ?? (() => missingOverride('openDocument')),
    navigate: overrides.navigate ?? (() => missingOverride('navigate')),
    closeDocument:
      overrides.closeDocument ?? (() => missingOverride('closeDocument')),
  };
}
