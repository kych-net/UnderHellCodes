# Todo 工具(Mojo 版):查找源文件中的所有 #TODO[...]
# 用法: mojo run todo工具.mojo [-- --dir 目录] [-- --include 关键字]
# 目录遍历经 Python 互操作(Mojo 1.0 暂无原生目录列举 API)。
from std.pathlib import Path
from std.python import Python
from std.os import getenv


# 把字符串拆成码点列表(每个元素一个 String)
def to_codepoints(s: String) -> List[String]:
    var out = List[String]()
    for cp in s.codepoint_slices():
        out.append(String(cp))
    return out^


# 码点列表转字符串
def from_codepoints(cps: List[String]) -> String:
    var out = String("")
    for c in cps:
        out += c
    return out


# 判断 s 是否以 suffix 结尾(码点级)
def ends_with(s: String, suffix: String) -> Bool:
    var cps = to_codepoints(s)
    var scps = to_codepoints(suffix)
    var ls = len(cps)
    var lt = len(scps)
    if ls < lt:
        return False
    for i in range(lt):
        if cps[ls - lt + i] != scps[i]:
            return False
    return True


# 判断 s 是否包含 sub(码点级)
def contains(s: String, sub: String) -> Bool:
    var cps = to_codepoints(s)
    var scps = to_codepoints(sub)
    var ls = len(cps)
    var lt = len(scps)
    if lt == 0:
        return True
    if ls < lt:
        return False
    var i = 0
    while i <= ls - lt:
        var ok = True
        for j in range(lt):
            if cps[i + j] != scps[j]:
                ok = False
                break
        if ok:
            return True
        i += 1
    return False


def os_getcwd() raises -> String:
    var os = Python.import_module("os")
    return String(os.getcwd())


# 递归收集 .typ 文件(os.walk)
def collect_files(doc_dir: String, include: String) raises -> List[String]:
    var files = List[String]()
    var os = Python.import_module("os")
    var walk = os.walk(doc_dir)
    for entry in walk:
        # entry = (root, dirs, files)
        var root = String(entry[0])
        var file_list = entry[2]
        for f in file_list:
            var name = String(f)
            if ends_with(name, ".typ"):
                if include.byte_length() > 0 and not contains(name, include):
                    continue
                var sep = "/"
                files.append(root + sep + name)
    # 排序(选择排序,保证确定性输出)
    var n = len(files)
    var i = 0
    while i < n:
        var j = i + 1
        while j < n:
            if files[j] < files[i]:
                var t = files[i]
                files[i] = files[j]
                files[j] = t
            j += 1
        i += 1
    return files^


# 把码点列表从 from..to(不含)拼成字符串
def slice_cp(cps: List[String], from_: Int, to: Int) -> String:
    var out = String("")
    for i in range(from_, to):
        out += cps[i]
    return out


# 在一行中查找 "#TODO[" 的码点位置
def find_todo(line: String) -> Int:
    var target = "#TODO["
    var cps = to_codepoints(line)
    var lt = 6
    var ls = len(cps)
    var i = 0
    while i <= ls - lt:
        var ok = True
        for j in range(lt):
            var t = target[byte=j]
            if cps[i + j] != String(t):
                ok = False
                break
        if ok:
            return i
        i += 1
    return -1


# 从 "#TODO[" 开始取到行尾最后一个 ']'(与 Python 版贪婪语义一致)
def todo_body(line: String, todo_pos: Int) -> String:
    var cps = to_codepoints(line)
    var n = len(cps)
    var start = todo_pos + 6  # len("#TODO[")
    var i = n - 1
    while i > todo_pos:
        if cps[i] == "]":
            return slice_cp(cps, start, i)
        i -= 1
    return slice_cp(cps, start, n)


def read_text(path: String) raises -> String:
    return Path(path).read_text()


# 把文本按 '\n' 切行(码点级)
def split_lines(text: String) -> List[String]:
    var out = List[String]()
    var cps = to_codepoints(text)
    var n = len(cps)
    var start = 0
    for i in range(n):
        if cps[i] == "\n":
            out.append(slice_cp(cps, start, i))
            start = i + 1
    if start < n:
        out.append(slice_cp(cps, start, n))
    return out^


def main() raises:
    var argv = sys_argv()
    var doc_dir = guess_root() + "/文档"
    var include = String("")
    var i = 0
    while i < len(argv):
        var a = argv[i]
        if a == "--dir" and i + 1 < len(argv):
            doc_dir = argv[i + 1]
            i += 2
        elif a == "--include" and i + 1 < len(argv):
            include = argv[i + 1]
            i += 2
        else:
            i += 1

    var files = collect_files(doc_dir, include)
    var total = 0
    for f in files:
        var text = read_text(f)
        var lines = split_lines(text)
        var line_no = 0
        for line in lines:
            line_no += 1
            var pos = find_todo(line)
            if pos >= 0:
                var body = todo_body(line, pos)
                if body.byte_length() == 0:
                    body = String("(空)")
                print(f, ":", line_no, ": ", body, sep="")
                total += 1
    if total == 0:
        print("未找到任何 #TODO。")
    else:
        print("共 ", total, " 条 #TODO。", sep="")


# 定位仓库根:UNDERHELL_ROOT -> 当前目录 -> 上级两层
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


# 取父目录(码点级:截到最后一个 '/')
def parent_dir(path: String) -> String:
    var cps = to_codepoints(path)
    var n = len(cps)
    var i = n - 1
    while i > 0:
        if cps[i] == "/":
            return slice_cp(cps, 0, i)
        i -= 1
    return String("/")


def sys_argv() -> List[String]:
    from std.sys import argv
    var out = List[String]()
    var all_args = argv()
    for i in range(1, len(all_args)):
        out.append(String(all_args[i]))
    return out^
