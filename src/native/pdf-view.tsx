import {
  forwardRef,
  type ComponentType,
  type RefAttributes,
} from 'react';
import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

import type {
  FlinkPDFViewEventProps,
  FlinkPDFViewRef,
} from './contracts';
import { normalizeNativeError } from './errors';
import { requireCompatibleFlinkNativeModule } from './production';

export type FlinkPDFViewProps = ViewProps & FlinkPDFViewEventProps;

type NativePDFViewProps = FlinkPDFViewProps & RefAttributes<FlinkPDFViewRef>;

let cachedNativeView: ComponentType<NativePDFViewProps> | undefined;

function getNativeView(): ComponentType<NativePDFViewProps> {
  try {
    requireCompatibleFlinkNativeModule('renderPDFView');
    cachedNativeView ??= requireNativeView<NativePDFViewProps>('FlinkNative');
    return cachedNativeView;
  } catch (error) {
    throw normalizeNativeError(error, 'renderPDFView');
  }
}

/** PDFKit-backed view. Rendering explicitly fails when FlinkNative is absent. */
export const FlinkPDFView = forwardRef<FlinkPDFViewRef, FlinkPDFViewProps>(
  function FlinkPDFView(props, ref) {
    const NativeView = getNativeView();
    return <NativeView {...props} ref={ref} />;
  },
);
