// diagnostics.ts —— 元素诊断:#设定元素 重复定义、未被 CSV 收录。
// 孤儿(csv 有而文档无)无文档位置可标注,由 清理 命令报告。

import * as vscode from 'vscode'
import type { AppContext } from './context'

const coll = vscode.languages.createDiagnosticCollection('underhell-elements')

/** 全局 #设定元素 定义计数(用于检出重复定义)。 */
function definitionCounts(app: AppContext): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { refs } of app.index.entries()) {
    for (const r of refs) {
      if (r.isDefinition) counts.set(r.id, (counts.get(r.id) ?? 0) + 1)
    }
  }
  return counts
}

/** 诊断指定 .typ 文档。 */
export function refreshDocument(app: AppContext, uri: vscode.Uri): void {
  const refs = app.index.get(uri)
  if (!refs) { coll.delete(uri); return }
  const ds: vscode.Diagnostic[] = []
  const counts = definitionCounts(app)
  const data = app.repoRoot ? app.csv.getOrLoad(app.repoRoot) : undefined
  for (const r of refs) {
    if (r.isDefinition && (counts.get(r.id) ?? 0) > 1) {
      const d = new vscode.Diagnostic(
        r.range,
        `元素「${r.id}」被重复定义 ${counts.get(r.id)} 次`,
        vscode.DiagnosticSeverity.Warning,
      )
      d.source = 'underhell-elements'
      ds.push(d)
    }
    if (data && !data.rows.has(r.id)) {
      const d = new vscode.Diagnostic(
        r.range,
        `元素「${r.id}」未收录于 元素系统.csv`,
        vscode.DiagnosticSeverity.Warning,
      )
      d.source = 'underhell-elements'
      ds.push(d)
    }
  }
  coll.set(uri, ds)
}

/** 刷新所有已打开的 .typ 文档。 */
export function refreshAllDocs(app: AppContext): void {
  for (const d of vscode.workspace.textDocuments) {
    if (d.uri.scheme === 'file' && d.fileName.endsWith('.typ')) {
      refreshDocument(app, d.uri)
    }
  }
}