---
document_id: FLINK-DESIGN
version: 1.0.0
updated_at: 2026-09-09
language: ja
audience: Codex
status: specification_ready_implementation_unverified
read_order: 2
requires: 01_requirements.md
next: 03_implementation_plan.md
---

# Flink 設計書

## DES-META — 適用規則

`01_requirements.md`の要件を正本とする。本書の型・状態・配置はFlinkの実装契約であり、Apple / Expoが提供するAPIそのものと区別する。コードブロックのTypeScriptは契約表現であり、未確認のExpo SDK用の完成実装ではない。実際のExpo Modules APIへのバインド構文はPhase 1で確認するが、意味・安全条件・型を黙って変更しない。

単位：UI寸法はpt、ファイルサイズはbytes、時刻は名前に明記する。ページは内部で0始まり、表示で1始まり。`number`のバイト数は安全整数を検証し、Swift側は`Int64`を使う。JSのビット演算によるInt32化を禁止する。

## DES-ARCH — 全体構成

```text
Windows
  TypeScript / UI / FSM / unit tests
  Metro (development build向け)
             │ ローカルネットワークのJS bundle / Fast Refresh
             ▼
iPhone / iPad の Flink
  Expo / React Native / Hermes
  ├─ LibraryStore          メタデータ一覧・検索・ソート（メモリのみ）
  ├─ SessionSettingsStore  onClose / onReopen・debug（メモリのみ）
  ├─ ReaderController      読書状態・NativeView操作
  ├─ BlinkDetector         純粋TypeScriptの状態機械
  └─ ReaderLifecycleController
             │ 型付きExpo Modules API
             ▼
  modules/flink-native (Swift)
  ├─ FlinkFilesModule
  │   ├─ LibraryFileService / ImportCoordinator
  │   ├─ LibraryPresenter / ActiveDocumentPresenter
  │   └─ ThumbnailService
  ├─ FlinkPDFModule / FlinkPDFView (PDFKit)
  ├─ FlinkFaceModule / FaceSessionCoordinator (ARKit)
  ├─ FlinkFaceDebugView (ARSCNView / SceneKit)
  └─ ReaderContextBroker / NativeBuildInfo
             │
             ├─ Documents/library/*.pdf              公開・永続
             ├─ Library/Application Support/Flink/
             │    import-staging/*.partial           非公開・作業用
             └─ Library/Caches/Flink/thumbnails/      非公開・再生成可能
```

本番のデータ通信サーバーは存在しない。Metroは開発中だけのJS配信経路であり、PDFやカメラ画像のアップロード先ではない。GitHub Releasesに置くIPAへユーザーのPDFを同梱しない。

### 責務の決定

| 項目 | 担当 | 理由 |
|---|---|---|
| ファイル選択・security scope・コピー・名前変更・削除 | Swift | 3GBファイルをJSへ渡さず、OSのファイル協調を利用する。 |
| PDF解釈・描画・ページ移動・fit | PDFKit / Swift | ローカルURLで開き、PDFViewの単一ページとズームを使う。[S-PDF][S-PDFDOC] |
| 係数の取得・フレーム保持・カメラ制御 | ARKit / Swift | `.eyeBlinkLeft` / `.eyeBlinkRight`を取りこぼさず取得する。[S-AR][S-EYE-L][S-EYE-R] |
| 係数から瞬きイベントへの判定 | TypeScript | Windowsで単体試験し、閾値・状態機械をdevelopment build再利用で改善する。 |
| 最終的なページ変更の安全確認 | Swift + TypeScript | JSだけのactive判定に依存せず、古い読書セッションの操作をネイティブでも拒否する。 |
| ライブラリ・設定・adaptive UI | TypeScript | ネイティブAPIを変えずに調整できる。 |
| 顔のデバッグ描画 | SceneKit / Swift | 指定技術を維持し、通常の検出から表示負荷を分離する。 |

### 採用しない主方式

- `react-native-pdf`等の追加ラッパーを主表示依存にしない。必要なPDFKit APIはローカルモジュールで限定公開する。
- `expo-document-picker`のキャッシュコピー後にさらにDocumentsへコピーする方式を採らない。公式資料も大きなファイルで`copyToCacheDirectory`が性能へ影響し得ると説明している。FlinkではSwift側でsecurity scopeを保持したまま1回の自アプリ管理コピーを行う。File Provider内部のダウンロード・一時領域までは制御できない。[S-EXPO-PICKER]
- フレームごとのReact state更新、無制限のイベントpush、JSでのファイルバイト処理をしない。
- 瞬き条件の調整のたびにSwiftを修正しなければならない構造にしない。

## DES-PROJECT — プロジェクト構成・依存

既存プロジェクトが`app/`か`src/app/`か、Expo Routerを含むかを調査して既存の入口を維持する。以下は`src/`利用時の論理配置。必要ならルート配置に読み替え、重複するエントリを作らない。

```text
src/
  app/                         Expo Routerの既存構成を利用
  features/library/            UI / hooks / selectors
  features/reader/             reader UI / controller
  features/settings/           session-only settings
  domain/blink/                detector.ts / types.ts / defaults.ts
  domain/library/              search / sort / metadata types
  domain/reader/               intents / lifecycle reducer
  native/                      型付きadapter / optional mocks
  stores/                      メモリ状態
  components/                  共通UI
modules/flink-native/
  expo-module.config.json
  index.ts
  ios/
    FlinkNative.podspec
    Files/
    PDF/
    Face/
    Shared/
plugins/with-flink-ios.ts
config/
  native-toolchain.json
  native-runtime.json
scripts/
  verify-local.mjs
  native-signature.mjs
  ci/
    validate-build-inputs.mjs
    build-ios.sh
    package-ipa.sh
    publish-release.sh
  fixtures/
    generate-pdf-fixtures.mjs
tests/
  unit/
  contracts/
  fixtures/                    小さい人工データのみ
native-locks/ios/Podfile.lock   初回CIで解決したものをユーザーが取り込む
.github/workflows/
  checks.yml
  build-ios-ipa.yml
docs/
  01_requirements.md
  02_design.md
  03_implementation_plan.md
  implementation-status.md     Codexが実装時に作成する進捗・検証台帳
```

Swift Modulesは`expo-module.config.json`経由でautolinkingする。`ios/`はCNG生成物とし、新規Managed/CNG構成では原則リポジトリへ含めない。永続的な変更はローカルModule、config plugin、app configに置く。既に手動native projectがあると判明した場合は、勝手に`prebuild --clean`で破壊しない。[S-MODULES][S-CNG]

依存は既存のExpo / RN / React / Router / safe-area系を基準とし、最初の開発ランタイムまでに`expo-dev-client`と必要なconfig plugin依存をまとめて導入する。新規DB、解析SDK、ネットワークPDF SDK、追加カメラSDKは導入しない。状態はReact Context / reducer / `useSyncExternalStore`等で十分とし、保存middlewareを持ち込まない。

テストランナーは既存構成を優先する。未導入なら純粋TSテストにVitest、React Nativeコンポーネント試験にSDK互換のJest系を選べるが、両方を理由なく追加しない。どちらを選んでもDES-BLINK-FSMの共通fixtureを利用する。

## DES-CONTRACTS — Swift / TypeScript契約

### 共通型

```ts
export type FileId = string;       // ネイティブが発行するopaque ID。永続IDではない
export type FileRevision = string; // ファイル属性・観測変更世代。内容ハッシュではない
export type ReaderSessionId = string;
export type TrackingEpoch = string;
export type InputGeneration = string;
export type TriggerMode = 'onClose' | 'onReopen';

export interface DocumentRef {
  fileId: FileId;
  revision: FileRevision;
}
export interface LibraryEntry extends DocumentRef {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtUnixMs: number | null;
  status: 'unknown' | 'ready' | 'locked' | 'invalid' | 'unavailable';
}
export interface LibrarySnapshot {
  scanId: string;
  indexRevision: string;
  entries: LibraryEntry[];
  warnings: Array<{ code: string; relativePath?: string }>;
}
export interface ReaderSnapshot {
  readerSessionId: ReaderSessionId;
  document: DocumentRef;
  pageIndex: number;
  pageCount: number;
  stateRevision: number;
  state: 'ready' | 'navigating' | 'suspended' | 'closed' | 'error';
}
export interface InputContext {
  jsRuntimeId: string;
  readerSessionId: ReaderSessionId;
  generation: InputGeneration;
}
export interface FlinkError {
  code: string;
  operation: string;
  recoverable: boolean;
  detail?: string; // 個人情報・絶対パス・PDF本文を含めない
}
```

APIの失敗は`FlinkError`に正規化してPromise rejectする。ユーザーによるピッカーキャンセルは正常な結果。Swiftの例外文や任意のURLをUIへそのまま出さない。IDや時刻の妥当性をネイティブ側でも検証する。

### Filesモジュール

```ts
export interface ImportResult {
  importId: string;
  cancelled: boolean;
  imported: DocumentRef[];
  failures: Array<{ name: string; code: string }>;
}
export interface ImportProgress {
  importId: string;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  stage: 'selecting' | 'waitingForProvider' | 'copying' | 'committing';
  copiedBytes: number;
  totalBytes: number | null;
}
export interface ThumbnailResult {
  document: DocumentRef;
  cacheUri: string | null;  // 自アプリのキャッシュ画像URIのみ
  status: 'ready' | 'locked' | 'invalid' | 'unavailable' | 'cancelled';
}
export interface FlinkFilesAPI {
  initializeLibrary(): Promise<void>;
  scanLibrary(): Promise<LibrarySnapshot>;
  presentImportPicker(importId: string): Promise<ImportResult>;
  cancelImport(importId: string): Promise<void>;
  renameDocument(document: DocumentRef, newBaseName: string): Promise<DocumentRef>;
  deleteDocument(document: DocumentRef): Promise<void>;
  requestThumbnail(document: DocumentRef, requestId: string): Promise<ThumbnailResult>;
  cancelThumbnail(requestId: string): Promise<void>;
}
```

イベント：`onLibraryInvalidated`、`onImportProgress`、`onDocumentInvalidated`。イベントは通知であり一覧の正本ではない。更新後の状態は`scanLibrary`等で確認する。進捗は最大10Hz程度に制限する。許可・選択・ファイルコピーが終わるまで、PromiseをUIスレッドの同期処理で待たない。

削除・名前変更APIは任意の`file://`や絶対パスを受け付けず、現在のindexにある`DocumentRef`だけを解決する。ライブラリ一覧に外部ピッカーのsecurity-scoped URLを保持しない。

### PDF View

```ts
export type NavigateRequest =
  | {
      readerSessionId: ReaderSessionId;
      commandId: string;
      source: 'manual';
      move: { delta: -1 | 1 } | { pageIndex: number };
    }
  | {
      readerSessionId: ReaderSessionId;
      commandId: string;
      source: 'blink';
      move: { delta: 1 };
      inputContext: InputContext;
      trackingEpoch: TrackingEpoch;
      sampleNativeMs: number;
    };
export interface NavigateResult {
  commandId: string;
  result: 'applied' | 'boundary' | 'busy' | 'stale' | 'suspended' | 'duplicate';
  snapshot: ReaderSnapshot;
}
export interface FlinkPDFViewRef {
  openDocument(input: { openRequestId: string; document: DocumentRef }): Promise<ReaderSnapshot>;
  navigate(input: NavigateRequest): Promise<NavigateResult>;
  closeDocument(readerSessionId: ReaderSessionId): Promise<void>;
}
```

PDF Viewは表示用native viewのrefに非同期メソッドを公開する。ExpoのView内`AsyncFunction`はReact refから呼び出せるが、デフォルトでUIスレッドに実行されるため、文書読込等の重い処理を明示的に別queueへ移す。[S-MODULE-API]

イベント：`onReaderStateChanged`、`onPageChanged`、`onReaderError`。すべて`readerSessionId`と`stateRevision`を含める。Promise結果と通知の両方を受け取っても、同じ世代のstateを二重適用しない。

### Faceモジュール

```ts
export interface FaceCapabilities {
  faceTrackingSupported: boolean;
  cameraAuthorization: 'notDetermined' | 'authorized' | 'denied' | 'restricted';
  nativeApiVersion: number;
  nativeRuntimeSignature: string;
}
export interface FaceSample {
  seq: number;
  nativeMs: number;        // ネイティブの共通monotonic clock。JS時計と比較しない
  frameTimestamp: number;  // ARFrame由来。フレームの重複・順序確認用
  trackingEpoch: TrackingEpoch;
  context: InputContext;
  faceId: string | null;
  tracked: boolean;
  left: number | null;
  right: number | null;
  jawOpen: number | null;  // デバッグ顔の口用。ページ送りには使わない
}
export interface FaceBatch {
  trackingEpoch: TrackingEpoch;
  nativeNowMs: number;
  overflowed: boolean;
  samples: FaceSample[];   // 時刻順。閉眼ピークを平均化しない
}
export interface FlinkFaceAPI {
  getCapabilities(): Promise<FaceCapabilities>;
  requestCameraPermission(): Promise<FaceCapabilities['cameraAuthorization']>;
  startTracking(context: InputContext): Promise<{ trackingEpoch: TrackingEpoch }>;
  stopTracking(context: InputContext, reason: string): Promise<void>;
  resetInput(context: InputContext): Promise<{ trackingEpoch: TrackingEpoch }>;
  drainSamples(trackingEpoch: TrackingEpoch): Promise<FaceBatch>;
}
```

`resetInput`はバッファと入力世代を更新する。カメラ再起動が不要なモード切替ではARSessionを再生成しなくてよい。`stopTracking`は所有contextを検証し、古いJS runtimeのcleanupが新しい読書セッションを停止しないようにする。

共有の`ReaderContextBroker`が、現在の読書セッション・active / modal / file invalidated状態を保持する。`source: blink`のページコマンドはこの状態と一致した場合のみ受け付ける。JSが誤って古いコマンドを送っても別PDFを送れない構造とする。

## DES-STORAGE — ディスク配置

```text
<Application sandbox>/
  Documents/
    library/
      漫画.pdf
      書籍 (2).pdf
      series/
        第1巻.PDF
      memo.txt                  無視。削除しない
    other.pdf                   ライブラリには表示しない
  Library/
    Application Support/Flink/
      import-staging/<UUID>.partial
    Caches/Flink/thumbnails/
      <cache-key>.jpg
```

`FileManager`で実際のDocuments / Application Support / Caches URLを毎回解決する。コンテナの絶対パスを保存・ハードコードしない。`library`作成は冪等。同名通常ファイルやrootのシンボリックリンクはエラーとし、ユーザーのファイルを置換しない。

初期化時は自アプリ管理のstagingディレクトリだけを掃除する。他アプリ・利用者が置いた`.tmp`等を任意に削除しない。コピー処理を開始する前に初期cleanupを完了する。アプリ終了時にPDFやサムネイル以外のユーザー状態を保存しない。

### Info.plist / Expo設定

- `name: Flink`、`slug: flink`、`scheme: flink`、`ios.bundleIdentifier: com.local.flink`。
- `ios.supportsTablet: true`、`orientation: default`、`userInterfaceStyle: automatic`。
- deployment targetは18.0。採用SDKが直接設定を提供する場合はそれを使い、そうでなければSDK互換の`expo-build-properties`等のconfig pluginで設定する。[S-EXPO-CONFIG][S-BUILD-PROPERTIES]
- `UIFileSharingEnabled = YES`、`LSSupportsOpeningDocumentsInPlace = YES`。[S-FILES]
- `NSCameraUsageDescription = "両目の瞬きを検出してPDFのページを送るためにカメラを使用します。映像は保存・送信しません。"`
- iPhoneはportrait / landscapeLeft / landscapeRight、iPadはこれらにportraitUpsideDownを加える。UIのresizeを可能にし、MVPのためだけに`UIRequiresFullScreen = YES`を強制しない。
- 新たなマルチウインドウ対応、background camera、iCloud entitlement、App Groups、push通知を追加しない。
- TrueDepth必須を示す独自の端末フィルターを加えない。実行時にFace Trackingを判定する。
- development profileだけにLAN接続用設定を入れる。`NSLocalNetworkUsageDescription`、必要なBonjourサービス等は採用SDKのdev-client / Metro生成物を確認して設定し、Releaseへ不要な例外を残さない。
- `NSAppTransportSecurity`を使う場合、開発時のローカル接続に必要な範囲だけに限定する。Releaseで`NSAllowsArbitraryLoads = YES`を残さない。

プライバシー説明はサイドロード版にも含める。カメラ権限とローカルネットワーク権限は別の許可であり、後者の拒否でARKitの非対応と表示しない。

## DES-INDEX — ライブラリ走査・ID

1. `Documents/library`以下の通常ファイルを再帰列挙する。隠し作業ファイル、リンク、package等の非対象を除外する。
2. 拡張子を大小文字非区別で`.pdf`判定する。非PDFファイルは本文を読まずに無視する。
3. 相対パス、サイズ、更新日時、取得可能ならfile resource identifierを一度に取得する。ここでは`PDFDocument`を開かず、ページ数・サムネイルを要求しない。
4. 現在のプロセス内でopaque `FileId`を割り当てる。resource identifierで同一性を維持できる場合は利用し、取得できなければ正規化したコンテナ内パスを基準にする。ハードリンク等で同じresourceを検出した場合は同一ファイルとして1件に正規化してよい。
5. `revision`にはサイズ・更新時刻・resource identity・観測した変更世代を反映する。内容ハッシュは計算しない。更新通知で変更があれば、属性が同じでもキャッシュを無効化する。
6. 古い走査完了通知が新しいindexを上書きしないよう`scanId`で世代管理する。最大1走査と1回分の再走査要求に集約する。
7. 同一ファイルを「取り込み記録」と「走査結果」に分割して登録しない。取り込み後は走査で正本へ反映する。

属性取得失敗は該当ファイルの警告として返し、正常な別ファイルを表示する。root自体が読めない場合は全体エラーとし、「0件の正常なライブラリ」と偽装しない。

走査はfile I/O queue、ソートと検索はJSのメモリ上で実行する。1000件程度のメタデータsnapshotは一括返却してよいが、PDFバイトは含めない。空更新でも毎回FileIdを変更して全リストを再mountしない。

### 検索・ソート

検索はファイル名をUnicode正規化した照合キーに対する部分一致とし、表示名は原文を保持する。大文字／小文字を区別せず、入力後150ms程度debounceする。必要な正規化や`Intl.Collator('ja', { numeric: true, sensitivity: 'base' })`の利用可否を実ランタイムで確認する。

ソートはname / modifiedAt / size。更新日時不明は既知日時の後、同値は名前・相対パスで安定化する。降順でも同値tie-break規則を固定する。検索・ソートのためにPDFを開かない。

## DES-IMPORT — 大容量コピー

`UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: false)`を使用し、選択URLのsecurity scopeをコピー完了まで管理する。これは「元ファイルを書き換える」指定ではない。元URLを一時的に読み、Flink自身のコピーを作るための方式である。[S-PICKER][S-PICKER-DELEGATE]

```text
選択
→ URL / 型 / 読取権限を確認
→ security scope取得（必要な外部URLのみ）
→ NSFileCoordinatorで読み取りを協調
→ 空き容量を予備確認
→ 非公開stagingへ逐次コピー
→ flush / close / 検証
→ 衝突しない名前を確保し、同一volume上で非置換commit
→ libraryを再走査
→ scope解放 / 一時状態解放
```

- picker自体の表示とdelegateはmain。コピーは専用serial queueで実行する。
- 自アプリsandboxのURLと外部security-scoped URLを区別する。取得に成功したscopeは`defer`相当で必ず解放する。永続bookmarkを保存しない。
- `FileHandle`等で最大1MiB程度の固定長バッファによる読取・書込を行う。ファイル全体サイズに比例するバッファを作らない。部分write・read error・キャンセルを処理する。
- 予備空き容量目安は`S + max(64MiB, 0.1*S)`。これは安全余裕の設計値であり、成功保証ではない。容量不明では不定進捗にし、途中のENOSPCも処理する。
- 拡張子と小さなヘッダによる明白な非PDF判定を行うが、ヘッダがあるだけで有効なPDFと断定しない。完全な解釈・ロック判定は要求時のPDFKitに委ね、壊れたPDFで全ライブラリを止めない。
- 最終ファイル名は元のbasenameを安全に扱う。サイズ超過・使用できない名前は黙って別文書に上書きせず、明示的エラーか安全な短縮名を利用者に通知する。
- commitは**非置換**を必須とする。`exists`の確認だけでは競合対策にならない。OSの同一volume・no-replace renameまたは同等の原子的非置換操作とファイル協調を使い、衝突したら`(2)`以降で再試行する。採用APIはSDK上で確認し、競合テストを付ける。
- コピー失敗・キャンセル・background移行では未commitの自アプリpartialを削除する。既にcommit済みの別ファイルや元ファイルは残す。stagingから公開先へcommitする前後の中断もテストする。
- バックグラウンドで3GBコピーを継続する機能はMVP外。provider待機等の中断できないOS呼出しは完了結果を無効化し、リソースを解放する。必ず即座にOS処理を打ち切れるとは約束しない。
- library内のPDFをpickerで選んだ場合も、要求どおり別名コピーを作る。既存ファイルと同じパスへ自己コピーしない。

NSFileCoordinatorのaccessorに渡されたURLを利用し、入力時のURL文字列だけに依存しない。providerによるURL置換を考慮する。[S-COORDINATOR]

## DES-COORDINATION — 外部編集・削除との協調

Documentsを公開すると他アプリも内容を扱えるため、Flinkのメモリ内indexだけを排他制御に使わない。[S-FILES]

- `LibraryPresenter`をlibraryディレクトリに登録し、下位項目の変更・移動・消失でindexを無効化する。専用のserial `OperationQueue`を用いる。
- `ActiveDocumentPresenter`を読書対象に登録する。読み取り開始はNSFileCoordinatorで協調し、外部writerへのrelinquish時はページ操作を止め、main上でPDFViewから文書をdetachして読取利用を解放してからwriterへ制御を渡す。
- PDFKitはURLから遅延してデータへアクセスし得るため、**初期化の瞬間だけread coordinationし、以後は外部変更を無視する実装にしない**。長時間の巨大コピーによるreader用スナップショットも既定では作らない。
- 自アプリの削除・名前変更もcoordinated writeとする。読書中の対象を変更する場合は先にreaderを閉じる。変更後はライブラリを表示し、勝手に履歴位置へ開き直さない。
- 外部移動・変更では古いopen requestを無効化する。現在の文書は閉じ、新しいindexから選び直す。`library`外への移動は一覧から除外する。
- callback、file I/O、main間で同期的な相互待ちを作らない。通知に応じた処理は非同期で引き渡し、relinquishのcompletionはちょうど1回呼ぶ。
- 再走査は500ms程度でdebounceし、foreground・画面復帰・手動更新をfallbackにする。通知到着時刻だけで絶対的な即時同期を保証しない。

ファイル協調を無視する外部writerや、OS側のPDFKit障害まで完全に防げるとは主張しない。検出時は安全停止し、再現条件を記録する。

## DES-FILE-MUTATION — 削除と名前変更

削除は確認ダイアログで`Flink/libraryからPDFファイルを削除します。この操作は取り消せません。`と明示する。成功後にindex・該当thumbnailを無効化する。確認待ちに外部更新が起きた場合は古いrevisionの削除を拒否して再確認する。

名前変更は拡張子を除いたbasenameを編集させ、結果へ`.pdf`を付ける。空白だけ、`.` / `..`、パス区切り、NUL、制御文字、OS上限超過を拒否する。既存名との衝突は`E_NAME_CONFLICT`。元の名前と同じならno-op。同じフォルダ内だけで変更し、パス入力で別フォルダへ移動させない。大文字／小文字だけの変更もファイルシステムに合わせて非破壊で扱う。

`fileId`から解決した直後にもroot内・通常ファイル・revisionを確認する。URL文字列の単純prefix比較ではなく、パス成分と解決済みrootを使う。リンクを辿る実装は採用しない。

## DES-THUMBNAIL — 遅延生成・キャッシュ

- 初期一覧はプレースホルダーで表示し、可視項目と近い範囲だけ要求する。
- 同時生成数は1。待ちキューを有界にし、画面外の未開始リクエストはキャンセルする。重複requestをまとめる。
- 表示中PDFと別の`PDFDocument`を使い、サムネイル用serial queue内でpage 0の`thumbnail(of:for:)`を生成する。PDFViewにattachしたオブジェクトを別threadへ持ち回らない。[S-THUMBNAIL]
- 出力画像は長辺512px以内。ポイント／ピクセル／UIImage.scaleを区別し、意図せずRetina倍率を二重適用しない。
- 自前decoded image cacheの上限は32MiB、ディスクキャッシュは128MiBを設計値とする。LRUで削除し、ファイル数だけでメモリを制限しない。PDFKit内部のメモリはこの上限の外であり、別途実測する。
- cache keyは相対パス・取得可能なresource ID・サイズ・更新時刻・観測変更世代・アルゴリズム版から作る。ファイル全内容のhashは使わない。ファイル変更・削除・renameで該当cacheを無効化する。
- readerを開く間は新しいthumbnail解析を原則止め、キャッシュを使う。iPadサイドバーで未生成の項目がある場合は一時的なプレースホルダーを許容する。開いたPDFを余計な同時解析で圧迫しない。
- cancelは「不要になった結果を採用しない」と「未開始を止める」を保証する。既に実行中のPDFKit同期解析を安全に強制停止できるとは仮定しない。解析実行数を増やしてタイムアウトを回避しない。

## DES-PDF — PDFKitの実装規則

```swift
// PDFViewの基本方針。重い文書生成は別queueで行う。
pdfView.displayMode = .singlePage
pdfView.displayDirection = .horizontal
pdfView.displaysAsBook = false
pdfView.usePageViewController(false, withViewOptions: nil)
pdfView.autoScales = true
```

`PDFDocument(url:)`で開き、`PDFDocument(data:)`用の全体Dataを作らない。`isLocked`、ページ数、ページ0の取得可否を確認してからattachする。ロックされていない暗号化PDFについて、権限を迂回する処理を加えない。[S-PDFDOC][S-LOCK]

### 所有とthread

文書読込は最大1件のloading queue。生成したPDFDocumentはattach前までそのqueueだけが所有し、mainへ引き渡した後はPDFView側だけが扱う。サムネイル用とは別インスタンス。PDFDocumentが無条件にthread-safeという前提を置かない。

各open requestにUUIDを付け、遅いAの読込が新しいBの選択を上書きしない。キャンセル・離脱後に完了したAは破棄する。parse待ちのreaderには戻る操作を残すが、PDFKit内部呼出しの即時キャンセルを保証しない。

### 自動ページfit

手動の「ページ全体」リセット操作は提供しない。ページ移動はネイティブの現在ページを正本として`page(at:)`と`go(to:)`で行い、ページ境界を確認する。移動後のレイアウトで現在ページのfit倍率を再計算し、`scaleFactorForSizeToFit`等の公開APIで適用する。[S-FIT]

portrait / landscapeやページサイズが混在する文書では、最初のページの倍率を使い回さない。layout更新後に適用し、ピンチ中の毎renderで`autoScales`を強制してユーザー倍率を壊さない。回転・サイドバー切替は文書を再作成せず、現在ページを維持してfitする。

### ページ状態と描画完了

`PDFViewPageChanged`通知から、現在ページ番号と`stateRevision`を更新する。これは論理上の現在ページの変化であり、全ピクセルの描画完了通知ではない。[S-PDF]

`NavigateResult.applied`は「対象ページをPDFViewへ適用し、current pageを確認した」を意味する。大容量PDFの描画時間は別に測る。存在しない公開APIで`onRenderComplete`を捏造しない。自動Live Text等の不要な解析は、採用SDKに公開された制御APIがある場合に限り停止を検討し、private API / KVCで無効化しない。

閲覧専用アプリとして、PDFリンクから外部URLや別文書を自動起動しない。PDFKitの公開delegate等で制御可能な範囲を確認し、外部遷移抑止をテストする。PDFフォーム編集、注釈作成、本文選択の独自機能は追加しない。

## DES-NAVIGATION — ページ送りの直列化

`GestureIntent`はTypeScriptドメイン層のイベントであり、将来の入力方法をページ操作から分離する。

```ts
export interface GestureIntent {
  eventId: string;
  kind: 'bilateralBlink';
  action: 'nextPage';
  triggerMode: TriggerMode;
  inputContext: InputContext;
  trackingEpoch: TrackingEpoch;
  sampleNativeMs: number;
}
```

MVPでウインク用kindを実際に発生させない。前ページのネイティブAPIは手動操作に存在するが、片目入力に割り当てない。

ページコマンドの受理条件：

1. readerSessionIdが表示中のセッションと一致する。
2. ネイティブ側でも文書がready、app / sceneがactive、モーダル中でない、ファイルが有効である。
3. 同時実行中のnavigateがない。busy中の瞬きは捨て、後で再生しない。
4. blinkの場合はInputContext・TrackingEpochが一致し、ネイティブ共通時計でサンプルの年齢が350ms以内である。
5. commandIdを直近256件程度の有界集合で重複排除する。同じコマンドの再送を二度実行しない。
6. 範囲外へ移動しない。最後のページの瞬きも候補を消費し、後で前ページに戻った時に再利用しない。

戻り値は各試行について1回だけ確定する。manual / blinkを同じページ変更経路へ集約し、JSがページ番号を楽観的に増やしてからネイティブ結果で補正する二重管理はしない。

## DES-FACE — ARKitセッションと有界サンプル取得

`FaceSessionCoordinator`はプロセス内で最大1つのARSessionを所有する。`ARFaceTrackingConfiguration.maximumNumberOfTrackedFaces = 1`とし、world tracking等の不要な構成を追加しない。capability確認とカメラ許可確認を行ってからrunする。[S-AR]

通常読書ではARSCNViewを必須にせずARSessionから係数を取得する。ARSessionDelegateのframe更新で対象ARFaceAnchorを取り出し、左右の係数・face identity・追跡可否を記録する。ARSessionのdelegate queueではPDF処理や画像変換を行わない。

- `eyeBlinkLeft` / `eyeBlinkRight`の左右は利用者本人の左右。カメラの鏡像表示やデバッグビューの左右とは分ける。
- 値が存在しない、非有限、範囲不正、顔が追跡されていない場合はinvalidとして扱う。欠損値を0（開眼）で埋めない。
- native timestampは、採取callbackで読む共通monotonic clockを使う。drain・最終コマンドTTLも同じ時計で測る。ARFrame timestampは別フィールドで保持し、フレームの重複・逆転を検知する。
- 別の顔に切り替わったらTrackingEpochを更新して再アームする。複数人を見分ける本人認証は行わない。

### Pull方式

```text
ARKit（利用可能な各フレームを採取）
   ↓ 小さな数値レコードのみ
Swift ring buffer（最大128サンプル）
   ↑ JSからdrainSamples、原則50msごと、同時要求は1つ
TypeScript BlinkDetector
   ↓ 1つのGestureIntent
ReaderController → native navigate
```

JS側は非同期drain完了後に次のタイマーを予約する。JSが止まっている間に50msごとのPromiseを無制限に積まない。各バッチは元サンプルを順番どおりに含め、閉眼ピークを平均・間引きして消さない。ARKitの実フレームレートを30 / 60fps等に固定して保証しない。

バッファoverflow時は`overflowed = true`を返し、そのバッチからイベントを作らない。古いサンプルも捨てて新しい開眼からやり直す。デバッグUI更新は最大10Hz、SceneKit描画は表示時のみ最大30fpsを設計値とする。

drainが2秒以上来ない場合、ネイティブのwatchdogでバッファを破棄しARSessionを停止する。JS復帰後、読書条件を再確認して自動再開する。debuggerでJSを止めていた期間の瞬きを後から再生しない。background / inactiveはJSイベントを待たずネイティブ側でも停止する。

## DES-BLINK-FSM — 純粋TypeScriptの瞬き状態機械

### パラメータ

次は開始用の**設計値**であり、ARKitの規定値や検証済みの最適値ではない。TypeScript定数から変更し、fixtureと実機測定で調整する。キャリブレーション画面やMVPの感度設定UIは作らない。

```ts
export const blinkDefaults = {
  triggerMode: 'onReopen' as TriggerMode,
  closeThresholdLeft: 0.65,
  closeThresholdRight: 0.65,
  openThresholdLeft: 0.25,
  openThresholdRight: 0.25,
  maxBilateralSkewMs: 120,
  rearmOpenMs: 150,
  cooldownMs: 350,
  maxClosedMs: 1500,
  maxSampleGapMs: 150,
  maxSampleAgeMs: 250,
  minimumBilateralClosedSamples: 1,
};
```

`0 <= openThreshold < closeThreshold <= 1`を検証する。通常の短い瞬きを扱うため、「何百ms以上閉じること」を下限条件にしない。左右両眼の条件が1つの有効サンプルで成立することを初期条件とする。1サンプルのノイズ耐性は実機試験で評価する。

`cooldownMs`のため350ms未満に連続する別の瞬きは、すべてが操作になるわけではない。重複抑止の設計上の制約として扱い、試験では十分な開眼間隔を置いた単発瞬きと区別する。

### 入力・出力

```ts
export interface DetectorInput {
  sample: FaceSample;
  sampleAgeMs: number; // batch.nativeNowMs - sample.nativeMs
  enabled: boolean;
  context: InputContext;
}
export interface BlinkDetector {
  push(input: DetectorInput): GestureIntent[]; // 通常0件、成立時1件
  reset(reason: string): void;
  setMode(mode: TriggerMode): void;
  snapshot(): DetectorDiagnostic;
}
export interface DetectorDiagnostic {
  state: 'DISABLED' | 'WAIT_OPEN' | 'ARMED' | 'CLOSING' | 'CLOSED' | 'CONSUMED';
  lastResetReason: string | null;
  detectedCount: number;
}
```

外部時計、React、Native Module、I/Oを状態機械から呼ばない。時刻は入力サンプルから決定する。同じ入力列は同じ出力になること。

### 目ごとのヒステリシス

各目の状態は`unknown / open / closed`。係数がclose閾値以上ならclosed、open閾値以下ならopen、中間値では直前状態を保持する。ただし、**再アームと再開眼成立には左右の生値がともにopen閾値以下であること**を要求する。unknownが中間値に来てもopenと仮定しない。

左右係数を平均して両眼閉鎖を推定しない。片目が1.0、他方が0.0の入力ではページ送りしない。

### 状態遷移

| 状態 | 入力条件 | 次状態・処理 |
|---|---|---|
| DISABLED | enabledになり有効な追跡入力が到着 | WAIT_OPEN。開始時の閉眼は数えない。 |
| WAIT_OPEN | 左右の生値がopen閾値以下で150ms継続し、最後のイベントから350ms以上経過 | ARMED。 |
| WAIT_OPEN | 開眼が途切れる、invalid、顔変更 | 開眼連続時間をクリア。イベントなし。 |
| ARMED | 片方がclose閾値へ到達 | CLOSING。最初の側と時刻を記録。 |
| ARMED | 同じサンプルで両方がclose閾値へ到達 | 両眼閉鎖成立。モード別処理へ。 |
| CLOSING | 120ms以内に他方もcloseへ到達し、最初の目がまだclosed | 両眼閉鎖成立。モード別処理へ。 |
| CLOSING | 最初の目がopenへ戻る／120msを超える | WAIT_OPEN。候補を捨てる。左右の別々のウインクを結合しない。 |
| 両眼閉鎖成立 + onClose | 有効な新しい閉眼サイクル | nextPageを1件出力しCONSUMED。 |
| 両眼閉鎖成立 + onReopen | 有効な新しい閉眼サイクル | CLOSED。両眼閉鎖成立時刻を記録。まだ出力しない。 |
| CLOSED | 1500ms以内に左右ともopen閾値以下 | nextPageを1件出力しCONSUMED。片目だけ開いても出力しない。 |
| CLOSED | 1500msを超える | WAIT_OPEN。長時間閉眼として候補を破棄。 |
| CONSUMED | 両目が開く | 開眼連続時間を計測し、150msとcooldownの両方を満たしたらARMED。 |
| CONSUMED | 目を閉じたまま／閾値付近で揺れる | 追加イベントなし。開眼計測は途切れたらクリア。 |
| 任意 | disabled、顔ロスト、顔変更、追跡中断、モード変更、context変更、overflow、sample gap >150ms、古いサンプル | 候補を破棄。disabledならDISABLED、それ以外はWAIT_OPEN。 |

同一サンプルで両眼が閉じた場合にCLOSINGを経由できなくても成立を取り逃さない。`maxBilateralSkewMs`は個別の閉眼開始時刻の差に適用し、片目を長く閉じてからもう片方を閉じた動作を通常の両眼瞬きと見なさない。

### 境界条件の正本

- close / open閾値との比較はそれぞれ`>=` / `<=`。
- 左右開始差は`<= 120ms`を許可、`> 120ms`を破棄。
- 再アームは開眼継続`>= 150ms`かつcooldown経過`>= 350ms`。
- reopenの閉眼長は`<= 1500ms`を許可。onCloseは既に送ったイベントを長時間閉眼後に取り消さない。
- 重複seqは再処理しない。epoch不一致、時刻逆転、不正値は出力せず再アームする。
- sampleAge >250msのサンプルは判定に使用しない。鮮度検査に`Date.now()`やJSの`performance.now()`を混ぜない。
- 顔・モード・generation変更時は進行候補を破棄する。同じreader内の直近イベントcooldownは維持してよいが、古い候補は維持しない。
- イベントが出た後にnativeでbusy / boundary / staleとして抑止されても、そのイベントは消費済み。後から再試行しない。

### 必須の人工時系列例

以下の値は`(left, right)`。各試験前に250ms以上の`(0.05, 0.05)`を供給してARMEDにする。単一のtimestampだけを置かず、想定フレーム間隔で入力する。

| ケース | 入力列の要点 | onClose | onReopen |
|---|---|---:|---:|
| 通常の瞬き | `(0.05,0.05)`→`(0.9,0.9)`を80ms→`(0.05,0.05)` | 閉眼時1 | 開眼時1 |
| 左片目のみ | `(0.9,0.05)`→open | 0 | 0 |
| 右片目のみ | `(0.05,0.9)`→open | 0 | 0 |
| 閉じ続ける | 両眼closedを3000ms | 開始時1のみ | 0 |
| 開始時にclosed | 起動直後closed、その後open | 0 | 0 |
| 左右のずれ | 左closedから80ms後に右closed、左はclosed継続 | 1 | reopen時1 |
| 長い片目閉眼後の両眼閉鎖 | 左closedから200ms後に右closed | 0 | 0 |
| 追跡ロスト | 両眼closedの途中にtracked=false | onCloseで既に出た分以外0 | 0 |
| ノイズ | 開眼後にclose閾値未満の値だけが揺れる | 0 | 0 |
| 2回の通常瞬き | 各サイクル間に500ms以上のopen | 2 | 2 |
| 古いバッチ | 上記正常列だがage >250ms | 0 | 0 |
| モード変更 | closed中にonClose / onReopenを切替 | 切替を原因とする追加出力0 | 切替を原因とする追加出力0 |

通常の瞬きを検出する設計であり、睡眠検出、注意力判定、視線計測、ウインクで戻る機能を追加しない。

## DES-LIFECYCLE — 読書・追跡の状態管理

`ReaderLifecycleController`の論理状態：`library / loading / ready / modal / inactive / interrupted / error / closed`。nativeも同じ安全条件を独立して確認する。

| 状態／イベント | PDF | ARSession | 瞬き判定 |
|---|---|---|---|
| library / loading | 未表示または読込中 | 停止 | DISABLED |
| ready + 権限未決定 | 手動閲覧可 | 許可要求後に自動開始 | 許可後WAIT_OPEN |
| ready + 権限あり | 閲覧可 | 実行 | WAIT_OPEN→ARMED |
| 権限拒否 / 非対応 | 手動閲覧可 | 停止 | DISABLED、理由表示 |
| 顔ロスト | 閲覧可 | 再検出のため継続 | WAIT_OPEN、候補破棄 |
| 設定・名前変更・削除確認・page入力・picker | 画面保持可 | 原則停止 | DISABLED、候補破棄 |
| デバッグパネル表示 | 閲覧可 | 同一sessionを共有 | 継続。デバッグ表示だけで2重起動しない |
| navigate / layout transition | 論理ページ変更中 | 原則継続 | 入力を一時無効化し、終了後再アーム |
| inactive / background | 状態保持可 | nativeから直ちにpause | DISABLED、バッファ破棄 |
| session interrupted / failed | 手動閲覧可 | 停止・復旧管理 | DISABLED、理由表示 |
| ファイル無効化 / reader離脱 | detach / close | 停止 | DISABLED |
| JS heartbeat timeout | 画面は保持し得る | 停止 | バッファ破棄 |

復帰は同じ画面がreadyで権限がある場合に自動。失敗時の無限runループを禁止し、再試行は回数と間隔を有界にする。恒久エラーは理由と再試行操作を提示してよいが、通常時の「開始ボタン」にはしない。

`UIApplication.isIdleTimerDisabled`は読書active中だけ有効。終了・inactive・エラーで必ず元に戻す。ARSessionはカメラ専用に使い、別AVCaptureSessionを並行起動しない。

Fast Refresh / JS reloadでは購読・タイマーを解除し、新しい`jsRuntimeId`を発行する。古いnative Promise完了を無視し、必要なsessionを1つだけ再開する。Native Moduleの破棄時にもセッションとpresenterを解放する。

## DES-FACE-DEBUG — 無地の顔の描画

`FlinkFaceDebugView`はARSCNViewを包み、同じFaceSessionCoordinatorのARSessionを参照する。検出の所有者にはならず、ARSessionDelegateを別のオブジェクトで上書きしない。ARSCNViewDelegate等の描画用callbackと、係数取得用delegateの責務を分ける。[S-SCENE]

### 見た目の仕様

```text
canvas: #FFFFFF（常に不透明）
face:   #3A3A3A（テクスチャなし、基本は一定の明度）
eyes:   #FFFFFF
mouth:  #FFFFFF
```

顔は`ARSCNFaceGeometry`の穴を持つ形状（`fillMesh: false`）等を使い、白背景が目・口に現れる無地のマスクとして描く。必要な補助形状はSceneKitで作成し、利用者の撮影画像をmaterialへ設定しない。目・口の見え方は実機で確認し、穴の裏に撮影映像が見えないようにする。

ARSCNViewは通常カメラ映像を背景に描画するため、単に「テクスチャを設定しない」だけでは要件を満たさない。[S-SCENE] scene背景を白へ設定し、必要ならカメラ追従の不透明な白い背景面を顔の後方・映像の前に置く。最初の描画、回転、復帰、顔ロスト時を含めて映像を露出させない。白いホストViewで初期フレームも覆い、映像が一瞬見える実装を合格にしない。

最大30fpsで表示し、非表示時はviewを描画停止／破棄してGPU負荷を減らす。ARKitの係数取得は別に継続する。デバッグ用に毎フレームUIImageを作らない。

メトリクスは最新値だけを表示する。左／右、tracked、FSM、検出イベント数、native適用数、busy / stale等の抑止数を分ける。時系列ログや顔メッシュの保存はしない。Releaseでも利用できるが、疑似サンプル注入などのテスト専用操作はDebugに限定する。

## DES-ADAPTIVE-UI — 画面構造

iPhoneかiPadかはplatform情報で判定し、layoutは`useWindowDimensions`等による現在の幅で決める。`isPad && availableWidth >= 768pt`をwideの初期条件とする。これは設計上のbreakpointであり、OSの保証値ではない。

### iPhone / compact

```text
ライブラリ
  上部: Flink / 設定 / 追加
  検索欄 + 並び替え + 更新
  可変列グリッド（縦は基本2列、カード最小幅140pt目安）
  空状態 / import進捗 / itemの操作メニュー

読書
  上部: ライブラリへ戻る / ファイル名 / 設定
  中央: PDFView（利用可能領域を最大利用）
  補助: 小さな追跡状態、任意のデバッグパネル
  下部: 前へ / 1 / 10000（タップで番号入力） / 次へ
```

デバッグパネルは読書画面内の小領域であり、通常のモーダル停止と区別する。iPhoneでは約140×200ptを初期目安とし、必要なPDF操作を隠さない配置にする。固定寸法により小さい高さで内容が欠ける場合は縮小・折り畳みで対処する。

### iPad / wide

```text
ライブラリ画面
  ナビゲーション領域（約220pt） | 多列の表紙グリッド
  ライブラリ / 設定             | 検索 / 並び替え / 追加

読書画面
  折り畳み式ライブラリ（約300pt）| PDFView
  検索・ソート・短い一覧         | タイトル・ページ操作
                                | 任意のデバッグパネル
```

表紙グリッドは空き幅と140〜180pt程度のカード幅から列数を計算し、機種名ごとの固定列数を持たない。読書サイドバーは同じLibraryStoreを参照するが、表紙の大きいグリッドではなく小さいサムネイル付き一覧を使う。サイドバーを畳むとPDFの幅を増やし、現在ページのfitを再計算する。

ライブラリとreader間で選択中PDFは1つ。単一のPDFViewを維持し、サイドバー表示・画面回転・breakpoint変更だけでreaderのkeyを変更しない。別のPDFを選んだ時だけopen requestを作り直す。

iPadの狭いウインドウはcompact UIへ戻す。Split View等でカメラが利用できない場合は「この表示状態ではカメラを利用できません。全画面で再試行してください。」等を表示し、手動閲覧を残す。Stage Managerが対象機で利用できると仮定しない。複数アプリを表示できることとARKitが連続動作することを同一視しない。

### DES-LIBRARY-UI — virtualization

1000件を全件mountせず、React Nativeのvirtualized list系を使う。グリッドの列変更では一覧だけを再構成し、readerまで再mountしない。可視項目callbackでthumbnailを要求する。itemはstable keyを持ち、検索の1文字ごとに全画像を開き直さない。

削除・renameは各itemメニューから1ファイルずつ。iPadのpopoverは表示anchorを適切に指定する。長い日本語名は省略表示と全文を確認できる領域を併用する。削除確認には対象名と相対フォルダを示す。

### DES-SETTINGS — セッション設定

`triggerMode`の2択、`debugVisible`、プライバシー説明、native API版・runtime signature・build profile・capability表示を提供する。再起動で初期値へ戻る旨を常に説明する。通常画面で高度な閾値スライダーや将来機能の無効スイッチを追加しない。

### DES-STATE — 状態の寿命

| データ | 寿命 | 保存先 |
|---|---|---|
| 取り込み済みPDF | 削除されるまで | Documents/library |
| 派生サムネイル | OS / LRUが削除するまで | Library/Caches |
| library index | プロセス内 | Swift map + JS store |
| readerの現在ページ | 開いているreaderの寿命 | native / JS snapshot |
| モード・検索・ソート・debug | プロセス内 | JS store |
| 係数サンプル | 有界buffer / 最大128件 | native memory |
| 診断カウンタ | プロセス内 | memory |
| build metadata | IPA作成時に固定 | アプリ同梱resource |

build metadataはユーザー設定の保存ではない。readerを閉じて開き直す場合はページ0。バックグラウンド往復だけなら現在ページを保持し、復帰時に瞬きだけを再アームする。

## DES-ERRORS — エラーコード

| code | 利用者向け意味／対処 | 備考 |
|---|---|---|
| E_LIBRARY_PATH_BLOCKED | libraryフォルダを作成できません。同名ファイルを確認してください。 | ファイルを自動削除しない。 |
| E_LIBRARY_UNAVAILABLE | ライブラリを読み取れません。再試行してください。 | 正常な0件と区別。 |
| E_IMPORT_PERMISSION | 選択したファイルへアクセスできません。 | security scope / provider。 |
| E_PROVIDER_UNAVAILABLE | ファイルの取得ができません。接続・ダウンロード状態を確認してください。 | 破損扱いにしない。 |
| E_NO_SPACE | 空き容量が不足しています。 | partialのみ除去。 |
| E_NOT_PDF | PDFファイルではありません。 | 非PDFの取り込み時。 |
| E_PDF_LOCKED | パスワード付きPDFは未対応 | 入力画面なし。 |
| E_PDF_INVALID | PDFを読み込めません。破損または未対応の構造です。 | parserの詳細保証はしない。 |
| E_PDF_EMPTY | ページがないPDFです。 | 0ページ。 |
| E_FILE_MISSING | ファイルが削除・移動されました。 | readerを閉じて更新。 |
| E_FILE_CHANGED | ファイルが変更されました。選び直してください。 | stale revision。 |
| E_NAME_INVALID | 使用できない名前です。 | basename検証。 |
| E_NAME_CONFLICT | 同じ名前のファイルがあります。 | rename時。 |
| E_PATH_OUTSIDE_LIBRARY | 対象のファイルは操作できません。 | 詳細な絶対パスを出さない。 |
| E_AR_UNSUPPORTED | この端末では瞬き操作を利用できません。 | 手動閲覧を残す。 |
| E_CAMERA_DENIED | カメラへのアクセスが許可されていません。 | システム設定への導線。 |
| E_CAMERA_RESTRICTED | カメラの使用が制限されています。 | 通常の拒否と区別。 |
| E_AR_INTERRUPTED | 瞬き操作が中断されました。 | 条件回復後に再アーム。 |
| E_TRACKING_STOPPED | 追跡が停止しています。 | JS heartbeat等。 |
| E_NATIVE_RUNTIME_MISMATCH | インストール済み開発ランタイムの更新が必要です。 | Metroの再起動だけで解決しない。 |

native navigateの`busy / boundary / stale`等は通常の制御結果であり、毎回ダイアログを出すエラーではない。利用者が続行できる状態を保ち、デバッグカウンタへ理由を反映する。

## DES-PERFORMANCE — 負荷制御・計測

重い処理の同時数は文書読込1、thumbnail生成1、importコピー1、ARSession1。readerの読込・表示を優先し、importやthumbnailの競合を抑制する。UI操作をnativeの同期ファイルI/Oでブロックしない。

メモリ警告で自前画像cacheを解放し、新規thumbnail要求を止める。`ProcessInfo.thermalState`等で深刻な状態を検知した場合は補助描画を停止し、critical時は瞬きも停止して理由を表示する。通常条件へ復帰した場合は安全な再アームから戻す。

Xcode Instrumentsをユーザーの必須操作にしない。Debug診断に、open / copy / scan / logical navigationのmonotonic timing、処理中件数、cacheサイズ、native memoryの取得可能な集計値、thermal stateを含める。公開APIだけで収集し、取得不能値を0と偽装しない。生のPDFや顔データは測定ログへ含めない。

3GBや1万ページではPDFKit内の時間・メモリが文書構造に依存する。特に高解像度画像の展開量はファイルサイズだけでは決まらない。仕様は「全体を自前でメモリ化しない設計」と「指定規模の実機試験」を要求するのであって、任意文書が必ず一定メモリ以内で開くという保証ではない。

## DES-DEVELOPMENT — Windows + development build

### 2種類のIPA

| 項目 | development | production |
|---|---|---|
| Xcode configuration | Debug | Release |
| 目的 | Windowsでの反復開発 | オフライン読書・確定版 |
| expo-dev-client | 有効 | 開発launcherを通常起動経路にしない |
| JS供給 | WindowsのMetro | IPA同梱bundle |
| カメラ / PDF / ファイルAPI | すべて組み込む | すべて組み込む |
| 顔デバッグUI | 利用可能 | 利用可能 |
| OS・機種 | 同じ2実機 | 同じ2実機 |
| Bundle Identifier / 表示名 | 原則productionと共通 / Flink | com.local.flink / Flink |
| インストール | 同じ署名identityで置換 | 同じ署名identityで置換 |

既定ではdevelopmentとproductionを別IDで同時インストールしない。PDFフォルダの分裂や追加のサイドロード枠を避けるためである。切替時のデータ保持はSideStore等の再署名方法にも依存するため、アンインストールせず同じIDで更新する試験を必須にする。OSが常にコンテナを維持すると保証しない。

### JS-only変更の反映

初回development IPAを両実機に入れた後、Windowsで次を実行する。採用package managerがnpm以外の場合もExpo CLI呼出しの意味は同じ。

```powershell
npx expo start --dev-client --lan --port 8081
```

PCと実機を同じ信頼できるLANに接続し、development clientのQR / launcherから開く。`localhost`をiPhoneから開く設定にしない。Windows Firewallは必要なプライベートネットワークのポートだけを許可し、全面無効化しない。LAN探索に失敗しても、実際のMetro URLを指定する経路を残す。Expoの公式CLIはLAN接続、Windowsのファイアウォール、任意のtunnel利用を説明している。[S-CLI]

Fast Refreshで十分な変更と、JS reloadが必要な変更を区別する。どちらもネイティブ再コンパイルではない。Metro停止後もキャッシュ済みJSが常に起動できるとは約束せず、PCなしの通常利用にはproductionを用いる。[S-DEV]

`--tunnel`はLANで接続できない場合の任意経路。外部サービスを経由するため既定にせず、利用者が選んだ場合のみ導入する。EAS Build / EAS UpdateやApple資格情報を必要にしない。JITの追加有効化を基本要件とせず、DebugをSideStoreで起動できない場合は署名・Developer Mode・エンジン設定・dev-client互換を切り分ける。

### 再ビルド判断表

| 変更 | development IPA再作成 | 対処 |
|---|---|---|
| TS / JSのUI、FSM、検索、ソート、型付きadapterのJS部分 | 不要 | Fast Refresh / reload。native契約互換が前提。 |
| Metroが扱う通常画像・スタイル・文字列 | 不要 | 必要ならMetro cache再起動。 |
| native codeを含まない依存の追加・更新 | 原則不要 | autolinking / config pluginへの影響がないことを確認。 |
| `.swift` / `.m` / `.mm` / native resource / podspec | 必要 | runtime version / signatureを更新し明示的にビルド。 |
| native依存追加・更新・削除 | 必要 | npm導入だけではIPA内にnative codeは追加されない。[S-DEV] |
| Info.plist / entitlement / scheme / bundle ID / deployment target | 必要 | config pluginから再生成。 |
| アプリアイコン・native splash・native font登録 | 必要 | 通常のMetro画像とは別。 |
| Expo SDK / React Native / Hermes / native architecture / CocoaPods解決結果 | 必要 | 対応表・lockfile・両実機を再検証。 |
| JS変更を新しいproduction IPAへ含めて確定配布 | 明示的なRelease生成が必要 | これは開発時の毎回再ビルドとは別。MVPでOTAを追加しない。 |
| README / テスト / CIの説明文だけ | 不要 | ローカル / Linux検査のみ。 |

### ネイティブ互換性管理

`nativeApiVersion = 2`を現行の契約版とする。初期の契約版1から手動の`fitCurrentPage` APIを削除したため2へ上げた。APIの削除・意味変更は版を上げ、JSが要求する版と一致しない場合は明示的な診断を出す。

`nativeRuntimeSignature`はnative source、ローカルmodule設定、autolinking対象のnative packageの解決版、native影響のあるExpo設定、config plugin、toolchain指定、native lock等から計算する。機械依存の絶対パスや生成済みbuild metadataは入力から除く。生成metadataをhash入力に含めて自己参照ループを作らない。

CocoaPodsの入力は、CIで依存解決した実際の`Podfile.lock`の正規化内容とする。初回に未解決の段階では完成済みsignatureを捏造せず、`unresolved`として扱う。初回Assetから取得したlockを`native-locks/ios/Podfile.lock`へ置いても、パス名や取得経路だけではhashが変わらないようにする。Windows側では保存した解決済みlockとinstalled runtime metadataを使って比較し、未解決の差分は「要確認」とする。

JS-onlyライブラリ変更のたびに、lockfile全体のhashだけで「必ずnative再ビルド」と判定しない。一方、不明な依存変更を自動的にJS-onlyと断定しない。signature確認は「要確認」を返しても、自動でmacOS jobを起動しない。

signatureの算出にGitコマンドを使わない。Codexはローカルのファイル・依存解決結果だけを見る。実機の署名と比較するための`native-build-info.json`は、ユーザーがRelease Assetから取得してローカルへ置く。

## DES-CI — GitHub Actions設計

### 元資料から維持する制約

U-ATTACHの「重要な制約」「GitHub Actions Artifactは禁止」「コード署名について」「検証」を継承する。違いは、最新ユーザー指示に対応するdevelopment profileを追加する点だけである。CIによるcheckout / Release操作は許可されるが、Codex自身が実行するGit / GitHub操作とは区別する。

### Workflow構成

1. `checks.yml`：通常push / pull requestでLinux上の型検査、単体試験、config / shell / workflowの静的検証。macOSビルドを呼ばない。
2. `build-ios-ipa.yml`：`v*` tag pushまたは手動実行。手動入力は既存`tag`、`profile: development | production`、`reason`を要求する。developmentは`dev-runtime-v*`、productionは`v*`のみ受け付ける。

```yaml
# triggerの契約。actionの版・job全体は実プロジェクトに合わせて実装する。
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        type: string
        required: true
      profile:
        type: choice
        options: [development, production]
        required: true
      reason:
        type: string
        required: true
```

`v*` tag pushのprofileはproductionに固定する。`dev-runtime-v*`をpushしただけではnative buildしない。ユーザーが手動起動する。手動実行ではworkflowを実行するbranchと実際にビルドするtagを混同せず、必ず指定tagのcommitをcheckoutする。

### Toolchain

初期候補は`macos-26` + Xcode 26.6。確認したrunner公式一覧にXcode 26.6 / 26.5 / 26.4.1等があり、Expo公式SDK表はSDKに応じたXcode・Node下限を示している。**実プロジェクトのSDKを確定してから**組合せを固定する。[S-RUNNER][S-SDK]

`macos-latest`や自動的なXcode最新版選択を採用しない。`DEVELOPER_DIR`で選択し、起動時に存在・版を検証する。Nodeもpackage managerのlockに適合するexact版を設定する。Ruby / CocoaPodsはGemfile / Gemfile.lockまたは同等の固定設定で管理する。SDKを自動upgradeしてtoolchainへ合わせない。

GitHub-hosted job自体の上限とは別に、このプロジェクトのnative jobは`timeout-minutes: 90`を初期の費用制御値とする。所要時間の予測ではない。超過時は原因を記録し、無断で上限を増やさない。[S-ACTIONS-LIMITS]

### ビルド処理

```text
Linux preflight
  入力形式 / profile-tag対応 / package lock / 型・テスト / 禁止設定を確認
     ↓ 成功時のみ
macOS job
  指定tagをcheckout・commitを記録
  toolchain検証
  lockに従いJS依存を導入
  profileを指定してExpo configを評価
  CNGならexpo prebuild --platform ios --no-install
  native lockを反映しCocoaPods導入
  workspace / scheme / application targetを生成物から確定
  native build infoをresourceとして生成
  xcodebuild（DebugまたはRelease、iphoneos、署名なし）
  .appとnative/bundle設定を検査
  Payload/Flink.appへ梱包
  checksum / native-build-info / Podfile.lockを準備
  対象ReleaseへAssetを公開
```

CNGの生成物は専用runner workspace内で作る。`prebuild --clean`は生成物であることが確認された場合にのみ使用可能とし、既存手動native projectを破壊するために使わない。

初回はPodfile.lockがないため、依存解決結果をRelease Assetとして返す。ユーザーが`native-locks/ios/Podfile.lock`へ配置した後は再利用・検証する。native依存変更時は差分を確認して意図的に更新する。この初回例外を隠して完全再現済みと主張しない。Pod lockが現行設定と矛盾した場合に、何も報告せず毎回最新解決しない。

xcodebuildは概念的に次の形とする。workspace / schemeの推測値をそのまま実行しない。

```bash
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build
```

`xcodebuild -list -json`、`-showBuildSettings -json`等を解析してapplication targetを特定し、`TARGET_BUILD_DIR`と`FULL_PRODUCT_NAME`から`.app`を解決する。複数候補時に`find | head -1`で選ばない。`SUPPORTED_PLATFORMS`、`TARGETED_DEVICE_FAMILY`、最低OS、Bundle Identifier、実行ファイル、embedded frameworksを確認する。`Flink.app`になっていない場合は元のPRODUCT_NAME設定を見直し、他アプリの成果物を勝手にリネームして梱包しない。

`-allowProvisioningUpdates`や証明書導入を追加しない。Simulator SDKを使わない。Releaseでは実際のJS bundle / assetsが同梱され、development launcherなしで起動することを確認する。Debugではdev-clientが組み込まれていることを確認する。

### 梱包・検証

```bash
mkdir -p "$STAGE/Payload"
ditto "$APP_PATH" "$STAGE/Payload/Flink.app"
ditto -c -k --keepParent "$STAGE/Payload" "$IPA_PATH"
unzip -l "$IPA_PATH"
```

検査項目：`Payload/Flink.app/Info.plist`、実行ファイル、arm64のiOS device向けMach-O、minimum OS、UIDeviceFamilyに1 / 2、Documents公開キー、カメラ説明、必要なframework / resources、Release bundle、不要な署名要求・資格情報の不在。`Payload/Payload`の二重階層を作らない。CIが署名せずに作るIPAであることと、SideStoreによる再署名後の起動確認を分ける。

### Release管理

- production tag例：`v1.0.0`。Expoのアプリversionと一致を検証し、IPA名は`Flink-1.0.0-unsigned.ipa`。
- development tag例：`dev-runtime-v1.0.0`。native runtimeの版を示し、IPA名は`Flink-dev-runtime-1.0.0-unsigned.ipa`。通常のアプリversionはExpo設定を使う。
- build numberはworkflow runから有効なCFBundleVersion形式へ変換し、結果を記録する。rerunのattemptはmetadataへ別途記録する。
- native jobだけに`contents: write`。認証は`GH_TOKEN: ${{ github.token }}`等の標準token。PAT / Apple secretは不要。
- tagは入力形式を厳密に検証し、environment経由でquoted shell引数として渡す。ユーザー入力を`${{ ... }}`でshell本文へ直接埋め込まない。先頭`-`やshell metacharacterを許可しない。
- Releaseがない場合は`gh release create`で作成するが、`--verify-tag`を付けて未存在tagの自動生成を防ぐ。指定tagの実commitを記録する。[S-GH-CREATE]
- 新規Releaseは必要ならdraftで作り、IPA・checksum・build infoのuploadと検証後に公開する。developmentはprerelease、latestにしない。
- 既存Releaseではソースtag / profileを確認してからAssetを扱う。同一tagを別commitへ付け替える運用をしない。
- mutableな既存Releaseでは再実行時の同名Assetを`--clobber`で置換できる。公開済みimmutable ReleaseではAsset変更が禁止されるため、同一内容ならno-op、不一致ならユーザーに新tagを要求する。リポジトリのimmutable設定を勝手に無効化しない。[S-GH-CREATE][S-GH-UPLOAD]
- `concurrency`でnative jobの重複実行を抑制する。実行中のビルドを通常pushで何度も取り消してやり直す設計にしない。

AssetはIPAに加え、`SHA256SUMS.txt`、`native-build-info.json`、初回または更新時の`Podfile.lock`を許容する。これはGitHub Releases内のAssetであり、Actions Artifactではない。ユーザーのPDF・顔データをAssetへ追加しない。

cacheはpackage manager / Bundler / CocoaPodsの依存取得を対象とし、OS・CPU arch・Xcode・lockに応じてkeyを分ける。署名済み成果物、IPA、staging、DerivedData全体の雑な復元をcacheに使わない。複数job間でIPAを渡すために`upload-artifact`を使う設計は禁止し、ビルドからRelease uploadまで同じmacOS jobで行う。

## DES-SOURCES — 公式参照資料

確認日：2026-09-09。ライブラリ／runnerの最新版を無条件で実プロジェクトへ適用せず、採用版の公式資料と照合する。設計値、状態機械、キャッシュ容量、レイアウト寸法は本書独自の決定である。

[S-AR]: https://developer.apple.com/documentation/arkit/arfacetrackingconfiguration/
[S-EYE-L]: https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation/eyeblinkleft
[S-EYE-R]: https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation/eyeblinkright
[S-SCENE]: https://developer.apple.com/documentation/arkit/arscnview?changes=l_6
[S-PDF]: https://developer.apple.com/documentation/pdfkit/pdfview
[S-PDFDOC]: https://developer.apple.com/documentation/pdfkit/pdfdocument
[S-FIT]: https://developer.apple.com/documentation/pdfkit/pdfview/autoscales
[S-LOCK]: https://developer.apple.com/documentation/pdfkit/pdfdocument/islocked
[S-THUMBNAIL]: https://developer.apple.com/documentation/pdfkit/pdfpage/thumbnail(of:for:)
[S-FILES]: https://developer.apple.com/documentation/fileprovider
[S-PICKER]: https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller
[S-PICKER-DELEGATE]: https://developer.apple.com/documentation/uikit/uidocumentpickerdelegate/documentpicker(_:didpickdocumentsat:)
[S-COORDINATOR]: https://developer.apple.com/documentation/foundation/nsfilecoordinator/coordinate(readingitemat:options:error:byaccessor:)
[S-EXPO-PICKER]: https://docs.expo.dev/versions/latest/sdk/document-picker/
[S-MODULES]: https://docs.expo.dev/modules/get-started/
[S-MODULE-API]: https://docs.expo.dev/modules/module-api/
[S-CNG]: https://docs.expo.dev/workflow/continuous-native-generation/
[S-EXPO-CONFIG]: https://docs.expo.dev/versions/latest/config/app/
[S-BUILD-PROPERTIES]: https://docs.expo.dev/versions/latest/sdk/build-properties/
[S-DEV]: https://docs.expo.dev/develop/development-builds/use-development-builds/
[S-CLI]: https://docs.expo.dev/more/expo-cli/
[S-SDK]: https://docs.expo.dev/versions/latest/
[S-RUNNER]: https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md
[S-ACTIONS-LIMITS]: https://docs.github.com/en/actions/reference/limits
[S-GH-CREATE]: https://cli.github.com/manual/gh_release_create
[S-GH-UPLOAD]: https://cli.github.com/manual/gh_release_upload

| 分野 | 参照 |
|---|---|
| Face Tracking / 係数 | [S-AR]、[S-EYE-L]、[S-EYE-R] |
| SceneKit / ARSCNView | [S-SCENE] |
| PDF表示・文書・fit・ロック・thumbnail | [S-PDF]、[S-PDFDOC]、[S-FIT]、[S-LOCK]、[S-THUMBNAIL] |
| Documents公開・picker・協調読取 | [S-FILES]、[S-PICKER]、[S-PICKER-DELEGATE]、[S-COORDINATOR] |
| Expoのpickerコピー特性 | [S-EXPO-PICKER] |
| native module / CNG | [S-MODULES]、[S-MODULE-API]、[S-CNG] |
| config / development | [S-EXPO-CONFIG]、[S-BUILD-PROPERTIES]、[S-DEV]、[S-CLI] |
| SDK / runner / CI制約 | [S-SDK]、[S-RUNNER]、[S-ACTIONS-LIMITS] |
| Release / tag / Asset | [S-GH-CREATE]、[S-GH-UPLOAD] |
