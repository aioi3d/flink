import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IOS_ROOT = path.join(ROOT, 'modules', 'flink-native', 'ios');

async function swiftFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return swiftFiles(target);
      return entry.isFile() && entry.name.endsWith('.swift') ? [target] : [];
    }),
  );
  return nested.flat();
}

async function source(relativePath) {
  return readFile(path.join(IOS_ROOT, ...relativePath.split('/')), 'utf8');
}

let allSwift;
let moduleSource;
let importSource;
let filesSource;
let thumbnailSource;
let pdfLoaderSource;
let pdfViewSource;
let faceSource;
let faceDebugSource;

beforeAll(async () => {
  const paths = await swiftFiles(IOS_ROOT);
  [
    allSwift,
    moduleSource,
    importSource,
    filesSource,
    thumbnailSource,
    pdfLoaderSource,
    pdfViewSource,
    faceSource,
    faceDebugSource,
  ] = await Promise.all([
    Promise.all(paths.map((file) => readFile(file, 'utf8'))).then((values) =>
      values.join('\n'),
    ),
    source('FlinkNativeModule.swift'),
    source('Files/FlinkImportCoordinator.swift'),
    source('Files/LibraryFileService.swift'),
    source('Files/FlinkThumbnailService.swift'),
    source('PDF/FlinkPDFDocumentLoader.swift'),
    source('PDF/FlinkPDFView.swift'),
    source('Face/FaceSessionCoordinator.swift'),
    source('Face/FlinkFaceDebugView.swift'),
  ]);
});

describe('Phase 2 native source contract', () => {
  it('exposes every API-v1 bridge entry without a Phase 1 stub', () => {
    for (const name of [
      'getRuntimeInfo',
      'initializeLibrary',
      'scanLibrary',
      'presentImportPicker',
      'cancelImport',
      'renameDocument',
      'deleteDocument',
      'requestThumbnail',
      'cancelThumbnail',
      'getCapabilities',
      'requestCameraPermission',
      'startTracking',
      'stopTracking',
      'resetInput',
      'drainSamples',
      'openDocument',
      'navigate',
      'fitCurrentPage',
      'closeDocument',
    ]) {
      expect(moduleSource).toContain(`AsyncFunction("${name}")`);
    }
    expect(moduleSource).toContain('ViewName("FlinkFaceDebugView")');
    expect(allSwift).not.toContain('NOT_IMPLEMENTED');
  });

  it('streams coordinated security-scoped imports and commits without replacement', () => {
    expect(importSource).toContain('UIDocumentPickerViewController');
    expect(importSource).toContain('allowsMultipleSelection = true');
    expect(importSource).toContain('startAccessingSecurityScopedResource()');
    expect(importSource).toContain('stopAccessingSecurityScopedResource()');
    expect(importSource).toContain('NSFileCoordinator');
    expect(importSource).toContain('FileHandle(forReadingFrom:');
    expect(importSource).toContain('read(upToCount: 1_048_576)');
    expect(importSource).toContain('RENAME_EXCL');
    expect(importSource).not.toContain('Data(contentsOf:');
  });

  it('uses revision-checked coordinated mutations and never loads PDFs while scanning', () => {
    expect(filesSource).toContain('fileResourceIdentifierKey');
    expect(filesSource).toContain('NSFileCoordinator');
    expect(filesSource).toContain('RENAME_EXCL');
    expect(filesSource).toContain('revalidateResolvedDocument');
    expect(filesSource).not.toContain('PDFDocument(');
  });

  it('keeps thumbnail work serial, bounded, cancellable, and pressure-aware', () => {
    expect(thumbnailSource).toContain('maximumQueuedJobs = 64');
    expect(thumbnailSource).toContain('diskCacheLimit: Int64 = 128 * 1_024 * 1_024');
    expect(thumbnailSource).toContain('didReceiveMemoryWarningNotification');
    expect(thumbnailSource).toContain('PDFDocument(url:');
    expect(thumbnailSource).toContain('pdf.page(at: 0)');
  });

  it('loads PDFKit documents by URL and provides single-page native navigation', () => {
    expect(pdfLoaderSource).toContain('PDFDocument(url:');
    expect(pdfLoaderSource).not.toContain('PDFDocument(data:');
    expect(pdfViewSource).toContain('displayMode = .singlePage');
    expect(pdfViewSource).toContain('scaleFactorForSizeToFit');
    expect(pdfViewSource).toContain('recentCommandIds');
    expect(pdfViewSource).toContain('FlinkReaderContextBroker.shared');
  });

  it('owns one explicit ARSession with a bounded pull buffer and watchdog', () => {
    expect(allSwift.match(/\bARSession\s*\(/g) ?? []).toHaveLength(1);
    expect(faceSource).toContain('ARFaceTrackingConfiguration.isSupported');
    expect(faceSource).toContain('.eyeBlinkLeft');
    expect(faceSource).toContain('.eyeBlinkRight');
    expect(faceSource).toContain('drainSamples');
    expect(faceSource).toContain('runWatchdogLocked');
    expect(faceSource).not.toContain('Data(contentsOf:');
  });

  it('keeps the release debug view opaque and attached to the shared session', () => {
    expect(faceDebugSource).toContain('backgroundColor = .white');
    expect(faceDebugSource).toContain('isOpaque = true');
    expect(faceDebugSource).toContain('coordinator.connectDebugSceneView(arSceneView)');
    expect(faceDebugSource).toContain('red: 58.0 / 255.0');
    expect(faceDebugSource).toContain('faceNode.isHidden');
  });
});
