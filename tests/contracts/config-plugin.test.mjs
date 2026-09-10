import { describe, expect, it } from 'vitest';

import flinkPlugin from '../../plugins/with-flink-ios.js';

const {
  applyFlinkBaseConfig,
  applyFlinkInfoPlist,
  resolveBuildProfile,
  resolveBuildMetadata,
  constants,
} = flinkPlugin;

describe('Flink iOS config plugin', () => {
  it('defaults unspecified builds to the safer production profile', () => {
    expect(resolveBuildProfile({})).toBe('production');
    expect(() => resolveBuildProfile({ FLINK_BUILD_PROFILE: 'debug' })).toThrow(
      /development.*production/,
    );
  });

  it('enforces the app identity, adaptive UI, and iOS 18 target', () => {
    expect(applyFlinkBaseConfig({ ios: {} })).toMatchObject({
      name: 'Flink',
      slug: 'flink',
      scheme: 'flink',
      orientation: 'default',
      userInterfaceStyle: 'automatic',
      ios: {
        bundleIdentifier: 'com.aioi.flink',
        deploymentTarget: '18.0',
        supportsTablet: true,
      },
    });

    expect(
      applyFlinkBaseConfig({ ios: { bundleIdentifier: 'jp.example.flink' } }),
    ).toMatchObject({ ios: { bundleIdentifier: 'jp.example.flink' } });
  });

  it('validates and embeds non-secret native build metadata', () => {
    const metadata = resolveBuildMetadata({
      FLINK_NATIVE_RUNTIME_VERSION: '1.2.3-beta.1',
      FLINK_NATIVE_RUNTIME_SIGNATURE: 'a'.repeat(64),
      FLINK_SOURCE_COMMIT: 'b'.repeat(40),
      FLINK_BUILD_NUMBER: '123.2',
    });
    const plist = applyFlinkInfoPlist({}, 'development', metadata);

    expect(plist).toMatchObject({
      FlinkNativeRuntimeVersion: '1.2.3-beta.1',
      FlinkNativeRuntimeSignature: 'a'.repeat(64),
      FlinkNativeSourceCommit: 'b'.repeat(40),
      FlinkNativeBuildProfile: 'development',
    });
    expect(() =>
      resolveBuildMetadata({ FLINK_NATIVE_RUNTIME_SIGNATURE: 'not-a-digest' }),
    ).toThrow(/SHA-256/);
    expect(() =>
      resolveBuildMetadata({ FLINK_SOURCE_COMMIT: 'short' }),
    ).toThrow(/commit id/);
    expect(() =>
      resolveBuildMetadata({ FLINK_BUILD_NUMBER: '1.2.3.4' }),
    ).toThrow(/numeric components/);
  });

  it('adds only the bounded development LAN configuration', () => {
    const plist = applyFlinkInfoPlist(
      {
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      },
      'development',
    );

    expect(plist.NSLocalNetworkUsageDescription).toContain('Expo Dev Launcher');
    expect(plist.NSBonjourServices).toContain('_expo._tcp');
    expect(plist.NSAppTransportSecurity).toEqual({ NSAllowsLocalNetworking: true });
    expect(plist.NSCameraUsageDescription).toBe(constants.CAMERA_USAGE_DESCRIPTION);
    expect(plist.UIFileSharingEnabled).toBe(true);
    expect(plist.LSSupportsOpeningDocumentsInPlace).toBe(true);
  });

  it('removes Expo LAN, localhost, and every blanket transport exception in production', () => {
    const plist = applyFlinkInfoPlist(
      {
        NSBonjourServices: ['_other._tcp.', '_expo._tcp'],
        NSLocalNetworkUsageDescription: 'development only',
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSAllowsArbitraryLoadsForMedia: true,
          NSAllowsArbitraryLoadsInWebContent: true,
          NSAllowsLocalNetworking: true,
          NSExceptionDomains: { localhost: { NSExceptionAllowsInsecureHTTPLoads: true } },
        },
      },
      'production',
    );

    expect(plist.NSBonjourServices).toEqual(['_other._tcp.']);
    expect(plist).not.toHaveProperty('NSLocalNetworkUsageDescription');
    expect(plist.NSAppTransportSecurity).toBeUndefined();
    expect(plist.UISupportedInterfaceOrientations).toEqual(
      constants.IPHONE_ORIENTATIONS,
    );
    expect(plist['UISupportedInterfaceOrientations~ipad']).toEqual(
      constants.IPAD_ORIENTATIONS,
    );
    expect(plist.UIRequiresFullScreen).toBe(false);
  });
});
