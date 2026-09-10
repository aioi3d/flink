import {
  forwardRef,
  type ComponentType,
  type RefAttributes,
} from 'react';
import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

import type { FlinkFaceDebugViewProps as NativeFaceDebugProps } from './contracts';
import { normalizeNativeError } from './errors';
import { requireCompatibleFlinkNativeModule } from './production';

type FlinkFaceDebugViewProps = ViewProps & NativeFaceDebugProps;
type NativeFaceDebugViewProps = FlinkFaceDebugViewProps & RefAttributes<unknown>;

let cachedNativeView: ComponentType<NativeFaceDebugViewProps> | undefined;

function getNativeView(): ComponentType<NativeFaceDebugViewProps> {
  try {
    requireCompatibleFlinkNativeModule('renderFaceDebugView');
    cachedNativeView ??= requireNativeView<FlinkFaceDebugViewProps>(
      'FlinkNative',
      'FlinkFaceDebugView',
    );
    return cachedNativeView;
  } catch (error) {
    throw normalizeNativeError(error, 'renderFaceDebugView');
  }
}

/** Camera-free SceneKit visualization backed by the single shared ARSession. */
export const FlinkFaceDebugView = forwardRef<unknown, FlinkFaceDebugViewProps>(
  function FlinkFaceDebugView(props, ref) {
    const NativeView = getNativeView();
    return <NativeView {...props} ref={ref} />;
  },
);
