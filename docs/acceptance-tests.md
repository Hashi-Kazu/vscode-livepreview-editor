# Live Preview Editor 受け入れテスト

**関連文書**: [requirements-usdm.md](requirements-usdm.md)

> ▶️ **開発継続中（2026-07-19 / v1.36.0）**: Live Preview を CustomTextEditorProvider として再採用し、Undo/Redo を VS Code へ委譲した（ADR-0020、R-03-12／R-33）。`test/customEditor.provider.test.ts` を受け入れ対象に登録し、旧 WebviewPanel／follow 前提の手動確認項目を現行 Custom Text Editor 設計へ改訂した。

テストは Vitest（`npm test`）で実行する。対象は `src/core` の純粋ロジック。各テストは仕様 ID（RXX-YY）と対応付ける。

## テストファイルと対応仕様

| テストファイル | 対応仕様 |
|---|---|
| `test/phase1.decorations.test.ts` | R-01（太字・見出し・リスト・カーソル連動） |
| `test/phase2.syntax.test.ts` | R-02（斜体・コード・リンク・画像・引用・コードブロック・表）、R-01-02（モデル純粋性：入力不変・決定性） |
| `test/phase2.sync.test.ts` | R-04（diffRange・shouldResync・cursorLines） |
| `test/phase3.edge.test.ts` | R-05-01/02/04（ネスト・誤装飾防止・フォールバック） |
| `test/phase3.behavior.test.ts` | R-04-01（Undo round-trip）・R-05-03/05（IME・性能）・R-06-02（fontSize 設定）・R-28-16（ホイールズーム計算） |
| `test/feature.task.test.ts` | R-08（GFM タスク検知・完了スタイル・カーソル行・ネスト・トグル・CRLF・EOL） |
| `test/feature.richtext.test.ts` | R-09（取消線・ハイライト） |
| `test/robustness.combinations.test.ts` | R-01-06（語中アンダースコア）・R-05-06（CRLF）・記法組み合わせ・構造不変条件（オフセット境界・replace 非重複） |
| `test/feature.format.test.ts` | R-16（toggleWrap：囲む・解除・空選択・往復） |
| `test/feature.markdown.test.ts` | R-19（水平線）・R-20（エスケープ）・R-21（オートリンク）・R-22（表のレンダリング/parseTable） |
| `test/feature.editing.test.ts` | R-23（リスト継続）・R-24（インデント）・R-25（見出しトグル）・R-26-02（リンクのマウスボタン判定） |
| `test/customEditor.provider.test.ts` | R-03-12（custom editor 登録）・R-33（Undo/Redo 委譲・key routing・host sync 契約）・R-04（self-echo/外部反映） |

## 実行方法

```bash
npm run compile   # 先にビルド（型チェック含む）が通ること
npm test          # 全テスト実行
npm run coverage  # カバレッジ確認
```

## 判定

- PASS した仕様は `requirements-usdm.md` のステータスを `■■■` に更新する。
- Webview 上の副作用（チェックボックスのトグル反映）は純粋ロジック外のため自動テスト対象外。クリック→postMessage の経路は手動確認（VSIX インストール後）に委ねる。対応仕様 R-08-05 は純粋ロジック側（行トグル計算 `toggleTaskAt`）のみ自動検証し、UI 結線は手動確認とする。
- **v1.6.0 で追加・変更した以下は VS Code 上の手動確認項目（純粋ロジック外）**。VSIX インストール後に確認する:
  - R-03-01〜04・R-03-12（`livePreview.openWith` でソース横へ Custom Text Editor を `ViewColumn.Beside` 起動、`priority: option` により `*.md` の既定は標準ソースエディタのまま、`supportsMultipleEditorsPerDocument: false` で同一 URI は複製せず既存エディタを reveal、異なる URI は並行して開ける、`.md` リンクで同一 URI を重複させず開く、書式・チェックボックス・IME・CRLF・最小差分同期の維持。R-03-05／R-03-09（active editor follow）・R-03-10（リネーム/削除の再バインド）は今回 version で廃止済みのため確認対象外）
  - R-33（Undo/Redo の VS Code 委譲: `Ctrl/Cmd+Z`=undo・`Ctrl/Cmd+Shift+Z`／`Ctrl+Y`=redo がソースエディタと履歴を共有して動作し、`Ctrl/Cmd+S` で保存されること。IME 変換中は Undo/Redo キーを奪わないこと。undo/redo は保存を伴わないこと）
  - R-03-08（Live Preview 編集と `toggleTask` の `WorkspaceEdit` は即時反映され、適用成功後のみ現在の TextDocument を再取得して即時保存されること。差分なし・`applyEdit` false/失敗時・バインド変更時に保存されないこと。ソースタブを閉じた状態でも標準ソースエディタを表示せず保存されること）
  - R-05-04（レンダリング例外時に警告を表示し、Live Preview ビューアを閉じたり標準ソースエディタへ切り替えたりしないこと）
  - R-27-01〜03（見出しブロック折りたたみ、初期全閉、`▸`/`▾` ガター開閉）
  - R-28-01〜03（左余白、キャレット視認、チェックボックスの確実なトグル）
  - R-26-02（標準リンクとオートリンクを左クリックすると従来どおり遷移し、右クリックでは遷移せず Webview のコンテキストメニューが表示されること）
  - R-28-15（十分にスクロールでき、表と `<details>` を含む長文を用意する。文書の上部・中盤・末尾でドラッグ選択ハイライトが表示され、スクロール後や表／`<details>` の直前・直後をまたぐ選択でも消えないこと。`livePreview.fontSize` の変更、Webview の縦横 resize、`<details>` の開閉後にも同じ位置で表示されること。いずれの状態でもハイライトが本文の左 48px・右 40px の余白へ漏れないこと。開発者ツールで `.cm-selectionLayer` の inline `style.height` が更新され、数値が `EditorView.contentHeight` 以上（丸め誤差は 1px 未満）であり、レイヤーの used height が 0 や viewport 高のままになっていないこと）
  - R-28-16（長文を途中までスクロールし、本文上にポインタを置いて Ctrl/Cmd＋ホイールを上下へ操作する。1 gesture ごとにフォントサイズが正確に 1px 変化し、8px/40px で停止すること。ズーム後もポインタ直下の文書位置が維持され、通常ホイールは従来どおりスクロールすること。他の Live タブと `livePreview.fontSize` 設定値は変化せず、タブを閉じて再度開くと設定値へ戻ること。Ctrl/Cmd＋`+`/`-` 等のキーボードズームは追加されていないこと）
