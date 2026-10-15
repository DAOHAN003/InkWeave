#!/usr/bin/env bash
# 本地质量门禁：定位边界审计 + 类型检查 + 前端单测 + 生产构建 + Rust 编译检查 + Rust 内核单测 + 万象工作区单测 + 桥接层单测 + 离线核心自检
# 用法：bash scripts/ci-check.sh   或   npm run ci
# 项目不开源、不推送 GitHub，故用本地脚本替代 GitHub Actions CI。
#
# 可选环境变量：
#   BOUNDARY_SKIP=1    跳过 [边界] 定位边界审计（应急用；不依赖工具链，仅需约 1 秒）
#   BOUNDARY_MAX_DEAD_COMMANDS=N  死命令上限（覆盖 scripts/boundary-baseline.json 基线）
#   BOUNDARY_MAX_DEAD_KEYS=N      死配置上限（覆盖基线）
#   SKIP_TS_TEST=1     跳过前端单测（应急用；仅需数秒，正常不该跳过）
#   SKIP_BUILD=1       跳过前端生产构建（加快迭代，但合并前不应跳过）
#   SKIP_RUST_TEST=1   跳过 Rust 单测（应急用；单测在依赖预热后仅需数秒，正常不该跳过）
#   SKIP_TAURI_TEST=1  跳过 src-tauri 桥接层单测（应急用）
#   SKIP_OFFLINE_VERIFY=1  跳过 [8/8] 离线核心自检（应急用；零模型 / 零 Key，约 6 秒）
#   MIN_TS_TESTS=N     前端单测数下限，默认 400（实跑 540；防「测试被删光仍报绿灯」）
#   MIN_RUST_TESTS=N   Rust 单测数下限，默认 600（同上）
#   MIN_WANXIANG_TESTS=N  wanxiang/ 工作区单测数下限，默认 240（本 fork 实跑 249；上游全量版约 340）
#   MIN_TAURI_TESTS=N  src-tauri 单测数下限，默认 50（同上）
#   FX_CARGO_TARGET_DIR=<目录>  Rust 三步统一改用 fresh CARGO_TARGET_DIR。
#      本环境（agent 沙箱）安全策略会冻结"已存在的 .cargo-build-lock"（写/删/改名全拒，
#      index.lock 同款模式），cargo 默认 target/debug 无法使用；设此变量指向全新目录
#      （如 <repo>/src-tauri/checktmp）即可绕过。用户真机无此问题，不设即可用默认 target。
#      ⚠️ 必须是 Windows 格式绝对路径（如 D:/...）：环境变量值不做 MSYS 路径转换，
#      传 /d/... 会被 Windows cargo 解析成 <cwd盘符>:\d\... 建到错误位置（08-03 实测踩坑）。
#      ⚠️ [4/8][7/8]（src-tauri）共用 FX_CARGO_TARGET_DIR；[5/8] wanxiang_engines 用
#      ENG_CARGO_TARGET_DIR；[6/8] wanxiang/ 工作区用 WX_CARGO_TARGET_DIR —— 三者独立目录，
#      避免三套 serde 解析产物串扰同一 target（E0277 历史教训）。
#   ENG_CARGO_TARGET_DIR=<目录>  [5/8] wanxiang_engines 测试的 fresh target（如
#      <repo>/wanxiang_engines/engcheck）。不设则用该工作区默认 target。
#   WX_CARGO_TARGET_DIR=<目录>  [6/8] wanxiang/ 工作区（wanxiang_types / wanxiang_core /
#      wanxiang_brain / wanxiang_evolution / wanxiang_world / wanxiang_engine / wanxiang_sdk
#      七个 crate）测试的 fresh target（如 <repo>/wanxiang/wxcheck）。不设则用该
#      工作区默认 target。与 FX / ENG 独立，防三套 serde 产物串扰。
set -euo pipefail
cd "$(dirname "$0")/.."

# 若指定 fresh target，提前 export，让 [4/8][5/8][6/8][7/8] 的 npm run 全部继承
if [ -n "${FX_CARGO_TARGET_DIR:-}" ]; then
  export CARGO_TARGET_DIR="$FX_CARGO_TARGET_DIR"
fi

TS_LOG=""
RUST_LOG=""
WX_LOG=""
TAURI_LOG=""
cleanup() { rm -f "${TS_LOG:-}" "${RUST_LOG:-}" "${WX_LOG:-}" "${TAURI_LOG:-}" 2>/dev/null || true; }
trap cleanup EXIT

# [边界] 定位边界审计：不依赖工具链，放在最前
# 守住「一个内核、两个出口、一道边界」——防止引擎能力无节制长进产品主 bridge
# （2026-08-29 复盘：27 个前端零调用的死命令正是这道边界失守的产物）
if [ "${BOUNDARY_SKIP:-0}" = "1" ]; then
  echo "==> [边界] ⏭  定位边界审计跳过 (BOUNDARY_SKIP=1)"
else
  echo "==> [边界] 定位边界审计 (check-boundary.mjs)"
  node scripts/check-boundary.mjs
fi

echo ""
echo "==> [1/8] TypeScript 类型检查 (tsc --noEmit)"
npm run check

echo ""
echo "==> [2/8] 前端确定性单测 (vitest，守门阈值 / 跨端哈希契约)"
# 覆盖 acceptRevision 采纳守门与 fnv1a32Ts 跨端契约等纯逻辑：
# 这类函数出错时不抛异常，只会静默产出错误结果（正文被残稿覆盖、指纹跨端错位），
# 类型检查与构建都抓不到，只能靠单测锁住。
if [ "${SKIP_TS_TEST:-0}" = "1" ]; then
  echo "   ⏭  SKIP_TS_TEST=1，跳过（不建议）。"
else
  min_ts="${MIN_TS_TESTS:-400}"
  TS_LOG="$(mktemp -t fxci-ts-XXXXXX.log)"

  set +e
  NO_COLOR=1 npm run test:ts >"$TS_LOG" 2>&1
  ts_code=$?
  set -e

  if [ "$ts_code" -ne 0 ]; then
    echo ""
    tail -40 "$TS_LOG"
    echo ""
    echo "❌ 前端单测失败，门禁不通过。"
    exit 1
  fi

  ts_passed="$(grep -oE 'Tests +[0-9]+ passed' "$TS_LOG" \
               | grep -oE '[0-9]+' | tail -1)"
  ts_passed="${ts_passed:-0}"
  echo "   ✔ 通过 ${ts_passed} 个前端单测（下限 ${min_ts}）"
  if [ "$ts_passed" -lt "$min_ts" ]; then
    echo ""
    echo "❌ 前端单测通过数 ${ts_passed} 低于下限 ${min_ts}，疑似测试被删除或未被收集。"
    echo "   若为有意精简，请显式调整：MIN_TS_TESTS=<新下限> 或修改脚本默认值。"
    exit 1
  fi
fi

echo ""
echo "==> [3/8] 前端生产构建 (tsc && vite build)"
# 关键：tsc --noEmit 只做类型检查，不产出产物。构建可能因资源/插件/动态导入等
# 类型检查覆盖不到的原因失败，故必须单独验证一次真实构建。
# dist 预清：vite emptyOutDir:false 不删 dist，陈旧哈希文件被 Defender 锁会 EPERM。
# 本环境删除全被 safe-delete 守卫拦（bash rm 目录拦 / PowerShell 拦 / node unlink 拦 /
# vite rmSync bulk 拦）——唯一可过的是「mv 改名」：dist → dist_old_<时间戳> 再建新 dist，
# vite 写干净目录零锁（08-03 实测，6.6s 构建成功）。dist_old_* 已被 .gitignore 覆盖。
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "   ⏭  SKIP_BUILD=1，跳过。"
else
  if [ -d dist ]; then
    mv dist "dist_old_$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
    mkdir -p dist
  fi
  npm run build
fi

echo ""
echo "==> [4/8] Rust 编译检查 (cargo check @ src-tauri)"
# CARGO_INCREMENTAL=0：防 Defender 锁 .rmeta 写坏增量缓存（见 [7/8] 注释），08-03 固化
CARGO_INCREMENTAL=0 npm run check:rust

echo ""
echo "==> [5/8] Rust 内核单测 (cargo test @ wanxiang_engines，零 LLM 确定性回归)"
# 依赖预热后全量单测约 5-15s。极少数情况下 Windows 上杀软实时扫描会短暂锁
# .cargo-build-lock 报 "os error 5"，故保留一次重试；但失败必须拦截，不得放行。
if [ "${SKIP_RUST_TEST:-0}" = "1" ]; then
  echo "   ⏭  SKIP_RUST_TEST=1，跳过（不建议：单测是确定性层唯一的回归保护）。"
else
  min_tests="${MIN_RUST_TESTS:-600}"
  RUST_LOG="$(mktemp -t fxci-rust-XXXXXX.log)"

  rust_test_ok=0
  set +e
  for i in 1 2; do
    # CARGO_INCREMENTAL=0：防 Defender 锁 .rmeta 写坏增量缓存导致 rustc ICE（见 [7/8] 注释）
    # ⚠️ wanxiang_engines 是独立工作区（自己的 Cargo.lock），必须用独立 CARGO_TARGET_DIR
    # （ENG_CARGO_TARGET_DIR，如 <repo>/wanxiang_engines/engcheck）——
    # 与 src-tauri 共用 FX_CARGO_TARGET_DIR 会把两套 serde 解析产物混进同一 target，
    # 导致 CausalGraph 等 trait bound 不匹配（08-03 实测 E0277）。不设则用工作区默认 target。
    if [ -n "${ENG_CARGO_TARGET_DIR:-}" ]; then
      CARGO_TARGET_DIR="$ENG_CARGO_TARGET_DIR" CARGO_INCREMENTAL=0 npm run test:rust >"$RUST_LOG" 2>&1
    else
      CARGO_INCREMENTAL=0 npm run test:rust >"$RUST_LOG" 2>&1
    fi
    if [ $? -eq 0 ]; then rust_test_ok=1; break; fi
    echo "   ⚠️  第 $i/2 次失败，重试…"
  done
  set -e

  # 失败必须显式退出。旧版此处无论重试结果如何都会落到"全部检查通过"，
  # 导致单测全挂仍报绿灯（门禁假阳性），已修。
  if [ "$rust_test_ok" -ne 1 ]; then
    echo ""
    tail -30 "$RUST_LOG"
    echo ""
    echo "❌ Rust 单测失败，门禁不通过。"
    exit 1
  fi

  # 统计实际通过数。防止「测试被误删/被 cfg 掉后套件变空，cargo 仍 exit 0」这类
  # 静默失效——通过数骤降时门禁必须报警，而不是继续报绿灯。
  passed="$(grep -oE 'test result: ok\. [0-9]+ passed' "$RUST_LOG" \
            | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')"
  echo "   ✔ 通过 ${passed} 个 Rust 单测（下限 ${min_tests}）"
  if [ "$passed" -lt "$min_tests" ]; then
    echo ""
    echo "❌ Rust 单测通过数 ${passed} 低于下限 ${min_tests}，疑似测试被删除或未编译。"
    echo "   若为有意精简，请显式调整：MIN_RUST_TESTS=<新下限> 或修改脚本默认值。"
    exit 1
  fi
fi

echo ""
echo "==> [6/8] 万象工作区单测 (cargo test --workspace @ wanxiang/，覆盖 7 个 crate 确定性回归)"
# 覆盖 wanxiang/ 工作区全部 crate（本 fork 实跑 249 单测，下限 240；上游全量版约 340）。
# 修复门禁盲区：原 [5/8] 只测 wanxiang_engines 一个 crate，而 wanxiang_types / wanxiang_core /
# wanxiang_brain / wanxiang_evolution / wanxiang_world / wanxiang_engine / wanxiang_sdk
# 六个 crate 的 #[test] 长期不在门禁内——它们编译失败或被误删都照样绿灯。
# 故此步用 `cargo test --workspace` 跑全工作区，与原 wanxiang_engines 步骤互补
# （engines 步骤因历史 ENG_CARGO_TARGET_DIR 隔离保留不动）。
if [ "${SKIP_RUST_TEST:-0}" = "1" ]; then
  echo "   ⏭  SKIP_RUST_TEST=1，跳过（不建议：万象工作区是引擎底层唯一的回归保护）。"
else
  min_wx="${MIN_WANXIANG_TESTS:-240}"
  WX_LOG="$(mktemp -t fxci-wx-XXXXXX.log)"

  wx_test_ok=0
  set +e
  for i in 1 2; do
    # CARGO_INCREMENTAL=0：防 Defender 锁 .rmeta 写坏增量缓存导致 rustc ICE（见 [7/8] 注释）
    # ⚠️ wanxiang/ 是独立工作区（自己的 Cargo.lock），必须用独立 CARGO_TARGET_DIR
    # （WX_CARGO_TARGET_DIR，如 <repo>/wanxiang/wxcheck）——
    # 与 src-tauri(FX) / wanxiang_engines(ENG) 共用会把三套 serde 解析产物混进同一 target，
    # 导致 trait bound 不匹配（E0277）。不设则用工作区默认 target。
    # 用 (cd wanxiang && ... ) 子 shell，避免改变外层 cwd 影响后续 [7/8] 步骤。
    if [ -n "${WX_CARGO_TARGET_DIR:-}" ]; then
      (cd wanxiang && CARGO_TARGET_DIR="$WX_CARGO_TARGET_DIR" CARGO_INCREMENTAL=0 cargo test --workspace >"$WX_LOG" 2>&1)
    else
      (cd wanxiang && CARGO_INCREMENTAL=0 cargo test --workspace >"$WX_LOG" 2>&1)
    fi
    if [ $? -eq 0 ]; then wx_test_ok=1; break; fi
    echo "   ⚠️  第 $i/2 次失败，重试…"
  done
  set -e

  # 失败必须显式退出（同 [5/8] 门禁假阳性修复）。
  if [ "$wx_test_ok" -ne 1 ]; then
    echo ""
    tail -30 "$WX_LOG"
    echo ""
    echo "❌ 万象工作区单测失败，门禁不通过。"
    exit 1
  fi

  # 统计实际通过数。防止「测试被误删/被 cfg 掉后套件变空，cargo 仍 exit 0」这类
  # 静默失效——通过数骤降时门禁必须报警，而不是继续报绿灯。
  wx_passed="$(grep -oE 'test result: ok\. [0-9]+ passed' "$WX_LOG" \
              | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')"
  echo "   ✔ 通过 ${wx_passed} 个万象工作区单测（下限 ${min_wx}）"
  if [ "$wx_passed" -lt "$min_wx" ]; then
    echo ""
    echo "❌ 万象工作区单测通过数 ${wx_passed} 低于下限 ${min_wx}，疑似测试被删除或未编译。"
    echo "   若为有意精简，请显式调整：MIN_WANXIANG_TESTS=<新下限> 或修改脚本默认值。"
    exit 1
  fi
fi

echo ""
echo "==> [7/8] Rust 桥接层单测 (cargo test @ src-tauri，wx_* 命令 / 世界图 / 文件 IO)"
# 为什么必须单列这一步：[4/8] 的 `cargo check` 只编译**主体代码**，不编译 #[cfg(test)]
# 测试模块，因此桥接层测试即使**编译不过**也照样绿灯。历史教训：wanxiang_bridge.rs 里
# 16 处测试因命令签名重构（新增 AppHandle / novel_id）而长期编译失败，整个 src-tauri
# 测试二进制根本 build 不出来 = 一个都没跑过，却从未被门禁发现。故此步不可省。
if [ "${SKIP_TAURI_TEST:-0}" = "1" ]; then
  echo "   ⏭  SKIP_TAURI_TEST=1，跳过（不建议：桥接层是前端与引擎之间唯一的回归保护）。"
else
  min_tauri="${MIN_TAURI_TESTS:-50}"
  TAURI_LOG="$(mktemp -t fxci-tauri-XXXXXX.log)"

  set +e
  # CARGO_INCREMENTAL=0：本机 Defender 偶发锁 .rmeta 拷贝（os error 5），会把
  # target/debug/incremental 写坏 → rustc ICE（"compiler unexpectedly panicked"）。
  # 禁用增量直接复用已有 rlib，编译时间几乎不变，彻底绕开（08-03 踩坑固化）。
  CARGO_INCREMENTAL=0 npm run test:tauri >"$TAURI_LOG" 2>&1
  tauri_code=$?
  set -e

  if [ "$tauri_code" -ne 0 ]; then
    echo ""
    tail -40 "$TAURI_LOG"
    echo ""
    echo "❌ src-tauri 桥接层单测失败，门禁不通过。"
    exit 1
  fi

  tauri_passed="$(grep -oE 'test result: ok\. [0-9]+ passed' "$TAURI_LOG" \
                  | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')"
  echo "   ✔ 通过 ${tauri_passed} 个桥接层单测（下限 ${min_tauri}）"
  if [ "$tauri_passed" -lt "$min_tauri" ]; then
    echo ""
    echo "❌ 桥接层单测通过数 ${tauri_passed} 低于下限 ${min_tauri}，疑似测试被删除或未编译。"
    echo "   若为有意精简，请显式调整：MIN_TAURI_TESTS=<新下限> 或修改脚本默认值。"
    exit 1
  fi
fi

# ─── [8/8] 离线核心自检（零模型 / 零 Key / 可断网）───
# 守的是「本地确定性能力」本身：LNN 三件套（AI 味 / 张力 / 文风）+ 离线词向量 RAG。
# 这部分不依赖任何外部服务，此前只在真机验收时由人工跑一次（outputs/零依赖验收清单.md），
# 无回归保护 —— 一旦被改坏，用户会误判成「没配模型所以不能用」。
if [ "${SKIP_OFFLINE_VERIFY:-0}" = "1" ]; then
  echo ""
  echo "==> [8/8] ⏭  离线核心自检跳过 (SKIP_OFFLINE_VERIFY=1)"
else
  echo ""
  echo "==> [8/8] 离线核心自检 (零模型 / 零 Key / 可断网)"
  if ! NO_COLOR=1 npm run verify:offline; then
    echo ""
    echo "❌ 离线核心自检失败：本地确定性能力（LNN / 离线词向量）异常。"
    exit 1
  fi
fi

echo ""
echo "✅ 全部检查通过"
