// providers.ts —— Hover / Definition / SemanticTokens。

import * as vscode from 'vscode'
import { refAtPosition } from './parse'
import type { AppContext } from './context'

const defKind = new vscode.SemanticTokensLegend(['element.id'])

export function registerHover(app: AppContext): void {
  app.ctrl.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file', pattern: '**/*.typ' },
      {
        provideHover(doc, pos) {
          const refs = app.index.get(doc.uri)
          if (!refs) return undefined
          const ref = refAtPosition(refs, pos)
          if (!ref) return undefined
          if (!app.repoRoot) {
            return new vscode.Hover(
              new vscode.MarkdownString(`元素：**${ref.id}**\n\n未定位到仓库根，无法读取元素系统。`),
            )
          }
          const data = app.csv.get(app.repoRoot)
          const entry = data?.rows.get(ref.id)
          const md = new vscode.MarkdownString()
          md.appendCodeblock(ref.id, 'text')
          if (data) {
            if (entry) {
              const lines: string[] = []
              for (const h of data.headers.slice(1)) {
                const t = entry.terms[h]
                if (t && t !== ref.id) lines.push(`- **${h}**：\`${t}\``)
              }
              if (lines.length) md.appendMarkdown(lines.join('\n'))
              else md.appendMarkdown('\n（无其他系统名词，均回退到 id）')
            } else {
              md.appendMarkdown(`\n<font color="#c00">⚠ 未收录于元素系统.csv</font>`)
            }
            // 定义提示
            const defs = [...(app.index.entries() ?? [])]
              .flatMap(e => e.refs.filter(r => r.id === ref.id && r.isDefinition))
            if (ref.isDefinition && defs.length > 1) {
              md.appendMarkdown(`\n> 此元素被 ${defs.length} 次定义（重复定义）`)
            }
            if (!ref.isDefinition && defs.length === 0) {
              md.appendMarkdown(`\n> 无定义（#设定元素 不存在，将回退 id）`)
            }
          }
          return new vscode.Hover(md, ref.whole)
        },
      },
    ),
  )
}

export function registerDefinition(app: AppContext): void {
  app.ctrl.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { scheme: 'file', pattern: '**/*.typ' },
      {
        provideDefinition(doc, pos) {
          const refs = app.index.get(doc.uri)
          if (!refs) return undefined
          const ref = refAtPosition(refs, pos)
          if (!ref) return undefined
          // 自身是定义 -> 跳自己;否则跳到最近同 id 的 #设定元素
          if (ref.isDefinition) {
            return new vscode.Location(doc.uri, ref.whole)
          }
          const best: Array<{ uri: vscode.Uri; range: vscode.Range; line: number }> = []
          for (const { uri, refs: r2 } of app.index.entries()) {
            for (const r of r2) {
              if (r.id === ref.id && r.isDefinition) {
                best.push({ uri, range: r.whole, line: r.whole.start.line })
              }
            }
          }
          if (best.length === 0) return undefined
          best.sort((a, b) => Math.abs(a.line - pos.line) - Math.abs(b.line - pos.line))
          return new vscode.Location(best[0].uri, best[0].range)
        },
      },
    ),
  )
}

export function registerSemanticTokens(app: AppContext): void {
  const provider: vscode.DocumentSemanticTokensProvider = {
    provideDocumentSemanticTokens(doc) {
      const refs = app.index.get(doc.uri)
      const tokens = new vscode.SemanticTokensBuilder(new vscode.SemanticTokensLegend(['element.id']))
      if (refs) {
        for (const r of refs) {
          tokens.push(r.range.start.line, r.range.start.character, r.range.end.character - r.range.start.character, 0)
        }
      }
      return tokens.build()
    },
  }
  app.ctrl.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { scheme: 'file', pattern: '**/*.typ' },
      provider,
      defKind,
    ),
  )
}