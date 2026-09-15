// context.ts —— 插件共享状态与文档解析索引。

import * as vscode from 'vscode'
import type { CsvCache } from './csv'
import type { ElementRef } from './parse'

/** .typ 元素引用索引:uri -> ElementRef[] */
export class ElementIndex {
  private map = new Map<string, ElementRef[]>()

  get(uri: vscode.Uri): ElementRef[] | undefined {
    return this.map.get(uri.toString())
  }
  set(uri: vscode.Uri, refs: ElementRef[]): void {
    this.map.set(uri.toString(), refs)
  }
  delete(uri: vscode.Uri): void {
    this.map.delete(uri.toString())
  }
  /** 遍历所有已索引文档。 */
  entries(): Array<{ uri: vscode.Uri; refs: ElementRef[] }> {
    const out: Array<{ uri: vscode.Uri; refs: ElementRef[] }> = []
    for (const [s, refs] of this.map) out.push({ uri: vscode.Uri.parse(s), refs })
    return out
  }
  clear(): void {
    this.map.clear()
  }
}

export interface AppContext {
  ctrl: vscode.ExtensionContext
  repoRoot?: string
  csv: CsvCache
  index: ElementIndex
}