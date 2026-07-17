---
name: ime-composition-suppression
description: IME 変換中（composing）はホストへの edit postMessage を抑制し、確定後にまとめて送信
metadata:
  type: project
---

# ADR-0008: IME 変換中の edit 送信抑制

- **ステータス**: 採択済み
- **確信度**: 高（src/core/sync.ts の shouldEmitEdit・コードコメントから明示的に確認）

## コンテキスト

日本語・CJK などを IME で入力する際、CodeMirror は変換途中の未確定文字列を一時的にドキュメントに挿入する。この段階で `TextDocument` へ edit を送ると:
1. 未確定文字列が保存済みファイルに書き込まれ、次の変換候補選択時に二重入力が起きる
2. 装飾が未確定文字列に反応してちらつく
3. ホスト→Webview の update メッセージが帰ってきてカーソルが飛ぶ

## 決定

`shouldEmitEdit({ docChanged, composing, applyingRemote })` が `composing === true` のとき `false` を返すことで、IME 変換中は edit を postMessage しない。確定後は `ViewUpdate` の非 composing 判定に加え、`compositionend` の後にマイクロタスクを登録して CodeMirror 自身のイベント処理後の最終 state を読む。保留変更があれば同一の冪等な flush 関数で全文を一度だけ送信し、その ack 版数で保留 remote を再検証する。

```ts
export function shouldEmitEdit({ docChanged, composing, applyingRemote }): boolean {
  if (!docChanged) return false;
  if (applyingRemote) return false;
  if (composing) return false;
  return true;
}
```

また `applyingRemote` フラグにより、ホストから受信した update 適用中に edit を送り返す「エコー」も防止する。

## 理由

- IME 変換中に edit を送信すると、未確定文字列がホストを通じてファイルに書き込まれてしまう（日本語ユーザー向け拡張として致命的なバグになる）
- `applyingRemote` の抑制がないとホスト→Webview→ホスト→... のエコーループが発生し、カーソルが飛び続ける

## 捨てた選択肢

- **常に emit する**: IME ユーザーの入力が壊れる（バグ）
- **ViewUpdate だけで確定を判定する**: IME 確定だけでは次の `ViewUpdate` が発生しない実装があり、次キー・失焦まで TextDocument へ反映されない
