# 去背景(Mojo 版):根据颜色去除地图图片背景,仅保留接近黑色的像素并转为纯黑。
# 像素处理经 Python 互操作调用 PIL/numpy(算法逻辑与 Python 版一致)。
#
# 用法: mojo run 去背景.mojo -- [输入.png] [输出.png]
#       mojo build 去背景.mojo -o 去背景-mojo
from std.python import Python
from std.pathlib import Path


def remove_background(src: String, dst: String) raises:
    var np = Python.import_module("numpy")
    var pil_image = Python.import_module("PIL.Image")

    var im = pil_image.open(src).convert("RGBA")
    var a = np.array(im).astype("float32")

    # 全部像素运算交给 numpy:用 evaluate(file=True) 定义多行处理函数,
    # 规避 PythonObject 的 Python 切片/赋值语法限制。算法与 Python 版一致。
    var src_def = String(
        "def process(a, black_threshold, min_alpha):\n"
        "    lum = a[..., :3].mean(-1)\n"
        "    visible = a[..., 3] > min_alpha\n"
        "    keep = visible & (lum <= black_threshold)\n"
        "    a[keep, :3] = 0\n"
        "    a[keep, 3] = 255\n"
        "    a[~keep, 3] = 0\n"
        "    return a\n"
    )
    var mod = Python.evaluate(src_def, file=True)
    var a2 = mod.process(a, 120, 40)

    pil_image.fromarray(a2.astype("uint8"), "RGBA").save(dst)
    var size = im.size
    print("完成:", dst, " 尺寸 ", size, sep="")


def main() raises:
    try:
        _run()
    except e:
        print("ERR:", e)


def _run() raises:
    # 参数:arg[1]=输入 arg[2]=输出(缺省 图片/地图.png -> 图片/地图_去背景.png)
    from std.sys import argv
    var all_args = argv()
    var src = String("图片/地图.png")
    var dst = String("图片/地图_去背景.png")
    var pos_args = List[String]()
    for i in range(1, len(all_args)):
        if String(all_args[i]) != "--":
            pos_args.append(String(all_args[i]))
    if len(pos_args) > 0:
        src = pos_args[0]
    if len(pos_args) > 1:
        dst = pos_args[1]
    remove_background(src, dst)
