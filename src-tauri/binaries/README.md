# 本地推理二进制放置目录（改造 P1-B）

FuxiLoom 的「模型」面板 → 「本地推理（sidecar）」会把本目录（或 UI 中指定的绝对路径）
里的推理引擎作为本地子进程拉起，经其 OpenAI 兼容端口接入，无需改动 AI 请求层。

## 放置方式（二选一）

1. 把二进制直接放到本目录，命名为（Windows）：
   - `koboldcpp.exe`
   - `llamacpp.exe`（即 `llama.cpp` 的 `llama-server` / `server` 可执行文件）
   打包后它们会出现在 `<安装目录>/resources/binaries/`，运行时由 Rust 侧自动查找。

2. 在「模型」面板的「二进制路径」里填绝对路径（如 `D:/tools/koboldcpp.exe`），
   优先级高于本目录查找。

> 注意：`.exe` 文件体积大且含权重无关二进制，请勿提交进 git（本目录只保留说明文件）。
> 实际使用时再把下载好的二进制放入即可。

## 下载来源

- KoboldCpp（GUI/CLI 一体，中文网文续写向，推荐）：
  https://github.com/LostRuins/koboldcpp/releases
- llama.cpp（`llama-server` / `server`）：
  https://github.com/ggerganov/llama.cpp/releases

## 推荐启动档（Rust 侧已内置，可用「额外参数」覆盖）

- KoboldCpp：`--port 5001 --gpulayers 99 --contextsize 16384 --cache-q8 --flashattention`
- llama.cpp：`--host 127.0.0.1 --port 8080 -ngl 99 --ctx-size 16384 --cache-q8 -fa --api-key none`

端口默认：KoboldCpp 5001 / llama.cpp 8080，可在面板覆盖。
启动后 Base URL 形如 `http://127.0.0.1:<port>/v1`，面板会自动回填并把后端类型设为 `llamacpp`。

---

# EPUB 导出二进制放置目录（改造 P2）

「导出」面板 →「导出 EPUB」会调用 pandoc 把装配好的 Markdown 转成 `.epub`。
pandoc 优先用本目录（或面板「pandoc 二进制路径」里填的绝对路径），找不到则回退系统 PATH。

## 放置方式（三选一）

1. 把 `pandoc.exe`（Windows）/ `pandoc`（macOS/Linux）放到本目录，
   打包后位于 `<安装目录>/resources/binaries/`，运行时由 Rust 侧自动查找。
2. 在「导出」面板的「pandoc 二进制路径」里填绝对路径，优先级最高。
3. 已把 pandoc 装进系统 PATH（如 `npm i -g pandoc` 或官方安装包），无需放本目录。

## 下载来源

- pandoc 官方（带 EPUB 写支持）：https://pandoc.org/installing.html
  Windows 直接装 `pandoc-*-windows-x86_64.msi` 即可。

> 说明：pandoc 是独立命令行工具，体积适中，放本目录或装 PATH 均可；缺失时导出会返回
> 清晰指引而非崩溃。生成的 EPUB 含自动目录（卷/章两级）、语言元数据、可选封面图。
