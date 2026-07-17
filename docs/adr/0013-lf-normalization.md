---
name: lf-normalization
description: Webview（CodeMirror）側は常に LF で処理し、拡張ホストが EOL 変換の責務を持つ
metadata:
  type: project
---

# ADR-0013: Webview/CodeMirror 側での LF 正規化

- **ステータス**: 採択済み
- **確信度**: 高（src/core/sync.ts の toLF/fromLF/fromLFPreserving・src/livePreviewViewerManager.ts から明示的に確認）

## コンテキスト

Windows 環境では `TextDocument` が CRLF（`\r\n`）で保持されることがある。CodeMirror は改行を LF（`\n`）として扱うことを前提としており、CRLF を渡すと正規表現マッチや行インデックス計算にずれが生じる。

## 決定

- Webview（CodeMirror）には常に LF に正規化したテキストを渡す（`toLF(document.getText())`）
- 拡張ホストは `webviewText` を LF で保持し、Webview との比較は LF ドメインで行う。`TextDocument` へ適用する最小差分は行単位の EOL を復元した後に計算する
- Webview からの edit を `TextDocument` に戻す際は `fromLFPreserving(newLF, oldText, fallbackEol)` で旧文書の行番号ごとの EOL を復元する。対応する旧行がない新規行には `fallbackEol` を使用し、旧文書に末尾改行がなければ新文書の最終行にも付与しない
- 単一 EOL 文書では従来の `fromLF` と同じ結果とし、`fromLF` は既存互換のため維持する

```ts
const toLF = (text) => text.replace(/\r\n?/g, '\n');
const fromLF = (text, eol) => eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
const restored = fromLFPreserving(newLF, oldText, fallbackEol);
```

## 理由

- CodeMirror の行分割・オフセット計算は LF を前提として動作する
- `shouldResync` の比較を LF ドメインで行うことで、EOL のみ異なる変更が false resync を引き起こさない
- CRLF ファイルを LF で編集しても、保存時に元の CRLF に戻すことでファイルの EOL 形式を保持できる
- CRLF/LF 混在ファイルでも、編集していない行の EOL を行単位で保持し、表示目的の正規化を本文へ波及させない

## 捨てた選択肢

- **CRLF のまま渡す**: CodeMirror の行インデックス計算がずれる
- **常に LF で保存**: CRLF ファイルを編集したユーザーのファイルが LF に変わってしまう（意図しない変更）
## v1.25.2 final-EOL follow-up

`fromLFPreserving` retains existing per-line CRLF/LF choices. A requested
final LF is retained with the existing line EOL or `fallbackEol` when the old
document had no terminal newline.
