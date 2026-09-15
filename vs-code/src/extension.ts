// extension.ts —— 插件入口:装配上下文、文档索引、缓存、watcher 与功能注册。

import * as fs from 'fs'
import * as vscode from 'vscode'
import { ElementIndex, AppContext } from './context'
import { CsvCache, findRepoRoot } from './csv'
import { parseTypText } from './parse'
import { registerHover, registerDefinition, registerSemanticTokens } from './providers'
import { registerCommands } from './commands'
import { refreshAllDocs } from './diagnostics'
import { ElementWebviewProvider } from './elementView'

const ELEMENT_VIEW_ID = 'underhellElementExplorer.view'

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

  // 全量重建索引:清空 -> 扫描所有 .typ -> 刷新已打开文档的诊断。
  const buildIndex = async (): Promise<void> => {
    index.clear()
    const files = await vscode.workspace.findFiles('**/*.typ')
    for (const uri of files) indexDoc(uri)
    refreshAllDocs(app)
  }

  // .typ 文件变更 -> 增量索引。
  const typWatcher = vscode.workspace.createFileSystemWatcher('**/*.typ')
  typWatcher.onDidCreate(uri => { indexDoc(uri); refreshAllDocs(app) })
  typWatcher.onDidChange(uri => { indexDoc(uri); refreshAllDocs(app) })
  typWatcher.onDidDelete(uri => { index.delete(uri); refreshAllDocs(app) })
  context.subscriptions.push(typWatcher)

  // 元素系统.csv 变更 -> 失效缓存并刷新诊断。
  const elementView = new ElementWebviewProvider(app)
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ELEMENT_VIEW_ID, elementView))
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