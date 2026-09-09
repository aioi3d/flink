import { describe, expect, it } from 'vitest';

import flinkPlugin from '../../plugins/with-flink-ios.js';

const {
  applyFlinkBaseConfig,
  applyFlinkInfoPlist,
  resolveBuildProfile,
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
        bundleIdentifier: 'com.local.flink',
        deploymentTarget: '18.0',
        supportsTablet: true,
      },
    });

    expect(
      applyFlinkBaseConfig({ ios: { bundleIdentifier: 'jp.example.flink' } }),
    ).toMatchObject({ ios: { bundleIdentifier: 'jp.example.flink' } });
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
