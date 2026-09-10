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
let filesTypesSource;
let thumbnailSource;
let pdfLoaderSource;
let pdfViewSource;
let faceSource;
let faceDebugSource;
let smokeScreenSource;

beforeAll(async () => {
  const paths = await swiftFiles(IOS_ROOT);
  [
    allSwift,
    moduleSource,
    importSource,
    filesSource,
    filesTypesSource,
    thumbnailSource,
    pdfLoaderSource,
    pdfViewSource,
    faceSource,
    faceDebugSource,
    smokeScreenSource,
  ] = await Promise.all([
    Promise.all(paths.map((file) => readFile(file, 'utf8'))).then((values) =>
      values.join('\n'),
    ),
    source('FlinkNativeModule.swift'),
    source('Files/FlinkImportCoordinator.swift'),
    source('Files/LibraryFileService.swift'),
    source('Files/FlinkFilesTypes.swift'),
    source('Files/FlinkThumbnailService.swift'),
    source('PDF/FlinkPDFDocumentLoader.swift'),
    source('PDF/FlinkPDFView.swift'),
    source('Face/FaceSessionCoordinator.swift'),
    source('Face/FlinkFaceDebugView.swift'),
    readFile(
      path.join(ROOT, 'src', 'features', 'smoke', 'phase2-smoke-screen.tsx'),
      'utf8',
    ),
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

  it('coordinates mutations from a trusted root and uses promised resource values', () => {
    expect(filesSource).toContain('NSFileAccessIntent');
    expect(filesSource).toMatch(
      /sourceOptions: \.forMoving,[\s\S]*?operation: "renameDocument"/,
    );
    expect(filesSource).toMatch(
      /sourceOptions: \.forDeleting,[\s\S]*?operation: "deleteDocument"/,
    );

    const mutationCoordinator = filesSource.slice(
      filesSource.indexOf('private func coordinateMutation('),
      filesSource.indexOf('private func revalidateResolvedDocument('),
    );
    expect(mutationCoordinator).toContain('sourceIntent');
    expect(mutationCoordinator).toContain('parentIntent');
    expect(mutationCoordinator).toContain('rootIntent');
    expect(mutationCoordinator).toContain('coordinator.coordinate(with: intents, queue: accessQueue)');
    expect(mutationCoordinator).toContain('sourceIntent.url');
    expect(mutationCoordinator).toContain('parentIntent?.url ?? rootIntent.url');
    expect(mutationCoordinator).toContain('rootIntent.url');
    expect(mutationCoordinator).toContain('CoordinationOutcome');
    expect(mutationCoordinator).toContain('@escaping @Sendable');
    expect(mutationCoordinator).toContain('expectedLibraryRootIdentity');
    expect(mutationCoordinator).toContain('withExtendedLifetime((coordinator, accessQueue))');
    expect(mutationCoordinator).not.toContain('writingItemAt: destination');

    expect(filesSource).not.toContain('private func coordinatedLibraryRoot(');
    expect(filesSource).toContain('promisedItemResourceValues(forKeys: keys)');
    expect(filesSource).toContain('private func assertNoCoordinatedSymbolicLink(');
    expect(filesSource).toContain('private func validatedRelativePathComponents(');
    expect(filesSource).toMatch(
      /coordinatedLibraryRoot: URL,[\s\S]*?validatedRelativePathComponents\([\s\S]*?coordinatedURL\([\s\S]*?assertNoCoordinatedSymbolicLink\(/,
    );
    expect(filesSource).toMatch(
      /coordinatedParent,[\s\S]*?rootedParent,/,
    );
    expect(filesTypesSource).toContain('path.v1.coordinated-parent-identity');
    expect(filesSource).toMatch(
      /coordinatedSource,[\s\S]*?rootedSource,[\s\S]*?fileChanged/,
    );
    expect(filesSource).toMatch(
      /FlinkPathDiagnostic\.coordinatedLibraryKind[\s\S]*?FlinkPathDiagnostic\.coordinatedLibraryIdentity/,
    );
    expect(filesSource).toMatch(
      /let coordinatedDestination = mutationURLs\.sourceParent[\s\S]*?appendingPathComponent\(newName, isDirectory: false\)/,
    );
    expect(filesSource).toMatch(
      /atomicRenameNoReplace\([\s\S]*?usesPromisedItemResourceValues: true/,
    );
    expect(filesSource).not.toContain('coordinator.item(');
    expect(filesSource).toMatch(
      /canonicalRelativePath\(\$0\.relativePath\)\s*== canonicalRelativePath\(expectedRelativePath\)/,
    );
    expect(filesTypesSource).not.toContain(
      'candidate.resolvingSymlinksInPath()',
    );

    const coordinatorRevalidation = filesSource.slice(
      filesSource.indexOf('private func revalidateResolvedDocument('),
      filesSource.indexOf('private func rejectRenameConflict('),
    );
    expect(coordinatorRevalidation).not.toContain('FlinkResourceIdentity.hashed');
    expect(coordinatorRevalidation).not.toContain('coordinatedSource.lastPathComponent');
    expect(coordinatorRevalidation).not.toContain('coordinatedSource.deletingLastPathComponent');
    expect(coordinatorRevalidation).toContain('resourceIdentity: resolved.resourceIdentity');
    expect(coordinatorRevalidation).toContain('usesPromisedItemResourceValues: true');
    expect(coordinatorRevalidation).toContain('source: coordinatedSource');
    expect(coordinatorRevalidation).toContain('sourceParent: coordinatedParent');
    expect(coordinatorRevalidation).toContain(
      'FlinkPathDiagnostic.coordinatedParentKind',
    );
    expect(coordinatorRevalidation).toContain('values.isSymbolicLink == false');
    expect(filesSource).toContain('includingPropertiesForKeys: nil');
    expect(filesTypesSource).toContain('guard values.isSymbolicLink == false');

    const identityHelper = filesSource.slice(
      filesSource.indexOf('private func isSameFileSystemResource('),
      filesSource.indexOf('private func posixMutationError('),
    );
    expect(identityHelper).toContain(') throws -> Bool');
    expect(identityHelper).toContain('let left = try resourceValues(');
    expect(identityHelper).toContain('let right = try resourceValues(');
    expect(identityHelper).not.toContain('try? resourceValues(');
    expect(identityHelper).toContain(
      'return leftIdentifier.isEqual(rightIdentifier)',
    );
    expect(identityHelper).toContain('return try hasSamePOSIXIdentity(lhs, rhs, operation: operation)');
    expect(identityHelper).toContain('private func posixIdentity(');
    expect(identityHelper).toContain('POSIXFileSystemIdentity(');
    expect(identityHelper).toContain('device: UInt64(status.st_dev)');
    expect(identityHelper).toContain('inode: UInt64(status.st_ino)');
    expect(identityHelper).not.toContain('FlinkResourceIdentity.hashed');
  });

  it('uses fixed, path-free diagnostics for every path-boundary rejection', () => {
    expect(filesTypesSource).toContain('internal enum FlinkPathDiagnostic');
    expect(filesTypesSource).toContain('override var debugDescription');
    expect(filesTypesSource).toContain('return FlinkFilesException(');
    expect(filesTypesSource).toContain('diagnostic: FlinkPathDiagnostic.relativePathOutsideRoot.rawValue');
    expect(filesTypesSource).toContain('diagnostic: FlinkPathDiagnostic.relativePathInvalidComponent.rawValue');
    expect(filesTypesSource).toContain('diagnostic: FlinkPathDiagnostic.pathOutsideRoot.rawValue');
    expect(filesTypesSource).toContain('diagnostic: FlinkPathDiagnostic.pathRootSymbolicLink.rawValue');
    expect(filesTypesSource).toContain('diagnostic: FlinkPathDiagnostic.pathDescendantSymbolicLink.rawValue');
    expect(filesSource).toContain('diagnostic: FlinkPathDiagnostic.resolveSourceKind.rawValue');
    expect(filesSource).toContain('diagnostic: FlinkPathDiagnostic.coordinatedSourceKind.rawValue');
    expect(filesSource).toContain('diagnostic: FlinkPathDiagnostic.coordinatedParentIdentity.rawValue');
    expect(filesSource).toContain('diagnostic: FlinkPathDiagnostic.nonFileIdentityURL.rawValue');
    expect(smokeScreenSource).toContain('formatNativeErrorForDisplay(normalized)');
    expect(smokeScreenSource).not.toContain('caught.message');
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
    expect(pdfViewSource).not.toContain('.singlePageContinuous');
    expect(pdfViewSource).toMatch(
      /func fitCurrentPage[\s\S]*?fitDisplayedPage\(\)/,
    );
    expect(pdfViewSource).toMatch(
      /let fit = pdfView\.scaleFactorForSizeToFit[\s\S]*?pdfView\.scaleFactor = fit/,
    );
    expect(smokeScreenSource).toContain('label="ページ全体"');
    expect(smokeScreenSource).toContain(
      '現在の1ページを画面内に収めるズームリセットです。',
    );
  });

  it('waits for the mounted native view before opening a PDF', () => {
    expect(moduleSource).toMatch(
      /View\(FlinkPDFView\.self\)[\s\S]*?Events\([\s\S]*?"onViewReady"/,
    );
    expect(pdfViewSource).toContain('let onViewReady = EventDispatcher()');
    expect(pdfViewSource).toMatch(
      /override func didMoveToWindow\(\)[\s\S]*?window != nil, !didEmitViewReady[\s\S]*?onViewReady\(\["ready": true\]\)/,
    );
    expect(smokeScreenSource).toContain(
      'const [pdfViewReady, setPdfViewReady] = useState(false);',
    );
    expect(smokeScreenSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(!pdfViewReady\) return;[\s\S]*?\.openDocument\(/,
    );
    expect(smokeScreenSource).toContain(
      'onViewReady={() => setPdfViewReady(true)}',
    );
    expect(smokeScreenSource).toContain('}, [entry, pdfViewReady]);');
  });

  it('owns one explicit ARSession with a bounded pull buffer and watchdog', () => {
    expect(allSwift.match(/\bARSession\s*\(/g) ?? []).toHaveLength(1);
    expect(faceSource).toContain('ARFaceTrackingConfiguration.isSupported');
    expect(faceSource).toContain('.eyeBlinkLeft');
    expect(faceSource).toContain('.eyeBlinkRight');
    expect(faceSource).toContain('drainSamples');
    expect(faceSource).toMatch(
      /func drainSamples\(trackingEpoch requestedEpoch: String\) throws -> \[String: Any\] \{[\s\S]*?return try withStateLock \{/,
    );
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
