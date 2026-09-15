// element-core.ts —— 用 TypeScript 重写 元素工具.py 的全部能力。
// 单一事实来源:插件内直接 import 调用,不依赖 Python 子进程。
// / TypeScript rewrite of 元素工具.py. Single source of truth imported
// directly by the extension (no Python subprocess).

import * as fs from 'fs'
import * as path from 'path'

export interface CoreOpts {
  /** 仓库根(含 文档/ 的目录) */
  repoRoot: string
  /** 文档目录,缺省 <repoRoot>/文档 */
  dir?: string
  /** CSV 路径,缺省 <repoRoot>/文档/元素系统.csv */
  csv?: string
}

function docDir(opts: CoreOpts): string {
  return opts.dir ?? path.join(opts.repoRoot, '文档')
}
function csvPath(opts: CoreOpts): string {
  return opts.csv ?? path.join(opts.repoRoot, '文档', '元素系统.csv')
}

// 元素 id 提取模式。对应 元素工具.py 的 PATTERNS / SETTING_PATTERNS。
// 捕获组 1 即概念 id。正则均支持 /u 语义(此处 id 通常为中文,JS RegExp 默认按 UTF-16,
// 中文 BMP 内单码元,足够)。
//
// 关键:捕获 id 的字符类必须是「不含空白起止」的紧凑词(ID),这样外层相邻的 \s*
// 与 id 字符集不相交,避免 ('[^\]]+' vs '\s*') 之间发生灾难性回溯。
const ID = '[^\\]\\s]+(?:[ \\t]+[^\\]\\s]+)*'

export const DEF_PATTERNS: RegExp[] = [
  /#元素\(\s*"([^"]+)"\s*\)/g,
  new RegExp(`#元素\\[\\s*(${ID})\\s*\\]`, 'g'),
  /#设定元素\(\s*"([^"]+)"\s*\)/g,
  new RegExp(`#设定元素\\[\\s*(${ID})\\s*\\]`, 'g'),
  new RegExp(`#设定元素\\([^)]*level\\s*:\\s*\\d+[^)]*\\)\\[\\s*(${ID})\\s*\\]`, 'g'),
]

export const SETTING_PATTERNS: RegExp[] = [
  /#设定元素\(\s*"([^"]+)"\s*\)/g,
  new RegExp(`#设定元素\\[\\s*(${ID})\\s*\\]`, 'g'),
  new RegExp(`#设定元素\\([^)]*level\\s*:\\s*\\d+[^)]*\\)\\[\\s*(${ID})\\s*\\]`, 'g'),
]

/** 收集要扫描的 .typ 源文件(默认 文档/ 下全部,含子目录)。 */
export function collectSourceFiles(opts: CoreOpts): string[] {
  const base = docDir(opts)
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error(`文档目录不存在: ${base}`)
  }
  const out: string[] = []
  walk(base, out)
  if (out.length === 0) {
    throw new Error(`未在 ${base} 下找到任何 .typ 文件`)
  }
  return out.sort()
}

function walk(dir: string, acc: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(p, acc)
    } else if (e.name.endsWith('.typ')) {
      acc.push(p)
    }
  }
}

export function scanText(text: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const pat of DEF_PATTERNS) {
    let m: RegExpExecArray | null
    pat.lastIndex = 0
    while ((m = pat.exec(text))) {
      const id = m[1].trim()
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
  }
  return ids
}

/** 仅统计 #设定元素 定义,得按源偏移排序的 id(去重),对应 scan_ordered_ids。 */
export function scanOrderedIds(opts: CoreOpts): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const f of collectSourceFiles(opts)) {
    const text = readUtf8(f)
    const hits: Array<{ start: number; id: string }> = []
    for (const pat of SETTING_PATTERNS) {
      let m: RegExpExecArray | null
      pat.lastIndex = 0
      while ((m = pat.exec(text))) {
        const id = m[1].trim()
        if (id) { hits.push({ start: m.index, id }) }
      }
    }
    hits.sort((a, b) => a.start - b.start)
    for (const h of hits) {
      if (!seen.has(h.id)) { seen.add(h.id); order.push(h.id) }
    }
  }
  return order
}

/** #设定元素 计数;>1 表示重复定义。 */
export function scanSettingCounts(opts: CoreOpts): Map<string, number> {
  const counts = new Map<string, number>()
  for (const f of collectSourceFiles(opts)) {
    const text = readUtf8(f)
    for (const pat of SETTING_PATTERNS) {
      let m: RegExpExecArray | null
      pat.lastIndex = 0
      while ((m = pat.exec(text))) {
        const id = m[1].trim()
        if (id) { counts.set(id, (counts.get(id) ?? 0) + 1) }
      }
    }
  }
  return counts
}

/* eslint-disable @typescript-eslint/no-var-requires */
function readUtf8(p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

/** 从 CSV 文本解析:首行表头,首列 id。返回行数组(含表头)。 */
export function parseCsvText(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() === '') {
    throw new Error('CSV 为空')
  }
  const header = lines[0].split(',')
  if (!header[0] || header[0].trim() !== 'id') {
    throw new Error('CSV 首列不是 id')
  }
  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const cells = line.split(',')
    if (cells[0].trim() !== '') rows.push(cells)
  }
  return { header, rows }
}

export function csvReadIds(opts: CoreOpts): Set<string> {
  const p = csvPath(opts)
  if (!fs.existsSync(p)) return new Set()
  const { header, rows } = parseCsvText(readUtf8(p))
  void header
  return new Set(rows.map(r => r[0].trim()))
}

/* eslint-enable @typescript-eslint/no-var-requires */

export interface ScanResult {
  files: number
  ids: string[]          // 全部唯一 id(去重后 asc)
  missing: string[]      // CSV 未收录
  dup: Array<{ id: string; count: number }>
}

export function scan(opts: CoreOpts): ScanResult {
  const files = collectSourceFiles(opts)
  const idset = new Set<string>()
  for (const f of files) {
    for (const id of scanText(readUtf8(f))) idset.add(id)
  }
  const ids = [...idset].sort((a, b) => a.localeCompare(b))
  const csvIds = csvReadIds(opts)
  const missing = ids.filter(id => !csvIds.has(id))
  const counts = scanSettingCounts(opts)
  const dup = [...counts.entries()]
    .filter(([, c]) => c > 1)
    .map(([id, c]) => ({ id, count: c }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return { files: files.length, ids, missing, dup }
}

/** 补全:把缺失 id 追加到 CSV 末尾(其余列留空)。 */
export function complement(opts: CoreOpts): string[] {
  const p = csvPath(opts)
  const added: string[] = []
  const dir = path.dirname(p)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  let header: string[]
  let existing = new Set<string>()
  let content = ''
  if (fs.existsSync(p)) {
    content = readUtf8(p)
    const { header: h, rows } = parseCsvText(content)
    header = h
    existing = new Set(rows.map(r => r[0].trim()))
  } else {
    header = ['id', '默认', '别名', 'academic']
  }

  const files = collectSourceFiles(opts)
  const idset = new Set<string>()
  for (const f of files) for (const id of scanText(readUtf8(f))) idset.add(id)
  const addList = [...idset].filter(id => !existing.has(id)).sort((a, b) => a.localeCompare(b))

  if (addList.length === 0) return added
  let buf = content
  if (content !== '' && !content.endsWith('\n')) buf += '\n'
  const tail = new Array(Math.max(0, header.length - 1)).fill('').join(',')
  const lines = addList.map(id => id + (tail ? ',' + tail : ''))
  buf += lines.join('\n') + '\n'
  fs.writeFileSync(p, buf, 'utf-8')
  return addList
}

/** 清理:删除 CSV 中文档已删除(不再引用)的孤儿元素。 */
export function cleanup(opts: CoreOpts): string[] {
  const p = csvPath(opts)
  if (!fs.existsSync(p)) throw new Error(`CSV 不存在: ${p}`)
  const text = readUtf8(p)
  const { header, rows } = parseCsvText(text)
  const docIds = new Set<string>()
  for (const f of collectSourceFiles(opts)) for (const id of scanText(readUtf8(f))) docIds.add(id)
  const keepRows = rows.filter(r => docIds.has(r[0].trim()))
  const removed = rows.filter(r => !docIds.has(r[0].trim())).map(r => r[0].trim()).sort((a, b) => a.localeCompare(b))
  if (removed.length > 0) {
    const out = [header.join(','), ...keepRows.map(r => r.join(','))].join('\n').replace(/\s+$/, '') + '\n'
    fs.writeFileSync(p, out, 'utf-8')
  }
  return removed
}

/** 排序:按文档中定义顺序重排 CSV,未定义元素排末尾(保持原相对顺序)。 */
export function sort(opts: CoreOpts): { defined: number; undefined_: number } {
  const p = csvPath(opts)
  if (!fs.existsSync(p)) throw new Error(`CSV 不存在: ${p}`)
  const text = readUtf8(p)
  const { header, rows } = parseCsvText(text)
  const order = scanOrderedIds(opts)
  const pos = new Map(order.map((id, i) => [id, i]))
  const defined: Array<{ r: string[]; i: number }> = []
  const undefined_: Array<{ r: string[]; i: number }> = []
  rows.forEach((r, i) => {
    if (pos.has(r[0].trim())) defined.push({ r, i })
    else undefined_.push({ r, i })
  })
  defined.sort((a, b) => pos.get(a.r[0].trim())! - pos.get(b.r[0].trim())!)
  const newBody = [...defined, ...undefined_].map(x => x.r)
  const out = [header.join(','), ...newBody.map(r => r.join(','))].join('\n').replace(/\s+$/, '') + '\n'
  fs.writeFileSync(p, out, 'utf-8')
  return { defined: defined.length, undefined_: undefined_.length }
}

/** 在单文件中替换元素引用、静态标签、交叉引用,返回替换次数。 */
function replaceInFile(file: string, oldId: string, newId: string): number {
  let text = readUtf8(file)
  let repl = 0
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const subs: Array<[RegExp, (m: string) => string]> = [
    [new RegExp(`#元素\\(\\s*"${esc(oldId)}"\\s*\\)`, 'g'), m => m.replace(oldId, newId)],
    [new RegExp(`#元素\\[\\s*${esc(oldId)}\\s*\\]`, 'g'), m => m.replace(oldId, newId)],
    [new RegExp(`#设定元素\\(\\s*"${esc(oldId)}"\\s*\\)`, 'g'), m => m.replace(oldId, newId)],
    [new RegExp(`#设定元素\\[${esc(oldId)}\\]`, 'g'), m => m.replace(oldId, newId)],
    [new RegExp(`#设定元素\\([^)]*level\\s*:\\s*\\d+[^)]*\\)\\[${esc(oldId)}\\]`, 'g'), m => m.replace(oldId, newId)],
    [new RegExp(`<${esc(oldId)}>`, 'g'), m => `<${newId}>`],
    [new RegExp(`@${esc(oldId)}(?![\\w])`, 'g'), m => `@${newId}`],
  ]
  for (const [re, rep] of subs) {
    let c = 0
    text = text.replace(re, m => { c++; return rep(m) })
    repl += c
  }
  if (repl > 0) fs.writeFileSync(file, text, 'utf-8')
  return repl
}

/** 更新 CSV 中引用旧 id 的名词单元格(及 id 列,防撞名)。 */
function renameInCsv(opts: CoreOpts, oldId: string, newId: string): number {
  const p = csvPath(opts)
  if (!fs.existsSync(p)) return 0
  const text = readUtf8(p)
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let changed = 0
  let content = text
  const idSet = new Set(lines.slice(1).filter(l => l.trim() !== '' && !l.startsWith(',')).map(l => l.split(',')[0].trim()))
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) continue
    const cols = lines[i].split(',')
    for (let j = 0; j < cols.length; j++) {
      if (cols[j].trim() === oldId && (j > 0 || !idSet.has(newId))) {
        cols[j] = cols[j].replace(oldId, newId)
        changed++
      }
    }
    lines[i] = cols.join(',')
  }
  if (changed > 0) content = lines.join('\n')
  fs.writeFileSync(p, content, 'utf-8')
  return changed
}

export function rename(opts: CoreOpts, oldId: string, newId: string): { srcRepl: number; csvCells: number } {
  if (oldId === newId) throw new Error('新旧 id 相同')
  let total = 0
  for (const f of collectSourceFiles(opts)) total += replaceInFile(f, oldId, newId)
  const csvCells = renameInCsv(opts, oldId, newId)
  return { srcRepl: total, csvCells }
}