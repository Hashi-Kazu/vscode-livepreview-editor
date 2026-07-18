# Architecture Decision Records (ADR)

このディレクトリは vscode-livepreview-editor の設計判断を [MADR](https://adr.github.io/madr/) 形式で記録する。

新しい設計判断を追加する場合は連番ファイル（`0015-xxx.md`）を作成し、このインデックスに追加すること。

---

## インデックス

| No. | タイトル | 要約 | 確信度 |
|-----|---------|------|--------|
| [0001](0001-codemirror6-as-editor-core.md) | CodeMirror 6 をエディタコアとして採用 | Webview 内エディタエンジンとして CM6 を選択。Monaco/CM5 より CSP 対応・装飾 API 適合性が高い | 高 |
| [0002](0002-pure-logic-layer-separation.md) | 装飾判定ロジックを純粋関数層として分離 | `src/core/` を CodeMirror/VS Code 非依存の純粋関数に。Vitest で直接テスト可能にするため | 高 |
| [0003](0003-decospec-intermediate-representation.md) | DecoSpec 中間表現の導入 | 純粋ロジック層の出力を CM6 Decoration API と橋渡しするフレームワーク非依存の記述子型 | 高 |
| [0004](0004-esbuild-dual-bundle.md) | esbuild による 2 エントリデュアルバンドル構成 | 拡張ホスト（CJS/Node）と Webview（IIFE/browser）を 1 スクリプトから並列ビルド | 高 |
| [0005](0005-custom-text-editor-provider.md) | CustomTextEditorProvider の採用（廃止） | v1.20.0 で ADR-0015 に置換 | 高 |
| [0006](0006-strict-csp-with-nonce.md) | Webview への nonce ベース厳格 CSP の適用 | `script-src 'nonce-…'` のみ許可。Markdown 内 inline script 実行を防止 | 高 |
| [0007](0007-minimal-diff-workspace-edit.md) | 最小差分による WorkspaceEdit 適用 | `diffRange()` で全体置換でなく変更箇所のみ replace。VS Code の undo 粒度を保持 | 高 |
| [0008](0008-ime-composition-suppression.md) | IME 変換中の edit 送信抑制 | `composing === true` の間は edit を postMessage しない。CJK 入力の二重化・ちらつきを防止 | 高 |
| [0009](0009-viewer-only-table-accordion.md) | テーブル・アコーディオンのビューア専用化 | v1.12.0 でカーソル時の生表示を廃止。高さ会計バグが繰り返し発生したため **(要確認: テーブルの扱い)** | 高 |
| [0010](0010-scope-commonmark-gfm-only.md) | Obsidian 独自機能の削除とスコープ限定 | v1.5.0 で Wikilink/埋め込み等を削除。ホスト I/O 品質リスクを排除するため | 高 |
| [0011](0011-vitest-for-unit-tests.md) | Vitest によるユニットテスト | @vscode/test-electron でなく Vitest を採用。純粋関数層を VS Code なしで直接テスト | 高 |
| [0012](0012-single-tab-editor-switch.md) | ビュー切り替えの単一タブ保持方式（廃止） | v1.20.0 で ADR-0015 に置換 | 高 |
| [0013](0013-lf-normalization.md) | Webview/CodeMirror 側での LF 正規化 | Webview は常に LF で処理。CRLF ファイルは拡張ホスト側で変換 | 高 |
| [0014](0014-ci-marketplace-publish.md) | GitHub Actions による Marketplace 自動公開 | main push をトリガーに自動ビルド・公開。mindmap-editor 方式を踏襲 | 高 |
| [0015](0015-editable-webview-panel-viewers.md) | editable WebviewPanel ビューア | ソース横表示、URI 単一所有、active editor follow、queued rebinding | 高 |
| [0017](0017-codemirror-history-and-ack-sync.md) | CodeMirror history and acknowledgement sync | CodeMirror 単独 Undo、host ack、WorkspaceEdit self-echo ledger、外部更新時の履歴リセット | 採用 |
| [0018](0018-explicit-save-over-idle-autosave.md) | 明示保存＋ライフサイクル flush（アイドル自動保存廃止） | `SaveDebouncer` を廃止し、Webview Ctrl+S→host `performSave` と失焦・破棄・バインド切替の flush 保存へ変更。Undo 安全機構は据え置き（ADR-0019 で supersede） | 採用 |
| [0019](0019-debounced-apply-immediate-save.md) | デバウンスバッチ apply＋即時保存 | デバウンス apply＋直後保存で dirty 滞留を防止する。v1.34.0 でソースタブ自動クローズ backstop を廃止し、該当判断を部分的に supersede | 採用 |

---

## 凡例

- **確信度 高**: コミットメッセージ・コード・コメントに明示的な根拠がある
- **確信度 中**: コードの変遷から推測できるが明言されていない
- **(要確認)**: 決定の事実は確認できるが理由が推測の域を出ない。開発者レビューが必要
