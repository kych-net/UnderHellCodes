# 元素工具(Mojo 版):地狱之下元素管理
# 用法: mojo run 元素工具.mojo -- <扫描|补全|清理|排序> [--dir 目录] [--csv 路径]
#       mojo build 元素工具.mojo -o 元素工具-mojo
# 说明: 引用模式为固定前缀解析(#元素("名") / #元素[名] / #设定元素(...) / #设定元素[名] /
#       #设定元素(level: n)[名]);目录遍历经 Python 互操作。
from std.pathlib import Path
from std.python import Python
from std.os import getenv

comptime DEFAULT_HEADER: StaticString = "id,默认,别名,academic"


# ---------- 字符串小工具(码点级) ----------


def to_codepoints(s: String) -> List[String]:
    var out = List[String]()
    for cp in s.codepoint_slices():
        out.append(String(cp))
    return out^


def from_codepoints(cps: List[String]) -> String:
    var out = String("")
    for c in cps:
        out += c
    return out


def slice_cp(cps: List[String], from_: Int, to: Int) -> String:
    var out = String("")
    for i in range(from_, to):
        out += cps[i]
    return out


def starts_with(s: String, prefix: String) -> Bool:
    var scps = to_codepoints(prefix)
    var cps = to_codepoints(s)
    if len(cps) < len(scps):
        return False
    for i in range(len(scps)):
        if cps[i] != scps[i]:
            return False
    return True


def ends_with(s: String, suffix: String) -> Bool:
    var cps = to_codepoints(s)
    var scps = to_codepoints(suffix)
    if len(cps) < len(scps):
        return False
    for i in range(len(scps)):
        if cps[len(cps) - len(scps) + i] != scps[i]:
            return False
    return True


def contains(s: String, sub: String) -> Bool:
    var cps = to_codepoints(s)
    var scps = to_codepoints(sub)
    if len(scps) == 0:
        return True
    if len(cps) < len(scps):
        return False
    var i = 0
    while i <= len(cps) - len(scps):
        var ok = True
        for j in range(len(scps)):
            if cps[i + j] != scps[j]:
                ok = False
                break
        if ok:
            return True
        i += 1
    return False


def split_lines(text: String) -> List[String]:
    var out = List[String]()
    var cps = to_codepoints(text)
    var start = 0
    for i in range(len(cps)):
        if cps[i] == "\n":
            out.append(slice_cp(cps, start, i))
            start = i + 1
    if start < len(cps):
        out.append(slice_cp(cps, start, len(cps)))
    return out^


def split_char(s: String, sep: String) -> List[String]:
    var out = List[String]()
    var cps = to_codepoints(s)
    var start = 0
    for i in range(len(cps)):
        if cps[i] == sep:
            out.append(slice_cp(cps, start, i))
            start = i + 1
    out.append(slice_cp(cps, start, len(cps)))
    return out^


def join_strs(parts: List[String], sep: String) -> String:
    var out = String("")
    for i in range(len(parts)):
        if i > 0:
            out += sep
        out += parts[i]
    return out


# CSV 单元格转义(与 Python 版一致:含逗号/引号/换行则加引号)
def csv_cell(v: String) -> String:
    if contains(v, ",") or contains(v, "\"") or contains(v, "\n"):
        var q = String("\"")
        var inner = String("")
        var cps = to_codepoints(v)
        for c in cps:
            if c == "\"":
                inner += "\"\""
            else:
                inner += c
        return q + inner + q
    return v


# ---------- 根定位与文件收集 ----------


def os_getcwd() raises -> String:
    var os = Python.import_module("os")
    return String(os.getcwd())


def guess_root() raises -> String:
    def has_doc(base: String) -> Bool:
        var p = Path(base)
        return (p / "文档").exists()

    var env = getenv("UNDERHELL_ROOT")
    if env.byte_length() > 0 and has_doc(env):
        return env
    var cwd = os_getcwd()
    if has_doc(cwd):
        return cwd
    var up2 = parent_dir(parent_dir(cwd))
    if has_doc(up2):
        return up2
    return cwd


def parent_dir(path: String) -> String:
    var cps = to_codepoints(path)
    var i = len(cps) - 1
    while i > 0:
        if cps[i] == "/":
            return slice_cp(cps, 0, i)
        i -= 1
    return String("/")


def collect_typ_files(doc_dir: String) raises -> List[String]:
    var files = List[String]()
    var os = Python.import_module("os")
    for entry in os.walk(doc_dir):
        var root = String(entry[0])
        for f in entry[2]:
            var name = String(f)
            if ends_with(name, ".typ"):
                files.append(root + "/" + name)
    # 排序
    var i = 0
    while i < len(files):
        var j = i + 1
        while j < len(files):
            if files[j] < files[i]:
                var t = files[i]
                files[i] = files[j]
                files[j] = t
            j += 1
        i += 1
    return files^


def read_text(path: String) raises -> String:
    return Path(path).read_text()


def write_text(path: String, text: String) raises:
    Path(path).write_text(text)


# ---------- 元素扫描(固定前缀解析) ----------


def strip_spaces(s: String) -> String:
    var cps = to_codepoints(s)
    var out = String("")
    for c in cps:
        if c != " " and c != "\t":
            out += c
    return out


# 从 pos 开始解析一行中的元素引用,把发现的 id 追加到 ids
# 支持: #元素("名")  #元素[名]  #设定元素("名")  #设定元素[名]  #设定元素(level: n)[名]
def scan_refs(line: String, mut ids: List[String]) -> None:
    var cps = to_codepoints(line)
    var n = len(cps)
    var i = 0
    while i < n:
        var found = String("")
        var bracket_pos = -1
        if starts_with(slice_cp(cps, i, min(i + 3, n)), "#元素"):
            # #元素("名") 或 #元素[名]
            var j = i + 3
            if j < n and cps[j] == "[":
                bracket_pos = find_close(cps, j)
                if bracket_pos > 0:
                    found = slice_cp(cps, j + 1, bracket_pos)
                    i = bracket_pos + 1
            elif j < n and cps[j] == "(":
                bracket_pos = find_close(cps, j)
                if bracket_pos > 0:
                    found = unquote(strip_spaces(slice_cp(cps, j + 1, bracket_pos)))
                    i = bracket_pos + 1
        elif starts_with(slice_cp(cps, i, min(i + 5, n)), "#设定元素"):
            var j = i + 5
            if j < n and cps[j] == "[":
                bracket_pos = find_close(cps, j)
                if bracket_pos > 0:
                    found = slice_cp(cps, j + 1, bracket_pos)
                    i = bracket_pos + 1
            elif j < n and cps[j] == "(":
                bracket_pos = find_close(cps, j)
                if bracket_pos > 0:
                    var inner = strip_spaces(slice_cp(cps, j + 1, bracket_pos))
                    # level: n) 形式 -> 其后才是 [名]
                    if starts_with(inner, "level:") and bracket_pos + 1 < n and cps[bracket_pos + 1] == "[":
                        var b2 = find_close(cps, bracket_pos + 1)
                        if b2 > 0:
                            found = slice_cp(cps, bracket_pos + 2, b2)
                            i = b2 + 1
                    else:
                        found = unquote(inner)
                        i = bracket_pos + 1
        if found.byte_length() > 0:
            var id_ = strip_spaces(found)
            if id_.byte_length() > 0 and not contains_str(ids, id_):
                ids.append(id_)
        else:
            i += 1


def min(a: Int, b: Int) -> Int:
    if a < b:
        return a
    return b


# 从 open(处 '[' 或 '(' 找配对闭包的码点下标;失败返回 -1
def find_close(cps: List[String], open_pos: Int) -> Int:
    var open_ch = cps[open_pos]
    var close_ch = String("")
    if open_ch == "[":
        close_ch = String("]")
    elif open_ch == "(":
        close_ch = String(")")
    else:
        return -1
    var depth = 0
    var i = open_pos
    while i < len(cps):
        if cps[i] == open_ch:
            depth += 1
        elif cps[i] == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def unquote(s: String) -> String:
    if starts_with(s, "\"") and ends_with(s, "\"") and s.count_codepoints() >= 2:
        var cps = to_codepoints(s)
        return slice_cp(cps, 1, len(cps) - 1)
    return s


def contains_str(lst: List[String], v: String) -> Bool:
    for x in lst:
        if x == v:
            return True
    return False


def scan_ids(files: List[String]) raises -> List[String]:
    var ids = List[String]()
    for f in files:
        for line in split_lines(read_text(f)):
            scan_refs(line, ids)
    return ids^


# 顺序版本(按文档出现顺序,含去重)
def scan_ordered_ids(files: List[String]) raises -> List[String]:
    return scan_ids(files)


# 设定次数统计(重复定义警告用)
def scan_setting_counts(files: List[String]) raises -> List[String]:
    # 返回 "id:次数" 字符串列表(简单序列化)
    var names = List[String]()
    var counts = List[Int]()
    for f in files:
        for line in split_lines(read_text(f)):
            # 复用 scan_refs 但只统计设定类:简单做法——先剔除 #元素( 引用,
            # 只解析 #设定元素 系列
            var ids = List[String]()
            var stripped = strip_element_refs(line)
            scan_refs(stripped, ids)
            for id_ in ids:
                var idx = index_of(names, id_)
                if idx >= 0:
                    counts[idx] = counts[idx] + 1
                else:
                    names.append(id_)
                    counts.append(1)
    var out = List[String]()
    for i in range(len(names)):
        if counts[i] > 1:
            out.append(names[i] + ":" + String(counts[i]))
    return out^


def strip_element_refs(line: String) -> String:
    # 把 "#元素(" 与 "#元素[" 的引用移除,只留 #设定元素 系列
    var cps = to_codepoints(line)
    var out = List[String]()
    var i = 0
    var n = len(cps)
    while i < n:
        if starts_with(slice_cp(cps, i, min(i + 3, n)), "#元素"):
            var j = i + 3
            if j < n and (cps[j] == "(" or cps[j] == "["):
                var b = find_close(cps, j)
                if b > 0:
                    i = b + 1
                    continue
            out.append(cps[i])
            i += 1
        else:
            out.append(cps[i])
            i += 1
    return from_codepoints(out)


def index_of(lst: List[String], v: String) -> Int:
    for i in range(len(lst)):
        if lst[i] == v:
            return i
    return -1


# ---------- CSV 操作 ----------


def read_csv_ids(csv_path: String) raises -> List[String]:
    var ids = List[String]()
    var text = read_text(csv_path)
    var lines = split_lines(text)
    for i in range(1, len(lines)):
        var line = lines[i]
        if line.byte_length() == 0:
            continue
        var cols = split_char(line, ",")
        var id_ = strip_spaces(cols[0])
        if id_.byte_length() > 0 and not contains_str(ids, id_):
            ids.append(id_)
    return ids^


def csv_lines(csv_path: String) raises -> List[String]:
    var text = read_text(csv_path)
    var lines = split_lines(text)
    var out = List[String]()
    for line in lines:
        if line.byte_length() > 0:
            out.append(line)
    return out^


# ---------- 子命令 ----------


def cmd_scan(doc_dir: String, csv_path: String) raises:
    var files = collect_typ_files(doc_dir)
    var ids = scan_ids(files)
    var csv_ids = read_csv_ids(csv_path)
    var missing = List[String]()
    for id_ in ids:
        if not contains_str(csv_ids, id_):
            missing.append(id_)
    print("扫描 ", len(files), " 个 .typ 文件,共 ", len(ids), " 个唯一元素:", sep="")
    for id_ in ids:
        var mark = String("")
        if not contains_str(csv_ids, id_):
            mark = String("  <-- 缺失,CSV 未收录")
        print("  - ", id_, mark, sep="")
    if len(missing) > 0:
        print("\n在 CSV 中缺失 ", len(missing), " 个(可用 补全 添加):", sep="")
        for id_ in missing:
            print("  - ", id_, sep="")
    # 重复设定警告
    var dup = scan_setting_counts(files)
    if len(dup) > 0:
        print("警告:以下元素被 #设定元素 设定了多次(疑似重复定义):")
        for d in dup:
            print("  ⚠ ", d, sep="")


def cmd_update_csv(doc_dir: String, csv_path: String) raises:
    var files = collect_typ_files(doc_dir)
    var ids = scan_ids(files)
    var existing = read_csv_ids(csv_path)
    var added = List[String]()
    for id_ in ids:
        if not contains_str(existing, id_):
            added.append(id_)
    if len(added) == 0:
        print("CSV 已完整,无需补全。")
        return
    var header_cols = split_char(DEFAULT_HEADER, ",")
    var rest = String("")
    for i in range(1, len(header_cols)):
        rest += ","
    var lines = List[String]()
    for id_ in added:
        lines.append(id_ + rest)
    # 读全文再整写(Mojo 无原生追加;保持行为一致)
    var old = read_text(csv_path)
    var body = String("")
    for line in lines:
        body += line + "\n"
    write_text(csv_path, old + body)
    print("已向 ", csv_path, " 追加 ", len(added), " 个元素:", sep="")
    for id_ in added:
        print("  + ", id_, sep="")


def cmd_cleanup(doc_dir: String, csv_path: String) raises:
    var files = collect_typ_files(doc_dir)
    var doc_ids = scan_ids(files)
    var rows = csv_lines(csv_path)
    var header = rows[0]
    var orphans = List[String]()
    for i in range(1, len(rows)):
        var cols = split_char(rows[i], ",")
        var id_ = strip_spaces(cols[0])
        if not contains_str(doc_ids, id_) and not contains_str(orphans, id_):
            orphans.append(id_)
    if len(orphans) == 0:
        print("CSV 中所有元素均在文档中被引用,无已删除的孤儿元素。")
        return
    var keep = List[String]()
    keep.append(header)
    for i in range(1, len(rows)):
        var cols = split_char(rows[i], ",")
        var id_ = strip_spaces(cols[0])
        if not contains_str(orphans, id_):
            keep.append(rows[i])
    var out = join_strs(keep, "\n") + "\n"
    write_text(csv_path, out)
    print("已从 ", csv_path, " 删除 ", len(orphans), " 个元素(文档已不再引用):", sep="")
    for id_ in orphans:
        print("  - ", id_, sep="")


def cmd_sort(doc_dir: String, csv_path: String) raises:
    var files = collect_typ_files(doc_dir)
    # 定义顺序:仅统计 #设定元素 的出现顺序
    var order = List[String]()
    for f in files:
        for line in split_lines(read_text(f)):
            var setting_ids = List[String]()
            var stripped = strip_element_refs(line)
            scan_refs(stripped, setting_ids)
            for id_ in setting_ids:
                if not contains_str(order, id_):
                    order.append(id_)
    var rows = csv_lines(csv_path)
    var header = rows[0]
    var defined = List[String]()
    var undefined = List[String]()
    for i in range(1, len(rows)):
        var cols = split_char(rows[i], ",")
        var id_ = strip_spaces(cols[0])
        if contains_str(order, id_):
            defined.append(rows[i])
        else:
            undefined.append(rows[i])
    # 已定义:按 order 中位置排序(选择排序)
    var pos = List[Int]()
    for row in defined:
        var id_ = strip_spaces(split_char(row, ",")[0])
        pos.append(index_of(order, id_))
    var n = len(defined)
    var i = 0
    while i < n:
        var j = i + 1
        while j < n:
            if pos[j] < pos[i]:
                var t = defined[i]
                defined[i] = defined[j]
                defined[j] = t
                var tp = pos[i]
                pos[i] = pos[j]
                pos[j] = tp
            j += 1
        i += 1
    var new_rows = List[String]()
    new_rows.append(header)
    for row in defined:
        new_rows.append(row)
    for row in undefined:
        new_rows.append(row)
    write_text(csv_path, join_strs(new_rows, "\n") + "\n")
    print("已按文档中定义顺序排序 ", csv_path, ":", sep="")
    print("  已定义(按文档顺序) ", len(defined), " 项;未定义(排末尾) ", len(undefined), " 项", sep="")


# ---------- 入口 ----------


def main() raises:
    var argv = sys_argv()
    if len(argv) == 0:
        print("用法: 元素工具 <扫描|补全|清理|排序> [--dir 目录] [--csv 路径]")
        return
    var start = 0
    if len(argv) > 0 and argv[0] == "--":
        start = 1
    if len(argv) <= start:
        print("用法: 元素工具 <扫描|补全|清理|排序> [--dir 目录] [--csv 路径]")
        return
    var cmd = argv[start]
    var doc_dir = guess_root() + "/文档"
    var csv_path = doc_dir + "/元素系统.csv"
    var i = start + 1
    while i < len(argv):
        var a = argv[i]
        if a == "--dir" and i + 1 < len(argv):
            doc_dir = argv[i + 1]
            i += 2
        elif a == "--csv" and i + 1 < len(argv):
            csv_path = argv[i + 1]
            i += 2
        else:
            i += 1
    if cmd == "扫描":
        cmd_scan(doc_dir, csv_path)
    elif cmd == "补全":
        cmd_update_csv(doc_dir, csv_path)
    elif cmd == "清理":
        cmd_cleanup(doc_dir, csv_path)
    elif cmd == "排序":
        cmd_sort(doc_dir, csv_path)
    else:
        print("未知命令: ", cmd)


def sys_argv() -> List[String]:
    from std.sys import argv
    var out = List[String]()
    var all_args = argv()
    for i in range(1, len(all_args)):
        out.append(String(all_args[i]))
    return out^
