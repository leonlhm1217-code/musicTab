# AuraLine — Impeccable 设计重构实施计划（Pioneer / Alpine 黑金拉丝铝仪器风）

本计划基于 **[pbakaus/impeccable](https://github.com/pbakaus/impeccable)** 的核心工作流（`Context-Driven Design`、`/audit` 反 AI Slop 审查、`/distill` 降噪提纯、`/polish` 硬件级交互打磨、`/typeset` 精密排版）以及您选定的 **阿尔派 (Alpine) / 先锋 (Pioneer) 经典黑金拉丝铝车载仪器风** 进行全方位重构。

---

## 一、Impeccable 审美审计与反模式清理清单 (`/audit` & `/distill`)

| 审计维度 | 现有代码中的 AI Slop / 视觉噪音 | Impeccable 重构方案 |
| :--- | :--- | :--- |
| **层级与容器 (`/distill`)** | `SettingsPage.tsx` 堆叠了 6 个 `rounded-xl bg-zinc-900/50 border` 独立卡片，内部又套一层带边框按钮（典型的 Cards-within-Cards 噪音）。 | 移除外层碎片化卡片套盒，改为**一体式深黑拉丝阳极氧化铝主机面板 (`#0A0A0C`) + `1px` 精密暗金/炭灰分割线 (`border-white/[0.07]`)**。 |
| **装饰性图标与绿点 (`/quieter`)** | 每个分区标题前都有装饰性图标（`<LayoutPanelTop>`, `<BarChart3>`, `<Palette>`, `<Sliders>`, `<Cpu>`）；停靠选项右侧与预览顶栏有 `bg-emerald-400 rounded-full` / `animate-pulse` 呼吸绿点。 | 彻底移除所有装饰性标题图标与圆点；状态指示全部采用**等宽精密字符标签**（如 `NOMINAL · 60 FPS` / `STANDBY · 0 FPS`）。 |
| **空间利用 (`/clarify`)** | 4 个任务栏停靠模式纵向排列占用了近 200px 高度，挤压了核心调节区。 | 浓缩为单行 4 段式**机头物理按键分段控制器（Segmented Selector）**：`最左贴合` · `图标右侧` · `托盘左侧` · `自由坐标`，下方配单行无框微字说明。 |
| **控制组件质感 (`/polish`)** | 使用浏览器默认 `<input type="range" className="accent-zinc-200">`，缺乏阻尼刻度感且无法快速归位。 | 定制**黑金拉丝铝精密推子（Tactile Hardware Fader）**：支持**双击推子瞬间恢复出厂默认值**，右侧数值与单位（`px` / `%` / `x`）字号层级分离并强制 `tabular-nums`。 |

---

## 二、分文件重构实施细节

### 1. `/DESIGN.md`（新建：Impeccable 上下文设计规范）
- 固化产品的核心身份（90 年代末 Pioneer Carrozzeria / Alpine CDA 旗舰车载机头 VFD 频谱仪）。
- 明确 **60-30-10 色彩预算**：
  - **60% 主机底盘**：深黑阳极氧化拉丝铝 (`#08080A` ~ `#0D0D10`)。
  - **30% 结构与刻度**：VFD 深邃滤光玻璃 (`#040507`)、`1px` 精密分割线 (`rgba(255,255,255,0.07)`)、冷灰铭文 (`#71717A`)。
  - **10% 仪器高光**：经典香槟琥珀金 (`#D4AF37` / `#F59E0B`) 与 VFD 荧光青 (`#00F5D4`)，仅用于当前激活档位与推子游标。
- 明确字体与排版铁律：`Outfit`（机头型号与主标题）、`Plus Jakarta Sans`（正文控制项）、`JetBrains Mono` + `tabular-nums`（所有频率、像素、分贝、倍率读数）。

### 2. `/src/index.css`（升级硬件级质感与推子样式）
- 新增细腻的阳极氧化铝微纹理背景类与 VFD 玻璃内阴影样式。
- 为自定义硬件推子（`<input type="range">`）编写跨内核的精密切削金属推柄（Chamfered Champagne Gold / Brushed Titanium Thumb）与刻度轨道样式，支持键盘方向键微调与 `:focus-visible` 高对比度焦点环。

### 3. `/src/components/SettingsPage.tsx`（重构为先锋/阿尔派机头控制面板）
- **顶部铭牌栏（Header Contract）**：左侧展示 `AURALINE // DEH-P99` 风格简洁标题与音频链路状态，右侧单一明确动作按钮（`退出程序`）。
- **唯一视觉焦点：下沉式 VFD 真空荧光屏预览舱（Recessed VFD Stage）**：
  - 内嵌深色滤光玻璃视窗，实时渲染 32 段 VFD 频谱。
  - 底部自带真实车载均衡器频率坐标尺：`32Hz` · `64Hz` · `125Hz` · `250Hz` · `500Hz` · `1kHz` · `2kHz` · `4kHz` · `8kHz` · `16kHz`。
  - 顶部左右两端以等宽数字实时显示当前主频段采样状态、可用任务栏槽位宽度（`SLOT 184px · 24 BANDS`）及不透明度。
- **单层分割线控制矩阵（Zero-Card-Nesting）**：
  - **01. 任务栏停靠位置**：单行 4 档分段按键 + 水平偏移推子（双击归零 `0px`）。
  - **02. 频谱分辨率与峰值驻留**：`16 / 24 / 32 BANDS` 机械档位切换 + `PEAK-HOLD` 开关。
  - **03. VFD 荧光灯珠滤色片**：6 款车载经典配色，以精致的三色荧光灯珠条块呈现，无多余花哨胶囊。
  - **04. 几何尺寸与音频增益推子组**：整体不透明度（双击复位 `100%`）、最大总宽度（双击复位 `180px`）、柱体高度（双击复位 `26px`）、增益灵敏度（双击复位 `1.00x`）。
  - **05. 静音归零与电源管理**：等待秒数档位（`5s / 10s / 30s / 60s`）与底部三联硬件开关（`开机自启` · `鼠标穿透` · `位置复位`）。

### 4. `/src/App.tsx`（净化 Web 预览顶栏与微交互）
- 移除预览顶栏的 `animate-pulse` 呼吸绿点与胶囊边框，改为符合 Impeccable `/quieter` 原则的极简无框机头状态栏，所有按钮保证单行不折行（`whitespace-nowrap shrink-0`）。
