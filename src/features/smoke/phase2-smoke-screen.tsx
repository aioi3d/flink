import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  FlinkFaceDebugView,
  FlinkNativeError,
  FlinkPDFView,
  flinkNative,
  normalizeNativeError,
  type FaceCapabilities,
  type FaceSample,
  type FlinkPDFViewRef,
  type ImportProgress,
  type InputContext,
  type LibraryEntry,
  type NativeRuntimeInfo,
  type ReaderSnapshot,
  type TrackingEpoch,
} from '@/native';

let tokenSequence = 0;

function makeToken(prefix: string) {
  tokenSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${tokenSequence.toString(36)}`;
}

function diagnostic(error: unknown, operation: string) {
  const normalized =
    error instanceof FlinkNativeError
      ? error
      : normalizeNativeError(error, operation);
  return `${normalized.code}: ${normalized.message}`;
}

function Button({
  label,
  onPress,
  disabled = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        danger && styles.dangerButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={[styles.buttonText, danger && styles.dangerButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Metadata({ runtime }: { runtime: NativeRuntimeInfo | null }) {
  if (!runtime) {
    return <Text style={styles.secondary}>runtime metadata: loading…</Text>;
  }
  return (
    <Text selectable style={styles.metadata}>
      API {runtime.nativeApiVersion} · runtime {runtime.nativeRuntimeVersion}{'\n'}
      {runtime.buildProfile} · {runtime.nativeRuntimeSignature}{'\n'}
      source {runtime.sourceCommit ?? 'not embedded'}
    </Text>
  );
}

function LibraryRow({
  entry,
  thumbnailUri,
  onOpen,
  onThumbnail,
  onRename,
  onDelete,
}: {
  entry: LibraryEntry;
  thumbnailUri?: string;
  onOpen: () => void;
  onThumbnail: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.fileCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entry.name}を開く`}
        onPress={onOpen}
        style={({ pressed }) => [styles.fileMain, pressed && styles.pressed]}>
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            contentFit="contain"
            style={styles.thumbnail}
          />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
            <Text style={styles.placeholderText}>PDF</Text>
          </View>
        )}
        <View style={styles.fileText}>
          <Text numberOfLines={2} style={styles.fileName}>
            {entry.name}
          </Text>
          <Text numberOfLines={1} style={styles.secondary}>
            {entry.relativePath}
          </Text>
          <Text style={styles.secondary}>
            {(entry.sizeBytes / 1_000_000).toFixed(2)} MB · {entry.status}
          </Text>
        </View>
      </Pressable>
      <View style={styles.rowActions}>
        <Button label="サムネイル" onPress={onThumbnail} />
        <Button label="名前変更" onPress={onRename} />
        <Button label="削除" danger onPress={onDelete} />
      </View>
    </View>
  );
}

function LibrarySmoke({
  onOpen,
}: {
  onOpen: (entry: LibraryEntry) => void;
}) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [runtime, setRuntime] = useState<NativeRuntimeInfo | null>(null);
  const [capabilities, setCapabilities] = useState<FaceCapabilities | null>(null);
  const [error, setError] = useState<string | null>(() =>
    Platform.OS === 'ios'
      ? null
      : 'この画面はiOS development buildで確認してください。',
  );
  const [busy, setBusy] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      setError('Phase 2 native smoke test is available on iOS only.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await flinkNative.initializeLibrary();
      const snapshot = await flinkNative.scanLibrary();
      setEntries(snapshot.entries);
    } catch (caught) {
      setError(diagnostic(caught, 'scanLibrary'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    let active = true;
    void Promise.all([
      flinkNative.getRuntimeInfo(),
      flinkNative.getCapabilities(),
    ])
      .then(([runtimeInfo, faceCapabilities]) => {
        if (active) {
          setRuntime(runtimeInfo);
          setCapabilities(faceCapabilities);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(diagnostic(caught, 'bootstrap'));
        }
      });
    queueMicrotask(() => {
      if (active) void refresh();
    });

    const invalidated = flinkNative.addListener('onLibraryInvalidated', () => {
      if (active) void refresh();
    });
    const importProgress = flinkNative.addListener(
      'onImportProgress',
      (event) => {
        if (active) setProgress(event);
      },
    );
    return () => {
      active = false;
      invalidated.remove();
      importProgress.remove();
    };
  }, [refresh]);

  const startImport = useCallback(async () => {
    const nextImportId = makeToken('import');
    setImportId(nextImportId);
    setProgress(null);
    setError(null);
    try {
      const result = await flinkNative.presentImportPicker(nextImportId);
      if (result.failures.length > 0) {
        setError(
          `一部の取り込みに失敗: ${result.failures
            .map((failure) => `${failure.name} (${failure.code})`)
            .join(', ')}`,
        );
      }
      await refresh();
    } catch (caught) {
      setError(diagnostic(caught, 'presentImportPicker'));
    } finally {
      setImportId(null);
      setProgress(null);
    }
  }, [refresh]);

  const cancelImport = useCallback(async () => {
    if (!importId) return;
    try {
      await flinkNative.cancelImport(importId);
    } catch (caught) {
      setError(diagnostic(caught, 'cancelImport'));
    }
  }, [importId]);

  const requestThumbnail = useCallback(async (entry: LibraryEntry) => {
    const requestId = makeToken('thumbnail');
    try {
      const result = await flinkNative.requestThumbnail(entry, requestId);
      if (result.cacheUri) {
        setThumbnails((current) => ({
          ...current,
          [`${entry.fileId}:${entry.revision}`]: result.cacheUri!,
        }));
      }
    } catch (caught) {
      setError(diagnostic(caught, 'requestThumbnail'));
    }
  }, []);

  const rename = useCallback(
    (entry: LibraryEntry) => {
      if (Platform.OS !== 'ios' || !Alert.prompt) return;
      Alert.prompt(
        'PDFの名前変更',
        '拡張子を除いた名前を入力してください。',
        async (newName) => {
          if (typeof newName !== 'string') return;
          try {
            await flinkNative.renameDocument(entry, newName);
            await refresh();
          } catch (caught) {
            setError(diagnostic(caught, 'renameDocument'));
          }
        },
        'plain-text',
        entry.name.replace(/\.pdf$/i, ''),
      );
    },
    [refresh],
  );

  const remove = useCallback(
    (entry: LibraryEntry) => {
      Alert.alert(
        'PDFを削除',
        'Flink/libraryからPDFファイルを削除します。この操作は取り消せません。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '削除',
            style: 'destructive',
            onPress: () => {
              void flinkNative
                .deleteDocument(entry)
                .then(refresh)
                .catch((caught) =>
                  setError(diagnostic(caught, 'deleteDocument')),
                );
            },
          },
        ],
      );
    },
    [refresh],
  );

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>PHASE 2 NATIVE SMOKE</Text>
          <Text style={styles.title}>Flink ライブラリ</Text>
        </View>
        <View style={styles.rowActions}>
          <Button label="更新" disabled={busy} onPress={() => void refresh()} />
          <Button
            label="PDFを追加"
            disabled={Boolean(importId)}
            onPress={() => void startImport()}
          />
        </View>
      </View>

      <View style={styles.runtimeCard}>
        <Metadata runtime={runtime} />
        <Text style={styles.secondary}>
          Face Tracking: {capabilities?.faceTrackingSupported ? 'supported' : 'unsupported / unknown'} · camera {capabilities?.cameraAuthorization ?? 'unknown'}
        </Text>
        <Text style={styles.notice}>
          これはnative契約確認用の最小画面です。完成UIはPhase 3で実装します。
        </Text>
      </View>

      {progress ? (
        <View style={styles.progressCard}>
          <Text numberOfLines={1} style={styles.fileName}>
            {progress.fileName}
          </Text>
          <Text style={styles.secondary}>
            {progress.stage} · {progress.copiedBytes} / {progress.totalBytes ?? '不明'} bytes
          </Text>
          <Button
            label="取り込みをキャンセル"
            danger
            onPress={() => void cancelImport()}
          />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy && entries.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : null}

      <FlatList
        data={entries}
        keyExtractor={(entry) => `${entry.fileId}:${entry.revision}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          busy ? null : (
            <Text style={styles.empty}>library内にPDFがありません。</Text>
          )
        }
        renderItem={({ item }) => (
          <LibraryRow
            entry={item}
            thumbnailUri={thumbnails[`${item.fileId}:${item.revision}`]}
            onOpen={() => onOpen(item)}
            onThumbnail={() => void requestThumbnail(item)}
            onRename={() => rename(item)}
            onDelete={() => remove(item)}
          />
        )}
      />
    </SafeAreaView>
  );
}

function ReaderSmoke({
  entry,
  onBack,
}: {
  entry: LibraryEntry;
  onBack: () => void;
}) {
  const pdfRef = useRef<FlinkPDFViewRef>(null);
  const mountedRef = useRef(true);
  const contextRef = useRef<InputContext | null>(null);
  const epochRef = useRef<TrackingEpoch | null>(null);
  const jsRuntimeId = useMemo(() => makeToken('js-runtime'), []);
  const [snapshot, setSnapshot] = useState<ReaderSnapshot | null>(null);
  const [sample, setSample] = useState<FaceSample | null>(null);
  const [tracking, setTracking] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [pdfViewReady, setPdfViewReady] = useState(false);
  const [jumpPage, setJumpPage] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (!pdfViewReady) return;

    mountedRef.current = true;
    let effectIsCurrent = true;
    const openRequestId = makeToken('open');
    let openedSessionId: string | null = null;
    const view = pdfRef.current;
    void view
      ?.openDocument({ openRequestId, document: entry })
      .then((next) => {
        openedSessionId = next.readerSessionId;
        if (effectIsCurrent && mountedRef.current) {
          setSnapshot(next);
          setJumpPage(String(next.pageIndex + 1));
        } else {
          void view.closeDocument(next.readerSessionId).catch(() => undefined);
        }
      })
      .catch((caught) => {
        if (effectIsCurrent && mountedRef.current) {
          setError(diagnostic(caught, 'openDocument'));
        }
      });

    return () => {
      effectIsCurrent = false;
      mountedRef.current = false;
      const context = contextRef.current;
      if (context) {
        void flinkNative
          .stopTracking(context, 'reader-unmount')
          .catch(() => undefined);
      }
      if (openedSessionId) {
        void view?.closeDocument(openedSessionId).catch(() => undefined);
      }
    };
  }, [entry, pdfViewReady]);

  useEffect(() => {
    if (!tracking || !epochRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => {
      if (cancelled || !epochRef.current) return;
      try {
        const batch = await flinkNative.drainSamples(epochRef.current);
        if (cancelled) return;
        if (batch.overflowed) {
          setSample(null);
        } else if (batch.samples.length > 0) {
          setSample(batch.samples.at(-1) ?? null);
        }
        timer = setTimeout(drain, 50);
      } catch (caught) {
        if (!cancelled) {
          setTracking(false);
          setError(diagnostic(caught, 'drainSamples'));
        }
      }
    };
    void drain();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tracking]);

  const navigate = useCallback(
    async (move: { delta: -1 | 1 } | { pageIndex: number }) => {
      if (!snapshot) return;
      try {
        const result = await pdfRef.current?.navigate({
          readerSessionId: snapshot.readerSessionId,
          commandId: makeToken('manual'),
          source: 'manual',
          move,
        });
        if (result) {
          setSnapshot(result.snapshot);
          setJumpPage(String(result.snapshot.pageIndex + 1));
        }
      } catch (caught) {
        setError(diagnostic(caught, 'navigate'));
      }
    },
    [snapshot],
  );

  const fit = useCallback(async () => {
    if (!snapshot) return;
    try {
      const next = await pdfRef.current?.fitCurrentPage(
        snapshot.readerSessionId,
      );
      if (next) setSnapshot(next);
    } catch (caught) {
      setError(diagnostic(caught, 'fitCurrentPage'));
    }
  }, [snapshot]);

  const startTracking = useCallback(async () => {
    if (!snapshot) return;
    setError(null);
    try {
      let capabilities = await flinkNative.getCapabilities();
      if (!capabilities.faceTrackingSupported) {
        setError('E_AR_UNSUPPORTED: この端末ではFace Trackingを利用できません。');
        return;
      }
      if (capabilities.cameraAuthorization === 'notDetermined') {
        const cameraAuthorization =
          await flinkNative.requestCameraPermission();
        capabilities = { ...capabilities, cameraAuthorization };
      }
      if (capabilities.cameraAuthorization !== 'authorized') {
        setError(`E_CAMERA_DENIED: camera ${capabilities.cameraAuthorization}`);
        return;
      }
      const context: InputContext = {
        jsRuntimeId,
        readerSessionId: snapshot.readerSessionId,
        generation: makeToken('input'),
      };
      const result = await flinkNative.startTracking(context);
      contextRef.current = context;
      epochRef.current = result.trackingEpoch;
      setTracking(true);
    } catch (caught) {
      setError(diagnostic(caught, 'startTracking'));
    }
  }, [jsRuntimeId, snapshot]);

  const stopTracking = useCallback(async () => {
    const context = contextRef.current;
    if (!context) return;
    try {
      await flinkNative.stopTracking(context, 'smoke-ui');
    } catch (caught) {
      setError(diagnostic(caught, 'stopTracking'));
    } finally {
      contextRef.current = null;
      epochRef.current = null;
      setTracking(false);
      setSample(null);
    }
  }, []);

  const resetTracking = useCallback(async () => {
    const context = contextRef.current;
    if (!context) return;
    try {
      const result = await flinkNative.resetInput(context);
      epochRef.current = result.trackingEpoch;
      setSample(null);
    } catch (caught) {
      setError(diagnostic(caught, 'resetInput'));
    }
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.readerHeader}>
        <Button label="ライブラリへ" onPress={onBack} />
        <View style={styles.readerTitleBlock}>
          <Text numberOfLines={1} style={styles.readerTitle}>
            {entry.name}
          </Text>
          <Text style={styles.secondary}>
            {snapshot
              ? `${snapshot.pageIndex + 1} / ${snapshot.pageCount} · ${snapshot.state}`
              : 'loading…'}
          </Text>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.readerBody, width >= 900 && styles.readerBodyWide]}>
        <View style={styles.pdfColumn}>
          <FlinkPDFView
            ref={pdfRef}
            style={styles.pdfView}
            onViewReady={() => setPdfViewReady(true)}
            onReaderStateChanged={({ nativeEvent }) => {
              setSnapshot((current) =>
                !current || nativeEvent.stateRevision >= current.stateRevision
                  ? nativeEvent.snapshot
                  : current,
              );
            }}
            onPageChanged={({ nativeEvent }) => {
              setSnapshot((current) =>
                current &&
                current.readerSessionId === nativeEvent.readerSessionId
                  ? {
                      ...current,
                      pageIndex: nativeEvent.pageIndex,
                      pageCount: nativeEvent.pageCount,
                      stateRevision: Math.max(
                        current.stateRevision,
                        nativeEvent.stateRevision,
                      ),
                    }
                  : current,
              );
              setJumpPage(String(nativeEvent.pageIndex + 1));
            }}
            onReaderError={({ nativeEvent }) => {
              setError(`${nativeEvent.error.code}: PDFを表示できません。`);
            }}
          />
          <View style={styles.navigationBar}>
            <Button
              label="前"
              disabled={!snapshot || snapshot.pageIndex === 0}
              onPress={() => void navigate({ delta: -1 })}
            />
            <TextInput
              accessibilityLabel="移動先ページ"
              keyboardType="number-pad"
              onChangeText={setJumpPage}
              onSubmitEditing={() => {
                const page = Number(jumpPage);
                if (Number.isInteger(page) && page >= 1) {
                  void navigate({ pageIndex: page - 1 });
                }
              }}
              style={styles.pageInput}
              value={jumpPage}
            />
            <Button
              label="移動"
              onPress={() => {
                const page = Number(jumpPage);
                if (Number.isInteger(page) && page >= 1) {
                  void navigate({ pageIndex: page - 1 });
                }
              }}
            />
            <Button label="ページ全体" onPress={() => void fit()} />
            <Button
              label="次"
              disabled={
                !snapshot || snapshot.pageIndex >= snapshot.pageCount - 1
              }
              onPress={() => void navigate({ delta: 1 })}
            />
          </View>
          <Text style={styles.fitHelp}>
            「ページ全体」は現在の1ページを画面内に収めるズームリセットです。
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.debugColumn}
          style={styles.debugScroll}>
          <Text style={styles.eyebrow}>FACE / ARKIT</Text>
          <Text style={styles.sampleValue}>
            LEFT {sample?.left?.toFixed(3) ?? '—'}{`\n`}
            RIGHT {sample?.right?.toFixed(3) ?? '—'}{`\n`}
            JAW {sample?.jawOpen?.toFixed(3) ?? '—'}{`\n`}
            tracked {String(sample?.tracked ?? false)} · seq {sample?.seq ?? '—'}
          </Text>
          <View style={styles.rowActions}>
            {tracking ? (
              <Button
                label="Tracking停止"
                danger
                onPress={() => void stopTracking()}
              />
            ) : (
              <Button
                label="Camera許可・Tracking開始"
                disabled={!snapshot}
                onPress={() => void startTracking()}
              />
            )}
            <Button
              label="入力世代をリセット"
              disabled={!tracking}
              onPress={() => void resetTracking()}
            />
            <Button
              label={debugVisible ? '顔表示OFF' : '顔表示ON'}
              onPress={() => setDebugVisible((value) => !value)}
            />
          </View>
          <View
            style={[
              styles.faceDebugFrame,
              !debugVisible && styles.faceDebugFrameHidden,
            ]}>
            <FlinkFaceDebugView
              visible={debugVisible}
              style={styles.faceDebugView}
            />
          </View>
          <Text style={styles.notice}>
            白いcanvas、濃いグレーの顔、白い目・口だけを表示します。カメラ映像は表示・保存・送信しません。
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

export function Phase2SmokeScreen() {
  const [selected, setSelected] = useState<LibraryEntry | null>(null);
  return selected ? (
    <ReaderSmoke entry={selected} onBack={() => setSelected(null)} />
  ) : (
    <LibrarySmoke onOpen={setSelected} />
  );
}

const colors = {
  background: '#F5F7FB',
  card: '#FFFFFF',
  ink: '#101828',
  secondary: '#667085',
  border: '#D9E0EA',
  blue: '#1570EF',
  blueSoft: '#EAF2FF',
  red: '#B42318',
  redSoft: '#FEECEB',
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  headerText: { gap: 3 },
  eyebrow: {
    color: colors.blue,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.2,
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  button: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B9CCEA',
    backgroundColor: colors.blueSoft,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  buttonText: { color: '#164C96', fontWeight: '700', fontSize: 13 },
  dangerButton: {
    backgroundColor: colors.redSoft,
    borderColor: '#F4B8B3',
  },
  dangerButtonText: { color: colors.red },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.65 },
  runtimeCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  metadata: {
    color: colors.ink,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
    lineHeight: 16,
  },
  notice: { color: colors.secondary, fontSize: 12, lineHeight: 18 },
  progressCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#FFF9E8',
    padding: 12,
    gap: 8,
  },
  error: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 10,
    backgroundColor: colors.redSoft,
    color: colors.red,
    padding: 10,
    fontWeight: '600',
  },
  loader: { padding: 24 },
  list: { paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
  empty: { padding: 24, color: colors.secondary, textAlign: 'center' },
  fileCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 10,
    gap: 8,
  },
  fileMain: { flexDirection: 'row', gap: 12 },
  thumbnail: {
    width: 68,
    height: 88,
    borderRadius: 6,
    backgroundColor: '#F2F4F7',
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  placeholderText: { color: colors.secondary, fontWeight: '800' },
  fileText: { flex: 1, justifyContent: 'center', gap: 4 },
  fileName: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  secondary: { color: colors.secondary, fontSize: 12 },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  readerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  readerTitleBlock: { flex: 1, alignItems: 'center' },
  readerTitle: { color: colors.ink, fontWeight: '800', fontSize: 16 },
  readerBody: { flex: 1 },
  readerBodyWide: { flexDirection: 'row' },
  pdfColumn: { flex: 3, minHeight: 360 },
  pdfView: { flex: 1, backgroundColor: '#E9EDF3' },
  navigationBar: {
    minHeight: 58,
    padding: 8,
    gap: 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pageInput: {
    minWidth: 58,
    minHeight: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: '#FFF',
    color: colors.ink,
    paddingHorizontal: 9,
    textAlign: 'center',
  },
  fitHelp: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.card,
    color: colors.secondary,
    fontSize: 11,
    textAlign: 'center',
  },
  debugScroll: {
    flex: 1,
    maxHeight: 420,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  debugColumn: { padding: 12, gap: 10, backgroundColor: colors.card },
  sampleValue: {
    color: colors.ink,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 21,
  },
  faceDebugFrame: {
    height: 230,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#FFF',
  },
  faceDebugFrameHidden: { height: 0, borderWidth: 0 },
  faceDebugView: { flex: 1, backgroundColor: '#FFF' },
});
