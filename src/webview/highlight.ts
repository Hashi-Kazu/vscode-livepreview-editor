/**
 * Syntax highlighting for embedded fenced code blocks (R-34).
 *
 * This module lives in the Webview bundle (it imports CodeMirror language
 * packages). It provides:
 *   1. `codeLanguageFor` — a synchronous `info string → Language` resolver for
 *      `markdown({ codeLanguages })`. Returning a `Language` synchronously (never
 *      a dynamic `import()`) keeps the Webview a single esbuild bundle.
 *   2. `lpHighlightStyle` — a `HighlightStyle` mapping the Lezer highlight tags
 *      that embedded code produces onto VS Code `--vscode-symbolIcon-*` theme
 *      variables (fallbacks only, so colours follow the active theme, R-28-04).
 *
 * Only programming-language tags are styled here. Markdown prose tags (heading,
 * strong, emphasis, link, list/quote markers, …) are deliberately left
 * unmapped so the existing `.cm-lp-*` decoration styling continues to own the
 * prose look; in practice this scopes the colours to code-block contents.
 */
import { HighlightStyle } from '@codemirror/language';
import type { Language } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { java } from '@codemirror/lang-java';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { php } from '@codemirror/lang-php';

/**
 * Resolve a fenced code block's info string to a CodeMirror `Language` (or null
 * when unsupported). Called by `markdown({ codeLanguages })` for each block; the
 * returned `Language` is used to parse the block so its tokens can be coloured.
 */
export function codeLanguageFor(info: string): Language | null {
  const name = info.toLowerCase().trim().split(/\s+/)[0];
  switch (name) {
    case 'js':
    case 'javascript':
    case 'node':
      return javascript().language;
    case 'jsx':
      return javascript({ jsx: true }).language;
    case 'ts':
    case 'typescript':
      return javascript({ typescript: true }).language;
    case 'tsx':
      return javascript({ typescript: true, jsx: true }).language;
    case 'py':
    case 'python':
      return python().language;
    case 'html':
    case 'htm':
      return html().language;
    case 'css':
      return css().language;
    case 'json':
    case 'jsonc':
      return json().language;
    case 'c':
    case 'cpp':
    case 'c++':
    case 'h':
    case 'hpp':
      return cpp().language;
    case 'rust':
    case 'rs':
      return rust().language;
    case 'java':
      return java().language;
    case 'sql':
      return sql().language;
    case 'xml':
    case 'svg':
      return xml().language;
    case 'yaml':
    case 'yml':
      return yaml().language;
    case 'php':
      return php().language;
    default:
      return null;
  }
}

/**
 * Token colour theme for embedded code. All colours reference
 * `--vscode-symbolIcon-*` (or a close theme variable) with a fallback so they
 * track the active VS Code theme without hard-coded colours (R-28-04). Only
 * programming-language tags are listed, so Markdown prose is unaffected.
 */
export const lpHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword],
    color: 'var(--vscode-symbolIcon-keywordForeground, #569cd6)',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
    color: 'var(--vscode-symbolIcon-functionForeground, #dcdcaa)',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName],
    color: 'var(--vscode-symbolIcon-classForeground, #4ec9b0)',
  },
  {
    tag: [t.propertyName, t.attributeName, t.variableName],
    color: 'var(--vscode-symbolIcon-variableForeground, #9cdcfe)',
  },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom],
    color: 'var(--vscode-symbolIcon-numberForeground, #b5cea8)',
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character],
    color: 'var(--vscode-symbolIcon-stringForeground, #ce9178)',
  },
  {
    tag: [t.constant(t.variableName), t.standard(t.name)],
    color: 'var(--vscode-symbolIcon-constantForeground, #4fc1ff)',
  },
  {
    tag: [t.operator, t.derefOperator, t.escape],
    color: 'var(--vscode-symbolIcon-operatorForeground, #d4d4d4)',
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--vscode-descriptionForeground, #6a9955)',
    fontStyle: 'italic',
  },
  { tag: t.invalid, color: 'var(--vscode-errorForeground, #f44747)' },
]);
