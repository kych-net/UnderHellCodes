# Todo 工具 — 查找源文件中的 `#TODO`

扫描 `文档/**/*.typ`(默认)中所有 `#TODO[...]` 标记。

## 用法

```bash
python3 todo工具.py               # 列出所有 TODO
python3 todo工具.py --dir 路径     # 指定扫描目录
python3 todo工具.py --include 内容 # 仅匹配文件名含"内容"的文件
python3 todo工具.py --limit 20    # 最多显示 20 条
```

## 说明

- 每处输出为 `文件:行号: TODO 内容`。
- 仓库根定位顺序:源码位置 → `UNDERHELL_ROOT` 环境变量 → 当前目录;
  从仓库根运行即可，也可用 `--dir` 指定。
- 纯标准库实现，无第三方依赖。