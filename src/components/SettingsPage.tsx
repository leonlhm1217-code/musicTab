import React from 'react';
import {
  AURA_THEMES,
  AuraThemeId,
  AudioTelemetry,
  StealthLineSettings,
} from '../types/audio';
import { MiniAuraWidget } from './MiniAuraWidget';
import {
  ArrowLeft,
  Cpu,
  Lock,
  Palette,
  Power,
  Rocket,
  RotateCcw,
  Sliders,
  Unlock,
} from 'lucide-react';

interface SettingsPageProps {
  settings: StealthLineSettings;
  telemetryRef: React.MutableRefObject<AudioTelemetry>;
  isSleepingState: boolean;
  clickThroughLocked: boolean;
  autoStartEnabled: boolean;
  isStandaloneWindow: boolean;
  onUpdateSettings: (partial: Partial<StealthLineSettings>) => void;
  onToggleClickThrough: (nextIgnore: boolean) => void;
  onToggleAutoStart: (nextEnabled: boolean) => void;
  onResetPosition: () => void;
  onBackToBar?: () => void;
  onQuitApp: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  telemetryRef,
  isSleepingState,
  clickThroughLocked,
  autoStartEnabled,
  isStandaloneWindow,
  onUpdateSettings,
  onToggleClickThrough,
  onToggleAutoStart,
  onResetPosition,
  onBackToBar,
  onQuitApp,
}) => {
  return (
    <div className="min-h-screen w-full bg-[#09090B] text-zinc-100 flex flex-col justify-between p-5 select-none overflow-y-auto">
      <div className="max-w-md w-full mx-auto space-y-4">
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            {!isStandaloneWindow && onBackToBar && (
              <button
                type="button"
                onClick={onBackToBar}
                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer"
                title="返回纯细线桌面视图"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
                AuraLine — 隐身细线设置
              </h1>
              <p className="text-[11px] text-zinc-400">
                仅监听扬声器/耳机输出 · 100% 零麦克风占用
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onQuitApp}
            className="px-2.5 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            title="彻底关闭并退出 AuraLine"
          >
            <Power className="w-3.5 h-3.5" />
            <span>退出程序</span>
          </button>
        </header>

        {/* Live Preview Box */}
        <section className="rounded-xl bg-zinc-900/70 border border-zinc-800/80 p-3.5 flex flex-col items-center justify-center gap-2 overflow-hidden">
          <div className="w-full flex items-center justify-between text-[10px] text-zinc-500">
            <span>实时效果预览</span>
            <span>快捷手势：细线上滚轮调透明度 · 双击细线打开设置</span>
          </div>
          <div
            style={{ opacity: settings.masterOpacity ?? 1 }}
            className="py-2 max-w-full overflow-hidden flex items-center justify-center transition-opacity duration-150"
          >
            <MiniAuraWidget
              telemetryRef={telemetryRef}
              settings={{
                ...settings,
                lineWidth: Math.min(settings.lineWidth, 340),
              }}
            />
          </div>
        </section>

        {/* 1. Color Presets */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Palette className="w-3.5 h-3.5 text-zinc-400" />
            <span>流体光晕色彩预设</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(AURA_THEMES) as AuraThemeId[]).map((tKey) => {
              const palette = AURA_THEMES[tKey];
              const isSelected = settings.theme === tKey;
              return (
                <button
                  key={tKey}
                  type="button"
                  onClick={() => onUpdateSettings({ theme: tKey })}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                    isSelected
                      ? 'bg-zinc-800/90 border-zinc-400 text-white'
                      : 'bg-zinc-900/50 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{palette.name}</span>
                    <span className="flex items-center -space-x-1">
                      <span
                        className="w-2.5 h-2.5 rounded-full ring-1 ring-black/40"
                        style={{ backgroundColor: `rgb(${palette.bassColor.join(',')})` }}
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full ring-1 ring-black/40"
                        style={{ backgroundColor: `rgb(${palette.midColor.join(',')})` }}
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full ring-1 ring-black/40"
                        style={{ backgroundColor: `rgb(${palette.trebleColor.join(',')})` }}
                      />
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 line-clamp-1">
                    {palette.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Dimensions, Master Opacity & Sensitivity */}
        <section className="space-y-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Sliders className="w-3.5 h-3.5 text-zinc-400" />
            <span>细线尺寸、隐蔽透明度与律动灵敏度</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">整体不透明度</span>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min="0.20"
                  max="1.00"
                  step="0.05"
                  value={settings.masterOpacity ?? 1.0}
                  onChange={(e) =>
                    onUpdateSettings({
                      masterOpacity: Math.max(0.2, Math.min(1, parseFloat(e.target.value))),
                    })
                  }
                  className="w-36 accent-zinc-200 cursor-pointer"
                />
                <span className="font-mono-tabular w-11 text-right text-zinc-200">
                  {Math.round((settings.masterOpacity ?? 1.0) * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">细线长度</span>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min="160"
                  max="640"
                  step="10"
                  value={settings.lineWidth}
                  onChange={(e) =>
                    onUpdateSettings({ lineWidth: parseInt(e.target.value, 10) })
                  }
                  className="w-36 accent-zinc-200 cursor-pointer"
                />
                <span className="font-mono-tabular w-11 text-right text-zinc-200">
                  {settings.lineWidth}px
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">细线粗细</span>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min="4"
                  max="16"
                  step="1"
                  value={settings.lineHeight}
                  onChange={(e) =>
                    onUpdateSettings({ lineHeight: parseInt(e.target.value, 10) })
                  }
                  className="w-36 accent-zinc-200 cursor-pointer"
                />
                <span className="font-mono-tabular w-11 text-right text-zinc-200">
                  {settings.lineHeight}px
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">节奏弹性强度</span>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.05"
                  value={settings.elasticIntensity}
                  onChange={(e) =>
                    onUpdateSettings({ elasticIntensity: parseFloat(e.target.value) })
                  }
                  className="w-36 accent-zinc-200 cursor-pointer"
                />
                <span className="font-mono-tabular w-11 text-right text-zinc-200">
                  {settings.elasticIntensity.toFixed(2)}x
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Office Auto-Sleep Power Saving */}
        <section className="space-y-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <Cpu className="w-3.5 h-3.5 text-zinc-400" />
              <span>办公电脑静音自动休眠</span>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ autoSleepEnabled: !settings.autoSleepEnabled })
              }
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                settings.autoSleepEnabled
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {isSleepingState
                ? '当前休眠省电中'
                : settings.autoSleepEnabled
                ? '已开启'
                : '已关闭'}
            </button>
          </div>

          {settings.autoSleepEnabled && (
            <div className="flex items-center justify-between gap-2 pt-1 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-zinc-400 mr-1">等待:</span>
                {[5, 10, 30, 60].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => onUpdateSettings({ autoSleepDelaySec: sec })}
                    className={`px-2 py-0.5 rounded font-mono-tabular transition-colors cursor-pointer ${
                      settings.autoSleepDelaySec === sec
                        ? 'bg-zinc-700 text-white font-semibold'
                        : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    autoSleepBehavior:
                      settings.autoSleepBehavior === 'freeze' ? 'low_fps' : 'freeze',
                  })
                }
                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono-tabular transition-colors cursor-pointer"
              >
                {settings.autoSleepBehavior === 'freeze' ? '0FPS 冻结' : '2FPS 待机'}
              </button>
            </div>
          )}
        </section>

        {/* 4. Desktop Bar Position, Auto-Start & Click-Through Controls */}
        <section className="grid grid-cols-3 gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => onToggleAutoStart(!autoStartEnabled)}
            className={`py-2 px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              autoStartEnabled
                ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
            title="开启后每次登录 Windows 自动静默启动 AuraLine"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{autoStartEnabled ? '开机自启:开' : '开机自启:关'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleClickThrough(!clickThroughLocked)}
            className={`py-2 px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              clickThroughLocked
                ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {clickThroughLocked ? (
              <Lock className="w-3.5 h-3.5" />
            ) : (
              <Unlock className="w-3.5 h-3.5" />
            )}
            <span>{clickThroughLocked ? '解除穿透' : '鼠标穿透'}</span>
          </button>

          <button
            type="button"
            onClick={onResetPosition}
            className="py-2 px-2.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置位置</span>
          </button>
        </section>
      </div>
    </div>
  );
};
