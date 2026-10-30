/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AURA_THEMES,
  AuraThemeId,
  AudioTelemetry,
  StealthLineSettings,
} from './types/audio';
import { RealtimeAudioEngine } from './services/audioEngine';
import { MiniAuraWidget } from './components/MiniAuraWidget';
import { Cpu, Eye, EyeOff, Lock, Moon, Palette, RotateCcw, Sun, Unlock } from 'lucide-react';

const STORAGE_KEY = 'auraline_native_settings_v1';
const WEB_DRAG_STORAGE_KEY = 'auraline_web_drag_offset_v1';

const DEFAULT_SETTINGS: StealthLineSettings = {
  lineWidth: 360,
  lineHeight: 8,
  theme: 'minimal_white',
  elasticIntensity: 1.15,
  auraSensitivity: 1.1,
  workLowPower30Fps: false,
  lightCanvasBg: false,
  autoSleepEnabled: true,
  autoSleepDelaySec: 10,
  autoSleepBehavior: 'freeze',
};

function loadSavedSettings(): StealthLineSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadSavedWebDragOffset(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(WEB_DRAG_STORAGE_KEY);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return parsed;
    }
    return { x: 0, y: 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

export default function App() {
  const engineRef = useRef<RealtimeAudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new RealtimeAudioEngine();
  }

  const telemetryRef = useRef<AudioTelemetry>({
    rmsVolume: 0.03,
    dbLevel: -58,
    bassEnergy: 0.05,
    midEnergy: 0.06,
    trebleEnergy: 0.04,
    dominantPitchHz: 0,
    noteName: '--',
    pitchNormalized: 0.5,
    isBeat: false,
    springScale: 1.0,
    springVelocity: 0,
    waveformSlice: new Array(48).fill(0),
    dominantInstrumentLabel: '声卡输出直连运行中',
    silentDurationSec: 0,
    isSleeping: false,
  });

  const [settings, setSettings] = useState<StealthLineSettings>(loadSavedSettings);
  const [hideControls, setHideControls] = useState<boolean>(false);
  const [clickThroughLocked, setClickThroughLocked] = useState<boolean>(false);

  // Persisted drag position for the stealth line when inside a web preview window
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>(loadSavedWebDragOffset);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number }>({
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const [isSleepingState, setIsSleepingState] = useState<boolean>(false);

  const updateSettings = useCallback((partial: Partial<StealthLineSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
    engineRef.current?.resetSilenceTimer();
  }, []);

  const toggleClickThrough = useCallback((nextIgnore: boolean) => {
    setClickThroughLocked(nextIgnore);
    engineRef.current?.setNativeClickThrough(nextIgnore);
  }, []);

  const handleResetPosition = useCallback(() => {
    setDragOffset({ x: 0, y: 0 });
    try {
      localStorage.setItem(WEB_DRAG_STORAGE_KEY, JSON.stringify({ x: 0, y: 0 }));
    } catch {
      // ignore
    }
    engineRef.current?.resetWindowToBottomCenter();
  }, []);

  // Automatically connect to output soundcard loopback on launch + init window position & system tray
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.startAutoConnect();
    engine.initWindowPositionMemory();

    engine.subscribeToTrayCommands((cmd) => {
      if (cmd === 'toggle-controls') {
        setClickThroughLocked(false);
        setHideControls((prev) => !prev);
      } else if (cmd === 'show-controls') {
        setClickThroughLocked(false);
        setHideControls(false);
      } else if (cmd === 'set-click-through:true') {
        setClickThroughLocked(true);
      } else if (cmd === 'set-click-through:false') {
        setClickThroughLocked(false);
      } else if (cmd.startsWith('set-theme:')) {
        const themeId = cmd.replace('set-theme:', '') as AuraThemeId;
        if (themeId in AURA_THEMES) {
          updateSettings({ theme: themeId });
        }
      } else if (cmd === 'reset-position') {
        setClickThroughLocked(false);
        handleResetPosition();
      }
    });

    const resumeOnFirstInteraction = () => {
      engine.resetSilenceTimer();
    };
    window.addEventListener('pointerdown', resumeOnFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', resumeOnFirstInteraction);
      engine.stopAll();
    };
  }, [handleResetPosition, updateSettings]);

  // Real-time local sampling loop with Auto-Sleep CPU throttling
  useEffect(() => {
    let rafId = 0;
    let lastSampleTime = 0;
    let lastUiSync = 0;

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      const engine = engineRef.current;
      if (!engine) return;

      const currentlySleeping = telemetryRef.current.isSleeping;
      const pollInterval = currentlySleeping ? 200 : settings.workLowPower30Fps ? 32 : 16;
      if (now - lastSampleTime < pollInterval) return;
      lastSampleTime = now;

      const sample = engine.sampleTelemetry(
        settings.elasticIntensity,
        settings.autoSleepEnabled,
        settings.autoSleepDelaySec
      );
      telemetryRef.current = sample;

      if (now - lastUiSync > 250) {
        lastUiSync = now;
        setIsSleepingState(sample.isSleeping);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    settings.elasticIntensity,
    settings.autoSleepEnabled,
    settings.autoSleepDelaySec,
    settings.workLowPower30Fps,
  ]);

  // Shortcut Alt + H toggles pure stealth mode & releases click-through lock when restoring UI
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setHideControls((prev) => {
          const next = !prev;
          if (!next) {
            toggleClickThrough(false);
          }
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleClickThrough]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (clickThroughLocked) return;

    // In Tauri native desktop runtime, invoke native OS frameless window dragging & auto-persist position
    if (engineRef.current?.isRunningInTauri()) {
      engineRef.current.startNativeWindowDrag();
      return;
    }

    isDraggingRef.current = true;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dragOffset.x,
      origY: dragOffset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const nextPos = {
      x: dragStartRef.current.origX + (e.clientX - dragStartRef.current.startX),
      y: dragStartRef.current.origY + (e.clientY - dragStartRef.current.startY),
    };
    setDragOffset(nextPos);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      localStorage.setItem(WEB_DRAG_STORAGE_KEY, JSON.stringify(dragOffset));
    } catch {
      // ignore
    }
  };

  const isLight = settings.lightCanvasBg;
  const isTauri = engineRef.current?.isRunningInTauri() ?? false;

  return (
    <div
      className={`min-h-screen w-full flex flex-col justify-between transition-colors duration-200 select-none overflow-hidden ${
        isTauri
          ? 'bg-transparent text-zinc-100'
          : isLight
          ? 'bg-[#F4F4F5] text-zinc-900'
          : 'bg-[#09090B] text-zinc-100'
      }`}
    >
      {/* Restore Micro-Tuning Bar Button when in Pure Stealth Mode */}
      {hideControls && (
        <button
          type="button"
          onClick={() => {
            setHideControls(false);
            toggleClickThrough(false);
          }}
          title="展开微调栏并解除鼠标穿透 (Alt + H 或右键系统托盘)"
          className={`fixed top-2.5 right-3 z-30 p-1.5 rounded-md opacity-10 hover:opacity-90 transition-opacity cursor-pointer ${
            isLight ? 'text-zinc-700 hover:bg-zinc-200' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}

      {/* CENTER STAGE: ONLY THE STEALTH ACOUSTIC FINE LINE (Supports Tauri OS Window Dragging + Position Memory) */}
      <main
        data-tauri-drag-region
        className="flex-1 flex flex-col items-center justify-center relative px-4"
      >
        <div
          data-tauri-drag-region
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
          }}
          title={
            clickThroughLocked
              ? '已开启鼠标穿透锁定 (右键右下角系统托盘或按 Alt + H 解锁)'
              : '按住可拖动隐身细线位置 (自动记忆坐标)'
          }
          className={`${
            clickThroughLocked
              ? 'pointer-events-none'
              : 'cursor-grab active:cursor-grabbing'
          } touch-none py-3 px-4`}
        >
          <MiniAuraWidget telemetryRef={telemetryRef} settings={settings} />
        </div>
      </main>

      {/* ULTRA-MINIMAL SINGLE-ROW TUNING BAR (Color Presets, Size Sliders, Auto-Sleep, Click-Through, Reset Pos) */}
      {!hideControls && (
        <footer
          className={`px-5 py-2.5 border-t text-[11px] transition-opacity duration-200 opacity-35 hover:opacity-100 ${
            isLight ? 'border-zinc-200/80 text-zinc-600' : 'border-zinc-800/50 text-zinc-400'
          }`}
        >
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
            {/* 1. Fluid Aura Color Presets */}
            <div className="flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 opacity-70 shrink-0" />
              <div className="flex items-center gap-1">
                {(Object.keys(AURA_THEMES) as AuraThemeId[]).map((tKey) => {
                  const palette = AURA_THEMES[tKey];
                  const isSelected = settings.theme === tKey;
                  return (
                    <button
                      key={tKey}
                      type="button"
                      onClick={() => updateSettings({ theme: tKey })}
                      title={palette.desc}
                      className={`px-2 py-0.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        isSelected
                          ? isLight
                            ? 'bg-zinc-900 text-white font-medium'
                            : 'bg-zinc-100 text-zinc-950 font-medium'
                          : isLight
                          ? 'hover:bg-zinc-200 text-zinc-700'
                          : 'hover:bg-zinc-800/80 text-zinc-300'
                      }`}
                    >
                      <span className="flex items-center -space-x-0.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: `rgb(${palette.bassColor.join(',')})` }}
                        />
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: `rgb(${palette.midColor.join(',')})` }}
                        />
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: `rgb(${palette.trebleColor.join(',')})` }}
                        />
                      </span>
                      <span>{palette.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Fine Line Width & Thickness Micro-Sliders */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap opacity-75">长度</span>
                <input
                  type="range"
                  min="160"
                  max="640"
                  step="10"
                  value={settings.lineWidth}
                  onChange={(e) =>
                    updateSettings({ lineWidth: parseInt(e.target.value, 10) })
                  }
                  className="w-20 accent-zinc-400 cursor-pointer"
                />
                <span className="font-mono-tabular w-9">{settings.lineWidth}px</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap opacity-75">粗细</span>
                <input
                  type="range"
                  min="4"
                  max="16"
                  step="1"
                  value={settings.lineHeight}
                  onChange={(e) =>
                    updateSettings({ lineHeight: parseInt(e.target.value, 10) })
                  }
                  className="w-16 accent-zinc-400 cursor-pointer"
                />
                <span className="font-mono-tabular w-6">{settings.lineHeight}px</span>
              </div>
            </div>

            {/* 3. Auto-Sleep CPU Power-Saving, Position Reset, Click-Through Lock & Stealth Toggle */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  updateSettings({ autoSleepEnabled: !settings.autoSleepEnabled })
                }
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                  settings.autoSleepEnabled
                    ? isLight
                      ? 'bg-zinc-800 text-white'
                      : 'bg-zinc-200 text-zinc-950 font-medium'
                    : isLight
                    ? 'bg-zinc-200 text-zinc-600'
                    : 'bg-zinc-800/70 text-zinc-400'
                }`}
              >
                <Cpu className="w-3 h-3" />
                <span>
                  {isSleepingState
                    ? '休眠中'
                    : `自动休眠:${settings.autoSleepEnabled ? '开' : '关'}`}
                </span>
              </button>

              {settings.autoSleepEnabled && (
                <>
                  <div className="flex items-center gap-0.5">
                    {[5, 10, 30, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => updateSettings({ autoSleepDelaySec: sec })}
                        className={`px-1.5 py-0.5 rounded font-mono-tabular transition-colors cursor-pointer whitespace-nowrap ${
                          settings.autoSleepDelaySec === sec
                            ? isLight
                              ? 'bg-zinc-300 text-zinc-900 font-semibold'
                              : 'bg-zinc-700 text-white font-semibold'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      updateSettings({
                        autoSleepBehavior:
                          settings.autoSleepBehavior === 'freeze' ? 'low_fps' : 'freeze',
                      })
                    }
                    className={`px-1.5 py-0.5 rounded font-mono-tabular transition-colors cursor-pointer whitespace-nowrap ${
                      isLight ? 'hover:bg-zinc-200' : 'hover:bg-zinc-800'
                    }`}
                    title="切换休眠时的省电模式 (0FPS停止动画 / 2FPS极低帧率)"
                  >
                    {settings.autoSleepBehavior === 'freeze' ? '0FPS' : '2FPS'}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleResetPosition}
                title="重置细线位置到屏幕中央/底部"
                className={`p-1 rounded transition-colors cursor-pointer ${
                  isLight ? 'hover:bg-zinc-200' : 'hover:bg-zinc-800'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {!isTauri && (
                <button
                  type="button"
                  onClick={() => updateSettings({ lightCanvasBg: !isLight })}
                  title={isLight ? '切换纯黑底色' : '切换办公浅灰底色'}
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    isLight ? 'hover:bg-zinc-200' : 'hover:bg-zinc-800'
                  }`}
                >
                  {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                </button>
              )}

              <button
                type="button"
                onClick={() => toggleClickThrough(!clickThroughLocked)}
                title="开启/关闭桌面鼠标穿透锁定 (开启后可通过右下角系统托盘右键菜单或 Alt+H 解锁)"
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                  clickThroughLocked
                    ? isLight
                      ? 'bg-zinc-800 text-white'
                      : 'bg-zinc-200 text-zinc-950 font-medium'
                    : isLight
                    ? 'hover:bg-zinc-200'
                    : 'hover:bg-zinc-800'
                }`}
              >
                {clickThroughLocked ? (
                  <Lock className="w-3 h-3" />
                ) : (
                  <Unlock className="w-3 h-3" />
                )}
                <span>{clickThroughLocked ? '已穿透' : '鼠标穿透'}</span>
              </button>

              <button
                type="button"
                onClick={() => setHideControls(true)}
                title="隐藏微调栏，仅留隐身细线 (Alt + H 或右键系统托盘)"
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                  isLight ? 'hover:bg-zinc-200' : 'hover:bg-zinc-800'
                }`}
              >
                <EyeOff className="w-3 h-3" />
                <span>纯细线</span>
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
