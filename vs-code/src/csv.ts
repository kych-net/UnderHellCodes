// csv.ts —— CSV 数据模型、加载缓存与仓库根探测。
// / CSV data model, cache and repo-root detection.

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { parseCsvText } from './element-core'

/** 单个元素条目:id -> 各系统名词(系统名 -> 名词)。 */
export interface ElementEntry {
  id: string
  /** 名词:system -> term(空串表示未定义,回退到 id) */
  terms: Record<string, string>
  /** 原始单元格数组(含 id 列) */
  raw: string[]
}

export interface CsvData {
  headers: string[]
  rows: Map<string, ElementEntry>
  uri: vscode.Uri
  mtime: number
}

/**
 * 从工作区定位仓库根:取第一个 workspaceFolder,逐级上溯到其含 文档/ 的祖先。
 * 找不到返回 undefined。
 */
export function findRepoRoot(workspaceFolder?: vscode.WorkspaceFolder): string | undefined {
  const opt = vscode.workspace
    .getConfiguration('underhell.elements')
    .get<string>('repoRoot', '')
  if (opt) return path.resolve(opt)
  if (!workspaceFolder) return undefined
  let dir = workspaceFolder.uri.fsPath
  while (true) {
    if (fs.existsSync(path.join(dir, '文档'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export function csvUri(repoRoot: string): vscode.Uri {
  return vscode.Uri.file(path.join(repoRoot, '文档', '元素系统.csv'))
}

/** 把 CSV 文本解析为 CsvData(复用 element-core.parseCsvText)。 */
export function parseCsvFile(uri: vscode.Uri): CsvData {
  const text = fs.readFileSync(uri.fsPath, 'utf-8')
  const stat = fs.statSync(uri.fsPath)
  const { header, rows } = parseCsvText(text)
  const map = new Map<string, ElementEntry>()
  for (const r of rows) {
    const id = r[0].trim()
    const terms: Record<string, string> = {}
    for (let j = 1; j < header.length && j < r.length; j++) {
      terms[header[j]] = r[j].trim()
    }
    map.set(id, { id, terms, raw: r })
  }
  return { headers: header, rows: map, uri, mtime: stat.mtimeMs }
}

/** 简易缓存:repoRoot -> CsvData;URI 匹配失效。 */
export class CsvCache {
  private cache = new Map<string, CsvData>()

  get(repoRoot: string): CsvData | undefined {
    return this.cache.get(repoRoot)
  }

  /** 返回当前数据;缺失或过期则加载。 */
  load(repoRoot: string): CsvData {
    const uri = csvUri(repoRoot)
    let d = this.cache.get(repoRoot)
    if (d && d.uri.toString() === uri.toString()) return d
    d = parseCsvFile(uri)
    this.cache.set(repoRoot, d)
    return d
  }

  invalidate(uri?: vscode.Uri): void {
    if (!uri) { this.cache.clear(); return }
    for (const [k, d] of this.cache) {
      if (d.uri.toString() === uri.toString()) this.cache.delete(k)
    }
  }
}