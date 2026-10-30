# AuraLine — 专为办公电脑打造的极简 QQ音乐 声学隐身细线

**AuraLine** 是一个极简、克制、零云端上传的实时音频视觉化微组件，专为搭配 **QQ音乐桌面歌词** 在办公电脑上使用而设计。

它摒弃了传统全屏频谱或笨重的歌词大框，仅保留一条可自由调节长宽的**声学隐身细线（Stealth Acoustic Fine Line）**，并在细线内部实时呈现**低/中/高三频乐器流体光晕**、**随主音高（Pitch）平滑游走的核心流光**、**声波微澜粒子**、**节拍瞬时加粗闪烁（Beat Flash）**以及**底部 `-40dB` 阈值超细实时音量条**。

---

## 1. 核心设计约束（供本地 Agent 继续开发时严格遵循）

1. **办公极简与克制美学**：
   - 仅保留「隐身细线」形态（默认 `360 × 8 px`，支持 `160–640 px` 长度与 `4–16 px` 粗细调节），不添加冗余的卡片堆叠、网格背景或花哨弹窗。
   - 支持一键切换纯平深色（`#09090B`）与办公浅灰（`#F4F4F5`）底色，支持 `Alt + H` 快捷键一键隐藏底部微调栏进入纯细线状态。
2. **100% 本机内存运算（零网络上传）**：
   - 所有音频信号（系统音频捕获 `getDisplayMedia`、麦克风/混音 `getUserMedia`、本地音频文件）均仅在浏览器本地内存的 `AudioContext` + `AnalyserNode` 中完成实时 FFT 频谱与时域分析。
   - **严禁**任何音频录制、存储或向外部服务器上传的行为。
3. **极低 CPU / GPU 资源占用**：
   - 支持 **自动休眠（Auto-Sleep）**：当连续静默（`rmsVolume < 0.038`）达到设定时长（`5s / 10s / 30s / 60s`）时，自动进入 **0 FPS 暂停重绘** 或 **2 FPS 极低帧率待机**，同时将后台音频唤醒轮询降频至 `5Hz (200ms)`；一旦检测到声音输入，在 `<0.2s` 内即刻满帧唤醒。
   - 所有 DOM 位移、弹性缩放与底部音量条均仅使用 GPU 合成属性（`transform: scale3d / translate3d`、`opacity`）。
4. **双端同步约束（React 主应用 + 单文件离线 HTML 导出器）**：
   - 本仓库提供一键导出免安装单文件离线版功能（`src/utils/exportStandaloneHtml.ts`）。本地 Agent 在修改核心视觉特效或音频参数时，**请务必同步更新 `src/components/MiniAuraWidget.tsx` 与 `src/utils/exportStandaloneHtml.ts`**。

---

## 2. 目录结构与模块职责

```text
├── index.html                        # 页面入口与字体加载 (Outfit, Plus Jakarta Sans, JetBrains Mono)
├── metadata.json                     # 应用元数据与本地音频权限声明 (microphone, display-capture)
├── package.json                      # 依赖与构建脚本 (Vite + React 19 + TypeScript + Tailwind CSS v4)
└── src/
    ├── main.tsx                      # React 挂载入口
    ├── index.css                     # Tailwind CSS v4 导入与基础字体/等宽数字变量
    ├── types/
    │   └── audio.ts                  # 核心类型定义：AudioTelemetry、StealthLineSettings、色彩预设 AURA_THEMES
    ├── services/
    │   └── audioEngine.ts            # Web Audio API 实时声学分析引擎 (FFT 2048、三频解构、音高、节拍弹簧物理、静默计时)
    ├── components/
    │   └── MiniAuraWidget.tsx        # 隐身声学细线核心渲染组件 (Canvas 2D 三频流体 + 节拍闪烁 + 底部 -40dB 音量条)
    ├── utils/
    │   └── exportStandaloneHtml.ts   # 单文件零依赖离线版 (.html) 生成与下载工具
    └── App.tsx                       # 主界面：顶栏主题切换、自由拖拽画布、Document PiP 独立置顶小窗、底部微调与自动休眠栏
```

---

## 3. 核心技术管线说明

### 3.1 实时声学特征解构 (`src/services/audioEngine.ts`)
`RealtimeAudioEngine.sampleTelemetry()` 每帧输出 `AudioTelemetry` 数据结构：

- **三频乐器能量映射 (`FFT 2048`)**：
  - `bassEnergy` (`20Hz – 250Hz`)：对应底鼓、贝斯，驱动细线左侧流体脉冲与节拍冲击检测。
  - `midEnergy` (`250Hz – 2500Hz`)：对应人声、钢琴、吉他，驱动细线中央核心流光与主波形丝线。
  - `trebleEnergy` (`2500Hz – 14000Hz`)：对应弦乐泛音、镲片、合成器高频，驱动细线右侧微光与悬浮声学微粒。
- **主音高追踪 (`dominantPitchHz` & `pitchNormalized`)**：
  - 在 `20Hz – 2500Hz` 基频区间内提取频谱能量峰值并做指数平滑，对数映射至 `70Hz – 1500Hz` 的 `[0, 1]` 归一化区间（`pitchNormalized`），实时控制细线中央流光团的水平游走重心。
- **瞬态节拍检测与弹簧阻尼物理 (`isBeat` & `springScale`)**：
  - 通过低频能量一阶差分（`bassDelta > 0.085 && bassEnergy > 0.22`）配合冷却帧窗口触发 `isBeat = true`。
  - 向阻尼谐振子模型注入瞬时速度冲量，输出平滑的 `springScale`（`0.96 ~ 1.24`），驱动细线产生富有弹性的物理呼吸感。
- **自动休眠检测 (`silentDurationSec` & `isSleeping`)**：
  - 当 `rmsVolume < 0.038` 时累加静默时长；超过 `autoSleepDelaySec` 时标记 `isSleeping = true`。

### 3.2 隐身细线视觉渲染 (`src/components/MiniAuraWidget.tsx`)
1. **三频流体光晕层**：在胶囊裁剪区域内使用 `globalCompositeOperation = 'screen'` 叠加左（低频）、中（随 `pitchNormalized` 水平偏移的中频）、右（高频）三组径向渐变色团。
2. **节拍瞬态加粗与高光闪烁 (`beatFlash`)**：
   - 当 `telemetry.isBeat` 触发时，`beatFlash` 瞬时跃升至 `0.78 + bassEnergy * 0.35`，随后按 `0.82/帧` 指数衰减。
   - `beatFlash` 同步驱动细线胶囊的**瞬时轻微加粗**（`activeThickness`）、**中心白光渐变高光层**、**外缘描边提亮**以及**外围柔光晕染**。
3. **底部 `-40dB` 超细实时音量条**：
   - 位于细线正下方（高度 `1.5px`），仅在 `!isSleeping && dbLevel > -40` 时显示（`opacity: 0.88`），低于 `-40dB` 时自动隐去（`opacity: 0`）。
   - 将 `-40dB ~ 0dB` 线性映射为 `scale3d(fillRatio, 1, 1)`，并同步当前色彩预设的三频渐变。
4. **四组壁纸色彩预设 (`AURA_THEMES`)**：
   - `minimal_white`（极简白 · 黑白对比）
   - `deep_sea`（深海静谧 · 蓝紫色系）
   - `vibrant_pulse`（活力律动 · 橙红色系）
   - `forest_mist`（森屿微光 · 青翠色系）

---

## 4. 本地开发与运行指南

```bash
# 1. 安装依赖
npm install

# 2. 启动本地开发服务器 (默认端口 3000)
npm run dev

# 3. 类型检查与生产构建验证
npm run lint
npm run build
```

---

## 5. 本地 Agent 后续迭代建议（Roadmap）

如果本地 Agent 计划将该组件进一步封装为原生桌面常驻程序，建议按以下方向扩展：

1. **Tauri / Electron 透明无边框置顶壳封装**：
   - 将当前 React 组件打包进 Tauri（推荐，体积 `<5MB`）或 Electron，开启 `transparent: true`、`frame: false`、`alwaysOnTop: true` 与鼠标穿透开关（`setIgnoreMouseEvents`），即可实现真正悬浮在 Windows / macOS 桌面任意位置（紧贴 QQ音乐桌面歌词）的原生透明挂件。
2. **系统级环回音频直连（WASAPI Loopback / CoreAudio Tap）**：
   - 在原生桌面壳中通过 Rust (`cpal`) 或系统音频环回接口直接静默读取声卡输出，免去浏览器每次启动需手动弹窗确认 `getDisplayMedia` 的步骤。
3. **配置持久化**：
   - 将用户的 `StealthLineSettings`（细线长宽、色彩预设、自动休眠时长、拖拽坐标）持久化至 `localStorage` 中，实现打开即恢复上次工位状态。
