// commands.ts —— 菜单/命令:扫描、补全、清理、排序、改名、刷新。
// 复用 element-core(与 元素工具.py 等价),直接操作 CSV 与 .typ。

import * as path from 'path'
import * as vscode from 'vscode'
import type { AppContext } from './context'
import * as core from './element-core'

export interface CommandHooks {
  /** 全量重建文档索引(改名后文本已变)。 */
  buildIndex: () => Promise<void>
}

function requireRepo(app: AppContext): string {
  if (!app.repoRoot) {
    throw new Error('未定位仓库根(含 文档/ 的目录)。可设置 underhell.elements.repoRoot。')
  }
  return app.repoRoot
}

function opts(app: AppContext): core.CoreOpts {
  return { repoRoot: requireRepo(app) }
}

export function registerCommands(app: AppContext, hooks: CommandHooks): void {
  const { ctrl } = app

  ctrl.subscriptions.push(vscode.commands.registerCommand('underhell.elements.scan', async () => {
    const o = opts(app)
    try {
      const r = core.scan(o)
      const lines: string[] = [
        `扫描 ${r.files} 个 .typ,共 ${r.ids.length} 个元素`,
        `缺失(${r.missing.length}):${r.missing.join('、') || '无'}`,
        `重复定义(${r.dup.length}):${r.dup.map(d => `${d.id}×${d.count}`).join('、') || '无'}`,
      ]
      if (r.missing.length) {
        const pick = await vscode.window.showQuickPick(
          r.missing.map(id => ({ label: id, description: '缺失，回车补全到 CSV' })),
          { placeHolder: '缺失元素（选择回车即可补全）', canPickMany: true },
        )
        if (pick) {
          // 由 补全 命令统一追加全部缺失
          void vscode.commands.executeCommand('underhell.elements.complement')
        }
      }
      vscode.window.showInformationMessage(lines.join('\n'))
    } catch (e) {
      showErr(e as Error)
    }
  }))

  ctrl.subscriptions.push(vscode.commands.registerCommand('underhell.elements.complement', async () => {
    try {
      const added = core.complement(opts(app))
      app.csv.invalidate()
      await refreshAll()
      vscode.window.showInformationMessage(
        added.length ? `已补全 ${added.length} 个缺失元素：${added.join('、')}` : '无缺失元素需要补全',
      )
    } catch (e) { showErr(e as Error) }
  }))

  ctrl.subscriptions.push(vscode.commands.registerCommand('underhell.elements.cleanup', async () => {
    try {
      const removed = core.cleanup(opts(app))
      app.csv.invalidate()
      await refreshAll()
      vscode.window.showInformationMessage(
        removed.length ? `已清理 ${removed.length} 个孤儿元素：${removed.join('、')}` : 'CSV 无孤儿元素',
      )
    } catch (e) { showErr(e as Error) }
  }))

  ctrl.subscriptions.push(vscode.commands.registerCommand('underhell.elements.sort', async () => {
    try {
      const r = core.sort(opts(app))
      app.csv.invalidate()
      await refreshAll()
      vscode.window.showInformationMessage(`CSV 已按文档定义顺序排序（已定义 ${r.defined}，未定义 ${r.undefined_}）`)
    } catch (e) { showErr(e as Error) }
  }))

  ctrl.subscriptions.push(vscode.commands.registerCommand('underhell.elements.rename', async () => {
    const editor = vscode.window.activeTextEditor
    try {
      const o = opts(app)
      const defaultOld = currentIdAt(app, editor)
      const oldId = await vscode.window.showInputBox({
        prompt: '要重命名的元素 id',
        value: defaultOld ?? '',
        placeHolder: '旧元素 id',
      })
      if (oldId === undefined || oldId.trim() === '') return
      const newId = await vscode.window.showInputBox({
        prompt: '新元素 id',
        value: oldId.trim(),
        placeHolder: '新元素 id（不可与旧相同）',
      })
      if (newId === undefined || newId.trim() === '' || newId.trim() === oldId.trim()) return
      const r = core.rename(o, oldId.trim(), newId.trim())
      await refreshAll()
      vscode.window.showInformationMessage(
        `重命名「${oldId.trim()}」→「${newId.trim()}」：文档替换 ${r.srcRepl} 处，CSV 名词单元格 ${r.csvCells} 处`,
      )
    } catch (e) { showErr(e as Error) }
  }))

  ctrl.subscriptions.push(vscode.commands.registerCommand('underhell.elements.refresh', async () => {
    try {
      await refreshAll()
      vscode.window.showInformationMessage('元素缓存已刷新')
    } catch (e) { showErr(e as Error) }
  }))

  async function refreshAll(): Promise<void> {
    app.csv.invalidate()
    await hooks.buildIndex()
  }
}

/** 取光标处元素 id,作重命名默认值。 */
function currentIdAt(app: AppContext, editor: vscode.TextEditor | undefined): string | undefined {
  if (!editor) return undefined
  const refs = app.index.get(editor.document.uri)
  if (!refs) return undefined
  for (const r of refs) {
    if (r.whole.contains(editor.selection.active) || r.range.contains(editor.selection.active)) {
      return r.id
    }
  }
  return undefined
}

function showErr(e: Error): void {
  void vscode.window.showErrorMessage(`元素工具：${e.message}`)
}