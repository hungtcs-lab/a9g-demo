# A9G 开发项目笔记

安信可 A9G Pudding 开发板，用 GPRS_C_SDK（C 语言）开发，不用 AT 指令。以下内容均于 2026-09-12 在本机实测验证。

## 硬件

- **供电**：5V 接右侧排针右下角的 **VUSB/5V**（旁边是 GND），上电自动开机。VBAT 只能接 3.5~4.2V（极限 4.6V），**不能接 5V**（曾误接过一次，模组没坏）。
- **板载 micro USB** 连的是 A9G 自带的 USB，不是串口，电脑识别不了（报 error -71），不要用它通信。
- **串口模块**：WCH CH343（`1a86:55d3`），在电脑上是 `/dev/ttyACM0`，3.3V 电平，只接 TX/RX/GND，不接 VCC。
  - 烧录、看 Trace 日志：接 **HST_TX / HST_RX**（右侧排针下半部分），921600 波特率，交叉连接。
  - AT 指令、UART1 输出：接 **TX1 / RX1**（即 IO1 / IO0，右上角前两个脚），115200 波特率。
- 板上**没有焊加速度计**（LIS3DH）。
- 两颗 LED：IO27、IO28（见 `apps/blink/src/blink.c` 里的 `GPIO_PIN_LED_BLUE` / `GPIO_PIN_LED_GREEN`）。

## 目录

| 路径 | 说明 |
|---|---|
| `apps/<名字>/` | **自己的代码**，每个子目录一个程序（`blink` 闪灯、`hwtest` TF 卡 + GPS 自检、`gpslogger` GPS 轨迹记录到 TF 卡 `/t/gps/YYYYMMDD.csv`，UART1 命令 `status`/`sim`）。入口函数必须叫 `<名字>_Main()`，Makefile 里 `LOCAL_NAME := demo/<名字>` |
| `GPRS_C_SDK/` | SDK（Ai-Thinker-Open/GPRS_C_SDK，git submodule），保持原样不改。`build.sh` 会把 `apps/<名字>` 软链接成 `GPRS_C_SDK/demo/<名字>`（已写入 SDK 的 `.git/info/exclude`）|
| `GPRS_CSDTK/` | 编译工具链 mips-elf-gcc 4.4.2（Ai-Thinker-Open/GPRS_CSDTK，git submodule）|
| `tools/coolwatcher/` | 能用的烧录/调试工具（从 Makimars 的 AppImage 解包，代码段已与 pulkin/csdtk42-linux 原版比对一致）|
| `web-viewer/` | **轨迹查看网页**（React + Vite + Mantine + Leaflet）。`pnpm dev` 起本地服务，上传 CSV 后在地图上看轨迹、按时间回放。详见下文 |
| `tracks/` | 用 `tools/fix_rollover.py` 修正过日期的 CSV（含真实位置，已 gitignore，不入库）|
| `docs/` | 原理图、引脚图、手册 |
| `docs/firmware/` | 原厂 AT 固件备份和官方烧录工具，见下文 |

## 编译

日常用项目根目录的 `./build.sh`（自动设置工具链环境，结束时打印要烧的 lod 路径）：

```bash
./build.sh <名字> [debug|release]       # 编译 apps/<名字>（release 带看门狗，崩溃自动重启）
./build.sh demo <名字> [debug|release]  # 编译 SDK 自带示例 GPRS_C_SDK/demo/<名字>
./build.sh clean <名字>
./build.sh                              # 显示用法和现有 apps
```

新建程序：复制 `apps/blink` 为 `apps/<新名字>`，改 Makefile 的 `LOCAL_NAME` 和入口函数名。SDK 只认自己目录树里的工程，所以才用软链接。

手动编译的等价命令：

```bash
cd GPRS_C_SDK
export CSDTK_ROOT="$PWD/../GPRS_CSDTK/CSDTK"
export TOOLCHAIN_ROOT="$(bash "$CSDTK_ROOT/prepare-runtime-links.sh" --tool-root)"
export RUNTIME_LIB_ROOT="$(bash "$CSDTK_ROOT/prepare-runtime-links.sh" --runtime-lib)"
export PATH="$TOOLCHAIN_ROOT/bin:$PATH"
export LD_LIBRARY_PATH="$RUNTIME_LIB_ROOT:$TOOLCHAIN_ROOT/lib"
bash scripts/build-sdk.sh app debug        # 或 demo <名字> debug|release
```

- 产物在 `hex/<项目>/`：`*_B2130_debug.lod`（约 5.4MB，首次或升级 SDK 后烧）和 `*_flash_debug.lod`（约 150KB，日常烧这个）。
- 路径里有 `@`，工具链脚本会自动把工具链复制到 `~/.cache/gprs-csdtk/`（约 500MB）。
- 克隆后先 `git submodule update --init`（两个子模块共约 190MB）。
- SDK 仓库里 `elfCombine.pl`、`lodCombine.pl`、`fota/linux/fotacreate`、`fotapack` 没有执行权限，`build.sh` 每次编译前会自动 `chmod +x`（手动编译需自己加），SDK 里设了 `core.fileMode false`。`.gitmodules` 给 SDK 设了 `ignore = dirty`，编译产物和软链接不会让主仓库显示改动。

## 烧录

```bash
cd tools/coolwatcher/usr/bin && ./coolwatcher &
```

- 启动时选 profile **8955**，lastcomport = 1（`comport/COM1 -> /dev/ttyACM0`）。
- 工具栏：LOD FLASH 选固件 → DRY FLASH 选 `host_8955_flsh_spi32m_ramrun.lod` → 火焰图标开始下载。
- 下载超时就按一下板子复位键再试。

## 踩过的坑

- **不要用 `GPRS_CSDTK/CSDTK/bin/coolwatcher`**：那个仓库是精简版，自带的 Ruby 库是 Windows 版，也没有 8955 配置，启动报 `rbconfig` LoadError。
- **`demo/gpio` 和 SDK 原始的 `app/` 模板会把所有 GPIO 设为输出并翻转**，包括串口引脚，接着线时不要烧。`apps/blink` 只闪 IO27/IO28。
- `apps/hwtest` 结果同时输出到 Trace 和 UART1（TX1，115200）；要让 Claude 直接读结果，需把串口模块从 HST 挪到 TX1/RX1。
- Linux 下没有官方命令行烧录工具，只能用 coolwatcher 图形界面。

## 轨迹查看网页（web-viewer）

```bash
cd web-viewer && pnpm dev      # http://localhost:5173
```

- **在线版**：推送到 GitHub 后由 `.github/workflows/pages.yml` 自动部署到 GitHub Pages（改动 `web-viewer/**` 时触发，也可在 Actions 页手动运行）。`vite.config.ts` 的 `base` 读环境变量 `BASE_PATH`，工作流里设成 `/<仓库名>/`，本地开发不受影响。
- 上传 `/gps/*.csv`（可多选，按时间合并），也可以点"示例轨迹"：每次随机挑一个公开地标附近的起点，生成随机环线，不含任何真实位置。
- 功能：地图轨迹（按速度/HDOP/卫星数上色）、统计（点数、时长、里程、散布）、按卫星数和 HDOP 筛选、按时间回放（1×~300×，自动跳过断点）、逐点查看。
- 底图默认高德，坐标用 `gcoord` 从 WGS84 转成 GCJ-02；切到 OSM 时不转换。
- 网页**不处理日期**，CSV 里是什么就显示什么。日期修正是录入侧的职责：新固件已在板子上修正，旧文件用 `tools/fix_rollover.py` 转换。
- 依赖都用现成的库：papaparse 解析 CSV、geolib/d3-array 算统计、date-fns 处理时间、chroma-js 配色、Mantine 做界面、react-leaflet 画地图。
- **坑**：Leaflet 的图层 z-index 高达 700，会盖住 Mantine 的 Drawer，所以 `.leaflet-container` 加了 `position: relative; z-index: 0` 做层叠隔离。地图容器必须有明确高度，另外用 ResizeObserver 调 `invalidateSize()`，否则布局变化后地图不重绘。

## 恢复 AT 固件

- 原厂固件版本 **V02.02.20180825R**，IMEI 记在 `CLAUDE.local.md`（不入库）。
- `docs/firmware/` 里有这一版的 `.afw`（从 Wayback Machine 找回，已校验）、更新的 20190915R（`.rar`，本机没法校验完整性）、官方烧录工具 `firmwarw_tool_v2.1.7z`（`fpupgrade.exe`，仅 Windows）及其操作说明。
- GitHub 上 GPRS-AT 仓库的 V1.6RC（2017 年）比原厂固件更旧，不要刷。
- 刷回方法：在 Windows 11 虚拟机（VirtualBox 里已有）运行 `fpupgrade.exe`，串口接 HST，FWH 选 `.afw`，**不要勾选 GPS**。
