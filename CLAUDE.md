# vscode-livepreview-editor

> ▶️ **開発継続中（2026-06-23 時点 / v1.15.2）**
>
> v1.11.0 の開発凍結は **v1.12.0 で解除**し、開発を再開した。以降は通常どおり機能追加・変更・バグ修正を行う（すべて CLAUDE.md の開発ルール＝`feature-dev` 経由）。
>
> **ライブ編集ポリシー（v1.12.0 〜）**:
> - **標準 Markdown 記法**（CommonMark + GFM）= **ライブ編集対象**（カーソル行で生記法・他行で装飾表示）
> - **HTML タグ**（`<details>` アコーディオン等）= **ビューア専用**（常にウィジェット描画。ビューアとして正しく成立すればよい。編集は標準ソースエディタで）
>
> v1.15.0〜v1.15.2 の主な内容:
> - ブロックウィジェット直下のクリック位置ずれを根本修正（`toDOM` の `requestMeasure` 撤去・`estimatedHeight` 動的化・テーブルセル `line-height` 固定。R-28-10／R-28-11）
> - 上下矢印がテーブル／アコーディオンをまたぐ際の複数行ジャンプを修正（`ArrowUp`/`ArrowDown` カスタムコマンド。R-28-12）
>
> v1.12.0〜v1.14.x の主な内容:
> - 表・`<details>` アコーディオンを**ビューア専用化**（R-22-02／R-27-03 再定義、R-28-09）
> - アコーディオンの開閉状態を summary キーで保持（R-27-02）
> - チェックボックス ON/OFF のホスト→Webview 反映を修正（R-08-07）
> - 相対パスリンクの山括弧宛先 `[ラベル](<…>)` を `openLink` で除去（R-21-03）
> - 本文余白を `20px 40px 24px 48px` へ調整（R-28-07）
>
> 以前の主な内容（v1.7.0〜v1.11.0）:
> - 表セルのインライン記法（太字・斜体・インラインコード）描画（R-22-03、`appendInlineCell`）
> - ビュー切り替えを同一タブ内の再描画方式へ変更（保存確認ダイアログを出さない、R-03 再定義）
> - 折りたたみ対象を見出しから HTML `<details><summary>` アコーディオンへ再定義（デフォルト折りたたみ、R-27 再定義）
>
> 改めて凍結する場合は、このバナーを凍結表記に戻すこと。

VS Code 拡張機能。Obsidian ライクな Markdown ライブプレビュー編集エディタ。TypeScript + CodeMirror 6 + esbuild + VS Code API（`CustomTextEditorProvider`）構成。

## 技術スタック

- TypeScript
- CodeMirror 6（`@codemirror/view` / `@codemirror/state` / `@codemirror/lang-markdown` / `@codemirror/commands`）
- VS Code Extension API（@types/vscode ^1.85.0）、`CustomTextEditorProvider`
- ビルド: esbuild（拡張ホスト=CJS / Webview=IIFE の 2 エントリ）
- テスト: Vitest（`src/core` の純粋ロジックを対象）
- エントリポイント: `src/extension.ts`（拡張ホスト）/ `src/webview/main.ts`（Webview）
- ビルド出力: `dist/extension.js`・`dist/webview.js`

## コマンド

```bash
npm install
npm run compile   # 型チェック(tsc --noEmit) + esbuild バンドル → dist/
npm test          # Vitest（受け入れテスト）
npm run coverage  # カバレッジ付きテスト
npm run watch     # ウォッチビルド
npm run package    # .vsix 生成（@vscode/vsce package）
```

## ディレクトリ構成

```
src/core/         # 純粋ロジック（CodeMirror/VS Code 非依存・テスト対象）
src/webview/      # CodeMirror 6 統合（core の記述子を Decoration に変換）
src/              # 拡張ホスト（extension.ts / livePreviewEditorProvider.ts）
test/             # Vitest テスト
docs/             # 要求仕様書（USDM形式）・アーキテクチャ・受け入れテスト
media/            # アイコン・CSS
releases/         # 各バージョンの VSIX と CHANGELOG
dist/             # ビルド出力（自動生成）
```

## 設計の肝

- **装飾判定ロジックは CodeMirror から完全分離した純粋関数**として `src/core/model.ts`（`computeDecorations` / `computeDecorationsSafe`）に実装する。Webview 層（`src/webview/decorations.ts`）が `DecoSpec` 記述子を CodeMirror の `Decoration` にマッピングする。
- **新しい記法を追加するときは、まず `src/core/model.ts` に純粋関数として実装し `test/` にユニットテストを追加する。** Webview の描画は後段。これによりテストが DOM/エディタ非依存に保たれる。
- 同期・差分・IME 抑制・カーソル行判定は `src/core/sync.ts`、ビューポート限定・設定解決は `src/core/viewport.ts`。
- ユーザーの Markdown テキストを書き換えない。装飾はあくまで表示のみで、`computeDecorations` は入力文字列を変更しない（テストで担保）。

## 開発ルール

**コード修正・機能追加・バグ修正など、あらゆる開発タスクは必ず `feature-dev` エージェントを通して行うこと。**

- `feature-dev` がコード修正・仕様書更新（ステータス `■■□`）・バージョンバンプ・受け入れテスト更新を一括で行う
- バグ調査が必要な場合は `debugger` を呼ぶ（**すべてのエージェント起動は main が行う**。サブエージェント間で直接指示はできない）
- **開発完了後の自動フロー**（すべて main が順に起動する）:
  1. `feature-dev` が成功報告（型チェック/build 通過、ステータス `■■□` 更新済み）
  2. main が `acceptance-test` を起動 → `npm test` 実行・ステータス `■■■` 反映・結果返却
     - **FAIL あり**: main が `feature-dev` を再起動して修正させる
     - **PASS / SKIP のみ**: 手順 3 へ
  3. main が `publisher` を起動 → build〜commit〜push まで
- バージョンポリシー: **要件変更あり → マイナーアップ / コード修正のみ → パッチアップ**
- **`feature-dev` はテストを実行しない**（`npm test` の実行は `acceptance-test` の責務。テストコードの更新・追加は行ってよい）
- 要求仕様書は `docs/requirements-usdm.md` を正とする。要件を変えたらこれを更新し `package.json` のバージョンを揃える。アーキテクチャを変えたら `docs/architecture.md` も更新する。

## エージェント一覧

| エージェント | 役割 |
|---|---|
| `feature-dev` | 開発全部（コード・仕様書・バージョン・受け入れテスト更新） |
| `debugger` | バグ調査のみ（読み取り専用） |
| `acceptance-test` | 受け入れテスト実行・ステータス `■■■` 反映 |
| `publisher` | build＋git push |

> **エージェント定義の管理**: `.claude/agents/*.md` は `C:\Claude Code\_agent-templates`（正本）から同期されたコピー。**直接編集せず**、正本を編集して `_agent-templates\sync-agents.ps1` を実行すること。プロジェクト固有の事情はエージェントではなくこの CLAUDE.md に書く。

## リリース運用

- フェーズ／バージョン完了ごとに `package.json` の version を上げ、`vsce package` で生成した VSIX を `releases/v{version}/` に配置、`releases/CHANGELOG.md` に変更点を追記する。
- Marketplace への公開は未設定（手動 VSIX 配布）。`publisher` は commit〜push まで担当する。

## 注意事項

- Webview バンドル（`dist/webview.js`）は CodeMirror を含むため約 0.5MB と大きいが正常。
- スコープは素の Markdown（CommonMark + GFM）の編集・プレビュー。Obsidian 独自機能（Wikilink/埋め込み/コールアウト/タグ/脚注/バックリンク等）は v1.5.0 で削除済み（再追加時は品質リスク＝ホスト側ワークスペース I/O を避ける方針）。
