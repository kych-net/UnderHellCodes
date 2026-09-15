// parse.ts —— 解析 .typ 里的元素引用,产出带位置的 ElementRef。
// 正则与 element-core 同源(DEF_PATTERNS/SETTING_PATTERNS)。

import * as vscode from 'vscode'
import { DEF_PATTERNS } from './element-core'

export type RefKind = 'str' | 'content' | 'levelContent'

export interface ElementRef {
  id: string
  /** id 文本所在范围(引用/跳转/高亮用) */
  range: vscode.Range
  /** 整个调用(如 #元素[名])范围,右键选区用 */
  whole: vscode.Range
  kind: RefKind
  isDefinition: boolean
}

/** 定位捕获组 1(单行中文文本,捕组内不含换行)在以 offset 计的行/列。 */
function rangeForMatch(
  text: string,
  m: RegExpExecArray,
  groupStart: number,
  groupEnd: number,
): vscode.Range {
  const startLine = text.slice(0, m.index).split('\n').length - 1
  const lineStart = text.lastIndexOf('\n', m.index - 1) + 1
  const wholeStart = m.index
  const wholeEnd = wholeStart + m[0].length
  return new vscode.Range(
    new vscode.Position(startLine, m.index - lineStart),
    new vscode.Position(startLine, groupEnd - lineStart),
  )
}

function wholeRange(text: string, m: RegExpExecArray): vscode.Range {
  const startLine = text.slice(0, m.index).split('\n').length - 1
  const lineStart = text.lastIndexOf('\n', m.index - 1) + 1
  return new vscode.Range(
    new vscode.Position(startLine, m.index - lineStart),
    new vscode.Position(startLine, m.index + m[0].length - lineStart),
  )
}

/** 解析整份 .typ 文本,返回全部元素引用(保持文档顺序)。 */
export function parseTypText(text: string): ElementRef[] {
  const out: ElementRef[] = []
  for (const pat of DEF_PATTERNS) {
    let m: RegExpExecArray | null
    pat.lastIndex = 0
    while ((m = pat.exec(text))) {
      const id = (m[1] ?? '').trim()
      if (!id) continue
      const isDef = /#设定元素/.test(m[0])
      const kind: RefKind = isDef && /level\s*:/.test(m[0]) ? 'levelContent' : isDef ? 'content' : /^#元素\(/.test(m[0]) ? 'str' : 'content'
      const idStart = m.index + m[0].indexOf(m[1]!)
      const idEnd = idStart + m[1]!.length
      out.push({
        id,
        range: rangeForMatch(text, m, idStart, idEnd),
        whole: wholeRange(text, m),
        kind,
        isDefinition: isDef,
      })
    }
  }
  // 按文档出现顺序排序(不同 pattern 各自遍历会乱序)
  out.sort((a, b) => (a.whole.start.line - b.whole.start.line) || (a.whole.start.character - b.whole.start.character))
  return out
}

/** 返回光标位于其 whole 范围(或 range 内)的引用。 */
export function refAtPosition(refs: ElementRef[], pos: vscode.Position): ElementRef | undefined {
  for (const r of refs) {
    if (r.whole.contains(pos) || r.range.contains(pos)) return r
  }
  return undefined
}