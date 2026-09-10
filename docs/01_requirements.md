---
document_id: FLINK-REQ
version: 1.0.0
updated_at: 2026-09-09
language: ja
audience: Codex
status: specification_ready_implementation_unverified
read_order: 1
related_documents:
  - 02_design.md
  - 03_implementation_plan.md
---

# Flink 要件定義書

## REQ-META — 文書の読み方・権限・根拠

本書は「何を実現するか」の正本である。`02_design.md` は実現方式、`03_implementation_plan.md` は最大5 Phaseの実装・検証手順を定める。Codexは3文書をこの順で読み、要件ID・設計ID・テストIDを維持すること。

- `MUST`：必須。未達のまま完了扱いにしない。
- `MUST NOT`：禁止。
- `SHOULD`：原則採用。変更時は理由・影響・代替検証を記録する。
- `MAY`：任意。MVPの完了条件には含めない。
- `設計判断`：ユーザーが直接指定していない点を、本仕様で実装可能な形に補完した決定。ユーザーの発言やAppleの保証と混同しない。
- `実機未検証`：仕様・実装案は存在するが、実機で成立したと確認していない状態。

### 入力資料と優先順位

| 根拠ID | 内容 | 用途 |
|---|---|---|
| U-INITIAL | ユーザーの初回依頼 | Expo、DBなし、ARKit Face Tracking、ARSCNView / SceneKit、PDF、サイドロード、文書3点、最大5 Phase |
| U-ANSWERS | ユーザーのQ1〜Q22への回答 | Flink、対象実機、瞬き、保存場所、ライブラリ、画面、保存しない状態、MVPの範囲 |
| U-ADDITIONAL | 回答末尾の追加指示 | Windows開発、GitHub Actionsのみのビルド、development build再利用、iPad向けUI |
| U-ATTACH | `Codex向け GitHub Actions実装プロンプト(1).md`（原題：Codex向け GitHub Actions実装プロンプト.md） | unsigned IPA、GitHub Releases、署名・Artifact・EASの禁止、tag / 手動実行、CI検証 |
| S-* | 各文書末尾の公式技術資料。確認日：2026-09-09 | API・開発環境の根拠。ユーザー要件そのものではない |

優先順位は、最新のユーザー指示 > 本書の確定要件 > 設計書 > 実装手順書。U-ATTACHは配布要件の原本として併読する。ただし次の2点は最新指示で明示的に補正する。

1. U-ATTACHのReleaseビルドに加え、**開発用Debug development build**を追加する。配布用は従来どおりReleaseとし、Debugに置き換えない。
2. U-ATTACHにあるGit / GitHub調査・操作をCodex自身に実行させない。Codexはローカルファイルの調査・編集・テストのみを行い、Git操作はユーザー、Release操作はユーザーが起動したCIの担当とする。

本書は設計成果物であり、アプリの実装、GitHub Actionsの実行、SideStoreでのインストール、対象実機での精度・性能を実施済みと主張しない。実際の`package.json`等は本資料作成時に提供されていないため、現在のExpo SDKを推測して固定しない。

## REQ-GOAL — 目的

Flinkは、iPhone / iPad上のローカルPDFを、通常の両目の瞬き1回で次の1ページに進められる読書アプリである。書籍・漫画を主用途とし、手動操作も残す。アプリのサービス用バックエンド、DB、ユーザーアカウント、サーバーへのPDFアップロードは設けない。Swift製ネイティブ機能も「端末内のフロントエンド処理」に含む。

**自然な瞬きと、ページを進めたい意思は区別しない。** 有効な読書状態で条件に一致した両目の瞬きは、意図しない自然な瞬きであってもページ送りになる。MVPでは長い瞬きや2回連続の瞬きへの置き換え、視線・意思の推定を行わない。

## REQ-ENV — 実行環境

| ID | 必須条件 | 根拠 |
|---|---|---|
| ENV-001 | アプリ表示名は`Flink`。iPhoneとiPadに対応する1つのiOSアプリとする。 | Q1・Q2 |
| ENV-002 | 主検証機はiPhone 13 / iOS 26.5、およびiPad (A16) / iPadOS 18.6.2。OS番号はユーザー申告値として保持する。 | Q2 |
| ENV-003 | Windowsで開発。ローカルMac / Xcode、iOS Simulator、Expo Goを実機検証の必須経路にしない。ネイティブビルドはGitHub-hosted macOS runnerのみ。 | Q3・追加指示 |
| ENV-004 | 既存ディレクトリの`create-expo-app`生成物を土台とする。再初期化や、確認なしのExpo SDK / React Native一括更新をしない。 | Q4 |
| ENV-005 | Expo / React Native + TypeScriptを基盤とする。ARKit / PDFKit / ファイルアクセスはSwift製ローカルExpo Moduleで接続する。 | 初回依頼・設計判断 |
| ENV-006 | 最低対応OSはiOS / iPadOS **18.0**を設計上の既定とする。実際の依存関係が18.6.2以下をサポートすることを確認する。iPadを切り捨てるdeployment target変更は禁止。 | Q2・設計判断 |
| ENV-007 | `ARFaceTrackingConfiguration.isSupported`を実機で確認する。TrueDepthの有無だけで非対応判定しない。対象機でfalseなら手動閲覧は維持するが、瞬き機能の対象機合格にはしない。 | Q2・S-AR |

AppleはiOS / iPadOS 14以降のFace TrackingについてApple Neural Engine搭載機を対応範囲として説明している。iPad (A16)はNeural Engine搭載機であるため、仕様上の対応候補であり、TrueDepth非搭載を理由に除外しない。ただし、この記述だけで対象実機・指定OS・署名済みアプリの組み合わせを検証済みとはしない。[S-AR][S-IPAD]

## REQ-DECISIONS — 未指定点に対して採用する設計判断

以下は質問への回答を置き換えるものではなく、残る曖昧さを解消するための既定仕様である。Codexは別の既定値を黙って採用しない。

| ID | 採用する決定 |
|---|---|
| DEC-001 | Bundle Identifierの初期値は`com.local.flink`。App Store上の登録・名称所有権を意味しない。ユーザーが初回ビルド前に変更可能。以後はデータ領域維持のため安易に変更しない。 |
| DEC-002 | `Documents/library/`以下を再帰的に探索する。`Documents/`直下や`library`以外の兄弟フォルダは対象外。サブフォルダは一覧上で相対パスを添え、アプリ取り込み先は`library/`直下に固定する。 |
| DEC-003 | 瞬きトリガーの初期値は`onReopen`（両目を開き直した時）。設定で`onClose`へ切り替え可能。設定はプロセス内のみ保持し、再起動で初期値に戻す。 |
| DEC-004 | PDFを閉じて開き直すと先頭ページ。プロセスが生存したままのバックグラウンド往復・回転では、現在表示中のページを維持してよい。履歴保存とは扱わない。 |
| DEC-005 | ファイル選択は複数選択に対応し、コピーは1ファイルずつ実行する。途中キャンセルでも、既に正常完了したPDFは残す。 |
| DEC-006 | 並び順はファイル名昇順を初期値とし、ファイル名・更新日時・サイズの各昇順／降順に対応。追加日時・最終閲覧日時は保存しない。 |
| DEC-007 | 非表示時のデバッグ描画は停止。表示時の顔キャンバスはダークモードでも白を保ち、顔は濃いグレー、目と口は白とする。 |
| DEC-008 | 最大容量の目標は3,000,000,000 bytes。境界試験には3 GiB（3,221,225,472 bytes）の有効なPDFも含める。1000件すべてを3GBにする同時容量要件ではない。 |
| DEC-009 | パスワード入力が必要な`isLocked == true`のPDFは未対応。空パスワード等で自動的に開ける暗号化PDFは、追加の解除処理なしで閲覧可能とする。 |
| DEC-010 | 1万ページの利用に備え、ページ番号指定による移動を基本閲覧操作に含める。本文検索、しおり、目次機能は追加しない。 |
| DEC-011 | 読書画面がactiveな間は自動スリープを抑止し、離脱・inactive・backgroundで解除する。専用の設定や永続化は追加しない。 |
| DEC-012 | `library`と同名の通常ファイルが置かれた場合は自動削除せず初期化エラー。フォルダがなくなった場合は安全に再作成する。 |
| DEC-013 | iPadの全画面読書を瞬き機能の主受入条件にする。小さいウインドウでもUIと手動閲覧を維持する。Split View等でカメラが利用できない場合は理由を表示し、全画面への復帰を案内する。 |

`isEncrypted`と`isLocked`は同義ではない。PDFKitは空パスワードの暗号化文書を自動で開くことがあるため、「暗号化されている」だけでパスワード要求エラーには分類しない。[S-LOCK]

## REQ-FILES — 保存領域・取り込み・ライブラリ

### FR-001 — 公開フォルダの初期化

MUST：初回起動で`Documents/library/`を作成する。OS上の公開先は次のとおり。

```text
iPhone: ファイル > このiPhone内 > Flink > library
iPad:   ファイル > このiPad内 > Flink > library
```

`Flink`はアプリのDocumentsコンテナの表示名であり、**`Documents/Flink/library`という余分な階層を作らない**。インストール済み・未起動時点での表示は保証対象外。`UIFileSharingEnabled`と`LSSupportsOpeningDocumentsInPlace`を設定する。OS側の一覧更新タイミングとアプリ内初期化を区別する。[S-FILES]

根拠：Q10〜Q12。設計：DES-STORAGE。テスト：TC-F01。

### FR-002 — アプリからの取り込み

MUST：追加ボタンからシステムのファイル選択画面を開き、PDFをアプリの`Documents/library/`直下へコピーする。元ファイルを変更・移動・削除しない。サーバーへ送信しない。コピー完了後の閲覧対象はアプリ側のファイルとする。

MUST：コピー中の状態、キャンセル、ファイル単位の成功・失敗を表示する。クラウド上の未ダウンロードPDFはFile Providerを介した取得を待つ。オフラインやアクセス拒否をローカルPDFの破損と混同しない。

MUST NOT：PDFの全バイトをJS、Base64、`ArrayBuffer`、巨大な`Data(contentsOf:)`に読み込んでコピーしない。

根拠：Q10・Q16。設計：DES-IMPORT。テスト：TC-F02、TC-F03、TC-P01。

### FR-003 — ファイル名衝突

MUST：既存ファイルを上書きせず、`資料.pdf`、`資料 (2).pdf`、`資料 (3).pdf`の順で利用可能な名前を割り当てる。競合発生時も既存ファイルを失わない。内容ハッシュによる重複削除・統合を行わない。

同じ元PDFを複数回取り込んだ結果、別々の保存ファイルができることは許容する。それぞれを1件ずつ表示する。同じ1つの保存ファイルを「取り込み履歴」と「フォルダ走査結果」で二重登録してはならない。

根拠：Q14。設計：DES-IMPORT、DES-INDEX。テスト：TC-F04。

### FR-004 — ライブラリの正本

MUST：現在`Documents/library/`以下に存在するPDFファイルの一覧をライブラリとする。別の「過去アップロード履歴テーブル」は設けない。アプリからコピーしたPDFとFilesアプリから配置したPDFを同じ規則で扱う。

MUST：PDF以外のファイル、ディレクトリそのもの、シンボリックリンク、一時コピー用ファイルは読み込み対象外とし、勝手に削除しない。拡張子`.pdf`の大文字／小文字を区別しない。PDFを名乗る破損ファイルは、検証時にエラー／プレースホルダーへ分類する。

MUST：ファイル名、更新日時、サイズ、サブフォルダの相対位置を表示可能にする。全1000件のPDFを開いてから一覧を表示する実装は禁止。

根拠：Q12〜Q16。設計：DES-INDEX。テスト：TC-F05、TC-F06、TC-P03。

### FR-005 — 外部変更への追随

MUST：初回表示、foreground復帰、ライブラリ再表示、手動更新、アプリ内の取り込み・削除・名前変更後に再走査する。ファイル変更通知でも差分更新／再走査する。

MUST：Filesアプリ等で削除、`library`外へ移動されたファイルは次の正常な更新で一覧から除外する。`library`内の移動・名前変更は現在の位置を反映する。通知だけに依存して整合性を失わない。

MUST：閲覧中ファイルの変更・削除を検知した場合は瞬き操作を止め、安全に文書を閉じて理由を表示する。不在ファイルへの古い操作を実行しない。

根拠：Q13。設計：DES-INDEX、DES-COORDINATION。テスト：TC-F07、TC-F08。

### FR-006 — ライブラリ操作

MUST：ファイル名の部分一致検索、DEC-006の並び替え、先頭1ページのサムネイル、確認付き削除、名前変更を提供する。

削除は実ファイルの削除であり、単なる一覧非表示ではない。確認文に明記する。名前変更ではPDF拡張子を維持し、パス区切り、空名、同名衝突などを検証する。名前変更時の衝突は自動上書きせず、別名の入力を求める。お気に入りとアプリ内のフォルダ作成・移動は対象外。

根拠：Q15。設計：DES-LIBRARY-UI、DES-FILE-MUTATION。テスト：TC-F09、TC-F10。

### FR-007 — サムネイル

MUST：ページ0（UI上の1ページ目）を使う。ライブラリ表示時は、表示対象の各項目についてサムネイル生成を自動で開始し、サムネイルボタンを押させない。生成中はプレースホルダーを表示し、完了した項目から差し替える。ファイル変更時は無効化する。破損・ロック・生成失敗時はプレースホルダーと状態を表示し、ライブラリ全体を失敗させない。

MAY：再生成可能なサムネイルのみ、非公開の`Library/Caches/`に保存する。これは読書履歴・設定の保存ではない。キャッシュ削除後もPDF自体は残り、必要時に再生成できること。

根拠：Q15・Q16、設計判断。設計：DES-THUMBNAIL。テスト：TC-F11。

## REQ-READER — PDF閲覧

### FR-008 — 表示エンジン

MUST：Apple PDFKitの`PDFView`をSwift製Expo Viewで包む。ローカルファイルURLから`PDFDocument`を開く。WebView / pdf.js、全ページ画像化、外部ビューアへの委譲を主表示経路にしない。[S-PDF]

根拠：PDF表示方法は設計者に委任。設計：DES-PDF。テスト：TC-R01。

### FR-009 — 表示・操作

MUST：縦方向の連続スクロール、縦横回転、ピンチ拡大、手動の前／次ページ、現在ページ数表示、ページ数表示をタップして開くダイアログによるページ番号指定に対応する。PDF内部のページ順を採用し、左開き固定とする。初期表示はページ全体が収まる倍率。

MUST：瞬き、前／次、ページ番号ダイアログでの明示的な移動では、拡大率に関係なく移動先をページ全体表示に戻す。縦方向の受動的なスクロールで現在ページが変わる際は、fit処理によってユーザーの倍率やスクロール位置をリセットしない。最後のページで次へを実行しても折り返さず、先頭で前へを実行しても範囲外へ進まない。

MUST NOT：横方向の連続表示、見開き、右開きは実装しない。

根拠：Q17・Q18、DEC-010。設計：DES-PDF、DES-NAVIGATION。テスト：TC-R02、TC-R03、TC-R04。

### FR-010 — PDF異常時

MUST：`isLocked == true`の場合は「パスワード付きPDFは未対応」と表示し、パスワード入力画面を出さない。ファイルは自動削除しない。破損、0ページ、読取不能、ファイル消失は別の原因として表示する。

MUST：エラー画面からライブラリに戻れる。PDFが開けない状態でカメラを継続使用しない。

根拠：Q19。設計：DES-ERRORS、DES-PDF。テスト：TC-R05。

### FR-011 — 保存しないユーザー状態

MUST NOT：現在ページ、閲覧履歴、最終閲覧日時、瞬き設定、並び替え、検索語、デバッグON/OFFを、DB、JSON、AsyncStorage、UserDefaults等へ永続化しない。

MUST：再起動時は初期設定・ライブラリ画面、PDFを新たに開くと先頭ページとする。アプリにコピー済みのPDFファイルは消さない。OSが管理するカメラ権限やdevelopment client自身の接続履歴はFlinkの読書履歴とは別物とする。

根拠：Q20。設計：DES-STATE。テスト：TC-R06。

## REQ-BLINK — 瞬き検出

### FR-012 — 検出入力

MUST：`ARFaceTrackingConfiguration`と`ARFaceAnchor.blendShapes[.eyeBlinkLeft] / [.eyeBlinkRight]`を使用する。値は目の閉じ具合を示す係数として扱い、左右両方が条件を満たすことを要求する。[S-AR][S-EYE]

MUST NOT：初回キャリブレーション画面、独自学習モデル、Vision / MediaPipe等への無断変更を行わない。片目ウインクはMVPでは操作しない。ARKit係数だけで実際の瞬きを100%認識できるとは主張しない。

根拠：Q5・Q7。設計：DES-FACE、DES-BLINK-FSM。テスト：TC-B01、TC-B02、TC-B03。

### FR-013 — トリガーの切り替え

MUST：設定で次の2種類を選択可能にする。

```text
onClose:  両目の閉眼条件が成立した時点で1ページ進む
onReopen: 両目の閉眼を確認後、両目の開眼条件が成立した時点で1ページ進む
```

同じ閉眼サイクルで2回以上送ってはならない。閉じ続けている間は連続で送らない。モード変更では進行中の候補を捨て、次の新しい開眼状態から判定し直す。

`onClose`は、将来目を開くかどうかが分からない時点で動作する。したがって長い閉眼の開始でも1回進むことがある。後から長い閉眼と判明してもページを戻さない。`onReopen`の長時間閉眼除外とはこの点が異なる。

根拠：Q6。設計：DES-BLINK-FSM。テスト：TC-B04、TC-B05、TC-B06。

### FR-014 — 自動開始と安全停止

MUST：PDFが正常に開き、画面がactiveで、カメラ権限がある場合は自動開始する。MVPの通常フローに「瞬き操作を開始」ボタンを設けない。権限未決定の場合は必要性を示してシステム許可を求め、許可後に自動開始する。

MUST：離脱、inactive / background、権限拒否、セッション中断、顔ロスト、PDFエラー、モーダル操作、ファイル変更、読書対象切替では、ページ送りを停止し古い候補を破棄する。カメラが不要な状態ではARSessionも停止する。復帰時は目を開いた安定状態を確認して自動再開する。

顔ロスト時は再検出のためARSessionを継続してよいが、ページ送りは停止する。瞬き判定不可でも手動ページ送りは残す。

根拠：Q8、設計判断。設計：DES-LIFECYCLE。テスト：TC-B07、TC-B08、TC-B09。

### FR-015 — 誤動作抑制

MUST：左右を平均せず個別に判定する。開閉で異なる閾値、左右閉眼タイミングの許容差、再アーム、重複排除、サンプルの鮮度確認を実装する。閾値や時間はDES-BLINK-FSMの設計値とし、生理学的な保証値と扱わない。

MUST：開始時から目を閉じている状態、顔の取り替わり、欠損・NaN値、古いバッチ、JS停止中の瞬き、ページ切替中の候補から後追いのページ送りを起こさない。

MUST NOT：再接続後やJS復帰後に、ためていた瞬き分をまとめてページ送りしない。

根拠：Q5〜Q8、設計判断。設計：DES-BLINK-FSM、DES-NAVIGATION。テスト：TC-B10、TC-B11、TC-B12、TC-B13。

## REQ-UI — 画面とデバッグ

### FR-016 — iPhone / iPadのレイアウト

MUST：iPhoneは読書画面を優先したコンパクトUI。iPadは利用可能な幅に応じたライブラリの多列表示、および読書時の折り畳み可能なライブラリサイドバーを提供する。単にiPhone画面を拡大したUIにしない。

MUST：端末名だけでなく現在のウインドウ幅で再配置する。iPadの狭いウインドウでは1ペインへ戻る。回転・サイドバー切替でPDF文書の再読み込みや先頭への巻き戻しを起こさない。カメラの同時使用・マルチタスク制約はUI対応とは別に扱う。

根拠：Q2・Q17・追加指示。設計：DES-ADAPTIVE-UI。テスト：TC-U01、TC-U02。

### FR-017 — 設定画面

MUST：瞬きトリガーの選択、デバッグ表示切替、カメラ／顔データの取扱説明、アプリとネイティブランタイムの診断情報を表示する。「設定はアプリ終了で初期値に戻ります」と説明する。

MUST NOT：将来機能の動かないスイッチを並べない。設定画面の表示中にPDFへ瞬き操作を送らない。

根拠：Q6・Q9・Q20、設計判断。設計：DES-SETTINGS。テスト：TC-U03。

### FR-018 — 顔のデバッグ表示

MUST：ARSCNView / SceneKitを用い、白いキャンバスに濃いグレーの無地の顔、白い目・口を表示する。撮影した顔のテクスチャや背景カメラ映像を表示しない。瞬きに応じて顔の目の状態が変わる。

MUST：左右の係数、追跡状態、瞬き判定状態、ページ送りの受理／抑止回数を確認できる。Debugビルド限定ではなく、サイドロードするReleaseでも設定から表示可能にする。

MUST：通常読書ではデバッグ描画を止める。ARSCNView用に2つ目のARSessionや別カメラキャプチャを起動しない。SceneKitの非推奨化はリスクとして分離管理し、無断でRealityKitへ変更しない。[S-SCENE]

根拠：Q9・初回技術指定。設計：DES-FACE-DEBUG。テスト：TC-U04、TC-U05。

### FR-019 — 見た目・操作性

MUST：日本語、システム追随のライト／ダーク、簡素な読書UI。音・振動を出さない。PDFの原稿色は反転しない。顔キャンバスのみDEC-007の白固定を適用する。

SHOULD：操作領域を44pt以上とし、VoiceOver用ラベル、文字サイズ拡大、Safe Area、キーボード表示、iPadのポップオーバー表示を考慮する。これらの44pt・レイアウト寸法は本設計の目標値である。

根拠：Q22、設計判断。設計：DES-ADAPTIVE-UI。テスト：TC-U06。

## REQ-NFR — 非機能要件

| ID | 要件 | 検証・注意 |
|---|---|---|
| NFR-001 | アプリDB・サービス用バックエンドなし。通常のPDF閲覧はオフラインで動く。 | TC-N01。開発中のMetro接続、File Providerによる取得、SideStoreの署名運用は別経路。 |
| NFR-002 | カメラ画像、顔メッシュ、blendShape時系列を保存・送信しない。解析は端末内。 | TC-N02。ログに生の係数列やPDF本文を出さない。デバッグUIはメモリ上の最新情報のみ。 |
| NFR-003 | 3GB程度、1万ページ、1000ファイルを設計・試験対象に含める。 | TC-P01〜TC-P04。小容量PDFだけで合格扱いにしない。容量目標はあらゆるPDFの性能保証ではない。 |
| NFR-004 | PDF全体のJS転送、全ページ事前描画、全件同時オープン、無制限キャッシュを禁止する。 | TC-P05。大きなファイルでInt32オーバーフローを起こさない。 |
| NFR-005 | コピーの中断・空き容量不足・名前衝突で既存PDFを失わない。処理途中のPDFを完成品として公開しない。 | TC-F03、TC-F04。自アプリが所有する一時ファイルだけを掃除する。 |
| NFR-006 | UI / ARSession / 文書のライフサイクルを明示し、重複セッションや不要なカメラ継続を防ぐ。 | TC-B07〜TC-B13、TC-U05。Fast Refresh / JS reloadも対象。 |
| NFR-007 | ファイル操作をlibrary領域に限定し、パストラバーサル・シンボリックリンク・古いファイルIDを拒否する。 | TC-N03。取り込み元への読み取り権限は例外として短時間だけ取得。 |
| NFR-008 | 熱状態・メモリ警告時はサムネイル等の補助処理を停止する。深刻な状態では瞬き操作を止め、手動操作を残す。 | TC-P06。OSによるプロセス強制終了をアプリが完全に防げるとは保証しない。 |
| NFR-009 | エラーは型付きコードで扱い、利用者向け日本語と技術診断を分離する。 | DES-ERRORS、TC-N04。失敗を無条件に空配列や成功へ変換しない。 |
| NFR-010 | 閾値・UI・ソート等の変更をTypeScript側で実装し、ネイティブAPIの変更なしに反復検証できる構造にする。 | TC-D01。フレームを無制限にJSへpushする方式は採用しない。 |

### 性能目標の位置づけ

以下は**本設計が定める計測目標**であり、Apple / Expoの公称性能ではない。Phase 5で実測値と合否を記録する。未達時はプロファイリングと修正を行い、数値や対象機を黙って緩和しない。

| 指標 | 初期目標 | 条件 |
|---|---|---|
| 1000件のライブラリ初回メタデータ一覧 | 3秒以内 | ローカル配置済み、サムネイル完了を待たない。初回・温間を分ける。 |
| 検索・並び替えの反映 | 200ms以内 | 1000件のメモリ内メタデータ。 |
| 瞬きイベント判定後〜論理ページ変更 | p95で250ms以内 | CPU過負荷でない通常の読書。画像描画完了時間とは別計測。 |
| 代表的な通常PDFのページ表示 | p95で1秒以内を目標 | テスト文書・倍率・端末を記録。PDFView通知だけで描画完了と断定しない。 |
| 3GB / 1万ページの初回読込 | 固定秒数の保証なし | 初回表示時間、操作応答、ピークメモリ、異常終了を記録。キャンセル／離脱可能なUIを保つ。 |
| 単発の両目の瞬きの検出 | 各実機・各モードで30回中27回以上、1動作での余分なページ送り0件 | 正面に近い顔、十分な照明、各試行の間に500ms以上の開眼。検出数とnativeでの適用数を分ける。片目閉眼は左右各20回で操作0件。 |
| 長時間安定性 | 30分・500ページ操作で異常終了なし | 両実機、デバッグ表示ON/OFFを分ける。 |

## REQ-DEV — 開発・配布

### DEV-001 — development buildの再利用

MUST：`expo-dev-client`を含むunsigned **Debug** IPAをGitHub Actionsで作成し、GitHub Releasesから取得してSideStore等で再署名・インストールする。WindowsのMetroへ接続して開発する。Expo Goでは独自Swiftモジュールを検証できないため主経路にしない。[S-DEV]

TypeScript / JavaScript / 通常のMetro管理アセットだけの変更では、ネイティブアプリを再コンパイルせず、Fast RefreshまたはJS reloadで反映する。Swift、native依存、ネイティブ設定、Expo SDK等の変更時のみ開発ランタイムを再作成する。

### DEV-002 — 開発版と配布版の違い

MUST：開発版はMetro接続を前提とする。配布用Release版はJSと必要なアセットを同梱し、Metro / 開発PCなしでPDFを読めるものとする。

**Release版に同梱済みのJSは、Windows上のファイル編集だけでは更新されない。** 通常の開発反復には再ビルドしないが、更新内容を新しいオフライン配布版として確定する際は、明示的なRelease生成を行う。MVPではEAS Updateや独自OTA更新サービスは導入しない。[S-DEV]

### DEV-003 — unsigned IPA・保存先

MUST：`iphoneos` / generic iOS device向けのアプリを生成し、`Payload/Flink.app`を含むZIPを`.ipa`とする。iPhoneとiPadで共通の成果物を使う。CIでAppleコード署名を要求しない。

MUST NOT：EAS Build、App Store Connect、TestFlight、Apple証明書、Provisioning Profile、`.p12`、Apple Accountのパスワード、App Store Connect API KeyをCIに持ち込まない。

MUST NOT：`actions/upload-artifact`を使わず、IPAをGitHub Actions Artifactに保存しない。IPAの永続的な保存先はGitHub Releasesのみ。依存関係キャッシュは許可するが、そこをIPAの保存先にしない。

### DEV-004 — 実行契機・権限

MUST：配布版はユーザーによる`v*` tag push、または既存tagを指定する手動実行で生成する。開発版は専用の`dev-runtime-v*` tagを手動実行で指定する。mainへの通常pushやJS変更ごとにmacOSビルドを実行しない。

MUST：Releaseの作成・更新にGitHub標準`GITHUB_TOKEN`を使用し、最小権限を設定する。未存在tagをCIが勝手に作らない。同じtagの再実行では既存Assetの扱いを明示し、異なるソースを同じtag名で公開しない。

### DEV-005 — Codexの作業範囲

MUST NOT：Codexは`git` / `gh`コマンド、GitHub connector / API、commit、push、tag、Release作成、workflow起動、リポジトリ作成・設定変更を直接実行しない。

MUST：Codexはworkflow / shell script / config plugin / ソースコード / テストファイルを作成し、Windowsで可能なローカル検証を行う。CI内で実行されるcheckout / GitHub CLI処理は、この禁止とは区別する。操作担当者はユーザーである。

### DEV-006 — 再現性と診断

MUST：実際のExpo / React Native / package managerを調査し、lockfileを維持する。Node、Ruby / CocoaPods、macOSラベル、Xcodeを記録・固定する。CNGの生成物へ手作業でしか再現できない変更を残さない。

MUST：ネイティブAPIバージョンとビルド情報をJSから取得可能にし、古いdevelopment buildとの非互換を診断する。Scheme / workspace / `.app`の場所は生成物から確認する。

### DEV-007 — 検証のゲート

MUST：最初のdevelopment buildを両実機で検証し、デバッガ未接続での起動、Metro接続、PDFKit、フォルダ公開、ARKitの実データを確認する。両実機を別々の合否として扱う。

SHOULD：ネイティブ機能を最初のdevelopment buildにまとめ、通常のUI / 瞬きロジック反復では追加のmacOSビルドをしない。初回開発ランタイムと最終Releaseの2回を基本計画とするが、ネイティブ不具合修正等による追加ビルドが不要と保証しない。

DEV-001〜DEV-007の設計：DES-DEVELOPMENT、DES-CI。テスト：TC-D01〜TC-D09。

## REQ-SCOPE — 将来拡張とMVP除外

| 将来候補 | MVPで用意する境界 | MVPでしないこと |
|---|---|---|
| 片目ウインクで前ページ | `GestureIntent`とページコマンドを分離し、手動の前ページAPIを再利用可能にする。 | ウインク検出、左右割当、設定UI。 |
| 明示的な開始ボタン | 自動開始を`ReaderLifecycleController`の方針として分離する。 | 開始ボタンを必須にする／ダミースイッチを表示する。 |
| 見開き等の表示モード | PDF表示設定を独立した設定オブジェクトにする。 | 見開き・右開きの実装。 |
| 設定・読書位置の保存 | メモリ状態のモデルを分離する。 | 保存用JSON / DB / AsyncStorageの先回り実装。 |

そのほかMVP除外：PDF以外、PDF本文検索、しおり、目次、注釈・編集、共有／書き出し、クラウド同期、アカウント、課金、広告、解析SDK、カメラ録画、顔認証、バックグラウンド顔検出、複数ウインドウでの同時読書、Filesアプリからの「Flinkで開く」受信拡張。Filesに置いたPDFを**Flink内から開けること**と、外部アプリからのOpen In受信は別機能である。

## REQ-ACCEPTANCE — MVP全体の完了条件

次のすべてを満たした場合のみMVP完了とする。

1. FR-001〜FR-019、NFR-001〜NFR-010、DEV-001〜DEV-007、ENV-001〜ENV-007の必須条件を実装し、`03_implementation_plan.md`の対応テスト結果を記録している。
2. iPhone 13 / iOS 26.5とiPad (A16) / iPadOS 18.6.2の両方で、実際の両目の瞬きによりPDFが次のページへ移動する。片目のみ、閉じ続ける、復帰直後、古いサンプルで二重送りしない。
3. アプリ取り込みとFiles経由配置が同じ`Flink/library`一覧に反映され、非PDFを無視し、削除・名前変更・外部変更を正しく扱う。
4. 同一development build上で、WindowsからTSのみを変更して両実機へ反映できる。オフラインのRelease版も別途動作する。
5. 大容量・多ページ・多数ファイルの検証結果を記録し、未実施項目を合格へ置き換えていない。検証用のパディングPDFのみで実際の漫画PDFの性能を保証していない。
6. 生成IPAはunsigned / device向けで、GitHub Releasesにのみ保存される。Codex自身が禁止されたGit / GitHub操作を行っていない。

## REQ-RISKS — 残る実機確認事項

| ID | リスク・不確実性 | 必須対応 |
|---|---|---|
| RISK-001 | iPad (A16) + iPadOS 18.6.2の実セッション・顔係数取得は未検証。 | Phase 2で`isSupported`だけでなく、左右係数が実際に変化することを確認。 |
| RISK-002 | iOS 26.5におけるSideStoreのバージョン・署名経路の互換性は未検証。 | 初回に起動まで確認。SideStore公式手順を参照し、署名問題をARKit問題と混同しない。[S-SIDE] |
| RISK-003 | 通常の瞬きは自然な読書中にも発生する。 | 意図推定をしない仕様を明示。前ページの手動操作を残す。 |
| RISK-004 | `onClose`では長い閉眼の開始と短い瞬きを先に区別できない。 | 1回のみ送り、後から取り消さない。 |
| RISK-005 | PDFKitはすべての3GB PDFの時間・メモリを保証していない。 | URLベース読込と負荷制御を実装し、実文書で測定する。[S-PDF] |
| RISK-006 | ARSCNView / SceneKitは非推奨。 | 指定技術を維持し、デバッグ表示だけに隔離する。[S-SCENE] |
| RISK-007 | OS / 他アプリとのカメラ競合・マルチタスク制約。 | 中断を扱い、手動閲覧を残す。別AVCaptureSessionで無理に回避しない。 |
| RISK-008 | サイドロード更新やBundle Identifier / 再署名ID変更によるデータ領域の変化。 | アンインストールを通常更新手順にしない。外部バックアップと同じIDでの更新を実機確認する。 |

## 公式参照資料

[S-AR]: https://developer.apple.com/documentation/arkit/arfacetrackingconfiguration/
[S-IPAD]: https://support.apple.com/ja-jp/122240
[S-EYE]: https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation/eyeblinkleft
[S-FILES]: https://developer.apple.com/documentation/fileprovider
[S-PDF]: https://developer.apple.com/documentation/pdfkit/pdfview
[S-LOCK]: https://developer.apple.com/documentation/pdfkit/pdfdocument/islocked
[S-SCENE]: https://developer.apple.com/documentation/arkit/arscnview?changes=l_6
[S-DEV]: https://docs.expo.dev/develop/development-builds/use-development-builds/
[S-SIDE]: https://docs.sidestore.io/docs/troubleshooting/error-codes

| 参照ID | 根拠として使う範囲 |
|---|---|
| [S-AR] | Face Trackingの対応条件、`isSupported`、ARFaceAnchor。 |
| [S-IPAD] | iPad (A16)のチップ・Neural Engine・前面カメラ仕様。 |
| [S-EYE] | 左目の閉眼係数。右目の対応APIは設計書で併記。 |
| [S-FILES] | Documents領域公開に用いるInfo.plistキー。 |
| [S-PDF] | PDFView / PDFDocumentによる表示・操作API。大容量性能の保証資料ではない。 |
| [S-LOCK] | 暗号化とロック状態の区別。 |
| [S-SCENE] | ARSCNViewの動作・非推奨。 |
| [S-DEV] | 開発ランタイム再利用、ネイティブ依存変更時の再ビルド。 |
| [S-SIDE] | SideStoreのOS依存トラブルシューティング。Flinkの検証結果ではない。 |
