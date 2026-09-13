# a9g-demo

安信可 [A9G Pudding 开发板](docs/a9g-dev_v1.2.pdf) 的 C 语言开发项目：基于 [GPRS_C_SDK](https://github.com/Ai-Thinker-Open/GPRS_C_SDK) 直接写固件（不用 AT 指令），在 Linux 下编译、烧录，把 GPS 轨迹记到 TF 卡，再用网页查看。

**在线轨迹查看器：<https://hungtcs-lab.github.io/a9g-demo/>**（CSV 只在浏览器本地解析，不会上传）

## 内容

| 路径 | 说明 |
|---|---|
| [`apps/blink`](apps/blink) | 闪烁板载 LED（IO27 / IO28），新程序的模板 |
| [`apps/hwtest`](apps/hwtest) | TF 卡 + GPS 自检，结果输出到 Trace 和 UART1 |
| [`apps/gpslogger`](apps/gpslogger) | GPS 轨迹记录，每秒一个点写入 TF 卡 `/t/gps/YYYYMMDD.csv`，自动修正 GPS 周数翻转导致的日期错误 |
| [`web-viewer`](web-viewer) | 轨迹查看网页（React + Vite + Mantine + Leaflet） |
| [`tools`](tools) | coolwatcher 烧录/调试工具（Linux 版）、串口日志脚本、旧 CSV 日期修正脚本 |
| [`docs`](docs) | 原理图、引脚图、手册，以及原厂 AT 固件备份和官方烧录工具 |
| `GPRS_C_SDK/`、`GPRS_CSDTK/` | SDK 和 mips-elf-gcc 工具链（git submodule，未做修改） |

## 快速开始

### 1. 克隆

```bash
git clone https://github.com/hungtcs-lab/a9g-demo.git
cd a9g-demo
git submodule update --init   # SDK + 工具链，约 190MB
```

### 2. 编译

```bash
./build.sh                      # 显示用法和现有 apps
./build.sh gpslogger            # 编译 apps/gpslogger（debug）
./build.sh gpslogger release    # release 带看门狗，崩溃自动重启
./build.sh demo gps             # 编译 SDK 自带示例
```

`build.sh` 会自动准备工具链环境，结束时打印要烧录的文件：

- `*_flash_debug.lod`（约 150KB）：日常烧这个
- `*_B2130_debug.lod`（约 5.4MB）：第一次烧录或升级 SDK 后烧

> 路径里如果有 `@` 等特殊字符，工具链会被复制到 `~/.cache/gprs-csdtk/`（约 500MB）。

新建程序：复制 `apps/blink` 为 `apps/<名字>`，把 Makefile 里的 `LOCAL_NAME` 改成 `demo/<名字>`，入口函数改成 `<名字>_Main()`。

### 3. 烧录

硬件连接（USB 转串口模块，3.3V 电平，只接 TX / RX / GND）：

| 用途 | 开发板引脚 | 波特率 |
|---|---|---|
| 烧录、Trace 日志 | HST_TX / HST_RX | 921600 |
| UART1 输出、命令 | TX1 / RX1（IO1 / IO0） | 115200 |

开发板用 5V 供电，接 **VUSB/5V** 引脚（**不要**接到 VBAT）。板载 micro USB 不是串口，不能用来烧录。

```bash
cd tools/coolwatcher/usr/bin && ./coolwatcher &
```

1. 启动时选择 profile **8955**，串口选 COM1（对应 `/dev/ttyACM0`）
2. **LOD FLASH** 选择要烧的 `.lod`
3. **DRY FLASH** 选择 `host_8955_flsh_spi32m_ramrun.lod`
4. 点火焰图标开始下载；超时就按一下板子的复位键再试

### 4. 查看轨迹

把 TF 卡里 `gps/` 目录下的 CSV 拖进 [在线查看器](https://hungtcs-lab.github.io/a9g-demo/)，或本地运行：

```bash
cd web-viewer
pnpm install
pnpm dev        # http://localhost:5173
```

功能：地图轨迹（按速度 / HDOP / 卫星数着色）、统计（点数、时长、里程）、按卫星数和 HDOP 筛选、按时间回放、逐点查看。底图默认高德（坐标自动从 WGS84 转为 GCJ-02），也可切换到 OpenStreetMap。没有数据时可以点"示例轨迹"体验。

## gpslogger

CSV 格式：

```csv
utc,lat,lon,alt_m,speed_kmh,course_deg,sats,hdop,fix
2026-09-11T17:30:17Z,39.908700,116.397500,50.0,1.5,118.2,7,1.2,3D
```

- LED：IO27 每写一个点翻转一次，每秒闪烁表示 TF 卡错误；IO28 常亮表示已定位，闪烁表示有 GPS 数据但未定位，熄灭表示没有 GPS 数据
- UART1 命令（以换行结尾）：`status` 查看当前状态，`sim` 切换模拟 NMEA 输入（没有卫星信号时测试写卡）
- 最多每 10 个点刷新一次文件，断电最多丢失 10 秒数据
- 旧固件记录的文件日期可能停在 2007 年（GPS 周数翻转），用 `python3 tools/fix_rollover.py <文件或目录> -o <输出目录>` 修正

## 恢复原厂 AT 固件

`docs/firmware/` 保存了原厂固件 V02.02.20180825R（`.afw`，附 `SHA256SUMS`）和官方烧录工具 `fpupgrade.exe`（仅 Windows）。串口接 HST，FWH 选择 `.afw` 文件，**不要勾选 GPS**。

## 致谢

- [Ai-Thinker-Open/GPRS_C_SDK](https://github.com/Ai-Thinker-Open/GPRS_C_SDK)、[Ai-Thinker-Open/GPRS_CSDTK](https://github.com/Ai-Thinker-Open/GPRS_CSDTK)
- [pulkin/csdtk42-linux](https://github.com/pulkin/csdtk42-linux)：Linux 版 coolwatcher

`tools/coolwatcher` 和 `docs/` 中的固件、工具、手册版权归原厂商所有，仅为方便开发备份于此。
