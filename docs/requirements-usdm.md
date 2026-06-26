# Live Preview Editor VS Code拡張機能 要求仕様書（USDM形式）

**文書番号**: LPE-REQ-001-USDM  
**バージョン**: 1.22.2
**作成日**: 2026-06-21  
**最終更新**: 2026-06-26
**ステータス**: 承認済み  
**関連文書**: [architecture.md](architecture.md) | [acceptance-tests.md](acceptance-tests.md) | [requirements.md](requirements.md)

> ▶️ **開発継続中（2026-06-26 時点 / v1.22.2）**: v1.11.0 の開発凍結は v1.12.0 で解除済み。v1.22.2 では、Live Preview からの編集適用成功後に即時保存し、ソースタブ終了後の編集結果をファイルへ確実に反映する（R-03-08）。改めて凍結する場合は本バナーを凍結表記に戻し、凍結理由（品質安定・スコープ確定）を踏まえて判断すること。

---

## 検証ステータス凡例

各仕様の先頭に付く3桁マーカーは、左から順に検証段階を表す。各桁は `■`（達成）/ `□`（未達成）で示す。

| 表記 | 状態 |
|------|------|
| `□□□` | 未着手 |
| `■□□` | レビュー済（実装未） |
| `■■□` | 実装済・テスト未 |
| `■■■` | テスト済 |

> 3桁目（`■■■`）への昇格は受け入れテスト実行時にのみ行う。

---

## 目的・スコープ

本文書は、Obsidian ライクな Markdown ライブプレビュー編集 VS Code 拡張機能（`vscode-livepreview-editor`）の要求仕様を USDM 形式で記述する。本拡張は CodeMirror 6 を Webview に埋め込み、記法を保持したまま装飾表示し、カーソル位置の行・要素では生の Markdown 記法を表示する。

## ライブ編集ポリシー

本拡張のライブ編集（カーソル行で生記法・他行で装飾表示）は **標準 Markdown 記法（CommonMark + GFM）** を対象とする。

| カテゴリ | 動作方針 |
|------|------|
| 標準 Markdown 記法（見出し・インライン記法・リスト・タスク・表・コードブロック・リンク・画像 等） | **ライブ編集**（カーソル行で生記法を表示し、他行では装飾表示する） |
| HTML タグ（`<details>`・`<summary>` 等） | **ビューア専用**（常にウィジェット描画。生の HTML 記法を表示する編集モードは持たない。本文の編集は標準ソースエディタで行う） |

HTML タグを使ったブロック（`<details>` アコーディオン等）は「ビューアとして正しく成立すること」を満足条件とし、ライブ編集対応は要件としない。

## 用語定義

| 用語 | 定義 |
|------|------|
| 装飾（Decoration） | 記法を隠す/置換する/スタイルを当てる表示処理。CodeMirror の `Decoration` に対応 |
| カーソル行 | キャレットまたは選択範囲が掛かっている行。生記法を表示する対象 |
| DecoSpec | 純粋ロジックが返す装飾記述子（オフセット・種別・タグ・属性） |
| タスク項目 | `- [ ]` / `- [x]` で始まる GFM チェックリスト項目 |
| ビューア専用 | カーソル位置に依らず常にウィジェット描画し、生記法を表示する編集モードを持たないブロック |

> **スコープ注記（v1.5.0）**: 本拡張は素の Markdown（CommonMark + GFM）の編集・プレビューに専念する。Obsidian 独自機能（Wikilink・埋め込み・コールアウト・タグ・脚注・カスタムタスク状態・バックリンク・ノート補完・画像ペースト保存）は品質リスク低減のため v1.5.0 で削除した（削除した要件番号: R-07, R-10〜R-15, R-17, R-18）。

## 動作環境

| 項目 | 要件 |
|------|------|
| VS Code バージョン | 1.85.0 以上 |
| 対象ファイル形式 | Markdown（`.md`） |
| Node.js（開発時） | 18.x 以上 |
| OS | Windows / macOS / Linux |

---

## ＜基本ライブプレビュー＞

### R-01 基本記法のライブプレビュー #core

> **理由：** Obsidian ライクに、記法を保持したまま見た目を装飾し、編集時のみ生記法を見せるため。

> **説明：** 装飾判定は CodeMirror 非依存の純粋関数 `computeDecorations`（`src/core/model.ts`）が担う。カーソル行は生記法、その他の行は装飾表示。

###### ＜カーソル連動＞

- ■■■ R-01-01 カーソル（選択範囲を含む）が掛かっている行は生の Markdown 記法を表示し、それ以外の行は記法を隠して装飾表示する。
- ■■■ R-01-02 `computeDecorations` は入力文字列を一切変更しない（表示のみ）。

###### ＜基本記法＞

- ■■■ R-01-03 太字 `**text**` を内側テキストの強調として装飾し、`**` マーカーを非カーソル行で隠す。
- ■■■ R-01-06 アンダースコア強調（`_`・`__`）は ASCII 単語文字に挟まれた語中（例 `my_var_name`）では発火しないこと（CommonMark 準拠。アスタリスクは語中可）。
- ■■■ R-01-04 見出し `#`〜`######` をレベル別クラスで装飾し、`#` プレフィックスを非カーソル行で隠す。
- ■■■ R-01-05 リスト `-` / `1.` を検知し、`-` マーカーをビュレットウィジェットへ置換（非カーソル行）。

---

## ＜拡張記法＞

### R-02 拡張 Markdown 記法 #syntax

> **理由：** 実用的な Markdown 文書を装飾表示するため、主要な記法を網羅する。

###### ＜インライン＞

- ■■■ R-02-01 斜体 `*text*` を装飾し、`**`（太字）と誤認しない。
- ■■■ R-02-02 インラインコード `` `code` `` を装飾し、内部の Markdown は装飾しない。
- ■■□ R-02-03 リンク `[text](url)` をラベル装飾＋href 保持で表示し、構文を非カーソル行で隠す。リンク遷移は左クリック時のみ実行し、右クリック時はリンクを開かず Webview のコンテキストメニューを表示すること。`.md` リンクの左クリックは同一 URI を重複させない別 Live Preview ビューアで開き、現在のビューアは維持する。`http(s)`/`mailto` は外部ブラウザ、その他相対パスは既定エディタで `preview: false`。
- ■■■ R-02-04 画像 `![alt](url)` を非カーソル行で画像ウィジェットに置換する。

###### ＜ブロック＞

- ■■■ R-02-05 引用 `> quote` を装飾し、`>` マーカーを非カーソル行で隠す。
- ■■■ R-02-06 フェンスコードブロック（```` ``` ````）を検知し、ブロック内の Markdown を一切装飾しない。
- ■■■ R-02-07 表（ヘッダ＋区切り行）を検知し、区切り行を非カーソル行で隠す。

---

## ＜表示制御・同期＞

### R-03 ソース横 Live Preview ビューア #viewer

> **理由：** 標準 Markdown ソースを維持したまま、横に並べた Live Preview でも編集でき、複数文書の確認と編集を安全に行えるようにするため。

> **説明：** `livePreview.openWith` は標準ソースエディタを置換せず、編集可能な `WebviewPanel` を横に開く。`customEditors` と `livePreview.toggleSource` は提供しない。同一 URI は常に 1 ビューアとし、異なる URI は複数ビューアを許可する。`livePreview.followActiveEditor` が有効な場合、アクティブな Markdown ソースへ最後に操作したビューアが追従する。切り替えは保留中の Webview 編集の適用後に行い、世代番号で旧バインド由来の遅延メッセージを拒否する。

###### ＜起動・重複防止＞

- ■■□ R-03-01 標準 Markdown エディタのタイトルバーボタンまたは Explorer コンテキストメニューの `livePreview.openWith` で、ソースを閉じずに Live Preview ビューアを `ViewColumn.Beside` へ開けること。
- ■■□ R-03-02 異なる Markdown URI の Live Preview ビューアは複数同時に開けるが、同一 URI のビューアは重複作成せず既存ビューアを再表示すること。
- ■■□ R-03-03 `.md` リンクは同一 URI の重複を作らず Live Preview ビューアで開き、現在のビューアを維持すること。外部 URL はブラウザ、その他の相対パスは `preview: false` の既定エディタで開くこと。
- ■■□ R-03-04 Live Preview は CodeMirror 編集、書式コマンド、チェックボックス、リンク、Undo、IME 抑制、CRLF 保持、最小差分同期を従来どおり提供し、Markdown テキストを表示目的で書き換えないこと。

###### ＜アクティブエディタ追従＞

- ■■□ R-03-05 `livePreview.followActiveEditor` は既定値 `true` とし、有効時はアクティブな Markdown ソースエディタへ最後に操作したビューアを追従させること。対象 URI を既に別ビューアが表示している場合は既存ビューアを所有者として維持し、重複切り替えを行わないこと。無効時は自動切り替えを行わないこと。
- ■■□ R-03-06 文書切り替えは、そのビューアで受信済みの保留編集を `WorkspaceEdit` へ適用した後に直列実行すること。各バインドに世代番号を付け、切り替え前の Webview が遅延送信した編集・タスク・リンク・エラー通知を新しい文書へ適用しないこと。
- ■■□ R-03-07 文書切り替え時はパネルタイトル、画像等の resource base、`localResourceRoots`、TextDocument 変更リスナーを新 URI へ再バインドすること。
- ■■□ R-03-08 ソースタブを閉じた後も Live Preview から編集できること。編集時は `workspace.openTextDocument(uri)` で TextDocument を再取得し、標準ソースエディタを表示しないこと。Webview 編集および `toggleTask` は `WorkspaceEdit` を即時適用し、適用成功後のみ現在のバインドの TextDocument を再取得して即時に `document.save()` すること。差分なし、`workspace.applyEdit` の false/失敗時、またはバインド変更時は保存しないこと。
- ■■□ R-03-09 書式コマンドとアクティブエディタ追従の対象は最後に操作したビューアとし、ビューア操作後にソースへフォーカスを戻しても対象を保持すること。

### R-04 ドキュメント同期 #sync

> **理由：** Webview の編集を TextDocument に正しく反映し、外部変更とも矛盾なく保つため。

###### ＜双方向同期＞

- ■■■ R-04-01 Webview の編集を最小差分（`diffRange`）で `WorkspaceEdit` に適用し、Undo 粒度を維持する。
- ■■■ R-04-02 外部変更（Git pull・他エディタ編集）を検知し、自身の編集エコーと区別して Webview を再同期する（`shouldResync`）。

---

## ＜品質・エッジケース＞

### R-05 エッジケースと性能 #robustness

> **理由：** 実利用に耐える堅牢性とパフォーマンスを確保するため。

###### ＜堅牢性＞

- ■■■ R-05-01 ネストしたリスト（インデント付き）をレベル付きで検知する。
- ■■■ R-05-02 コードブロック内の `#` `**` `` ` `` `>` を誤装飾しない。未終了フェンスも安全に扱う。
- ■■■ R-05-03 IME 入力中（変換中）は同期を遅延し装飾ちらつきを防止する（`shouldEmitEdit`）。
- ■■□ R-05-04 レンダリング失敗時は警告を表示し、安全な無装飾表示を維持すること。標準ソースエディタへの切り替えや追加表示は行わないこと（`computeDecorationsSafe`）。

###### ＜性能＞

- ■■■ R-05-05 装飾範囲をビューポート内に限定し（`viewportWindow`）、数千行でも処理時間が上限内に収まる。
- ■■■ R-05-06 CRLF 行末の文書でも記法検知・タスクトグルが正しく動作し、Webview 編集の反映時にファイルの EOL（CRLF）を保持して最小差分のみ適用すること（`toLF`/`fromLF`、`splitLines` の CR 除外、`toggleTaskAt` の CR 許容）。
- ■■□ R-05-07 `buildDecorations` の `RangeSetBuilder.add()` 呼び出しは CodeMirror が要求する `(from, startSide)` 昇順を遵守すること。`MarkDecoration` の `startSide`（500000000）は `Decoration.replace` の `startSide`（499999999）より大きいため、同一 `from` では `hide`/`replaceWidget` を `mark` より前に追加すること（`sideOf` の順序を修正）。また `builder.add()` が例外をスローした場合は `onError` で報告し `Decoration.none` を返してエディタが空白になることを防ぐこと。

### R-06 設定 #settings

> **理由：** ユーザーが表示を調整できるようにするため。

> **説明：** ソース表示は VS Code 標準エディタに委ねたため、装飾 ON/OFF 設定（旧 `livePreview.decorationsEnabled`）は v1.6.0 で廃止した。Live エディターは常に装飾表示する。

###### ＜設定項目＞

- ■■■ R-06-02 `livePreview.fontSize` を 8〜40 にクランプして反映する。

---

## ＜タスク管理＞

### R-08 タスクチェックボックス #task

> **理由：** Obsidian と同様に、チェックリストをインタラクティブなチェックボックスとして扱い、編集体験（WYSIWYG 操作）を高めるため。

> **説明：** `- [ ]`（未完了）・`- [x]`/`- [X]`（完了）で始まるリスト項目を対象とする。マーカー部をチェックボックスウィジェットに置換し、クリックで `[ ]`⇄`[x]` をトグルする。完了項目は本文に取り消し線スタイルを当てる。

###### ＜表示＞

- ■■■ R-08-01 `- [ ]` / `- [x]`（大文字 `X` を含む）を検知し、マーカー部を非カーソル行でチェックボックスウィジェット（`cm-lp-task-checkbox`、`checked` 状態を属性 `checked` に保持）へ置換すること。
- ■■■ R-08-02 完了タスク（`[x]`）の本文に取り消し線スタイル（`cm-lp-task-done`）を当てること。
- ■■■ R-08-03 カーソル行では `- [ ]` の生記法を表示すること（チェックボックス置換を行わない）。
- ■■■ R-08-04 インデントされたネストタスクも検知し、インデントレベルを属性 `indent` に保持すること。
- ■■□ R-08-06 タスク行（`.cm-lp-task`）の本文はリンク色・下線を継承しないこと（`.cm-line.cm-lp-task` に `color: var(--vscode-editor-foreground); text-decoration: none` を当てる）。ただし本文中の実リンク（`.cm-lp-link`）は R-21-04 に従いリンク色・下線を表示すること（`color` の上書きをせず `.cm-lp-link` のスタイルを継承させる）。
- ■■□ R-08-08 チェックボックスウィジェットの外観を CSS のみで次のとおりにすること（DOM・クラス名は不変）。未チェック（`.cm-lp-task-checkbox`）は `background: transparent`（エディタ背景と同化しない）・`border: 1.5px solid #888`（dark/light 両テーマで視認可能な中間グレー）・`border-radius: 4px` とする。チェック済み（`.cm-lp-task-checkbox-checked`）は**固定の赤** `background: #e5484d; border-color: #e5484d;` とし、チェックマーク（`::after`）は**白固定** `border-color: #fff`（回転四角コーナー形状を維持し、位置・サイズを角丸四角の中央に視覚的に収まるよう調整）とする。完了タスクの本文色（`.cm-lp-task-done` の `color`）は `var(--vscode-disabledForeground, var(--vscode-descriptionForeground, #888)) !important` とし、さらに `.cm-lp-task-done .cm-lp-link { color: inherit !important }` を追加してチェック済みタスク内のリンクも同じ暗転色で描画すること（`.cm-line.cm-lp-task .cm-lp-link` の明示 color による !important 上書きを防ぐ）。

###### ＜操作＞

- ■■■ R-08-05 Webview 上でチェックボックスをクリックすると、対応行の `[ ]`⇄`[x]` をトグルし、TextDocument に反映すること。（行トグル計算 `toggleTaskAt` を自動検証。クリック→反映の UI 結線は手動確認）
- ■■□ R-08-07 ホスト起点のトグル（`toggleTask`）でも、トグル結果を Webview へ確実に反映すること。`applyEditFromWebview` が `webviewText` を先行更新するため `onDidChangeTextDocument` のエコー抑制で `update` が送られず、CodeMirror のチェックボックス表示が更新されない問題を避けるため、`toggleTask` 処理では `applyEditFromWebview` の後に明示的に `postMessage({ type: 'update', text })` を送ること。Webview の `update` ハンドラはテキスト一致時 no-op のため通常編集には無害であること。また `setText`（Webview の `update` ハンドラが呼ぶ関数）は**最小差分 dispatch 方式**で実装すること: 共通プレフィックス・サフィックスを除いた最小変更範囲のみ `{ from, to: toOld, insert: text.slice(from, toNew) }` で dispatch し、セレクションを明示しない（CodeMirror が差分を通じてセレクションを自動マッピングするため cursor 位置がほぼ維持される）。全文置換（from:0, to:doc.length）では CodeMirror がセレクションを anchor:0 にリセットして `scrollIntoView` が走り、チェックボックストグル後にスクロール位置が先頭へジャンプする。最小差分方式はその根本原因を排除する。

---

## ＜リッチテキスト記法＞

### R-09 取り消し線・ハイライト #richtext

> **理由：** GFM／Obsidian で一般的な装飾記法をライブプレビュー対象に含め、レンダリング品質を高めるため。

###### ＜装飾＞

- ■■■ R-09-01 取り消し線 `~~text~~` を装飾し、`~~` マーカーを非カーソル行で隠すこと。
- ■■■ R-09-02 ハイライト `==text==` を装飾し、`==` マーカーを非カーソル行で隠すこと。コードブロック内・カーソル行では装飾／非表示を行わないこと。

---

## ＜編集体験の強化＞

### R-16 フォーマットコマンド #format

> **理由：** Obsidian と同様に、選択範囲へ装飾をトグルできるコマンド／ショートカットを提供し、編集体験を高めるため。

> **説明：** 純粋関数 `toggleWrap`（対称マーカー）を `src/core/format.ts` に実装。Webview のキーマップと VS Code コマンド（`livePreview.format.*`、Ctrl+B/I/Shift+X/Shift+H/E）から呼ぶ。

###### ＜トグル＞

- ■■■ R-16-01 選択範囲を対称マーカー（`**` `*` `~~` `==` `` ` ``）で囲めること。
- ■■■ R-16-02 既にマーカーで囲まれている場合（外側／選択端のいずれでも）は解除できること。
- ■■■ R-16-03 空選択では空のマーカーペアを挿入し、カーソルを中央へ置くこと。
- ■■□ R-16-05 コマンド `livePreview.format.*` とショートカット（Ctrl+B 等）から実行できること。（UI 結線は手動確認）

---

## ＜Markdown 記法の網羅＞

### R-19 水平線 #hr

> **理由：** 区切りを視覚化するため、水平線記法を表示する。

###### ＜表示＞

- ■■■ R-19-01 `---` / `***` / `___`（3 個以上・スペース許容）を水平線として検知し、非カーソル行でルールウィジェットに置換すること。リスト（`- `）や 2 個以下は誤検知しないこと。

### R-20 バックスラッシュエスケープ #escape

> **理由：** 記号を文字どおり表示するエスケープを CommonMark 準拠で扱うため。

###### ＜エスケープ＞

- ■■■ R-20-01 `\*` `\#` `\[` 等のエスケープは記法を発火させず、非カーソル行ではバックスラッシュを隠すこと。

### R-21 オートリンク・リンク視認性 #autolink

> **理由：** `<url>` 形式のオートリンクを表示・到達可能にするため。また、リンクの存在をユーザーが気づけるよう、常時下線で視認性を確保するため。

###### ＜表示＞

- ■■■ R-21-01 `<https://…>` をリンク化し `< >` を非カーソル行で隠すこと。
- ■■■ R-21-02 `<a@b.com>` には `mailto:` を付与すること。
- ■■■ R-21-03 CommonMark の山括弧宛先 `[ラベル](<相対パス>)`（パスにスペースを含み得る）を開く際、`openLink`（`src/livePreviewEditorProvider.ts`）が href の外側 1 組の山括弧 `< >` のみを除去（`/^<([\s\S]*)>$/`）してから解決すること。山括弧内のスペースは保持する（`Uri.joinPath` がそのまま扱う）。`model` のパース（`LINK_RE`）は href に山括弧を残す仕様とし、除去はホスト側 `openLink` で吸収する（`data-href`/title 表示には影響させない）。全角スラッシュ `／`(U+FF0F) は実フォルダ名の一部として不変に扱うこと。
- ■■□ R-21-04 リンク（`.cm-lp-link`）は常時下線（`text-decoration: underline`）を表示し、ホバー時も下線を維持すること。タスク行内のリンク（`.cm-line.cm-lp-task .cm-lp-link`）も同様に `.cm-lp-link` のリンク色と下線を継承して表示すること（本文色への上書きをしない）。

### R-22 表のレンダリング #table

> **理由：** GFM テーブルをライブプレビューで実際の表として表示するため。

> **説明：** `detectTableBlocks`/`parseTable` でブロックを解析。表は**カーソルがブロック外のとき**は単一の `table-block` ウィジェットへ置換して HTML テーブル描画し、**カーソルがブロック内に入るとウィジェットを解除して生の行 `| a | b |` を表示**してセル内テキストを直接編集できるようにする。テーブルのクリックは当該行（`<tr data-line>`）へキャレットを移動させ、再描画でブロックがアクティブ化して編集モードへ切り替わる。行の追加や列構造の編集は標準ソースエディタで行う。

###### ＜描画＞

- ■■■ R-22-01 表ブロック全体を 1 つの `table-block` ウィジェットに置換し、ヘッダ・整列・行データを保持すること。ウィジェットの `attrs` にブロック開始行（`startLine`）を載せ、Webview が各 `<tr>` に `data-line`（ヘッダ=`startLine`、区切り行はスキップ、`rows[k]`=`startLine+2+k`）を付与できるようにすること。
- ■■■ R-22-02 表は、カーソルがブロック内にあるときは `table-block` ウィジェットを出さず生の行を表示し**セル内テキストを編集可能**とすること。非カーソル時のみ従来どおりウィジェットへ置換すること。Webview 側でテーブルのクリックは、クリックされた `<tr>` の `data-line` を読み、その行頭へキャレットを移動（`view.dispatch({selection})`＋`view.focus()`）して編集モードへ遷移させること（`data-line` が無い区切り行などはキャレット移動しない）。コードブロック内の表もどきは表にしないこと。
- ■■□ R-22-03 表セル内の最小限のインライン記法（太字 `**` / `__`、斜体 `*` / `_`、インラインコード `` ` ``）を装飾描画し、生のマーカー（例 `**CPM**`）をそのまま表示しないこと（MAIO プレビュー同様）。装飾は Webview 層（`appendInlineCell`）でテキストノードへ安全に変換し、生 HTML を挿入しないこと。

---

## ＜編集体験の網羅＞

### R-23 リスト継続入力 #listcontinue

> **理由：** Enter での箇条書き継続という基本的な編集操作を提供するため。

> **説明：** 純粋関数 `continueList`（`src/core/editing.ts`）で次マーカーを算出し、Webview の Enter キーマップで適用する。

###### ＜継続＞

- ■■■ R-23-01 箇条書きを次のビュレットで継続すること。
- ■■■ R-23-02 順序リストは番号をインクリメントすること。
- ■■■ R-23-03 タスクは未完了チェックボックス `[ ]` で継続すること。
- ■■■ R-23-04 インデントを維持すること。
- ■■■ R-23-05 空項目で Enter したらマーカーを除去してリストを終了すること。

### R-24 インデント操作 #indent

> **理由：** Tab/Shift+Tab でリストの階層を調整できるようにするため。

###### ＜インデント＞

- ■■■ R-24-01 Tab で 2 スペースのインデントを追加すること（リスト行）。
- ■■■ R-24-02 Shift+Tab で先頭スペース（最大 2）またはタブ 1 つを除去すること。

### R-25 見出しトグル #headingtoggle

> **理由：** ショートカットで見出しレベルを切り替えられるようにするため。

###### ＜トグル＞

- ■■■ R-25-01 段落を指定レベルの見出しにすること（`Mod+Alt+1〜6`）。
- ■■■ R-25-02 同レベルの見出しは段落へ戻すこと。別レベルは変更すること。レベルは 1〜6 にクランプすること。

---

## ＜実挙動＞

### R-26 画像描画・リンク遷移 #render

> **理由：** プレビューで画像が実際に表示され、リンクが到達可能であることは編集体験の要であるため。

###### ＜描画・遷移＞

- ■■□ R-26-01 Webview の `localResourceRoots` と `asWebviewUri` による `resourceBase` で、相対パス画像（`![](img.png)`）を実描画すること。（リソース解決ロジック `resolveSrc` を実装。表示確認は手動）
- ■■□ R-26-02 標準リンク/オートリンクの左クリックで、外部 URL はブラウザ、相対パスはファイルを開くこと。リンク先が `.md` の場合は同一 URI を重複させない Live Preview ビューアで開き、それ以外は既定エディタで開くこと。右クリックでは `openLink` を送信せず、イベントを消費しないことで Webview のコンテキストメニューを表示すること。（マウスボタン判定を自動検証。UI 結線は手動確認）

---

## ＜Live エディターの操作・体裁＞

### R-27 HTML アコーディオン折りたたみ #fold

> **理由：** 補足情報を `<details>` アコーディオンで畳んで見通しを良くするため。見出しガター折りたたみは不要のため廃止し、HTML の `<details><summary>` 記法のレンダリングに置き換える。

> **説明：** HTML の `<details><summary>…</summary>…</details>` ブロックをプレビュー上でアコーディオンとしてレンダリングする。判定は純粋関数 `detectDetailsBlocks`（`src/core/model.ts`）が担い、**ビューア専用**としてカーソル位置に依らず常にブロック全体を 1 つの `details-block` ウィジェット（既定で折りたたんだ＝閉じた状態）へ置換する（生の HTML を表示する編集モードは持たない）。Webview 層（`src/webview/decorations.ts`）が実際の `<details>` 要素にマッピングし、`<summary>` クリックで開閉する。開閉状態は summary テキストをキーに `openDetails` 集合で記憶し、再描画後も保持する（同一サマリのアコーディオンは状態を共有する制限あり）。アコーディオン本文の編集は標準ソースエディタで行う。見出し（`#`）単位のガター折りたたみ（旧 `foldService`/`foldGutter`）は v1.7.0 で廃止した。

###### ＜折りたたみ＞

- ■■■ R-27-01 `<details><summary>…</summary>…</details>` ブロックを検知し、ブロック全体を 1 つの `details-block` ウィジェットへ置換すること。フェンスコードブロック内の `<details>` はアコーディオンとみなさず、閉じタグの無い未終了ブロックは折りたたまない（文末まで畳まない）こと。
- ■■■ R-27-02 アコーディオンは既定で折りたたんだ（閉じた）状態で表示し、`<summary>` をクリックで開閉できること。開閉状態は再描画後も保持すること（summary テキストをキーに記憶）。
- ■■■ R-27-03 アコーディオンは**ビューア専用**とし、ブロック内にカーソルがあってもウィジェットのまま（生の HTML 記法を表示しない＝実質非編集）とすること。Webview 側ではウィジェット本体（サマリ以外）のクリックを capture フェーズで握りつぶし（`preventDefault`/`stopImmediatePropagation`）、CodeMirror 既定の mousedown によるキャレット移動を防ぐこと。`<summary>` クリックはネイティブ開閉に通すこと。
- ■■□ R-27-04 サマリ行は背景バー・枠・余計な padding を持たず、`▶`（閉）/`▼`（開）の三角マーカー＋サマリテキストのみの軽量な 1 行表示とし、本文インライン要素と馴染ませること。マーカーは開閉状態に追従する（`<details open>` で `▼`、閉で `▶`）。サマリテキストは通常ウェイト（`font-weight: 400`、太字継承を防ぐ）で表示し、マーカーとサマリテキストの間に半角程度の余白（マーカーの `margin-right` 約 `0.4em`）を設けること（MAIO 参照画像準拠）。
- ■■■ R-27-05 純粋関数 `detailsTagRanges`（`src/core/model.ts`）は各行の構造 HTML タグ（`<details …>`・`<summary …>`・`</summary>`・`</details>` の山括弧を含むタグ文字列）の範囲を返すこと（サマリ本文は含まない）。ビューア専用化により `computeDecorations` 内ではこの範囲を使った行内 `hide` は行わない（ブロック全体がウィジェット置換されるため）が、関数自体の仕様は維持する。
- ■■■ R-27-06 アコーディオンを開いたとき**本文を描画**すること（ビューア専用）。`detectDetailsBlocks` が `</summary>` より後〜`</details>` 直前の各行から構造タグを除去した本文行群を `DetailsBlock.body` に格納し（前後の空行はトリム）、`details-block` ウィジェットの `attrs.body` に JSON で渡す。Webview 層は `<details>` 内（サマリの後）に各本文行を `.cm-lp-details-body-line` として最小限のインライン記法（太字・斜体・インラインコード、`appendInlineCell`）で描画すること。複数段落・リスト・ネストは簡易描画で割り切る。本文の編集は標準ソースエディタで行う。

### R-28 Live エディターの編集体裁 #editing-ui

> **理由：** 実編集に耐える基本的な見た目（余白・キャレット・チェックボックス操作）を確保するため。

###### ＜体裁＞

- ■■□ R-28-01 本文左側に十分な余白（左パディング）を設けること。見出しガター廃止で空いた領域は本文余白として活用すること。
- ■■□ R-28-02 編集時にキャレット（テキストカーソル）が視認できること（`drawSelection` を有効化し、カーソル要素 `.cm-cursor` の `border-left-color` を `var(--vscode-editorCursor-foreground)`（フォールバックで editor 前景色）で確実に描画する）。
- ■■□ R-28-03 タスクチェックボックスはクリックでフォーカス・選択移動を起こさず、ON/OFF が確実にトグルされること（ウィジェットを `span` 化し、クリックを capture フェーズで受け、`preventDefault`/`stopImmediatePropagation` で CodeMirror の mousedown より先に処理してキャレット移動・再描画を防ぐ）。
- ■■□ R-28-04 本文・見出し・各記法の文字色を VS Code 標準テーマの色変数（`var(--vscode-...)`）に追従させ、独自のハードコード色を用いないこと。
- ■■□ R-28-05 本文体裁を GitHub / VS Code 標準 Markdown プレビュー（github-markdown-css 風）に寄せること。具体的には次を満たすこと（描画エンジンと装飾ロジックは変更せず CSS の体裁のみで実現する）:
  - 本文フォントは UI/サンセリフ（`var(--vscode-markdown-font-family, var(--vscode-font-family, system-ui, sans-serif))`）とし、コード（`.cm-lp-code`/`.cm-lp-codeblock`）のみ monospace を維持。行間は 1.6 前後。
  - 見出し `.cm-lp-h1`〜`h6` を GitHub 風サイズ（h1≈2em / h2≈1.5em / h3≈1.25em / h4≈1em / h5≈0.9em / h6≈0.85em 目安）にし、h1/h2 行に下境界線（`border-bottom: 1px solid var(--vscode-panel-border)`）と上下マージンを付与する。
  - インラインコードは淡背景＋角丸の小ピル、ブロックコード `.cm-lp-codeblock` は全幅背景＋十分なパディング（例 `12px 16px`）にする。
  - 引用 `.cm-lp-quote`・表 `table.cm-lp-table`（ボーダー・ヘッダ背景・任意のゼブラ）・水平線 `.cm-lp-hr-line` を GitHub プレビュー風にする。
  - すべての色は `var(--vscode-*)` 変数でテーマ追従を維持し（ハードコード色禁止・フォールバックのみ可）、`.cm-lp-table-row` の `font-variant-numeric: tabular-nums` を維持する。カーソル行で生記法が見えても体裁が崩れないこと（カーソル行表示ロジックは変更しない）。
- ■■□ R-28-06 「Markdown All in One」プレビューに体裁を寄せる追加の磨き込みを行うこと（CSS のみ／装飾ロジック不変）: ブロックコードに淡いボーダー（`border: 1px solid var(--vscode-panel-border)`）、引用に淡い背景バンド（`var(--vscode-textBlockQuote-background)`）、`<details>` アコーディオンのマーカーを小さめ・控えめ（`▶`/`▼`、`font-size: 0.8em` 目安）にし、マーカーとサマリテキストの間に余白（`margin-right: 0.4em` 目安）を設け、サマリテキストを通常ウェイト（`font-weight: 400`）にすること。チェックボックスとタスク本文の間に十分な余白を設けること。
- ■■□ R-28-07 左右の読みやすい余白を「Markdown All in One」プレビューに寄せること（`.cm-content` のパディングを `20px 40px 24px 48px` 目安〔上 `20px`／右 `40px`／下 `24px`／左 `48px`〕とする。CodeMirror のインラインスタイル上書きを防ぐため `!important` を付与する）。見出しは行装飾のためインデントを増やさず、見出しと本文の左端が揃うこと。本文フォントは Markdown サンセリフスタックを明示指定（継承のみに頼らない）し、`font-weight: 400`（通常ウェイト）で等幅へフォールバックしないこと。
- ■■□ R-28-08 タスク行（`.cm-line.cm-lp-task`）内のインラインリンク（`.cm-lp-task .cm-lp-link`）は R-21-04 に従いリンク色（`.cm-lp-link` の `color` を継承）と下線（hover 含む）を表示すること。`color` の上書きは行わない（R-08-06 の補完）。
- ■■■ R-28-09 `<details>` アコーディオンは**ビューア専用**（R-27-03）のため、ブロック本文を生記法で表示する編集モードは持たない。本文・サマリのインライン記法（太字・斜体・インラインコード）は `details-block` ウィジェット側（`<summary>` は `appendInlineCell`）でのみ描画し、ブロック内カーソル時に生のマーカー（例 `**ワークパッケージ**`）が見えることはない。本文の編集は標準ソースエディタで行う。装飾は表示のみで入力文字列を変更しないこと。
- ■■□ R-28-10 ブロックウィジェット（`TableWidget`・`DetailsWidget`）は `block: true` で挿入されるため、ブロック高さ会計と実 DOM のズレを抑え、ウィジェットより**下の行**の `posAtCoords`（クリック位置と編集位置の不一致）を防ぐこと。高さ整合は **estimatedHeight 主導**とし（R-28-11 で再定義）、`toDOM` 内では `view.requestMeasure()` を**呼ばない**こと（`toDOM` は CodeMirror の measure サイクル内で実行されるため、ここで再 measure を要求すると高さ確定が次フレームへ遅れ、その間 `posAtCoords` が旧値のままクリックずれを生む）。更新パスの `updateDOM(_dom, view)` でのみ `view.requestMeasure()` を呼び（`return true` で既存 DOM を再利用）、初回描画は `estimatedHeight` で実態に近づける。`DetailsWidget` は開閉で高さが変わるため、`toggle` イベントリスナー内でも `view.requestMeasure()` を呼ぶこと（toggle は measure サイクル外・DOM がツリー内にあるタイミングのため有効）。
- ■■□ R-28-11 ブロックウィジェットの `get estimatedHeight()` は**現在のフォントサイズ**（ホストの `fontSize` 設定。既定 14px。`setFontSize` で webview の装飾層へ同期）と、アコーディオンの**開閉状態**を反映した値を返し、measure 確定前でもブロック直下のクリック位置が一致すること。具体的には、プレーン行高は `fontSize × 1.6`、テーブル行高は `fontSize × 0.95 × 1.6 + 13`（セル `padding: 6px 13px` の縦 12px＋border 1px）として、テーブル＝（ヘッダ 1＋本文行数）× テーブル行高＋`fontSize`（`margin: 0.5em 0`）、アコーディオン＝サマリ行（`fontSize × 1.4 + 2`）＋（開状態のみ）本文行数 ×（`fontSize × 1.4 + 2`）とすること（22/34px のハードコードは廃止）。あわせて、テーブルセルの行高を CSS で固定（`table.cm-lp-table th/td { line-height: 1.6; }`、インライン `<strong>`/`<code>`/`<em>` は `line-height/font-size: inherit`）し、セル内インライン記法（`**bold**`/`` `code` ``）や折返しで行高がブレないようにして推定と実測の乖離自体を縮めること。これによりフォントサイズ 14 以外・セル内インライン記法・details 開閉直後でもブロック直下クリックが正しい行に着地すること。
- ■■□ R-28-12 ブロックウィジェット（テーブル・`<details>`）は `block: true` で atomic 扱いのため、上下矢印（既定の `cursorLineUp/Down`）はブロック全体を 1 ストロークでスキップし、複数ソース行を飛び越えてしまう。これを防ぐため、上下矢印用のカスタムコマンド（`ArrowUp`/`ArrowDown`、既定キーマップより優先登録）を設け、キャレットが折りたたみブロックを越える場合は**1 ソース行ずつ**隣接行へ着地させること。判定は「CodeMirror の既定の縦移動（`moveVertically`）が現在行から 2 ソース行以上ジャンプするか」で行い（折返し段落の視覚行移動は同一/隣接ソース行に留まるため誤発火しない）、該当時のみ現在行 ±1 のソース行先頭へキャレットを移す。非該当（通常移動・折返し段落内の視覚行移動）は既定キーマップにフォールバックすること。
- ■■■ R-28-13 スクロール後にクリックしても、クリックした行に正確にカーソルが置かれること。`#editor { overflow: auto }` と CodeMirror の `.cm-scroller { overflow: auto }` が**二重スクロールコンテナ**を形成すると、`#editor.scrollTop` が増加する一方で `.cm-scroller.scrollTop` は 0 のままとなり、CodeMirror の `posAtCoords` がスクロール量ぶん座標変換をずらしてしまう（スクロールするほど同じクリック位置でもずれ量が増大する症状）。対策として `#editor` の `overflow` を `hidden` に変更し、スクロールを唯一のコンテナである `.cm-scroller` に完全委譲すること（`media/editor.css`）。
- ■■■ R-28-14 見出し行（`.cm-line.cm-lp-h1`〜`h6`）と HR 行（`.cm-lp-hr-line`）の上下余白が `margin` ではなく `padding` で表現されており、CodeMirror の height oracle が正確な行高さを計測できること。`getBoundingClientRect().height` は CSS `margin` を含まないため、見出し・HR 行の `margin-top`/`margin-bottom` が height oracle に計上されず、スクロール量に比例してクリック位置ずれが累積していた（R-28-10 でテーブルに対して同原則の修正を行ったが、見出し・HR に同問題が残存していた）。対策として `media/editor.css` の見出し `margin-top: 0.8em` → `padding-top: 0.8em`・`margin-bottom: 0.3em` → `padding-bottom: 0.3em`（h1/h2 は border-bottom 上の空きを統合し `padding-bottom: 0.55em`）、HR の `margin: 1em 0` → `padding: 0.15em 0`（余白縮小も兼ねる）へ変換すること。あわせて HR の `border-top` を 2px → 3px（`rgba(127,127,127,0.5)`）に変更し視認性を高めること。`applyFontSize` の末尾で `requestAnimationFrame(() => view.requestMeasure())` を呼び、フォントサイズ変更後に全行の実寸を再測定させること（`src/webview/main.ts`）。
- ■■■ R-28-15 ドラッグ選択範囲が左右余白にはみ出さず、かつ長文の上部・中盤・末尾やスクロール後でも確実に視認できること。`.cm-selectionLayer` は `contain:size` かつ子要素が absolute 配置のため、CSS 高さ未指定では used height が 0 となり選択矩形がすべてクリップされ、`height:100%` では viewport 高に固定され文書途中以降がクリップされる。対策として `src/webview/main.ts` の専用 `ViewPlugin` が CodeMirror の `requestMeasure` read/write フェーズを使い、read で `view.contentHeight` と対象レイヤーを取得し、write で inline `height: ${view.contentHeight}px` を同期すること。同一キーで重複 measure を集約し、初期生成、`docViewUpdate`（文書・装飾・viewport 由来の DOM 更新）、`geometryChanged` / `docChanged`、フォントサイズ変更、表・`<details>` の再測定後をカバーし、destroy 時は付与した inline height を除去すること。CSS は `width:100%` と `clip-path: inset(0 40px 0 48px)` を維持して左右余白を除外し、固定 height は指定しないこと。
- ■■□ R-28-16 Live エディター上で Ctrl（Windows/Linux）または Cmd（macOS）を押しながらマウスホイールを操作すると、ホイール上方向で 1px 拡大、下方向で 1px 縮小すること。ホイールの `deltaY` の大きさにかかわらず 1 回の gesture につき 1px のみ変更し、有効範囲は `livePreview.fontSize` と同じ 8〜40px にクランプする。計算は CodeMirror/DOM 非依存の純粋関数 `zoomFontSize`（`src/core/viewport.ts`）で行う。変更は現在の Webview タブ内の `fontSize` 状態だけに適用し、VS Code 設定、他タブ、再度開いたタブには保存・伝播しない。通常の修飾キーなしホイールは従来どおりスクロールし、キーボードショートカットによるズームは追加しない。ズーム時はポインタ直下の文書位置と行内 Y オフセットを変更前に記録し、既存 `applyFontSize` の再計測後に `.cm-scroller.scrollTop` を補正して表示アンカーを維持すること。
