# Live Preview Editor 受け入れテスト

**関連文書**: [requirements-usdm.md](requirements-usdm.md)

> ⛔ **開発凍結（2026-06-21）**: 本拡張は v1.6.0 をもって開発を凍結する。

テストは Vitest（`npm test`）で実行する。対象は `src/core` の純粋ロジック。各テストは仕様 ID（RXX-YY）と対応付ける。

## テストファイルと対応仕様

| テストファイル | 対応仕様 |
|---|---|
| `test/phase1.decorations.test.ts` | R-01（太字・見出し・リスト・カーソル連動） |
| `test/phase2.syntax.test.ts` | R-02（斜体・コード・リンク・画像・引用・コードブロック・表）、R-01-02（モデル純粋性：入力不変・決定性） |
| `test/phase2.sync.test.ts` | R-04（diffRange・shouldResync・cursorLines） |
| `test/phase3.edge.test.ts` | R-05-01/02/04（ネスト・誤装飾防止・フォールバック） |
| `test/phase3.behavior.test.ts` | R-04-01（Undo round-trip）・R-05-03/05（IME・性能）・R-06-02（fontSize 設定） |
| `test/feature.task.test.ts` | R-08（GFM タスク検知・完了スタイル・カーソル行・ネスト・トグル・CRLF・EOL） |
| `test/feature.richtext.test.ts` | R-09（取消線・ハイライト） |
| `test/robustness.combinations.test.ts` | R-01-06（語中アンダースコア）・R-05-06（CRLF）・記法組み合わせ・構造不変条件（オフセット境界・replace 非重複） |
| `test/feature.format.test.ts` | R-16（toggleWrap：囲む・解除・空選択・往復） |
| `test/feature.markdown.test.ts` | R-19（水平線）・R-20（エスケープ）・R-21（オートリンク）・R-22（表のレンダリング/parseTable） |
| `test/feature.editing.test.ts` | R-23（リスト継続）・R-24（インデント）・R-25（見出しトグル） |

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
  - R-03-01〜04（Live↔標準エディタの同一タブ切り替え、リンク先 `.md` の Live 別タブ起動、テキスト不変）
  - R-27-01〜03（見出しブロック折りたたみ、初期全閉、`▸`/`▾` ガター開閉）
  - R-28-01〜03（左余白、キャレット視認、チェックボックスの確実なトグル）
