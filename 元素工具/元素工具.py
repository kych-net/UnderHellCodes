#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""元素工具:地狱之下世界观的元素(id)管理 CLI。

三大功能:
  1. 扫描   查找源文件里的所有元素 id(默认扫描仓库根 文档/ 下的全部 .typ)
  2. 补全   把扫描到的、却未出现在 元素系统.csv 里的 id 追加为新行(其余列留空)
  3. 改名   批量重命名一个元素 id:同步替换文档里的引用 / 静态标签 / 引用,
            并把 CSV 的 id 列一并更新

元素在 Typst 文档中的引用形式:
  #元素("怪动植物")                 字符串形式
  #元素[怪动植物]                   内容形式
  #设定元素[怪动植物]               内容形式(普通模式)
  #设定元素(level: 2)[主行星]        标题+锚点模式下带 level 的内容形式

用法:
  python3 元素工具.py 扫描 [--csv 路径]
  python3 元素工具.py 补全 [--csv 路径]
  python3 元素工具.py 改名 旧id 新id [--csv 路径]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# 定位仓库根:优先 源码所在位置 -> UNDERHELL_ROOT 环境变量 -> 当前目录,
# 取第一个其下含 文档/ 的候选。Nuitka 单文件运行时 __file__ 指向临时解包目录,
# 故需回退到环境变量或当前工作目录。
# / Locate the repo root by trying, in order: script location, the
# UNDERHELL_ROOT env var, then the current working directory, taking the first
# that contains a 文档/ folder (single-file builds unpack __file__ to a temp dir).
def _guess_root() -> Path:
    cands: list[Path] = []
    try:
        cands.append(Path(__file__).resolve().parent.parent.parent)
    except NameError:
        pass
    env = os.environ.get("UNDERHELL_ROOT")
    if env:
        cands.append(Path(env))
    cands.append(Path.cwd())
    for c in cands:
        if (c / "文档").is_dir():
            return c
    return cands[0]

ROOT = _guess_root()
DEFAULT_DOC_DIR = ROOT / "文档"
DEFAULT_CSV = ROOT / "文档" / "元素系统.csv"

# 提取元素 id 的模式。捕获组即得到概念 id(字符串为引号内,内容形式为 [] 内)
PATTERNS = [
    re.compile(r'#元素\(\s*"([^"]+)"\s*\)'),                        # #元素("名")
    re.compile(r'#元素\[\s*([^\]]+?)\s*\]'),                        # #元素[名]
    re.compile(r'#设定元素\(\s*"([^"]+)"\s*\)'),                    # #设定元素("名")
    re.compile(r'#设定元素\[([^\]]+?)\]'),                          # #设定元素[名]
    re.compile(r'#设定元素\([^)]*level\s*:\s*\d+[^)]*\)\[([^\]]+?)\]'),  # #设定元素(level: n)[名]
]


def collect_source_files(doc_dir: Path | None) -> list[Path]:
    """收集要扫描的 .typ 源文件。默认扫描 文档/ 下全部 .typ(含 内容/ 子目录)。"""
    base = doc_dir if doc_dir else DEFAULT_DOC_DIR
    base = base.resolve()
    if not base.is_dir():
        sys.exit(f"[错误] 文档目录不存在: {base}")
    files = sorted(p for p in base.rglob("*.typ") if p.is_file())
    if not files:
        sys.exit(f"[错误] 未在 {base} 下找到任何 .typ 文件")
    return files


def scan_ids(files: list[Path]) -> set[str]:
    """从源文件中提取所有元素 id,保持源顺序去重。"""
    ids: set[str] = set()
    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            print(f"[跳过] {f}: {e}")
            continue
        for pat in PATTERNS:
            for m in pat.finditer(text):
                id_ = m.group(1).strip()
                if id_:
                    ids.add(id_)
    return ids


def read_csv_ids(csv_path: Path) -> set[str]:
    """读取 CSV 第一列(id 列,去掉表头)的全部 id。"""
    if not csv_path.exists():
        return set()
    rows = csv_path.read_text(encoding="utf-8").splitlines()
    if not rows:
        return set()
    header = rows[0].split(",")
    if not header or header[0].strip() != "id":
        sys.exit(f"[错误] CSV 首列不是 id: {csv_path}")
    return {r.split(",")[0].strip() for r in rows[1:] if r.strip()} - {""}


def cmd_scan(args) -> None:
    files = collect_source_files(args.dir)
    idset = scan_ids(files)
    ids = sorted(idset)
    csv_ids = read_csv_ids(args.csv)
    missing = sorted(idset - csv_ids)
    print(f"扫描 {len(files)} 个 .typ 文件,共 {len(ids)} 个唯一元素:")
    for id_ in ids:
        mark = "" if id_ in csv_ids else "  <-- 缺失,CSV 未收录"
        print(f"  - {id_}{mark}")
    if missing:
        print(f"\n在 CSV 中缺失 {len(missing)} 个(可用 补全 添加):")
        for id_ in missing:
            print(f"  - {id_}")


def cmd_update_csv(args) -> None:
    files = collect_source_files(args.dir)
    ids = scan_ids(files)
    csv_path = args.csv
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    if csv_path.exists():
        rows = csv_path.read_text(encoding="utf-8").splitlines()
        header = rows[0]
        existing = set()
        for r in rows[1:]:
            if r.strip():
                existing.add(r.split(",")[0].strip())
    else:
        header = "id,默认,别名,academic"
        existing = set()
    added = sorted(ids - existing)
    if not added:
        print("CSV 已完整,无需补全。")
        return
    with csv_path.open("a", encoding="utf-8", newline="") as fh:
        for id_ in added:
            row = id_ + "," + ",".join([""] * (len(header.split(",")) - 1))
            fh.write(row + "\n")
    print(f"已向 {csv_path} 追加 {len(added)} 个元素:")
    for id_ in added:
        print(f"  + {id_}")


def cmd_cleanup(args) -> None:
    files = collect_source_files(args.dir)
    doc_ids = scan_ids(files)
    csv_ids = read_csv_ids(args.csv)
    orphans = sorted(csv_ids - doc_ids)
    if not orphans:
        print("CSV 中所有元素均在文档中被引用,无已删除的孤儿元素。")
        return
    print(f"CSV 中存在、但文档已不再引用的元素 {len(orphans)} 个"
          f"(可从 {args.csv} 中删除):")
    for id_ in orphans:
        print(f"  - {id_}")


def _replace_in_file(path: Path, old: str, new: str) -> int:
    """在单个源文件中重命名元素引用、静态标签与引用,返回替换次数。"""
    text = path.read_text(encoding="utf-8")
    # 1) 各元素引用形式
    repl = 0
    def _sub(pat: re.Pattern) -> None:
        nonlocal text, repl
        text, n = pat.subn(lambda m: m.group(0).replace(old, new), text)
        repl += n
    for pat in (
        re.compile(rf'#元素\(\s*"{re.escape(old)}"\s*\)'),
        re.compile(rf'#元素\[\s*{re.escape(old)}\s*\]'),
        re.compile(rf'#设定元素\(\s*"{re.escape(old)}"\s*\)'),
        re.compile(rf'#设定元素\[{re.escape(old)}\]'),
        re.compile(rf'#设定元素\([^)]*level\s*:\s*\d+[^)]*\)\[{re.escape(old)}\]'),
    ):
        _sub(pat)
    # 2) 静态标签 <旧id> 与交叉引用 @旧id
    text, n = re.subn(rf'<{re.escape(old)}>', f"<{new}>", text)
    repl += n
    text, n = re.subn(rf'@{re.escape(old)}(?![\w])', f"@{new}", text)
    repl += n
    if text != path.read_text(encoding="utf-8"):
        path.write_text(text, encoding="utf-8")
    return repl


def _rename_in_csv(csv_path: Path, old: str, new: str) -> int:
    """把 CSV 中 id 列的旧 id 改为新 id,并更新引用旧 id 的名词单元格。"""
    if not csv_path.exists():
        return 0
    text = csv_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    changed = 0
    for i, line in enumerate(lines):
        if i == 0:
            continue  # 表头
        cols = line.split(",")
        for j, c in enumerate(cols):
            if c.strip() == old:
                cols[j] = c.replace(old, new)
                changed += 1
        lines[i] = ",".join(cols)
    if changed:
        csv_path.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")
    return changed


def cmd_rename(args) -> None:
    old, new = args.old, args.new
    if old == new:
        sys.exit("[错误] 新旧 id 相同")
    files = collect_source_files(args.dir)
    total = 0
    for f in files:
        total += _replace_in_file(f, old, new)
    csv_changed = _rename_in_csv(args.csv, old, new)
    print(f"已重命名元素 {old!r} -> {new!r}:")
    print(f"  源文件替换 {total} 处;CSV 更新 {csv_changed} 个单元格。")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="元素工具", description="地狱之下世界观元素工具")

    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--dir", type=Path, dest="dir", default=None,
                        help="文档目录(默认 仓库根/文档)")
    parent.add_argument("--csv", type=Path, dest="csv", default=DEFAULT_CSV,
                        help="元素系统 CSV 路径(默认 仓库根/文档/元素系统.csv)")

    sub = ap.add_subparsers(dest="command", required=True)

    p_scan = sub.add_parser("扫描", parents=[parent], help="查找源文件中所有元素")
    p_scan.set_defaults(func=cmd_scan)

    p_csv = sub.add_parser("补全", parents=[parent], help="把缺失元素追加到 CSV")
    p_csv.set_defaults(func=cmd_update_csv)

    p_cln = sub.add_parser("清理", parents=[parent],
                           help="查找 CSV 中存在、但文档已删除(不再引用)的元素")
    p_cln.set_defaults(func=cmd_cleanup)

    p_ren = sub.add_parser("改名", parents=[parent], help="重命名元素 id")
    p_ren.add_argument("old", help="旧 id")
    p_ren.add_argument("new", help="新 id")
    p_ren.set_defaults(func=cmd_rename)
    return ap


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())