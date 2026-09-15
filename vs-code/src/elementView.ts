// elementView.ts —— 活动栏「元素管理」Webview 表格视图。
// 只读浏览全部元素 + 编辑系统名词单元格(写回 CSV) + 一键维护命令。

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import type { AppContext } from './context'
import * as core from './element-core'

export interface ElemRow {
  id: string
  /** 全局 #设定元素 定义次数 */
  defs: number
  /** 是否在文档中被引用过(引用或定义) */
  referenced: boolean
  /** 各系统名词:system -> term(可能为空串表示回退 id) */
  terms: Array<{ col: string; value: string }>
}

export interface Snapshot {
  headers: string[]
  rows: ElemRow[]
  repoRoot?: string
}

function buildSnapshot(app: AppContext): Snapshot {
  const data = app.repoRoot ? app.csv.getOrLoad(app.repoRoot) : undefined
  // 引用/定义统计
  const defCount = new Map<string, number>()
  const referenced = new Set<string>()
  for (const { refs } of app.index.entries()) {
    for (const r of refs) {
      referenced.add(r.id)
      if (r.isDefinition) defCount.set(r.id, (defCount.get(r.id) ?? 0) + 1)
    }
  }
  const headers = data ? data.headers : ['id', '默认']
  const rows: ElemRow[] = []
  if (data) {
    for (const [id, entry] of data.rows) {
      rows.push({
        id,
        defs: defCount.get(id) ?? 0,
        referenced: referenced.has(id),
        terms: headers.slice(1).map(h => ({ col: h, value: entry.terms[h] ?? '' })),
      })
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'))
  return { headers, rows, repoRoot: app.repoRoot }
}

// 写回单格名词:按 id 定位 CSV 行,替换 system 列并保存。
function saveCell(app: AppContext, id: string, col: string, value: string): void {
  if (!app.repoRoot) throw new Error('未定位仓库根')
  if (/[,\r\n]/.test(value)) throw new Error('名词不能包含逗号或换行')
  const p = path.join(app.repoRoot, '文档', '元素系统.csv')
  let text = fs.readFileSync(p, 'utf-8')
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const header = lines[0].split(',')
  const cIdx = header.indexOf(col)
  if (cIdx < 0) throw new Error(`表头无列「${col}」`)
  let hit = false
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    const cells = lines[i].split(',')
    if (cells[0].trim() === id) {
      while (cells.length <= cIdx) cells.push('')
      cells[cIdx] = value
      lines[i] = cells.join(',')
      hit = true
      break
    }
  }
  if (!hit) throw new Error(`CSV 无元素「${id}」`)
  fs.writeFileSync(p, lines.join(nl), 'utf-8')
  app.csv.invalidate()
}

export class ElementWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  /** 外部注入:重建文档索引(改名后正文已变)。 */
  refreshAll?: () => Promise<void>

  constructor(private app: AppContext) {}

  resolveWebviewView(wv: vscode.WebviewView): void {
    this.view = wv
    wv.webview.options = { enableScripts: true }
    wv.webview.onDidReceiveMessage(msg => {
      try {
        this.handle(msg)
      } catch (e) {
        void vscode.window.showErrorMessage(`元素管理：${(e as Error).message}`)
      }
    })
    this.refresh()
  }

  /** 外部(csv 变化/命令后)刷新。 */
  refresh(): void {
    if (this.view) this.render()
  }

  private snapshot(): Snapshot {
    return buildSnapshot(this.app)
  }

  private render(): void {
    if (!this.view) return
    this.view.webview.html = html(this.snapshot())
  }

  private handle(msg: { type?: string } & Record<string, unknown>): void {
    switch (msg.type) {
      case 'save': {
        saveCell(this.app, String(msg.id), String(msg.col), String(msg.value))
        this.render()
        break
      }
      case 'rename': {
        if (!this.app.repoRoot) throw new Error('未定位仓库根')
        const oldId = String(msg.oldId)
        const newId = String(msg.newId)
        if (oldId && newId && oldId !== newId) {
          core.rename({ repoRoot: this.app.repoRoot }, oldId, newId)
          this.app.csv.invalidate()
          void (this.refreshAll ? this.refreshAll() : Promise.resolve()).then(() => this.render())
        }
        break
      }
      case 'cmd': {
        const name = String(msg.cmd)
        void (async () => {
          try {
            await vscode.commands.executeCommand(`underhell.elements.${name}`)
          } catch (e) {
            void vscode.window.showErrorMessage(`元素管理：${(e as Error).message}`)
          }
          this.render()
        })()
        break
      }
      default:
        break
    }
  }
}

// 属性值注入须转义,防止引号截断与 </script> 提前闭合。
const escAttr = (s: unknown): string =>
  JSON.stringify(s).replace(/</g, '\\u003c')
// 文本内容注入须转义 HTML(不得用 JSON.stringify,否则内容会带双引号)。
const escText = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function html(s: Snapshot): string {
  const thead = ['元素', ...s.headers.slice(1), '状态']
    .map(h => `<th>${h}</th>`)
    .join('')

  const tbody = s.rows
    .map(row => {
      const cells = row.terms
        .map(t => `<td class="ed" contenteditable spellcheck="false" data-id="${escAttr(row.id)}" data-col="${escAttr(t.col)}">${escText(t.value || row.id)}</td>`)
        .join('')
      let badge = ''
      if (!row.referenced) badge = '<span class="badge orphan">孤儿</span>'
      else if (row.defs === 0) badge = '<span class="badge nodef">未定义</span>'
      else if (row.defs > 1) badge = `<span class="badge dup">重复×${row.defs}</span>`
      else badge = '<span class="badge ok"></span>'
      return `<tr><td class="id" contenteditable spellcheck="false" data-id="${escAttr(row.id)}">${escText(row.id)}</td>${cells}<td>${badge}</td></tr>`
    })
    .join('')

  const repoRootNote = s.repoRoot
    ? ''
    : '<p class="warn">未定位到仓库根（找不到含 文档/ 的目录）。可设置 underhell.elements.repoRoot。</p>'

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { --gap: 8px; }
  body { margin: 0; padding: 8px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none;
           padding: 3px 8px; cursor: pointer; border-radius: 2px; font-size: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .warn { color: var(--vscode-errorForeground); }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; text-align: left; white-space: nowrap; }
  th { position: sticky; top: 0; background: var(--vscode-editor-background); }
  td.id { font-weight: 600; }
  td.ed[contenteditable] { min-width: 3em; }
  td.ed:focus { outline: 1px solid var(--vscode-focusBorder); }
  .badge { font-size: 10px; padding: 0 5px; border-radius: 8px; }
  .orphan { background: var(--vscode-inputValidation-warningBackground); }
  .nodef { background: var(--vscode-inputValidation-infoBackground); }
  .dup { background: var(--vscode-inputValidation-errorBackground); }
</style>
</head>
<body>
  ${repoRootNote}
  <div class="toolbar">
    <button data-cmd="complement">补全缺失</button>
    <button data-cmd="cleanup">清理孤儿</button>
    <button data-cmd="sort">按文档排序</button>
    <button data-cmd="refresh">刷新</button>
  </div>
  <table>
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table>
<script>
  (function () {
    var vsc = acquireVsCodeApi();
    document.querySelectorAll('button[data-cmd]').forEach(function (b) {
      b.addEventListener('click', function () {
        vsc.postMessage({ type: 'cmd', cmd: b.getAttribute('data-cmd') });
      });
    });
    document.querySelectorAll('td.id').forEach(function (td) {
      td.addEventListener('blur', function () {
        var oldId = td.getAttribute('data-id');
        var newId = td.textContent;
        if (newId === '' || newId === oldId) { td.textContent = oldId; return; }
        vsc.postMessage({ type: 'rename', oldId: oldId, newId: newId });
      });
    });
    document.querySelectorAll('td.ed').forEach(function (td) {
      td.addEventListener('blur', function () {
        var id = td.getAttribute('data-id');
        var col = td.getAttribute('data-col');
        var val = td.textContent;
        if (val === '' || val === td.getAttribute('data-orig')) return;
        vsc.postMessage({ type: 'save', id: id, col: col, value: val });
      });
      td.addEventListener('focus', function () { td.setAttribute('data-orig', td.textContent); });
    });
  })();
</script>
</body>
</html>`
}