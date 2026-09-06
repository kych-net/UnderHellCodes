#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""排版工具:依据《内容/附录.typ》排版规范,对文档 .typ 提供 检查 与 修复。

核心思路:先对源码做**词法分析**,识别并排除所有 Typst 代码元素
(函数调用与参数、`#expr` 表达式、代码块 `{}`、字符串、数学 `$..$`、
raw `` `..` ``、注释 `//` `/* */`、字段访问链等),只对**纯正文片段**
进行检查与修复;代码中一律不变。

规范要点:全角标点半角(后不加空格)、正文标点后不加空格、称呼用"它"、
温度用 K、括注(…)改斜体、大数用科学计数法、中文字符间不空格。

用法:
  python3 排版工具.py 检查 [--dir 文档目录] [--include 关键词]
  python3 排版工具.py 修复 [--dir 文档目录]

仓库根定位顺序:源码位置 -> UNDERHELL_ROOT 环境变量 -> 当前目录。
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
# 正文标点后不应有空格(规范:标点后不加空格);匹配"标点+空格"
PUNCT_SPACE_RE = re.compile(r"(?<=[,.;:])[ ]+(?=[^\s])")
# 摄氏度换算为开尔文:K = °C + 273.15,取整(匹配数字…"°C" 完整片段)
CELS_RE = re.compile(r'(-?\d+(?:\.\d+)?)\s*"?\s*[°℃]C?"?')
END_PUNCT = set(".。！？!?…")

# 不算正文的结构行:标题(=)、列表(- +)、术语(/)、原始前缀(~)与注释(//)
STRUCT_LINE_RE = re.compile(r"^\s*(=+|-|\+|/|~|//)")


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


# ============================================================
# 词法分析:切分 Typst 源码,返回"正文片段"区间 [(起, 止), ...]
# 代码元素(函数调用/参数/#表达式/代码块/字符串/数学/raw/注释/字段链)
# 全部排除;`#name[...]` 的内容块内部仍按正文处理(块内的 #/$/` 再递归排除)。
# ============================================================
def _match_balanced(s: str, i: int, open_ch: str, close_ch: str) -> int:
    """从 i(open_ch 处)匹配到配对的 close_ch,返回 close 下标;失败返回 len(s)。"""
    depth = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == '"':
            i += 1
            while i < n and s[i] != '"':
                i += 2 if s[i] == "\\" else 1
            i += 1
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n


def _skip_string(s: str, i: int) -> int:
    """i 处为 '"',返回字符串结束后的下标。"""
    i += 1
    n = len(s)
    while i < n:
        if s[i] == "\\":
            i += 2
            continue
        if s[i] == '"':
            return i + 1
        i += 1
    return n


def _ident_end(s: str, i: int) -> int:
    n = len(s)
    while i < n and (s[i].isalnum() or s[i] in "_"):
        i += 1
    return i


def 正文区间(s: str) -> list[tuple[int, int]]:
    """返回 s 中"正文片段"的 [(起,止)] 区间(不含任何代码元素)。"""
    n = len(s)
    res: list[tuple[int, int]] = []
    body_start = 0
    blocks: list[int] = []  # 待闭合的内容块 ']' 深度

    def cut(a: int, b: int) -> None:
        nonlocal body_start
        if a > body_start:
            res.append((body_start, a))
        body_start = max(body_start, b)

    i = 0
    while i < n:
        c = s[i]
        nxt = s[i + 1] if i + 1 < n else ""
        # 注释
        if c == "/" and nxt == "/":
            cut(i, i)
            j = s.find("\n", i)
            i = n if j < 0 else j
            body_start = i
            continue
        if c == "/" and nxt == "*":
            cut(i, i)
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            body_start = i
            continue
        # raw
        if c == "`":
            cut(i, i)
            j = s.find("`", i + 1)
            i = n if j < 0 else j + 1
            body_start = i
            continue
        # 数学
        if c == "$":
            cut(i, i)
            j = i + 1
            while j < n:
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "$":
                    break
                j += 1
            i = j + 1 if j < n else n
            body_start = i
            continue
        # 内容块闭合
        if c == "]" and blocks:
            cut(i, i)
            blocks.pop()
            i += 1
            body_start = i
            continue
        # 代码表达式 #...
        if c == "#":
            cut(i, i)
            i += 1
            i = _ident_end(s, i)
            saw_assign = False
            while i < n:
                ch = s[i]
                if ch.isalnum() or ch in "_":
                    i = _ident_end(s, i)
                    continue
                if ch == ".":
                    j = _ident_end(s, i + 1)
                    if j == i + 1:
                        break
                    i = j
                    continue
                if ch == "(":
                    # 调用:实参整体是代码(含字符串/嵌套块);
                    # 若随后紧跟内容块 [..](如 #设定元素(..)[名]),一并排除
                    i = _match_balanced(s, i, "(", ")") + 1
                    j = i
                    while j < n and s[j] in " \t":
                        j += 1
                    if j < n and s[j] == "[":
                        i = _match_balanced(s, j, "[", "]") + 1
                    break
                if ch == "[":
                    # 内容块实参整体是代码;其前后的正文仍按正文处理
                    i = _match_balanced(s, i, "[", "]") + 1
                    break
                if ch == "{":
                    i = _match_balanced(s, i, "{", "}") + 1
                    break
                if ch == '"':
                    i = _skip_string(s, i)
                    continue
                if ch == ":":
                    # 路径/参数冒号;吞掉 import 的通配 *
                    i += 1
                    while i < n and s[i] in " \t*":
                        i += 1
                    continue
                if ch == ":":
                    i += 1
                    continue
                if ch == "=" and s[i + 1:i + 2] != "=":
                    # 赋值/箭头(=>):右值可能是跨行的 (…) / {…} / […]
                    saw_assign = True
                    j = i + (2 if s[i + 1:i + 2] == ">" else 1)
                    while j < n and s[j] in " \t\r\n":
                        j += 1
                    if j < n and s[j] in "({[":
                        op = s[j]
                        cl = {"(": ")", "{": "}", "[": "]"}[op]
                        i = _match_balanced(s, j, op, cl) + 1
                        continue
                    # 右值为简单表达式:吞到行尾
                    k = s.find("\n", i)
                    i = n if k < 0 else k
                    break
                if ch in " \t\r\n":
                    if saw_assign:
                        k = s.find("\n", i)
                        i = n if k < 0 else k
                        break
                    j = i
                    while j < n and s[j] in " \t\r\n":
                        j += 1
                    if j < n and s[j] in "([{.\"=":
                        i = j
                        continue
                    if j < n and (s[j].isalnum() or s[j] in "_"):
                        # 变量名/关键字(如 #let x = …、#show text: it => …)
                        i = j
                        continue
                    k = s.find("\n", i)
                    i = n if k < 0 else k
                    break
                break
            if not blocks:
                body_start = i
            continue
        i += 1
    cut(n, n)
    return res


def 行正文片段(line: str, offset: int, spans: list[tuple[int, int]]) -> list[tuple[int, str]]:
    """返回该行内正文片段 [(起始列, 文本)](列基于整行)。"""
    out = []
    ls = offset
    le = offset + len(line)
    for (a, b) in spans:
        s = max(a, ls)
        e = min(b, le)
        if s < e:
            out.append((s - ls, line[s - ls:e - ls]))
    return out


# ---------- 片段级修复 ----------
PUNCT_KEEP_RE = re.compile(r"([,.;:])([ ]+)(?=[^\s])")

def fix_fragment(frag: str, prev: str = "") -> str:
    """修复一个正文片段;prev 为源码中片段前一个字符(用于跨片段判定)。

    例外:`]`/`)`/`}` 之后的句点(如 `#元素[x]. 后文`)保留空格,
    否则会被 Typst 解析为字段访问。
    """
    padded = prev + frag
    new = FULLWIDTH_RE.sub(TO_REPLACE, padded)
    new = fix_celsius(new)

    def _del_space(m):
        # `]`/`)`/`}` 之后的句点保留空格(避免与 Typst 字段访问语法冲突)
        if m.group(1) == "." and m.start(1) > 0 and padded[m.start(1) - 1] in "]})":
            return m.group(0)
        # 其余:保留标点本身,删除其后的空格
        return m.group(1)
    new = PUNCT_KEEP_RE.sub(_del_space, new)

    new = CN_SPACE_RE.sub(r"\1\2", new)
    return new[1:]


def fix_celsius(ln: str) -> str:
    def repl(m):
        k = round(float(m.group(1)) + 273.15)
        unit = '"K"' if '"' in m.group(0) else "K"
        return f'{k} {unit}'
    return CELS_RE.sub(repl, ln)


def check_file(f: Path, rel: str) -> list[str]:
    """基于词法正文片段检查;返回违规列表。"""
    if rel in SKIP_FIX:
        return []
    issues: list[str] = []
    src = f.read_text(encoding="utf-8")
    spans = 正文区间(src)
    offset = 0
    for i, line in enumerate(src.splitlines(), 1):
        # 标题/列表/术语/注释行不算正文,整体跳过检查
        if STRUCT_LINE_RE.match(line):
            offset += len(line) + 1
            continue
        for col, frag in 行正文片段(line, offset, spans):
            body = frag.strip()
            if not body:
                continue
            prev = src[offset + col - 1] if offset + col > 0 else ""
            padded = prev + frag
            if FULLWIDTH_RE.search(frag):
                chars = sorted({c for c in frag if c in FULLWIDTH})
                issues.append(f"  {rel}:{i}: 全角标点 {''.join(chars)} -> {body[:38]}")
            if re.search(r"[她他]", frag):
                issues.append(f"  {rel}:{i}: 称呼用了她/他 -> {body[:38]}")
            if re.search(r"[℃°]", frag):
                issues.append(f"  {rel}:{i}: 温度用了 °C/℃ -> {body[:38]}")
            if re.search(r"\([^)]*[\u4e00-\u9fff][^)]*\)", frag):
                issues.append(f"  {rel}:{i}: 含中文圆括号括注(疑需斜体) -> {body[:38]}")
            if CN_SPACE_RE.search(frag):
                issues.append(f"  {rel}:{i}: 中文字符间含空格 -> {body[:38]}")
            # 标点后空格:`])}` 之后的句点保留(避免字段访问冲突),其余报
            punct_bad = PUNCT_KEEP_RE.search(padded) and not (
                PUNCT_KEEP_RE.search(padded).group(1) == "."
                and padded[PUNCT_KEEP_RE.search(padded).start(1) - 1] in "]})"
            )
            if punct_bad:
                issues.append(f"  {rel}:{i}: 正文标点后含空格 -> {body[:38]}")
            if CN_BIG_RE.search(frag):
                issues.append(f"  {rel}:{i}: 万级大数未用科学计数法 -> {body[:38]}")
        # 句尾补点:行尾是正文片段且末字非句尾标点
        tail_spans = [(c, t) for (c, t) in 行正文片段(line, offset, spans) if c + len(t) == len(line)]
        if tail_spans:
            frag = tail_spans[-1][1].rstrip()
            if frag and frag[-1] not in END_PUNCT and frag[-1] not in ":;,,":
                issues.append(f"  {rel}:{i}: 句子结尾缺失点号 -> {frag[-38:]}")
        offset += len(line) + 1
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


def fix_file(f: Path) -> bool:
    src = f.read_text(encoding="utf-8")
    spans = 正文区间(src)
    offset = 0
    out_lines = []
    for line in src.splitlines():
        # 标题/列表/术语/注释行不算正文,整体原样保留
        if STRUCT_LINE_RE.match(line):
            out_lines.append(line)
            offset += len(line) + 1
            continue
        pieces = []
        pos = 0
        frags = 行正文片段(line, offset, spans)
        tail_covered = False
        for col, frag in frags:
            # 片段前的代码部分原样
            pieces.append(line[pos:col])
            prev = src[offset + col - 1] if offset + col > 0 else ""
            fixed = fix_fragment(frag, prev)
            # 句尾补点:片段覆盖到行尾
            if col + len(frag) == len(line):
                tail_covered = True
                stripped = fixed.rstrip()
                if stripped and stripped[-1] not in END_PUNCT and stripped[-1] not in ":;,,":
                    fixed = stripped + "."
            pieces.append(fixed)
            pos = col + len(frag)
        pieces.append(line[pos:])
        out_lines.append("".join(pieces))
        offset += len(line) + 1
    new_src = "\n".join(out_lines) + ("\n" if src.endswith("\n") else "")
    if new_src != src:
        f.write_text(new_src, encoding="utf-8")
        return True
    return False


def cmd_fix(args) -> None:
    files = collect_files(args.dir, args.include)
    changed = 0
    for f in files:
        rel = str(f.relative_to(args.dir.resolve()))
        if rel in SKIP_FIX:
            print(f"[跳过规范文件] {rel}")
            continue
        if fix_file(f):
            changed += 1
            print(f"[已修复] {rel}")
    print(f"共修复 {changed} 个文件。")

    # 温度以外的提示(°C 已自动换算;此处提示遗留)
    for f in collect_files(args.dir, args.include):
        rel = str(f.relative_to(args.dir.resolve()))
        for i, ln in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"[℃°]", ln):
                print(f"  [需人工] {rel}:{i}: 温度单位 °C 需换算为 K")


def build_parser() -> argparse.ArgumentParser:
    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--dir", type=Path, default=DEFAULT_DOC_DIR,
                        help="文档目录(默认 仓库根/文档)")
    parent.add_argument("--include", default=None,
                        help="仅处理文件名包含该关键字的文件")

    ap = argparse.ArgumentParser(prog="排版工具", description="按附录规范检查/修复文档排版(先词法排除代码)")
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