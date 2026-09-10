---
document_id: FLINK-IMPLEMENTATION
version: 1.0.0
updated_at: 2026-09-09
language: ja
audience: Codex
status: specification_ready_implementation_unverified
read_order: 3
requires:
  - 01_requirements.md
  - 02_design.md
phase_count: 5
---

# Flink 実装手順書

## PLAN-RULES — Codexの実行規則

本書は実装を5 Phaseに限定する。Phaseを追加して先送りせず、native修正が必要になった場合は既存Phase 2へ戻って該当成果物を更新する。文書作成時点ではコード・ビルド・実機試験は未実施である。

### 作業担当の分離

| 担当 | 実行してよいこと | 実行してはいけないこと |
|---|---|---|
| Codex | ローカルファイル調査・編集、依存導入、Windowsで動くテスト、workflow / CI scriptの作成、検証台帳の更新 | `git` / `gh`、GitHub connector / API、commit / push / tag、Release作成、workflow実行、リポジトリ作成・設定変更、Mac / Xcodeを使ったローカルビルド |
| ユーザー | Git / GitHub操作、Actions起動、Asset取得、SideStore再署名、両実機操作、結果・ログの共有 | Apple資格情報をCodexやCIへ渡す必要はない |
| GitHub Actions | ユーザーが指定したtagのcheckout、macOSビルド、unsigned IPA梱包、GITHUB_TOKENでRelease作成・Asset upload | Appleコード署名、EAS、Actions ArtifactへのIPA保存、勝手なtag作成 |

CI script内の`git` / `gh`は、**ユーザーが起動するCI用のコード**である。Codexがローカルで実行してよい例ではない。ユーザー操作が必要な地点では、必要な入力と確認項目を報告し、実行していないことを明示する。架空のworkflow run、commit hash、ビルド成功ログ、実機結果を記録しない。

### 完了状態の表現

`implementation-status.md`にタスク・テストごとの状態を次から記録する。

```text
NOT_STARTED
IMPLEMENTED_UNVERIFIED
LOCAL_VERIFIED
CI_VERIFIED
DEVICE_VERIFIED_IPHONE
DEVICE_VERIFIED_IPAD
BLOCKED
```

ソース実装完了と実機合格は別である。実機操作を待つ状態でも、ユーザー権限の操作をCodexが代行しない。既知のmock結果を実機結果へ流用しない。

## PLAN-OVERVIEW — 5 Phase

| Phase | 目的 | 主な成果物 | native build |
|---|---|---|---|
| 1 | 既存生成物を調査し、依存・契約・CNG・検証土台を固定 | 環境台帳、設定、型、mock、unit tests、静的checks、workflow原案 | なし |
| 2 | 必要なnative機能をまとめ、再利用するdevelopment IPAを作る | Swift Modules、PDF / file / AR / debug実装、CI、初回実機証拠 | 基本1回目。native不具合があれば追加 |
| 3 | ライブラリ機能をdevelopment build上で完成 | 取り込み・一覧・検索・ソート・thumbnail・削除・rename | 原則なし |
| 4 | 瞬き・reader・iPad UIを統合 | FSM、lifecycle、設定、adaptive reader、回帰試験 | 原則なし |
| 5 | 大容量・両実機を検証し、Release IPAを確定 | 性能結果、セキュリティ確認、オフラインRelease、引継ぎ | 基本2回目。必要な修正時のみ追加 |

「2回」は不要なビルドを減らす基本計画であり、成功を保証する上限ではない。各PhaseでTS-only変更を理由にnative jobを起動しない。Release確定は通常開発とは区別し、ユーザーが明示的に行う。

---

## Phase 1 — 調査・契約・ローカル検証基盤

### 目的

Expo生成物を壊さず、iPadOS 18.6.2と後続のdevelopment build再利用に適した構成を確定する。native compile前に検出できる失敗をWindows / Linuxで除く。

### 入力

要件・設計・本手順書、ユーザー添付のActions実装プロンプト、ローカルの`create-expo-app`生成物。`.gitignore`等の通常ファイルは確認してよいが、Gitコマンドによる調査をしない。

### タスク

**P1-01：既存構成の調査。** `package.json`、lockfile、Expo config、entry point、Router有無、TS設定、既存script、`ios/`、workflowをファイルから確認する。複数lockfileは推測で混在利用せず、使用中のpackage managerを確定する。リモートtag / Releaseの実在調査はユーザー担当とする。

**P1-02：バージョン台帳。** 実際のExpo / React Native / React / Node / package manager版を記録する。現在の公式SDK対応表と照合し、最低OS 18.0、対象iPadOS 18.6.2を満たすことを確認する。[S-SDK] 仮の最新版へ書き換えない。SDKが要件と両立しない場合はBLOCKEDと理由を記録し、無断でiPad対応を落とさない。

**P1-03：native toolchainの固定。** `config/native-toolchain.json`へNode exact版、package manager、Ruby / CocoaPodsの方針、macOS label、Xcode、deployment target、CNGの有無を記録する。初期候補はDES-CIの`macos-26` / Xcode 26.6であり、実SDKとの互換を確認する。採用時点のrunner仕様を確認し、beta Xcodeへ自動移行しない。[S-RUNNER]

**P1-04：アプリ設定。** 名前Flink、Bundle Identifier初期値`com.local.flink`、tablet対応、向き、theme、Documents公開、カメラ説明、development時だけのLAN設定をconfig pluginで再生成可能にする。既存のapp config形式をむやみに全面変更しない。ユーザーがBundle Identifierを変えるなら初回IPAより前に行う。

**P1-05：依存とローカルModule。** SDK互換の`expo-dev-client`を導入し、local Expo Moduleを`modules/flink-native`へ作る。autolinking、podspec、Swift module名を確定する。必要なnative依存をこの段階で洗い出し、後からUI小変更のために追加しない。[S-MODULES][S-DEV]

**P1-06：型付き契約。** DES-CONTRACTSの`DocumentRef`、reader / tracking / generation / revision、エラー、native APIを定義する。Native Adapterとmockの戻り値・エラーを同じ形にする。現行契約はAPI 2であり、実機でnative moduleが見つからないときに、黙ってmockへfallbackしない。

**P1-07：純粋ドメインの単体試験。** 瞬きFSMのfixture、検索・ソート、表示ページ数変換、入力バリデーション、古いreader response拒否をテスト可能にする。状態機械の初期実装またはテスト用仕様を作り、Phase 4で同じテストを完成させる。

**P1-08：CIの静的基盤。** `checks.yml`と`build-ios-ipa.yml`の原案を作る。tag/profile検証、最小権限、署名なし、Artifactなし、GitHub Releasesのみ、main pushでnative buildしないことをテストする。action参照は公式提供元と採用時の固定版／commitを確認し、未確認のSHAを捏造しない。

**P1-09：署名情報・native signature。** `nativeApiVersion`、`nativeRuntimeVersion`、runtime signatureの計算方式、生成metadata除外、`native:check`scriptを用意する。検査はファイルだけで行い、Git / GitHubへ接続しない。

**P1-10：検証台帳とfixture。** 小さい正常PDF、1ページPDF、横長／縦長混在、壊れたPDF、パスワードPDF、非PDF、Unicode名、同名コピー等の準備手順を作る。大容量データは通常のsourceやIPAへ含めない。

### Windowsで行う検証

npmプロジェクトの代表例。実際のpackage managerへ揃え、存在しないscriptを実行したことにしない。

```powershell
npm ci
npx expo install --check
npx expo-doctor
npx expo config --type public
npm run typecheck
npm run lint
npm run test:unit
npm run verify:config
npm run native:check
```

`typecheck`等はこのPhaseで定義するプロジェクトscript。`expo-doctor`等のツール版と実行結果を記録する。public config出力にも秘密値を入れない。Windowsで`xcodebuild`、`pod install`、`expo run:ios`を実行する手順にしない。

### 出口条件

- ENV-001〜ENV-006、DEV-005〜DEV-006に対応する設定・環境台帳があり、未知のSDK版を仮定していない。
- 必要なnative APIの一覧と意味が固定され、Phase 2で実装する範囲が明確。
- 型検査と実装済み単体試験が通る。まだないnative実装は明示的に未実装であり成功mockを本番利用していない。
- TC-D05 / TC-D06 / TC-D07の静的に実行可能な部分がLOCAL_VERIFIED。
- macOS buildはまだ実行していない。

---

## Phase 2 — native基盤・最初のdevelopment IPA

### 目的

後続PhaseでSwiftやnative設定を触らずに反復できるよう、必要なnative機能を初回development buildへまとめる。Windowsでは確かめられないiPad / ARKit / サイドロードの成立性を早期に検証する。

### 依存

Phase 1の契約とローカル検証が完了していること。ユーザーがGitHub上の初回tagとActions実行を担当できること。

### タスク

**P2-01：保存領域。** FR-001 / DES-STORAGEを実装する。library初期化、同名ファイル衝突、private staging、cache、root escape防止を実装する。フォルダ表示は初回起動後に確認する。

**P2-02：Filesサービス。** 再帰走査、opaque ID / revision、相対パス、増分無効化、型付きエラーを実装する。初回一覧のために全PDFを開かない。

**P2-03：ImportCoordinator。** native picker、security scope、coordinated read、固定長ストリームコピー、空き容量不足、キャンセル、no-replace commit、複数ファイルの部分成功を実装する。UIを完成させる前でも全APIが動くようにする。

**P2-04：削除・rename・presenter。** coordinated write、revision検証、名前検証、キャッシュ無効化、読書中ファイルのrelinquish、外部削除／移動を実装する。provider callbackとmain間のデッドロックをレビューする。

**P2-05：PDFView。** URLベース読込、縦方向の連続表示、前／次、ページ数表示タップからの番号ダイアログ移動、自動fit、mixed page size、回転、ロック・破損判定、readerSessionId、open requestキャンセル、command dedupeを実装する。明示的な移動・open・layoutではfitするが、受動的なスクロールでのページ変更では倍率や位置をリセットしない。可視ページすべてで外部PDFアクションを無効化する。手動のページ全体リセットは提供しない。非同期メソッドを単にmain上で巨大処理を行うラッパーにしない。

**P2-06：サムネイル。** page 0、ライブラリ表示時の自動直列要求、生成1件、キャッシュ、キャンセル、reader優先・メモリ警告対応を実装する。

**P2-07：FaceSessionCoordinator。** capability、カメラ許可、ARSession 1つ、左右係数、face identity、有界buffer、pull drain、native monotonic clock、watchdog、inactive停止を実装する。`isSupported`をtrueに固定したり機種名のハードコードで代用しない。

**P2-08：無地の顔デバッグ。** ARSCNView / SceneKit、白背景面、濃いグレーの顔、白い目・口、カメラ映像非表示、通常時の描画停止を実装する。ARSessionを2つ作らない。Releaseで顔デバッグを使える構成にする。

**P2-09：ContextBroker / runtime情報。** 古いreaderやtracking世代のページコマンドをnativeでも拒否する。API版、runtime signature、build profile、ソースcommit等を同梱metadataから取得可能にする。ユーザー状態の保存機構を追加しない。

**P2-10：スモーク画面。** Debug用の最小UIで、ファイル選択、一覧、PDF表示、手動移動、左右係数、顔表示、環境情報を確認できるようにする。これはnative契約を試すための画面であり、後続Phaseの完成UIと混同しない。native操作はstubのままにしない。

**P2-11：CIを実装。** DES-CIのpreflight → macOS → unsigned `.app` → IPA → GitHub Releasesを完成させる。引数のquote、tagの実commit、package / Pod lock、Debug / Release分岐、minimum OS / device family / resourcesの検査を実装する。

### 初回nativeビルド前のまとめ確認

```text
[ ] Files: init / scan / picker / cancel / rename / delete / thumbnail が実装済み
[ ] PDF: open / close / vertical continuous scroll / prev / next / dialog jump / fit / visible-page action suppression / notifications が実装済み
[ ] Face: permission / capability / start / stop / reset / drain が実装済み
[ ] Face debug: 白背景・顔・目・口・表示OFF時の停止が実装済み
[ ] lifecycle: inactive / background / JS reload / stale commands が扱われる
[ ] app config: tablet / orientations / sharing / permissions / dev LAN が揃っている
[ ] native API v2とTS型が一致する
[ ] Expo / JS依存の導入はlockfileに反映済み
[ ] local checksに失敗がない
[ ] workflowにupload-artifact、EAS、Apple secret要求がない
```

### ユーザー担当の最初の実行

ユーザーが変更をcommit / pushし、既存commitを指す`dev-runtime-v1.0.0`等のtagを作成する。GitHub Actionsの手動実行で、そのtagと`profile=development`、初回native基盤確認というreasonを指定する。

Codexはこの操作を実行しない。実行後に提供されたログ・Asset情報を読み、次を確認する。

```text
toolchainの実版
実際のworkspace / scheme / application target
Debug + iphoneos + generic iOS device
CODE_SIGNING_ALLOWED=NO等の適用
minimum OSが18.0、UIDeviceFamilyにiPhone / iPad
ローカルExpo Moduleのautolinking
Payload/Flink.app構造
Release Assetの名前・SHA256・native signature
CocoaPods解決結果
```

ユーザーがIPAを取得し、SideStore等で再署名して両実機へインストールする。SideStoreの初期セットアップ・更新・Developer Modeは、その時点の公式手順に従う。iOS 26.5での互換を未検証のまま断定しない。公式にはOS依存のエラー案内があるため、インストール問題はFlinkのビルド・JS・ARKitと分けて診断する。[S-SIDE]

### 初回の実機ゲート

| 項目 | iPhone 13 / iOS 26.5 | iPad (A16) / iPadOS 18.6.2 |
|---|---|---|
| 署名後、native debugger / Macなしで起動 | 記録必須 | 記録必須 |
| Windows Metroへ接続 | 記録必須 | 記録必須 |
| native API / signatureが表示される | 記録必須 | 記録必須 |
| 初回起動後、FilesにFlink/libraryがある | 記録必須 | 記録必須 |
| 小さいPDFをコピー・開く・手動移動できる | 記録必須 | 記録必須 |
| `isSupported`の値 | 実測値を記録 | 実測値を記録 |
| 左右の閉眼係数が実際に変化する | 記録必須 | 記録必須 |
| 片目閉眼でも左右を別々に取得できる | 記録必須 | 記録必須 |
| 無地の顔、白い目・口、背景映像なし | 記録必須 | 記録必須 |
| backgroundでカメラが停止する | 記録必須 | 記録必須 |
| TSの表示文字列変更が同じIPAへ反映 | 記録必須 | 記録必須 |

iPadはTrueDepthがないことだけで不合格にしない。実際にARKitが利用不能なら、手動PDFは残すが主要機能のゲートは未達と記録する。[S-AR] native側の修正が必要な場合はこのPhaseでまとめ、native runtime版を更新して追加buildする。UI変更をnative不具合修正と一緒に小分けして連続buildしない。

### 出口条件

- native API全項目が実装済みで、未実装stubが初回IPAに残っていない。
- TC-D02〜TC-D04、TC-D08の初回経路がCI / 両実機で確認されている。
- FR-001、FR-008、FR-012、FR-018のnative成立性が両実機で確認されている。
- TS-only更新が同じIPAで動き、WindowsにMac / Xcodeを要求していない。
- ユーザーが初回Podfile.lock / build infoを保存し、次回の依存固定方法が明確。

---

## Phase 3 — ライブラリ機能の完成

### 目的

Phase 2のnative APIを再利用し、実際の読書導線としてファイル管理・ライブラリを完成させる。

### タスク

**P3-01：LibraryStore。** 正本をnative scanに置き、メタデータだけをJSへ保持する。取り込み履歴用の別リスト、DB、保存用JSONを追加しない。走査世代を使い、古い完了通知の上書きを防ぐ。

**P3-02：一覧。** virtualizedなiPhoneグリッドとiPadの多列グリッドを実装する。非PDFを表示しない。空・読取失敗・コピー中・破損・ロックを別状態にする。

**P3-03：Import UI。** 追加ボタン、複数選択、provider待機、不定／確定進捗、キャンセル、部分成功の結果表示を実装する。「アップロード」は通信ではなくコピーであることが分かる表記にする。

**P3-04：検索・並び替え。** ファイル名部分一致、自然な数字順、name / date / sizeの昇降順、同値の安定順を実装する。ユーザー状態はメモリのみ。

**P3-05：Thumbnail UI。** 可視項目優先で要求し、URI / revisionを検証して表示する。古いthumbnail responseが改名後の別項目に貼られないようにする。未生成・失敗にプレースホルダーを使う。

**P3-06：削除・名前変更。** destructive confirmation、入力検証、同名拒否、現在読書中の対象を閉じる流れを実装する。実ファイルが削除される意味を曖昧にしない。

**P3-07：外部変更。** invalidation、foreground、ライブラリ再表示、手動更新を統合する。Filesで削除・移動・改名・上書きした結果を確認する。通知未到着でも手動更新で収束できること。

**P3-08：台帳。** TC-F01〜TC-F11、TC-P03、TC-N03の該当部分を両実機で実施し、native runtime signatureを記録する。

### 開発の進め方

同じdevelopment buildにWindowsのMetroを接続する。UIやドメイン修正ごとに`native:check`で影響を確認し、TS-onlyならrefresh / reloadのみで検証する。Native Adapterのモックではなく実機のSwift APIを使う。足りないnative動作が見つかった場合は、要件を省略せずPhase 2のnative修正として記録する。

### 出口条件

FR-001〜FR-007が実装され、両実機でファイル経路、非PDF除外、同名コピー、削除、改名、外部変更が確認されている。1000件の一覧を表示するために1000個のPDFDocumentやReact Viewを同時生成していない。TSだけの変更で追加native buildを実行していないことを記録する。

---

## Phase 4 — 瞬き・reader・iPad UIの統合

### 目的

通常の両眼瞬きをページ操作へつなぎ、設定・ライフサイクル・adaptive UIを統合する。native API v2を維持したままTS中心で反復する。

### タスク

**P4-01：FSM完成。** DES-BLINK-FSMを純粋関数／クラスとして実装し、全境界値と人工時系列を試験する。close / reopen、片目、左右のずれ、長時間閉眼、startup closed、NaN、overflow、stale、face change、cooldownを網羅する。

**P4-02：Pull controller。** 最大1つのdrain Promise、50ms程度のpoll、有界サンプル、monotonic時刻、最大age、例外からの復旧を実装する。JS停止後のバッチを再生しない。

**P4-03：ReaderController。** manualとblinkを同じnative navigateに集約する。readerSessionId、generation、commandId、stateRevisionを使い、二重ページ送り・古い応答を防ぐ。nativeの結果が正本。

**P4-04：Lifecycle。** PDF openで自動開始、権限拒否時の手動閲覧、background停止、モーダル停止、顔ロスト後の再アーム、JS reload、PDF切替時の破棄を実装する。通常の開始ボタンを追加しない。

**P4-05：Reader UI。** 縦スクロール、ピンチ、前／次、ページ数表示タップで開くページ番号ダイアログ、境界状態、ロード・エラー、追跡状態を仕上げる。手動のページ全体リセットは追加しない。ズーム中の瞬きや明示的な移動は移動先で自動fitする一方、受動的なスクロールでは倍率を維持する。PDF本文検索や見開きを追加しない。

**P4-06：Settings。** モード切替、デバッグON/OFF、説明、runtime診断を作る。設定はプロセス内だけとし、切替時に判定途中の候補を破棄する。

**P4-07：iPad UI。** wideの多列ライブラリ、reader sidebar、折り畳み、狭いウインドウの1ペイン化、回転を実装する。PDFViewは同じインスタンスを維持する。デバッグパネルは読書画面に配置し、mode設定モーダルとは区別する。

**P4-08：日本語・theme・操作性。** ライト／ダーク、白固定の顔キャンバス、PDF色の非反転、音・振動なし、長い名前、文字拡大、VoiceOverラベル、safe area、キーボードを確認する。

**P4-09：両実機回帰。** TC-B01〜TC-B13、TC-R01〜TC-R06、TC-U01〜TC-U06、TC-D01を実施する。normal blinkの実測数、単眼時の誤動作、debug ON/OFF、portrait / landscapeを分けて記録する。

### 精度の確認方法

十分な照明、正面に近い顔、読みやすい距離を標準条件として、各モードで最低30回の単発の両眼瞬きを行う。各試行は開眼を500ms以上挟む。検出数・native適用数・余分なページ数を別々に記録する。既定の目標は各実機・各モードで27/30以上を検出し、1つの動作で2ページ以上送らないこと。これは本プロジェクトの初期受入目標であり、公称精度ではない。

片目は左右それぞれ20回を行い、ページ操作0件を要求する。下向き・眼鏡・暗所などは追加条件として計測し、標準条件の結果と混ぜない。目視した回数は操作者の記録であり、カメラ映像を保存して検証する手順にはしない。

閾値を調整した場合は変更前後の値と同じfixtureの結果を残す。通常の瞬きを検出できないからといって、ユーザーに黙って長い瞬きや2回瞬きへ仕様を変えない。

### 出口条件

FR-008〜FR-019が両実機で確認され、close / reopenの設定変更、auto start、iPad独自レイアウト、背景復帰、古いサンプル破棄が動く。永続化を追加していない。TSのみで改善した範囲とnative修正が発生した範囲を区別して報告する。

---

## Phase 5 — 規模・安全性・Release・引継ぎ

### 目的

大容量を含む現実的な負荷を両実機で確認し、オフラインで使えるRelease IPAを生成する。開発版の成功だけでMVP完了にしない。

### タスク

**P5-01：fixtureの準備。** 下記PLAN-FIXTURESの容量・ページ・件数・画像負荷を用意する。ユーザーの書籍・漫画をGitHubへアップロードしない。権利上利用できるデータのみ使用する。

**P5-02：大容量経路。** 3GB級コピー、3GiB境界、1万ページの先頭／中間／末尾、ズーム、1000件一覧、空き容量不足、外部変更を検証する。実際のPDFKit負荷と、ファイルI/Oの境界値試験を分ける。

**P5-03：安定性。** 各実機で30分・500ページ操作を含む読書、debug ON/OFF、回転、ファイル切替、inactive / foregroundを実施する。native memory、thermal、処理件数、誤動作、異常終了を記録する。

**P5-04：セキュリティとデータ。** 外部URL / path、symlink、stale revision、copy中断、scope解放、キャッシュ上限、PDF / 顔データの非送信・非保存、ログ内容、権限拒否を確認する。利用者のPDFを自動削除するcleanupがないことをレビューする。

**P5-05：Release前のnative影響確認。** `native:check`、全ローカル試験、依存lock、config評価、workflow検証を実行する。native変更が残っていればまとめてPhase 2相当の確認を行う。失敗を隠すために容量目標・iPad対応を削らない。

**P5-06：ユーザーがRelease生成。** ユーザーが確定commitに`v1.0.0`等のtagを作成し、production workflowを実行する。tagとExpoのversionを一致させる。Codexは実行しない。

**P5-07：Release IPA確認。** GitHub Releasesにunsigned IPA、checksum、build infoがあることを確認する。minimum OS、iPhone / iPad device family、カメラ説明、フォルダ公開、同梱JS、署名なし、Artifact未使用をCIログと生成物で検証する。

**P5-08：オフライン実機試験。** 同じBundle Identifier / 再署名identityでdevelopmentからproductionへ更新し、PDFが残るか確認する。更新前に必要なPDFをFilesから別領域へバックアップする。Metroを停止し、ネットワーク接続がなくても保存済みPDFの閲覧・両眼瞬き・debug表示が動くことを両実機で確認する。署名の有効期間等はSideStore側の運用条件として別に記録する。[S-SIDE]

**P5-09：Releaseでの再測定。** Debugのメモリ・速度だけでproduction性能を判定しない。大容量open、単発瞬き、通常ページ移動、1000件一覧、background復帰についてReleaseで再度測る。

**P5-10：引継ぎ。** 変更ファイル、採用版、workspace / scheme、CI契機、Asset名、runtime signature、検証済み機種／OS、テスト結果、未検証項目、既知制約、再ビルド判断、Windows手順を報告する。

### 出口条件

`01_requirements.md`のREQ-ACCEPTANCEを満たし、全必須テストに実測の証拠がある。未実施の大容量試験や片方の機種を「おそらく動く」として合格にしない。native API・docs・workflow・検証台帳の版が一致し、CodexがGit / GitHub操作を直接行っていない。

---

## PLAN-FIXTURES — 試験データ

| データID | 内容 | 目的 |
|---|---|---|
| FIX-01 | 3ページの正常PDF。各ページに大きく1・2・3を表示。 | 送り回数・ページ順・境界。 |
| FIX-02 | 1ページPDF、縦長／横長混在PDF、回転メタデータ付きPDF。 | fit・向き・1ページ境界。 |
| FIX-03 | 日本語名、空白、絵文字、数字付きの名前、同名PDF、`.PDF`。 | index・ソート・rename・URI。 |
| FIX-04 | `.txt` / `.jpg` / サブフォルダ / 偽装`.pdf` / 0-byte / 破損PDF。 | 除外・異常分離。 |
| FIX-05 | 開くのにパスワードが必要なPDF、および空パスワードで開ける暗号化PDF。 | isLockedとisEncryptedの区別。 |
| FIX-06 | 1万ページの有効PDF。ページごとに番号を持つ。 | 多ページ・中間／末尾への移動。 |
| FIX-07 | 実バイトサイズ3,000,000,000以上、別途3GiB程度の有効PDF。 | 大容量コピー・64bit・大きいoffset。 |
| FIX-08 | 多数の画像を含む、権利上利用可能な書籍／漫画相当PDF。可能なら3GB級。 | 実際の展開・描画・メモリ負荷。 |
| FIX-09 | 小さい正常PDFを中心に1000件。 | 一覧・virtualization・検索・cache。 |
| FIX-10 | ARKit係数の人工JSON配列。個人の実測顔データは保存しない。 | FSMの全境界と回帰。 |

巨大なfixtureを作るscriptは逐次出力し、Windows自体でも全体をメモリ化しない。大きな未参照streamやコメントでサイズを増やした有効PDFはoffset / コピーの試験には使えるが、実画像PDFの描画負荷の代用品にはしない。

FIX-07 / FIX-08 / FIX-09は端末空き容量に合わせて個別に試す。1000×3GBの同時配置を要求しない。実データを用意できなかった試験はNOT_STARTEDまたはBLOCKEDのままとし、合格にしない。

## PLAN-TESTS — 必須テストカタログ

`Local`はWindows / Linuxの単体・契約・静的検証、`CI`はユーザーが起動するmacOS workflow、`Device`は対象両実機。テスト名だけではなくGiven / When / Thenに相当する操作と結果を保存する。

### ファイル・ライブラリ

| ID | 環境 | 操作と期待結果 |
|---|---|---|
| TC-F01 | Device | 初回起動→Filesで`Flink/library`が見える。`Documents/Flink/library`の二重階層なし。library削除後の再作成、同名通常ファイルがある場合の非破壊エラーも確認。 |
| TC-F02 | Device | システムpickerからローカル／File ProviderのPDFを取り込む→library直下にコピー。元ファイル不変。複数選択・provider取得待ち・取得不能を区別。 |
| TC-F03 | Local + Device | コピー中キャンセル、空き不足、background、途中失敗→未完成PDFを一覧に出さず自前partialを掃除。既存PDF・完了済みコピー・元ファイルは残る。 |
| TC-F04 | Local + Device | 同名取り込みを繰り返す／commit直前に同名を外部作成→(2),(3)等になり上書きなし。1実ファイル1項目。内容同一の別ファイルは統合しない。 |
| TC-F05 | Device | root直下、兄弟folder、library、library下位folderへ各種ファイルを配置→library内の通常PDFだけ表示。`.PDF`を含み、非PDFは無視・非削除。 |
| TC-F06 | Local + Device | 走査中に新走査、属性取得エラー、root読取不能→古い結果で上書きしない。一部警告と全体エラーを区別。 |
| TC-F07 | Device | Filesから削除、library外へ移動、library内rename→再表示／foreground／手動更新で現状に一致。削除済み履歴を残さない。 |
| TC-F08 | Device | 読書中にFilesで対象を変更／削除／移動→瞬き停止、文書解放、理由表示。旧readerコマンドで別文書を操作しない。 |
| TC-F09 | Local + Device | 日本語・数字を含む名前で検索／6種類のsort→正しい安定順。0件検索とライブラリ失敗は別表示。 |
| TC-F10 | Local + Device | 削除取消／確定、rename、同名、空名、拡張子、パス入力、case-only変更、確認中の外部更新→非破壊・正しいエラー。 |
| TC-F11 | Device | 初期はplaceholder→ライブラリに表示された各項目のpage0 thumbnailを手動操作なしで順次表示。更新／rename／削除で無効化。cache削除後もPDFは残る。大量ライブラリで同時生成数とcache上限が守られる。 |

### PDF閲覧

| ID | 環境 | 操作と期待結果 |
|---|---|---|
| TC-R01 | Device | 正常PDFを開く→PDFKitでpage0を表示。読込中に別PDFへ切替→古いopen完了で上書きしない。 |
| TC-R02 | Local + Device | 前／次／ページ数表示をタップして開く番号ダイアログ、先頭、最後、1ページPDF→境界を超えず番号変換が正しい。同一command再送は1回だけ。 |
| TC-R03 | Device | 縦方向にスクロールして複数ページを通過→現在ページ番号が追随し、倍率・位置がfitでリセットされない。ピンチ拡大中に瞬き／前次／番号ダイアログで明示移動→対象ページへ進みfit。混在サイズ、90度回転メタデータでも切れない。可視の隣接ページを含め外部PDFリンクが起動しない。 |
| TC-R04 | Device | portrait / landscape、iPad sidebar開閉／幅変更→現在ページを維持してfit。文書の再読込・先頭戻りなし。 |
| TC-R05 | Device | パスワード必須、空パスワード暗号化、破損、0ページ、消失→各仕様の表示。ロックは固定文言、パスワード入力なし、カメラ停止。 |
| TC-R06 | Device | 数ページ読みmode変更→readerを閉じて再openするとpage0。プロセス再起動で設定初期化、PDF自体は残る。background往復だけなら現在ページ維持。 |

### 瞬き

| ID | 環境 | 操作と期待結果 |
|---|---|---|
| TC-B01 | Local + Device | 左右それぞれの係数取得、単位・範囲・本人基準の左右を確認。平均値による両眼判定をしていない。 |
| TC-B02 | Local + Device | 正常な両眼瞬き→各modeで指定タイミングに1ページ。実機の各mode30回を記録する。 |
| TC-B03 | Local + Device | 左右の片目閉眼を各20回、左右平均が高くなる片目入力→ページ送り0件。前ページにも動かない。 |
| TC-B04 | Local + Device | onCloseで閉眼後ずっと閉じる→開始時の1回のみ。開眼時に追加なし。 |
| TC-B05 | Local + Device | onReopenで閉眼、片目だけ開く、両目を開く→両眼開眼で1回。1500ms超の閉眼では0回。 |
| TC-B06 | Local + Device | 閉眼途中・rearm中・設定画面でmode変更→変更自体でページ移動なし。新しい開眼から判定。 |
| TC-B07 | Device | PDF openで自動開始。libraryへ戻る／background／inactive→カメラ停止。復帰後はopenを確認して自動再開。 |
| TC-B08 | Device | カメラ拒否・制限・AR unsupportedの制御経路→理由を表示し手動閲覧可能。毎回許可ダイアログをループさせない。 |
| TC-B09 | Local + Device | 顔ロスト・顔変更・session中断・復帰→閉眼候補破棄。新しい顔や復帰直後の閉眼を送らない。 |
| TC-B10 | Local | startup closed、NaN/null、threshold一致、左右差120ms境界、gap150ms境界→DES-BLINK-FSMどおり。 |
| TC-B11 | Local + Device | 閉じたままの係数揺れ、cooldown中の次閉眼、重複seq→重複イベントなし。500ms以上のopenを挟む2回は2回。 |
| TC-B12 | Local + Device | JSを止める／通信を一時止める／overflow／古いbatch→溜まった瞬きを復帰後に送らない。native watchdogと再アームも確認。 |
| TC-B13 | Local + Device | navigate中、最後のページ、modal中、PDF切替中、古いreader / epoch / command→抑止され、後から再実行されない。 |

### UI・デバッグ

| ID | 環境 | 操作と期待結果 |
|---|---|---|
| TC-U01 | Device | iPhone縦横、iPad wideでlibrary→グリッド列数とnavigationが適切。1000件を全件mountしない。 |
| TC-U02 | Device | iPad reader sidebar開閉、狭いwindow、回転→1ペイン切替とPDF状態保持。カメラ制約は手動閲覧へfallbackし理由を表示。 |
| TC-U03 | Device | mode / debug切替、設定を開いたまま瞬き、再起動→設定中は送らず、再起動で初期値。動かない将来設定なし。 |
| TC-U04 | Device | 顔debugの初回表示・回転・顔ロスト・background復帰→灰色の顔、白い目・口、白canvas。生カメラ映像が一瞬も出ないことを目視確認。 |
| TC-U05 | Device | debug ON/OFFを繰り返す→ARSessionは1つ、通常時に描画停止、係数取得は読書中継続。Releaseでもdebug可。 |
| TC-U06 | Device | ライト／ダーク、長いファイル名、文字拡大、VoiceOverラベル、キーボード、iPad popover→操作不能領域なし。音・振動なし、PDF色反転なし。 |

### 非機能・性能

| ID | 環境 | 操作と期待結果 |
|---|---|---|
| TC-N01 | Local + Device | アプリにDB／backend依存なし。ReleaseでMetro・ネットワークなしに保存済みPDFを読める。provider未取得ファイルとは区別。 |
| TC-N02 | Local + Device | source / 設定 / ログ / 出力先を点検→顔画像・係数時系列・PDF本文の保存送信なし。debug情報は最新メモリ値だけ。 |
| TC-N03 | Local + Device | `../`、絶対パス、encoded separator、symlink、古いID、同名差替え→library外を読取／削除しない。対象以外のファイル不変。 |
| TC-N04 | Local + Device | nativeの各失敗をadapterへ返す→型付きコードと日本語表示が対応し、空配列／成功へ化けない。 |
| TC-P01 | Device | 3GB以上および3GiB級有効PDFを取り込む→bytes / progressが2GiBで負値や0へ戻らず、元ファイル不変、全文JS転送なし。 |
| TC-P02 | Device | 1万ページの先頭・中間・最後へ移動、ズーム、連続送り→page countと順序が正しい。全ページ事前描画なし。 |
| TC-P03 | Device | 1000件ローカルPDFでcold scan / warm scan / 検索 / sort→初期3秒・更新200ms目標と実測を比較。全thumbnailを待たない。 |
| TC-P04 | Device | 実画像の書籍／漫画PDFを含む大容量open→初回時間・描画・メモリ・操作応答を記録。パディングPDFだけで代用しない。 |
| TC-P05 | Local + Device | source監査と負荷試験→base64全文、巨大Data、無制限queue / cache、全件PDF openなし。サムネイル・scan・copyの同時数を確認。 |
| TC-P06 | Device | 30分・500ページ操作、回転、debug、復帰、メモリ／thermal対応→異常終了なし。実際に起きていないOS警告は注入試験と実測を区別。 |

### 開発・配布

| ID | 環境 | 操作と期待結果 |
|---|---|---|
| TC-D01 | Device | 同じdevelopment IPA上でTSのUI・FSM定数を変更→両実機へrefresh / reloadで反映。native再buildなし、signature不変。 |
| TC-D02 | CI | device SDK・Debug/Release分岐・署名無効・app生成・IPA構造・UIDeviceFamily・最低OSを検査。Simulatorではない。 |
| TC-D03 | CI + Device | development Assetから再署名・インストール→native debugger / Macなしで起動、Windows Metro接続、全local moduleがある。 |
| TC-D04 | CI + Device | production AssetでMetro停止・オフライン起動→同梱JSで読書、瞬き、顔debugが動く。 |
| TC-D05 | Local + CI | main通常push / TS-only変更でnative job未起動。production tag / 明示dispatchのみ起動。development tag push単独では未起動。 |
| TC-D06 | Local + CI | workflow / scriptsをレビュー→EAS、Apple certificate/profile/secret、upload-artifactなし。Release uploadは標準token、権限は必要jobだけ。 |
| TC-D07 | Local + CI | dispatchの不正tag・profile不一致・tag未存在・branch/tag取り違え→事前に失敗。新tagを自動生成しない。source SHAを記録。 |
| TC-D08 | CI | 同じtagのrerunで既存Release/Assetを安全に扱う。mutableはclobber、immutableは同一ならno-op／差異は明示停止。失敗時に別commitを上書きしない。 |
| TC-D09 | Device | development↔productionを同じ再署名identityで更新→バックアップ後にlibrary保持を確認。古いnative APIには明示的mismatch。アンインストールを既定更新にしない。 |

## PLAN-TRACE — 要件・設計・Phase対応

| 要件 | 主な設計ID | 主Phase | 主テスト |
|---|---|---|---|
| ENV-001〜ENV-006 | DES-PROJECT、DES-STORAGE、DES-CI | 1・2 | TC-D02、TC-D03 |
| ENV-007、FR-012 | DES-FACE、DES-BLINK-FSM | 2・4 | TC-B01〜TC-B03 |
| FR-001 | DES-STORAGE | 2 | TC-F01 |
| FR-002〜FR-003 | DES-IMPORT | 2・3 | TC-F02〜TC-F04 |
| FR-004〜FR-005 | DES-INDEX、DES-COORDINATION | 2・3 | TC-F05〜TC-F08 |
| FR-006 | DES-FILE-MUTATION、DES-LIBRARY-UI | 2・3 | TC-F09〜TC-F10 |
| FR-007 | DES-THUMBNAIL | 2・3 | TC-F11 |
| FR-008〜FR-010 | DES-PDF、DES-NAVIGATION、DES-ERRORS | 2・4 | TC-R01〜TC-R05 |
| FR-011 | DES-STATE | 3・4 | TC-R06 |
| FR-013〜FR-015 | DES-BLINK-FSM、DES-LIFECYCLE | 4 | TC-B04〜TC-B13 |
| FR-016〜FR-017、FR-019 | DES-ADAPTIVE-UI、DES-SETTINGS | 3・4 | TC-U01〜TC-U03、TC-U06 |
| FR-018 | DES-FACE-DEBUG | 2・4 | TC-U04〜TC-U05 |
| NFR-001〜NFR-002 | DES-ARCH、DES-STATE | 全Phase | TC-N01〜TC-N02 |
| NFR-003〜NFR-004 | DES-PERFORMANCE、DES-THUMBNAIL | 2・5 | TC-P01〜TC-P05 |
| NFR-005 | DES-IMPORT、DES-FILE-MUTATION | 2・3 | TC-F03〜TC-F04 |
| NFR-006 | DES-LIFECYCLE | 2・4 | TC-B07〜TC-B13、TC-U05 |
| NFR-007 | DES-STORAGE、DES-FILE-MUTATION | 2・5 | TC-N03 |
| NFR-008 | DES-PERFORMANCE | 2・5 | TC-P06 |
| NFR-009 | DES-ERRORS | 全Phase | TC-N04 |
| NFR-010、DEV-001〜DEV-002 | DES-DEVELOPMENT | 1〜5 | TC-D01、TC-D03〜TC-D04 |
| DEV-003〜DEV-004 | DES-CI | 1・2・5 | TC-D02、TC-D05〜TC-D08 |
| DEV-005 | DES-META、DES-CI、PLAN-RULES | 全Phase | 作業記録・権限レビュー |
| DEV-006〜DEV-007 | DES-PROJECT、DES-DEVELOPMENT、DES-CI | 1・2・5 | TC-D02〜TC-D04、TC-D09 |

## PLAN-EVIDENCE — 検証記録の形式

実装時に次の形式で台帳を作る。以下は記入テンプレートであって実施結果ではない。

```yaml
test_id: TC-B02
status: NOT_STARTED
app_version: null
build_profile: null
native_api_version: null
native_runtime_signature: null
source_commit: null  # ユーザーまたはCIから得た実値のみ
workflow_run: null
hardware: null
os_version: null
orientation: null
debug_visible: null
fixture_id: null
preconditions: []
actions: []
expected: null
observed: null
metrics:
  attempts: null
  detected_events: null
  applied_page_changes: null
  extra_page_changes: null
  elapsed_ms: null
  peak_native_memory_bytes: null
evidence: []
notes: []
```

動画・顔フレームを証拠として要求しない。UIのスクリーンショットを共有する場合も、PDF本文の権利や個人情報に注意する。ログに名前や絶対パスを不要に含めない。source commitはCodexがGitを実行して取得せず、CI metadata等の実値を使う。

## PLAN-TROUBLESHOOT — 切り分け順序

| 症状 | 最初に確認すること | 誤った対処として禁止すること |
|---|---|---|
| IPAがインストールできない | device binary、Payload構造、最低OS、再署名ログ、SideStore版・公式OS対応案内 | Apple証明書をCIへ入れる、Simulator IPAで代用する |
| 起動後に開発画面が接続できない | Metro起動、実機から到達できるPCのIP、LAN権限、Firewall、scheme、dev profile | native API不具合と決めつけて毎回ビルドする |
| native module not found | IPA内module、API版、native signature、autolinkingログ | 実機で黙ってmockへfallbackする |
| iPadで顔が取れない | isSupported、カメラ許可、frame / anchor / coefficients、全画面・前面カメラ方向、session中断 | TrueDepthがないから当然非対応と断定する |
| 戻った直後にページが飛ぶ | epoch / generation、buffer reset、WAIT_OPEN、native TTL | cooldownだけを極端に長くして問題を隠す |
| 同じ瞬きで2ページ進む | 重複購読、FSM consumed、commandId、Promiseと通知の二重適用 | 長い瞬きへ要件を変更する |
| Filesに見えるがアプリに出ない | libraryの位置、拡張子、通常ファイル判定、foreground / 手動scan、index warning | Documents全体を無条件に読み込む |
| 3GBでコピー失敗 | 空き容量、Int64、provider、scope寿命、chunk I/O、commit | Base64化、巨大Data化、無断でサイズ上限を100MBに下げる |
| 大きいPDFだけ描画が遅い | 文書構造、page images、PDFKit memory、thumbnail競合、Debug/Release差 | 全ページを事前画像化する |
| ReleaseでJS変更が出ない | 実際のIPAに同梱されたJS版とbuild metadata | Windowsの編集が既存Releaseへ自動配信されると説明する |
| 同じReleaseへの再upload失敗 | 権限、tag、Asset名、immutable Release設定 | immutable設定を勝手に無効化する |

## PLAN-HANDOVER — Codexの最終報告

報告は次の情報を含める。成功した項目だけを並べず、未検証・失敗・追加native buildの理由を明示する。

```text
実装した要件ID
変更ファイル
実際のExpo / React Native / Node / package manager版
CNG / config plugin / local modulesの構成
実際のworkspace / scheme / application target
最低OS / Bundle Identifier / iPhone・iPad device family
Debug / Releaseの生成方法・発火条件
Release Asset名・checksum・native runtime signature
再実行時のAssetの扱い・cache内容
WindowsのMetro起動手順
JS-onlyで再ビルド不要な範囲と、必要になる変更
対象実機ごとのテスト結果と性能
未検証項目・既知の制約・次に必要なユーザー操作
CodexがGit / GitHub操作を実行していないことの作業範囲記録
```

## 公式参照資料

U-ATTACHはユーザーの配布要件の根拠として原本を参照する。以下はその要件に技術的な確認を加えるための公式資料。確認日：2026-09-09。

[S-SDK]: https://docs.expo.dev/versions/latest/
[S-RUNNER]: https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md
[S-MODULES]: https://docs.expo.dev/modules/get-started/
[S-DEV]: https://docs.expo.dev/develop/development-builds/use-development-builds/
[S-AR]: https://developer.apple.com/documentation/arkit/arfacetrackingconfiguration/
[S-SIDE]: https://docs.sidestore.io/docs/troubleshooting/error-codes

| 参照 | 確認範囲 |
|---|---|
| [S-SDK] | 採用Expo SDKとReact Native / Node / iOS / Xcodeの対応。 |
| [S-RUNNER] | hosted macOS runnerに存在するtoolchain。 |
| [S-MODULES] | ローカルExpo Moduleと組み込み経路。 |
| [S-DEV] | development buildの再利用とnative依存変更時の再ビルド。 |
| [S-AR] | Face Trackingの対応範囲と実行時判定。 |
| [S-SIDE] | SideStoreのOS依存エラー切り分け。Flinkを実機検証した証拠ではない。 |
