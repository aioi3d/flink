'use strict';

const {
  IOSConfig,
  createRunOncePlugin,
  withInfoPlist,
} = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-flink-ios';
const PLUGIN_VERSION = '1.0.0';
const DEFAULT_BUNDLE_IDENTIFIER = 'com.aioi.flink';
const DEFAULT_NATIVE_RUNTIME_VERSION = '1.0.5';
const CAMERA_USAGE_DESCRIPTION =
  '両目の瞬きを検出してPDFのページを送るためにカメラを使用します。映像は保存・送信しません。';
const LOCAL_NETWORK_USAGE_DESCRIPTION =
  'Expo Dev Launcher がWindows上の開発サーバーを検出し、接続するためにローカルネットワークを使用します。';
const EXPO_BONJOUR_SERVICE = '_expo._tcp';

const IPHONE_ORIENTATIONS = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

const IPAD_ORIENTATIONS = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

function resolveBuildProfile(environment = process.env) {
  const value = environment.FLINK_BUILD_PROFILE;
  if (value === undefined || value === '') {
    return 'production';
  }
  if (value !== 'development' && value !== 'production') {
    throw new Error(
      `[${PLUGIN_NAME}] FLINK_BUILD_PROFILE must be "development" or "production"; received ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function resolveBuildMetadata(environment = process.env) {
  const nativeRuntimeVersion =
    environment.FLINK_NATIVE_RUNTIME_VERSION || DEFAULT_NATIVE_RUNTIME_VERSION;
  const nativeRuntimeSignature =
    environment.FLINK_NATIVE_RUNTIME_SIGNATURE || 'unresolved';
  const sourceCommit = environment.FLINK_SOURCE_COMMIT || undefined;
  const buildNumber = environment.FLINK_BUILD_NUMBER || undefined;

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nativeRuntimeVersion)) {
    throw new Error(
      `[${PLUGIN_NAME}] FLINK_NATIVE_RUNTIME_VERSION must be a semantic version.`,
    );
  }
  if (
    nativeRuntimeSignature !== 'unresolved' &&
    !/^[a-f0-9]{64}$/.test(nativeRuntimeSignature)
  ) {
    throw new Error(
      `[${PLUGIN_NAME}] FLINK_NATIVE_RUNTIME_SIGNATURE must be "unresolved" or a lowercase SHA-256 digest.`,
    );
  }
  if (sourceCommit !== undefined && !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error(
      `[${PLUGIN_NAME}] FLINK_SOURCE_COMMIT must be a full lowercase Git commit id.`,
    );
  }
  if (buildNumber !== undefined && !/^\d+(?:\.\d+){0,2}$/.test(buildNumber)) {
    throw new Error(
      `[${PLUGIN_NAME}] FLINK_BUILD_NUMBER must contain one to three numeric components.`,
    );
  }

  return {
    nativeRuntimeVersion,
    nativeRuntimeSignature,
    sourceCommit,
    buildNumber,
  };
}

function withoutExpoBonjourService(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const remaining = value.filter(
    (service) =>
      typeof service !== 'string' ||
      service.toLowerCase().replace(/\.$/, '') !== EXPO_BONJOUR_SERVICE,
  );
  return remaining.length > 0 ? remaining : undefined;
}

function configureTransportSecurity(infoPlist, profile) {
  const current =
    infoPlist.NSAppTransportSecurity &&
    typeof infoPlist.NSAppTransportSecurity === 'object' &&
    !Array.isArray(infoPlist.NSAppTransportSecurity)
      ? { ...infoPlist.NSAppTransportSecurity }
      : {};

  // Flink never permits a blanket transport exception. A development client only
  // needs local-network access; production removes that exception as well.
  delete current.NSAllowsArbitraryLoads;
  delete current.NSAllowsArbitraryLoadsInWebContent;
  delete current.NSAllowsArbitraryLoadsForMedia;

  if (profile === 'development') {
    current.NSAllowsLocalNetworking = true;
  } else {
    delete current.NSAllowsLocalNetworking;

    // expo-dev-client's config can contribute a localhost exception. It is
    // useful while loading a development bundle, but it must not leak into a
    // production Info.plist.
    if (
      current.NSExceptionDomains &&
      typeof current.NSExceptionDomains === 'object' &&
      !Array.isArray(current.NSExceptionDomains)
    ) {
      const remainingDomains = Object.fromEntries(
        Object.entries(current.NSExceptionDomains).filter(
          ([domain]) => domain.toLowerCase().replace(/\.$/, '') !== 'localhost',
        ),
      );
      if (Object.keys(remainingDomains).length === 0) {
        delete current.NSExceptionDomains;
      } else {
        current.NSExceptionDomains = remainingDomains;
      }
    }
  }

  if (Object.keys(current).length === 0) {
    delete infoPlist.NSAppTransportSecurity;
  } else {
    infoPlist.NSAppTransportSecurity = current;
  }
}

function applyFlinkInfoPlist(infoPlist, profile, metadata = resolveBuildMetadata()) {
  const result = { ...infoPlist };
  result.UIFileSharingEnabled = true;
  result.LSSupportsOpeningDocumentsInPlace = true;
  result.NSCameraUsageDescription = CAMERA_USAGE_DESCRIPTION;
  result.UISupportedInterfaceOrientations = [...IPHONE_ORIENTATIONS];
  result['UISupportedInterfaceOrientations~ipad'] = [...IPAD_ORIENTATIONS];
  result.UIRequiresFullScreen = false;
  result.FlinkNativeRuntimeVersion = metadata.nativeRuntimeVersion;
  result.FlinkNativeRuntimeSignature = metadata.nativeRuntimeSignature;
  result.FlinkNativeBuildProfile = profile;
  if (metadata.sourceCommit) {
    result.FlinkNativeSourceCommit = metadata.sourceCommit;
  } else {
    delete result.FlinkNativeSourceCommit;
  }

  if (profile === 'development') {
    const services = Array.isArray(result.NSBonjourServices)
      ? [...result.NSBonjourServices]
      : [];
    const hasExpoService = services.some(
      (service) =>
        typeof service === 'string' &&
        service.toLowerCase().replace(/\.$/, '') === EXPO_BONJOUR_SERVICE,
    );
    if (!hasExpoService) {
      services.push(EXPO_BONJOUR_SERVICE);
    }
    result.NSBonjourServices = services;
    result.NSLocalNetworkUsageDescription = LOCAL_NETWORK_USAGE_DESCRIPTION;
  } else {
    const remaining = withoutExpoBonjourService(result.NSBonjourServices);
    if (remaining) {
      result.NSBonjourServices = remaining;
    } else {
      delete result.NSBonjourServices;
    }
    delete result.NSLocalNetworkUsageDescription;
  }

  configureTransportSecurity(result, profile);
  return result;
}

function applyFlinkBaseConfig(config) {
  return {
    ...config,
    name: 'Flink',
    slug: 'flink',
    scheme: 'flink',
    orientation: 'default',
    userInterfaceStyle: 'automatic',
    ios: {
      ...(config.ios ?? {}),
      bundleIdentifier: config.ios?.bundleIdentifier ?? DEFAULT_BUNDLE_IDENTIFIER,
      deploymentTarget: '18.0',
      supportsTablet: true,
    },
  };
}

function withFlinkIos(config) {
  const profile = resolveBuildProfile();
  const metadata = resolveBuildMetadata();
  let nextConfig = applyFlinkBaseConfig(config);
  if (metadata.buildNumber) {
    nextConfig.ios.buildNumber = metadata.buildNumber;
  }

  // SDK 57 has a built-in ios.deploymentTarget property. Explicitly install the
  // matching mods so this plugin remains independently reproducible.
  nextConfig = IOSConfig.DeploymentTarget.withDeploymentTarget(nextConfig);
  nextConfig = IOSConfig.DeploymentTarget.withDeploymentTargetPodfileProps(nextConfig);
  nextConfig = withInfoPlist(nextConfig, (modConfig) => {
    modConfig.modResults = applyFlinkInfoPlist(
      modConfig.modResults,
      profile,
      metadata,
    );
    return modConfig;
  });

  return nextConfig;
}

module.exports = createRunOncePlugin(withFlinkIos, PLUGIN_NAME, PLUGIN_VERSION);
module.exports.applyFlinkBaseConfig = applyFlinkBaseConfig;
module.exports.applyFlinkInfoPlist = applyFlinkInfoPlist;
module.exports.resolveBuildProfile = resolveBuildProfile;
module.exports.resolveBuildMetadata = resolveBuildMetadata;
module.exports.constants = {
  CAMERA_USAGE_DESCRIPTION,
  EXPO_BONJOUR_SERVICE,
  IPAD_ORIENTATIONS,
  IPHONE_ORIENTATIONS,
  LOCAL_NETWORK_USAGE_DESCRIPTION,
  DEFAULT_BUNDLE_IDENTIFIER,
  DEFAULT_NATIVE_RUNTIME_VERSION,
};
