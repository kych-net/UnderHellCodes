// extension.ts —— 插件入口:装配上下文、文档索引、缓存、watcher 与功能注册。

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { ElementIndex, AppContext } from './context'
import { CsvCache, findRepoRoot } from './csv'
import { parseTypText } from './parse'
import { registerHover, registerDefinition, registerSemanticTokens } from './providers'
import { registerCommands } from './commands'
import { refreshAllDocs } from './diagnostics'
import { ElementWebviewProvider } from './elementView'

const ELEMENT_VIEW_ID = 'underhellElementExplorer.view'

/** 递归收集目录下全部 .typ 文件(按路径排序)。 */
function collectTypFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of ents) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.typ')) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

export function activate(context: vscode.ExtensionContext): void {
  const csv = new CsvCache()
  const index = new ElementIndex()
  const app: AppContext = {
    ctrl: context,
    repoRoot: findRepoRoot(vscode.workspace.workspaceFolders?.[0]),
    csv,
    index,
  }

  // 解析单文档并入索引(优先用内存文档文本,避免读盘不一致)。
  const indexDoc = (uri: vscode.Uri): void => {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
    const text = doc ? doc.getText() : fs.readFileSync(uri.fsPath, 'utf-8')
    index.set(uri, parseTypText(text))
  }

  // 元素管理视图(先于 buildIndex 创建,便于其完成后刷新)。
  const elementView = new ElementWebviewProvider(app)
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ELEMENT_VIEW_ID, elementView))

  // 全量重建索引:扫描仓库 文档/ 下全部 .typ(不依赖 workspace 范围)。
  // 单文件解析失败跳过,不中断整体。
  const buildIndex = async (): Promise<void> => {
    index.clear()
    const docDir = app.repoRoot ? path.join(app.repoRoot, '文档') : undefined
    const files = docDir ? collectTypFiles(docDir) : []
    for (const f of files) {
      try { indexDoc(vscode.Uri.file(f)) } catch { /* 跳过坏文件 */ }
    }
    refreshAllDocs(app)
    elementView.refresh()
  }
  elementView.refreshAll = buildIndex

  // .typ 文件变更 -> 增量索引(仅监听仓库 文档/ 目录)。
  const typPattern = app.repoRoot
    ? new vscode.RelativePattern(path.join(app.repoRoot, '文档'), '**/*.typ')
    : '**/*.typ'
  const typWatcher = vscode.workspace.createFileSystemWatcher(typPattern)
  typWatcher.onDidCreate(uri => { indexDoc(uri); refreshAllDocs(app) })
  typWatcher.onDidChange(uri => { indexDoc(uri); refreshAllDocs(app) })
  typWatcher.onDidDelete(uri => { index.delete(uri); refreshAllDocs(app) })
  context.subscriptions.push(typWatcher)

  // 元素系统.csv 变更 -> 失效缓存并刷新诊断与视图。
  const csvWatcher = vscode.workspace.createFileSystemWatcher('**/元素系统.csv')
  csvWatcher.onDidChange(() => { csv.invalidate(); refreshAllDocs(app); elementView.refresh() })
  csvWatcher.onDidDelete(() => { csv.invalidate(); refreshAllDocs(app); elementView.refresh() })
  csvWatcher.onDidCreate(() => { csv.invalidate(); refreshAllDocs(app); elementView.refresh() })
  context.subscriptions.push(csvWatcher)

  registerHover(app)
  registerDefinition(app)
  registerSemanticTokens(app)
  registerCommands(app, { buildIndex })

  void buildIndex()
}

export function deactivate(): void {
  /* 无全局资源需显式释放;订阅均已推入 context。 */
}