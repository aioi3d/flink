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

function notImplemented<Result>(operation: string): Promise<Result> {
  return Promise.reject(
    new FlinkNativeError({
      code: 'NOT_IMPLEMENTED',
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
      options.initializeLibrary ?? (() => notImplemented('initializeLibrary')),
    scanLibrary: options.scanLibrary ?? (() => notImplemented('scanLibrary')),
    presentImportPicker:
      options.presentImportPicker ??
      (() => notImplemented('presentImportPicker')),
    cancelImport:
      options.cancelImport ?? (() => notImplemented('cancelImport')),
    renameDocument:
      options.renameDocument ?? (() => notImplemented('renameDocument')),
    deleteDocument:
      options.deleteDocument ?? (() => notImplemented('deleteDocument')),
    requestThumbnail:
      options.requestThumbnail ?? (() => notImplemented('requestThumbnail')),
    cancelThumbnail:
      options.cancelThumbnail ?? (() => notImplemented('cancelThumbnail')),
    getCapabilities:
      options.getCapabilities ?? (() => notImplemented('getCapabilities')),
    requestCameraPermission:
      options.requestCameraPermission ??
      (() => notImplemented('requestCameraPermission')),
    startTracking:
      options.startTracking ?? (() => notImplemented('startTracking')),
    stopTracking:
      options.stopTracking ?? (() => notImplemented('stopTracking')),
    resetInput: options.resetInput ?? (() => notImplemented('resetInput')),
    drainSamples:
      options.drainSamples ?? (() => notImplemented('drainSamples')),
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
      overrides.openDocument ?? (() => notImplemented('openDocument')),
    navigate: overrides.navigate ?? (() => notImplemented('navigate')),
    fitCurrentPage:
      overrides.fitCurrentPage ?? (() => notImplemented('fitCurrentPage')),
    closeDocument:
      overrides.closeDocument ?? (() => notImplemented('closeDocument')),
  };
}
