#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Todo 工具:查找源文件(默认 仓库根/文档 下的全部 .typ)中所有 `#TODO[...]`。

用法:
  python3 todo工具.py                     # 在终端列出所有 TODO
  python3 todo工具.py --dir 路径            # 指定扫描目录
  python3 todo工具.py --include "内容"      # 仅匹配文件名含 内容 的
  python3 todo工具.py --limit 20           # 最多显示 20 条(仅终端列出时)
  python3 todo工具.py 列表 [--out 路径]      # 输出 Todo 列表文件
                                          # (默认 文档/待办.md,即与文档同目录)

默认仓库根定位顺序:源码位置 -> UNDERHELL_ROOT 环境变量 -> 当前目录。
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

TODO_RE = re.compile(r"#TODO\[(.*)\]")


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


def collect_files(doc_dir: Path) -> list[Path]:
    base = doc_dir.resolve()
    if not base.is_dir():
        sys.exit(f"[错误] 目录不存在: {base}")
    files = sorted(p for p in base.rglob("*.typ") if p.is_file())
    if not files:
        sys.exit(f"[错误] 未在 {base} 下找到任何 .typ 文件")
    return files


def find_todos(files: list[Path], include: str | None) -> list[tuple[Path, int, str]]:
    hits: list[tuple[Path, int, str]] = []
    for f in files:
        if include and include not in f.name:
            continue
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError) as e:
            print(f"[跳过] {f}: {e}")
            continue
        for i, line in enumerate(lines, 1):
            for m in TODO_RE.finditer(line):
                hits.append((f, i, m.group(1).strip()))
    return hits


def cmd_find(args) -> None:
    files = collect_files(args.dir)
    hits = find_todos(files, args.include)
    if not hits:
        print("未找到任何 #TODO。")
        return
    total = len(hits)
    shown = hits if args.limit is None else hits[: args.limit]
    for f, ln, text in shown:
        rel = f.relative_to(args.dir) if f.is_absolute() else f
        preview = text if text else "(空)"
        print(f"{f}:{ln}: {preview}")
    if args.limit and total > args.limit:
        print(f"... 共 {total} 条,仅显示前 {args.limit} 条(用 --limit 调整)。")
    else:
        print(f"共 {total} 条 #TODO。")


def _csv_cell(value: object) -> str:
    """CSV 单元格转义:含逗号/引号/换行时用括号包裹。"""
    s = str(value) if value is not None else ""
    if any(c in s for c in (',', '"', '\n', '\r')):
        return '"' + s.replace('"', '""') + '"'
    return s


def cmd_list(args) -> None:
    files = collect_files(args.dir)
    hits = find_todos(files, args.include)
    base = args.dir.resolve()
    out = args.out or (args.dir / ("待办.csv" if args.format == "csv" else "待办.md"))
    out.parent.mkdir(parents=True, exist_ok=True)
    if args.format == "csv":
        lines = ["编号,位置,内容"]
        for i, (f, ln, text) in enumerate(hits, 1):
            rel = f.relative_to(base)
            lines.append(",".join([
                _csv_cell(i), _csv_cell(f"{rel}:{ln}"), _csv_cell(text or ""),
            ]))
        out.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")
        print(f"已导出 {len(hits)} 条 #TODO 到 CSV: {out}")
        return
    lines = ["# 待办表格", "",
             f"- 共 {len(hits)} 条 #TODO" if hits else "- 当前无 #TODO", "",
             "| 编号 | 位置(文件:行) | TODO 内容 |",
             "|---|---|---|"]
    for i, (f, ln, text) in enumerate(hits, 1):
        preview = text if text else "(空)"
        preview = preview.replace("|", "\\|")
        rel = f.relative_to(base)
        lines.append(f"| {i} | {rel}:{ln} | {preview} |")
    out.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")
    print(f"已写入 {len(hits)} 条 #TODO 表格到: {out}")


def build_parser() -> argparse.ArgumentParser:
    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--dir", type=Path, default=DEFAULT_DOC_DIR,
                        help="扫描目录(默认 仓库根/文档)")
    parent.add_argument("--include", default=None,
                        help="仅匹配文件名包含该关键字的文件")

    ap = argparse.ArgumentParser(prog="todo工具", parents=[parent],
                                 description="查找源文件中所有 #TODO")
    ap.add_argument("--limit", type=int, default=None,
                    help="终端列出时最多显示条数")
    ap.set_defaults(func=cmd_find)

    sub = ap.add_subparsers(dest="command")
    p_list = sub.add_parser("列表", parents=[parent],
                            help="输出 Todo 列表文件(默认 文档/待办.md)")
    p_list.add_argument("--out", type=Path, default=None,
                        help="输出文件路径(缺省:按格式 待办.md / 待办.csv,与文档同目录)")
    p_list.add_argument("--format", choices=["md", "csv"], default="md",
                        help="输出格式:md(Markdown 表格,默认)或 csv")
    p_list.set_defaults(func=cmd_list)
    return ap


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())