import React from 'react';
import {
  AURA_THEMES,
  AuraThemeId,
  AudioTelemetry,
  DEFAULT_SETTINGS,
  StealthLineSettings,
  TaskbarDockMode,
  TaskbarSlotTelemetry,
} from '../types/audio';
import { MiniAuraWidget } from './MiniAuraWidget';
import {
  ArrowLeft,
  Lock,
  Power,
  Rocket,
  RotateCcw,
  Unlock,
  X,
} from 'lucide-react';

interface SettingsPageProps {
  settings: StealthLineSettings;
  telemetryRef: React.MutableRefObject<AudioTelemetry>;
  taskbarSlot: TaskbarSlotTelemetry | null;
  isSleepingState: boolean;
  clickThroughLocked: boolean;
  autoStartEnabled: boolean;
  isStandaloneWindow: boolean;
  onUpdateSettings: (partial: Partial<StealthLineSettings>) => void;
  onToggleClickThrough: (nextIgnore: boolean) => void;
  onToggleAutoStart: (nextEnabled: boolean) => void;
  onResetPosition: () => void;
  onCloseSettings: () => void;
  onQuitApp: () => void;
}

const VFD_FREQUENCY_MARKS = [
  '32Hz',
  '64Hz',
  '125Hz',
  '250Hz',
  '500Hz',
  '1kHz',
  '2kHz',
  '4kHz',
  '8kHz',
  '16kHz',
] as const;

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  telemetryRef,
  taskbarSlot,
  isSleepingState,
  clickThroughLocked,
  autoStartEnabled,
  isStandaloneWindow,
  onUpdateSettings,
  onToggleClickThrough,
  onToggleAutoStart,
  onResetPosition,
  onCloseSettings,
  onQuitApp,
}) => {
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCloseSettings]);

  const dockOptions: {
    id: TaskbarDockMode;
    shortLabel: string;
    desc: string;
  }[] = [
    {
      id: 'left_edge',
      shortLabel: '最左贴合',
      desc: '锚定在任务栏最左端，当居中搜索框与图标向左扩展时自动收窄柱数防遮挡',
    },
    {
      id: 'after_icons',
      shortLabel: '图标右侧',
      desc: '自动识别任务栏打开软件图标的右边界，紧随其后动态避让',
    },
    {
      id: 'before_tray',
      shortLabel: '托盘左侧',
      desc: '嵌入在任务栏右下角输入法、网络与时钟托盘区左侧空白槽位',
    },
    {
      id: 'manual',
      shortLabel: '自由坐标',
      desc: '解锁自动停靠限制，允许按住频谱条任意拖放至桌面或任务栏坐标',
    },
  ];

  const activeDockMode = settings.taskbarDockMode ?? 'left_edge';
  const activeDockInfo =
    dockOptions.find((d) => d.id === activeDockMode) ?? dockOptions[0];

  const opacityPct = Math.round((settings.masterOpacity ?? 1.0) * 100);
  const offsetPx = settings.taskbarOffsetX ?? 0;

  return (
    <div className="anodized-chassis min-h-screen w-full bg-[#09090B] text-[#F4F4F6] flex flex-col justify-between px-5 py-4 select-none overflow-y-auto">
      <div className="max-w-md w-full mx-auto pb-4">
        {/* Top Hardware Instrument Header */}
        <header className="flex items-center justify-between border-b border-white/[0.08] pb-3 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {!isStandaloneWindow && (
              <button
                type="button"
                onClick={onCloseSettings}
                className="p-1.5 rounded bg-[#121217] hover:bg-[#1A1A22] border border-white/[0.08] text-zinc-300 transition-colors cursor-pointer shrink-0"
                title="返回任务栏车载频谱视图 (Esc)"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="font-display text-sm font-semibold tracking-wider uppercase text-[#F4F4F6] whitespace-nowrap">
                  AURALINE
                </h1>
                <span className="font-mono-tabular text-[10px] tracking-widest uppercase text-[#D4AF37] whitespace-nowrap">
                  DEH-P99 VFD CONSOLE
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 truncate">
                32段对数声学分析仪 · 任务栏无损内嵌 · WASAPI 零麦克风占用
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onCloseSettings}
              className="px-2.5 py-1.5 rounded bg-[#16161D] hover:bg-[#22222C] border border-[#D4AF37]/40 text-[#F4F4F6] text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="保存并关闭设置窗口 (快捷键 Esc)，保持任务栏频谱继续运行"
            >
              <X className="w-3.5 h-3.5 text-[#E5C158] shrink-0" />
              <span>完成关闭</span>
            </button>

            <button
              type="button"
              onClick={onQuitApp}
              className="px-2.5 py-1.5 rounded bg-red-950/30 hover:bg-red-900/40 border border-red-500/25 text-red-300 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="彻底退出 AuraLine 后台进程"
            >
              <Power className="w-3.5 h-3.5 shrink-0" />
              <span>退出</span>
            </button>
          </div>
        </header>

        {/* Focal Anchor: Recessed Smoked-Glass VFD Spectrum Bay */}
        <section className="my-3.5 rounded-md vfd-display-bay px-3.5 py-2.5 flex flex-col gap-2">
          {/* Top Instrument Telemetry Strip (Unboxed, middle-dot separated) */}
          <div className="w-full flex items-center justify-between text-[10px] font-mono-tabular tracking-wide">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <span className="text-[#E5C158] font-medium">VFD MONITOR</span>
              <span className="text-zinc-600">·</span>
              <span>
                {taskbarSlot
                  ? `SLOT ${taskbarSlot.availableWidth}PX · ${taskbarSlot.recommendedBands} BANDS`
                  : `${settings.preferredBands ?? 24} BANDS`}
              </span>
              <span className="text-zinc-600">·</span>
              <span>OPACITY {opacityPct}%</span>
            </div>
            <span
              className={
                isSleepingState ? 'text-amber-400/90' : 'text-[#00F5D4]/90'
              }
            >
              {isSleepingState ? 'STANDBY 0 FPS' : 'NOMINAL 60 FPS'}
            </span>
          </div>

          {/* Live VFD Bar Stage */}
          <div
            style={{ opacity: settings.masterOpacity ?? 1 }}
            className="py-2 px-2 flex items-center justify-center min-h-[42px] transition-opacity duration-150 overflow-hidden"
          >
            <MiniAuraWidget
              telemetryRef={telemetryRef}
              settings={settings}
              activeBands={settings.preferredBands ?? 24}
              effectiveWidth={Math.min(settings.lineWidth, 340)}
            />
          </div>

          {/* Bottom ISO 10-Band Frequency Scale */}
          <div className="w-full border-t border-white/[0.06] pt-1.5 flex items-center justify-between text-[9px] font-mono-tabular text-zinc-500">
            {VFD_FREQUENCY_MARKS.map((freq) => (
              <span key={freq} className="whitespace-nowrap">
                {freq}
              </span>
            ))}
          </div>
        </section>

        {/* Single-Elevation Control Matrix with 1px Hairline Dividers */}
        <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
          {/* 01. Taskbar Adaptive Docking & Horizontal Offset */}
          <section className="py-3 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[11px] font-semibold tracking-wider text-[#D4AF37]">
                  01.
                </span>
                <h2 className="text-xs font-medium text-zinc-200">
                  任务栏停靠槽位
                </h2>
              </div>
              <span className="text-[10px] font-mono-tabular text-zinc-500">
                {activeDockMode === 'manual'
                  ? 'MANUAL COORD'
                  : 'AUTO AVOIDANCE'}
              </span>
            </div>

            {/* Compact 4-Segment Hardware Selector */}
            <div className="grid grid-cols-4 gap-1 p-1 rounded bg-[#0E0E12] border border-white/[0.06]">
              {dockOptions.map((opt) => {
                const active = activeDockMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateSettings({ taskbarDockMode: opt.id })}
                    className={`py-1.5 px-2 rounded-[3px] text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 text-center ${
                      active
                        ? 'bg-[#1C1C22] text-[#F4F4F6] border border-[#D4AF37]/50 shadow-[0_1px_4px_rgba(0,0,0,0.6)]'
                        : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    {opt.shortLabel}
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              {activeDockInfo.desc}
            </p>

            {activeDockMode !== 'manual' && (
              <div className="flex items-center justify-between gap-3 pt-0.5 text-xs">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-zinc-300">水平微调偏移</span>
                  <span className="text-[10px] text-zinc-500">
                    (双击推子归零)
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="-120"
                    max="120"
                    step="4"
                    value={offsetPx}
                    onDoubleClick={() =>
                      onUpdateSettings({
                        taskbarOffsetX: DEFAULT_SETTINGS.taskbarOffsetX,
                      })
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        taskbarOffsetX: parseInt(e.target.value, 10),
                      })
                    }
                    title="双击复位为 0 px"
                    className="hardware-fader w-32"
                  />
                  <span className="font-mono-tabular w-14 text-right">
                    <span className="text-zinc-100">
                      {offsetPx > 0 ? `+${offsetPx}` : offsetPx}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-0.5">px</span>
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* 02. Spectrum Band Density & Peak-Hold Caps */}
          <section className="py-3 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[11px] font-semibold tracking-wider text-[#D4AF37]">
                  02.
                </span>
                <h2 className="text-xs font-medium text-zinc-200">
                  频谱密度与峰值驻留
                </h2>
              </div>
              <span className="text-[10px] font-mono-tabular text-zinc-500">
                ISO LOGARITHMIC
              </span>
            </div>

            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-zinc-300">首选频谱柱数量</span>
              <div className="flex items-center gap-1 p-0.5 rounded bg-[#0E0E12] border border-white/[0.06]">
                {([16, 24, 32] as const).map((cnt) => {
                  const active = (settings.preferredBands ?? 24) === cnt;
                  return (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => onUpdateSettings({ preferredBands: cnt })}
                      className={`px-2.5 py-1 rounded-[3px] font-mono-tabular text-xs transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-[#1C1C22] text-[#E5C158] border border-[#D4AF37]/50 font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                      }`}
                    >
                      {cnt}
                      <span className="text-[10px] text-zinc-500 ml-0.5">
                        段
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="text-zinc-300">
                  峰值驻留掉落小方块 (Peak-Hold)
                </div>
                <div className="text-[11px] text-zinc-500">
                  复刻阿尔派 / 先锋机头高音瞬态悬停与重力下落包络
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    showPeakHoldCaps: !(settings.showPeakHoldCaps ?? true),
                  })
                }
                className={`px-3 py-1 rounded text-xs font-mono-tabular transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
                  settings.showPeakHoldCaps ?? true
                    ? 'bg-[#1C1C22] text-[#E5C158] border-[#D4AF37]/50 font-medium'
                    : 'bg-[#0E0E12] text-zinc-400 border-white/[0.06] hover:text-zinc-200'
                }`}
              >
                {settings.showPeakHoldCaps ?? true ? 'PEAK ON' : 'PEAK OFF'}
              </button>
            </div>
          </section>

          {/* 03. Car Stereo VFD Phosphor Color Presets */}
          <section className="py-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[11px] font-semibold tracking-wider text-[#D4AF37]">
                  03.
                </span>
                <h2 className="text-xs font-medium text-zinc-200">
                  VFD 荧光灯珠滤色片
                </h2>
              </div>
              <span className="text-[10px] font-mono-tabular text-zinc-500">
                PHOSPHOR MATRIX
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(AURA_THEMES) as AuraThemeId[]).map((tKey) => {
                const palette = AURA_THEMES[tKey];
                const isSelected = settings.theme === tKey;
                return (
                  <button
                    key={tKey}
                    type="button"
                    onClick={() => onUpdateSettings({ theme: tKey })}
                    className={`px-2.5 py-2 rounded text-left transition-all cursor-pointer flex flex-col gap-1 border ${
                      isSelected
                        ? 'bg-[#18181F] border-[#D4AF37]/55 text-white'
                        : 'bg-[#0E0E12] border-white/[0.06] text-zinc-300 hover:border-white/[0.14]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium whitespace-nowrap truncate">
                        {palette.name}
                      </span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <span
                          className="w-2 h-2.5 rounded-[1px]"
                          style={{
                            backgroundColor: `rgb(${palette.bassColor.join(',')})`,
                          }}
                        />
                        <span
                          className="w-2 h-2.5 rounded-[1px]"
                          style={{
                            backgroundColor: `rgb(${palette.midColor.join(',')})`,
                          }}
                        />
                        <span
                          className="w-2 h-2.5 rounded-[1px]"
                          style={{
                            backgroundColor: `rgb(${palette.trebleColor.join(',')})`,
                          }}
                        />
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-500 line-clamp-1">
                      {palette.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 04. Dimensions, Master Opacity & Gain Faders */}
          <section className="py-3 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[11px] font-semibold tracking-wider text-[#D4AF37]">
                  04.
                </span>
                <h2 className="text-xs font-medium text-zinc-200">
                  任务栏比例尺寸与增益推子
                </h2>
              </div>
              <span className="text-[10px] text-zinc-500">
                双击推子恢复出厂值
              </span>
            </div>

            {/* Quick Taskbar Scale Presets */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded bg-[#0E0E12] border border-white/[0.06]">
              {(
                [
                  { label: '紧凑比例 (240×32)', w: 240, h: 32 },
                  { label: '标准比例 (320×38)', w: 320, h: 38 },
                  { label: '加宽放大 (440×46)', w: 440, h: 46 },
                ] as const
              ).map((preset) => {
                const isCurrent =
                  Math.abs((settings.lineWidth ?? 320) - preset.w) <= 10 &&
                  Math.abs((settings.lineHeight ?? 38) - preset.h) <= 2;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        lineWidth: preset.w,
                        lineHeight: preset.h,
                      })
                    }
                    className={`py-1 px-2 rounded-[3px] text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 text-center ${
                      isCurrent
                        ? 'bg-[#1C1C22] text-[#E5C158] border border-[#D4AF37]/50'
                        : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-300">整体光学不透明度</span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="0.20"
                    max="1.00"
                    step="0.05"
                    value={settings.masterOpacity ?? 1.0}
                    onDoubleClick={() =>
                      onUpdateSettings({
                        masterOpacity: DEFAULT_SETTINGS.masterOpacity,
                      })
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        masterOpacity: Math.max(
                          0.2,
                          Math.min(1, parseFloat(e.target.value))
                        ),
                      })
                    }
                    title="双击复位为 100%"
                    className="hardware-fader w-36"
                  />
                  <span className="font-mono-tabular w-14 text-right">
                    <span className="text-zinc-100">{opacityPct}</span>
                    <span className="text-[10px] text-zinc-500 ml-0.5">%</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-300">最大频谱总宽度</span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="160"
                    max="600"
                    step="10"
                    value={settings.lineWidth ?? 320}
                    onDoubleClick={() =>
                      onUpdateSettings({ lineWidth: DEFAULT_SETTINGS.lineWidth })
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        lineWidth: parseInt(e.target.value, 10),
                      })
                    }
                    title={`双击复位为 ${DEFAULT_SETTINGS.lineWidth} px`}
                    className="hardware-fader w-36"
                  />
                  <span className="font-mono-tabular w-14 text-right">
                    <span className="text-zinc-100">
                      {settings.lineWidth ?? 320}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-0.5">px</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-300">灯珠柱垂直高度</span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="24"
                    max="54"
                    step="2"
                    value={settings.lineHeight ?? 38}
                    onDoubleClick={() =>
                      onUpdateSettings({
                        lineHeight: DEFAULT_SETTINGS.lineHeight,
                      })
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        lineHeight: parseInt(e.target.value, 10),
                      })
                    }
                    title={`双击复位为 ${DEFAULT_SETTINGS.lineHeight} px`}
                    className="hardware-fader w-36"
                  />
                  <span className="font-mono-tabular w-14 text-right">
                    <span className="text-zinc-100">
                      {settings.lineHeight ?? 38}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-0.5">px</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-300">音频前置放大增益</span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="0.6"
                    max="2.2"
                    step="0.05"
                    value={settings.auraSensitivity ?? 1.25}
                    onDoubleClick={() =>
                      onUpdateSettings({
                        auraSensitivity: DEFAULT_SETTINGS.auraSensitivity,
                      })
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        auraSensitivity: parseFloat(e.target.value),
                      })
                    }
                    title={`双击复位为 ${DEFAULT_SETTINGS.auraSensitivity.toFixed(2)}×`}
                    className="hardware-fader w-36"
                  />
                  <span className="font-mono-tabular w-14 text-right">
                    <span className="text-zinc-100">
                      {(settings.auraSensitivity ?? 1.25).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-0.5">×</span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 05. Auto-Sleep & System Utility Controls */}
          <section className="py-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[11px] font-semibold tracking-wider text-[#D4AF37]">
                  05.
                </span>
                <h2 className="text-xs font-medium text-zinc-200">
                  静音休眠与系统控制
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    autoSleepEnabled: !settings.autoSleepEnabled,
                  })
                }
                className={`px-2.5 py-1 rounded text-xs font-mono-tabular transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
                  settings.autoSleepEnabled
                    ? 'bg-[#1C1C22] text-[#E5C158] border-[#D4AF37]/50 font-medium'
                    : 'bg-[#0E0E12] text-zinc-400 border-white/[0.06] hover:text-zinc-200'
                }`}
              >
                {isSleepingState
                  ? 'SLEEP ACTIVE'
                  : settings.autoSleepEnabled
                  ? 'AUTO-SLEEP ON'
                  : 'AUTO-SLEEP OFF'}
              </button>
            </div>

            {settings.autoSleepEnabled && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-zinc-400 mr-1">静音等待阈值:</span>
                  {[5, 10, 30, 60].map((sec) => {
                    const active = settings.autoSleepDelaySec === sec;
                    return (
                      <button
                        key={sec}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ autoSleepDelaySec: sec })
                        }
                        className={`px-2 py-0.5 rounded font-mono-tabular transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                          active
                            ? 'bg-[#1C1C22] text-[#E5C158] border-[#D4AF37]/45 font-semibold'
                            : 'bg-[#0E0E12] text-zinc-400 border-white/[0.06] hover:text-zinc-200'
                        }`}
                      >
                        {sec}
                        <span className="text-[10px] text-zinc-500 ml-0.5">
                          s
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      autoSleepBehavior:
                        settings.autoSleepBehavior === 'freeze'
                          ? 'low_fps'
                          : 'freeze',
                    })
                  }
                  className="px-2.5 py-0.5 rounded bg-[#0E0E12] hover:bg-[#18181F] border border-white/[0.08] text-zinc-300 font-mono-tabular transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {settings.autoSleepBehavior === 'freeze'
                    ? '0 FPS 冻结'
                    : '2 FPS 待机'}
                </button>
              </div>
            )}

            {/* Hardware Action Switches */}
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => onToggleAutoStart(!autoStartEnabled)}
                className={`py-2 px-2.5 rounded border text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  autoStartEnabled
                    ? 'bg-[#1C1C22] text-[#E5C158] border-[#D4AF37]/50'
                    : 'bg-[#0E0E12] border-white/[0.07] text-zinc-300 hover:bg-[#16161C]'
                }`}
                title="开启后每次登录 Windows 自动静默嵌入任务栏运行"
              >
                <Rocket className="w-3.5 h-3.5 shrink-0" />
                <span>{autoStartEnabled ? '开机自启: 开' : '开机自启: 关'}</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleClickThrough(!clickThroughLocked)}
                className={`py-2 px-2.5 rounded border text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  clickThroughLocked
                    ? 'bg-[#1C1C22] text-[#E5C158] border-[#D4AF37]/50'
                    : 'bg-[#0E0E12] border-white/[0.07] text-zinc-300 hover:bg-[#16161C]'
                }`}
              >
                {clickThroughLocked ? (
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{clickThroughLocked ? '解除穿透' : '鼠标穿透'}</span>
              </button>

              <button
                type="button"
                onClick={onResetPosition}
                className="py-2 px-2.5 rounded border border-white/[0.07] bg-[#0E0E12] hover:bg-[#16161C] text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>重置位置</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
