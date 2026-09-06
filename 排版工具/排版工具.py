#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""排版工具:依据《内容/附录.typ》排版规范,对文档 .typ 提供 检查 与 修复。

规范要点:全角标点半角、中文字符间不空格、称呼一律用"它"、温度用 K、
括注(…)改斜体、大数用科学计数法、交叉引用用 @label。

用法:
  python3 排版工具.py 检查 [--dir 文档目录] [--include 关键词]
  python3 排版工具.py 修复 [--dir 文档目录]

仓库根定位顺序:源码位置 -> UNDERHELL_ROOT 环境变量 -> 当前目录。
自动修复仅处理有把握的项:全角标点、称呼(她/他→它)、中文字符间空格。
温度(需数值换算)与括注(易误伤代码)只检查、不自动改。
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# 修复时跳过该文件(其全角标点是规范示例,不应改动)
SKIP_FIX = {"内容/附录.typ"}

# 全角 -> 半角(规范:统一半角)
FULLWIDTH = {
    "，": ",", "、": ",", "：": ":", "；": ";",
    "（": "(", "）": ")", "——": "--", "。": ".",
    "“": '"', "”": '"', "‘": "'", "’": "'",
}
FULLWIDTH_RE = re.compile("[" + "".join(FULLWIDTH.keys()) + "]")
TO_REPLACE = lambda m: FULLWIDTH[m.group(0)]  # noqa: E731

CN_SPACE_RE = re.compile(r"([\u4e00-\u9fff])\s+([\u4e00-\u9fff])")
CN_BIG_RE = re.compile(r"(?<![0-9])[1-9][0-9]{4,}(?![0-9])")
# 内容标点(最终 PDF 可见)后应跟空格;此处只看其后紧跟中文字符的情况
PUNCT_SPACE_RE = re.compile(r"(?<=[,.;:])(?=[\u4e00-\u9fff])")
# 摄氏度换算为开尔文:K = °C + 273.15,取整(匹配数字…"°C" 完整片段)
CELS_RE = re.compile(r'(-?\d+(?:\.\d+)?)\s*"?\s*[°℃]C?"?')


def fix_celsius(ln: str) -> str:
    def repl(m):
        k = round(float(m.group(1)) + 273.15)
        return f'{k} "K"'
    return CELS_RE.sub(repl, ln)


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


def collect_files(doc_dir: Path, include: str | None) -> list[Path]:
    base = doc_dir.resolve()
    if not base.is_dir():
        sys.exit(f"[错误] 目录不存在: {base}")
    files = sorted(p for p in base.rglob("*.typ") if p.is_file())
    files = [f for f in files if not include or include in f.name]
    if not files:
        sys.exit(f"[错误] 未在 {base} 下找到 .typ 文件")
    return files


def _iter_lines(f: Path):
    return open(f, encoding="utf-8").read().splitlines()


CODE_HINT = re.compile(r"^/|\b(import|let|const|rgb|csv|table|表格|提示框|属性框|人物框|事件)\b|\.\.|==|#![a-z]+")


def check_file(f: Path, rel: str) -> list[str]:
    """返回该文件不符合规范的违规列表(字符串)。"""
    if rel in SKIP_FIX:
        return []  # 规范文件自身,全角为示例,不纳入违规
    issues: list[str] = []
    for i, ln in enumerate(_iter_lines(f), 1):
        body = ln.strip()
        if body.startswith("//") or CODE_HINT.search(ln):
            continue
        if FULLWIDTH_RE.search(ln):
            chars = sorted({c for c in ln if c in FULLWIDTH})
            issues.append(f"  {rel}:{i}: 全角标点 {''.join(chars)} -> {body[:38]}")
        if re.search(r"[她他]", ln):
            issues.append(f"  {rel}:{i}: 称呼用了她/他 -> {body[:38]}")
        if re.search(r"[℃°]", ln):
            issues.append(f"  {rel}:{i}: 温度用了 °C/℃ -> {body[:38]}")
        if re.search(r"\([^)]*[\u4e00-\u9fff][^)]*\)", ln):
            issues.append(f"  {rel}:{i}: 含中文圆括号括注(疑需斜体) -> {body[:38]}")
        if CN_SPACE_RE.search(ln):
            issues.append(f"  {rel}:{i}: 中文字符间含空格 -> {body[:38]}")
        if PUNCT_SPACE_RE.search(ln):
            issues.append(f"  {rel}:{i}: 内容标点后缺空格 -> {body[:38]}")
        if CN_BIG_RE.search(ln):
            issues.append(f"  {rel}:{i}: 万级大数未用科学计数法 -> {body[:38]}")
    return issues


def cmd_check(args) -> None:
    files = collect_files(args.dir, args.include)
    total = 0
    for f in files:
        rel = str(f.relative_to(args.dir.resolve()))
        issues = check_file(f, rel)
        total += len(issues)
        for it in issues:
            print(it)
    print(f"\n共 {len(files)} 个文件,违规 {total} 处。")


def fix_line(ln: str) -> str:
    # 全角标点钟表;°C→K;内容标点后补空格;中文字符空格
    new = FULLWIDTH_RE.sub(TO_REPLACE, ln)
    new = fix_celsius(new)
    new = PUNCT_SPACE_RE.sub(" ", new)
    new = CN_SPACE_RE.sub(r"\1\2", new)
    return new


def cmd_fix(args) -> None:
    files = collect_files(args.dir, args.include)
    changed_files = 0
    for f in files:
        rel = str(f.relative_to(args.dir.resolve()))
        if rel in SKIP_FIX:
            print(f"[跳过规范文件] {rel}")
            continue
        lines = _iter_lines(f)
        new = [fix_line(ln) for ln in lines]
        if new != lines:
            f.write_text("\n".join(new) + "\n", encoding="utf-8")
            changed_files += 1
            print(f"[已修复] {rel}")
    print(f"共修复 {changed_files} 个文件。")

    # 温度与括注不自动改,提示人工
    files2 = collect_files(args.dir, args.include)
    for f in files2:
        rel = str(f.relative_to(args.dir.resolve()))
        for i, ln in enumerate(_iter_lines(f), 1):
            if re.search(r"[℃°]", ln):
                print(f"  [需人工] {rel}:{i}: 温度单位 °C 需换算为 K")


def build_parser() -> argparse.ArgumentParser:
    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--dir", type=Path, default=DEFAULT_DOC_DIR,
                        help="文档目录(默认 仓库根/文档)")
    parent.add_argument("--include", default=None,
                        help="仅处理文件名包含该关键字的文件")

    ap = argparse.ArgumentParser(prog="排版工具", description="按附录规范检查/修复文档排版")
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("检查", parents=[parent], help="检查不符合排版规范之处").set_defaults(func=cmd_check)
    sub.add_parser("修复", parents=[parent], help="自动修复有把握的排版问题").set_defaults(func=cmd_fix)
    return ap


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())