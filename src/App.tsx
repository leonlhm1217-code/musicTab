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
import { SettingsPage } from './components/SettingsPage';
import { Settings, X } from 'lucide-react';

const STORAGE_KEY = 'auraline_native_settings_v1';
const WEB_DRAG_STORAGE_KEY = 'auraline_web_drag_offset_v1';

const DEFAULT_SETTINGS: StealthLineSettings = {
  lineWidth: 360,
  lineHeight: 8,
  masterOpacity: 1.0,
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

  const [isSettingsRoute, setIsSettingsRoute] = useState<boolean>(
    () => typeof window !== 'undefined' && window.location.hash === '#settings'
  );
  const [settings, setSettings] = useState<StealthLineSettings>(loadSavedSettings);
  const [clickThroughLocked, setClickThroughLocked] = useState<boolean>(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState<boolean>(false);
  const [isClosedInWebPreview, setIsClosedInWebPreview] = useState<boolean>(false);
  const [wheelOpacityHint, setWheelOpacityHint] = useState<number | null>(null);
  const wheelHintTimerRef = useRef<number | null>(null);

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

  // Sync hash route changes (#settings vs main desktop fine line)
  useEffect(() => {
    const onHashChange = () => {
      setIsSettingsRoute(window.location.hash === '#settings');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Cross-window real-time settings synchronization (localStorage + Tauri IPC broadcast)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setSettings((prev) => ({ ...prev, ...JSON.parse(e.newValue!) }));
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', onStorage);

    engineRef.current?.subscribeToSettingsBroadcast((partial) => {
      setSettings((prev) => ({ ...prev, ...partial }));
    });

    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateSettings = useCallback((partial: Partial<StealthLineSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      engineRef.current?.syncSettingsAcrossWindows(next);
      return next;
    });
    engineRef.current?.resetSilenceTimer();
  }, []);

  const toggleClickThrough = useCallback((nextIgnore: boolean) => {
    setClickThroughLocked(nextIgnore);
    engineRef.current?.setNativeClickThrough(nextIgnore);
  }, []);

  const handleToggleAutoStart = useCallback(async (nextEnabled: boolean) => {
    const applied = await engineRef.current?.setAutoStartEnabled(nextEnabled);
    if (typeof applied === 'boolean') {
      setAutoStartEnabled(applied);
    }
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

  const handleOpenSettings = useCallback(async () => {
    const openedNative = await engineRef.current?.openNativeSettingsWindow();
    if (!openedNative) {
      window.location.hash = '#settings';
      setIsSettingsRoute(true);
    }
  }, []);

  const handleQuitApp = useCallback(async () => {
    if (engineRef.current?.isRunningInTauri()) {
      await engineRef.current.quitNativeApp();
    } else {
      setIsClosedInWebPreview(true);
    }
  }, []);

  // Mouse wheel on the fine line directly adjusts Master Opacity (20% to 100%)
  const handleWheelOpacity = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (clickThroughLocked) return;
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const current = settings.masterOpacity ?? 1.0;
      const next = Math.round(Math.max(0.2, Math.min(1.0, current + delta)) * 100) / 100;
      updateSettings({ masterOpacity: next });

      setWheelOpacityHint(Math.round(next * 100));
      if (wheelHintTimerRef.current !== null) {
        window.clearTimeout(wheelHintTimerRef.current);
      }
      wheelHintTimerRef.current = window.setTimeout(() => {
        setWheelOpacityHint(null);
      }, 900);
    },
    [clickThroughLocked, settings.masterOpacity, updateSettings]
  );

  // Automatically connect to output soundcard loopback on launch + init window position & system tray
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.startAutoConnect();
    engine.getAutoStartEnabled().then(setAutoStartEnabled);

    if (window.location.hash !== '#settings') {
      engine.initWindowPositionMemory();
      engine.syncSettingsAcrossWindows(loadSavedSettings());
    }

    engine.subscribeToTrayCommands((cmd) => {
      if (cmd === 'set-click-through:true') {
        setClickThroughLocked(true);
      } else if (cmd === 'set-click-through:false') {
        setClickThroughLocked(false);
      } else if (cmd === 'auto-start-changed:true') {
        setAutoStartEnabled(true);
      } else if (cmd === 'auto-start-changed:false') {
        setAutoStartEnabled(false);
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (clickThroughLocked) return;

    // Ignore drag start if clicking the action buttons
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }

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

  const isTauri = engineRef.current?.isRunningInTauri() ?? false;

  // 1. STANDALONE SETTINGS PAGE / WINDOW (#settings)
  if (isSettingsRoute) {
    return (
      <SettingsPage
        settings={settings}
        telemetryRef={telemetryRef}
        isSleepingState={isSleepingState}
        clickThroughLocked={clickThroughLocked}
        autoStartEnabled={autoStartEnabled}
        isStandaloneWindow={isTauri}
        onUpdateSettings={updateSettings}
        onToggleClickThrough={toggleClickThrough}
        onToggleAutoStart={handleToggleAutoStart}
        onResetPosition={handleResetPosition}
        onBackToBar={() => {
          window.location.hash = '';
          setIsSettingsRoute(false);
        }}
        onQuitApp={handleQuitApp}
      />
    );
  }

  if (isClosedInWebPreview) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-transparent text-zinc-400 text-xs">
        <span>隐身声学细线已关闭（在桌面 .exe 中会直接退出进程）</span>
        <button
          type="button"
          onClick={() => setIsClosedInWebPreview(false)}
          className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 cursor-pointer"
        >
          重新唤醒细线
        </button>
      </div>
    );
  }

  // 2. PURE DESKTOP BAR VIEW: ONLY THE SINGLE FINE LINE + GESTURES + HOVER GLOW ACTIONS
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center bg-transparent select-none overflow-hidden"
      style={{ background: 'transparent' }}
    >
      <div
        data-tauri-drag-region
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheelOpacity}
        onDoubleClick={() => {
          if (!clickThroughLocked) {
            handleOpenSettings();
          }
        }}
        style={{
          transform: isTauri
            ? undefined
            : `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
        }}
        title={
          clickThroughLocked
            ? '已开启鼠标穿透锁定 (右键右下角系统托盘图标可解锁)'
            : '按住拖动位置 · 滚轮调节透明度 · 双击打开设置'
        }
        className={`group relative flex items-center gap-2 py-2 px-3 ${
          clickThroughLocked
            ? 'pointer-events-none'
            : 'cursor-grab active:cursor-grabbing'
        } touch-none`}
      >
        {/* The Single Stealth Acoustic Fine Line with Master Opacity */}
        <div
          style={{ opacity: settings.masterOpacity ?? 1.0 }}
          className="transition-opacity duration-150"
        >
          <MiniAuraWidget telemetryRef={telemetryRef} settings={settings} />
        </div>

        {/* Ephemeral Mouse Wheel Opacity Indicator */}
        {wheelOpacityHint !== null && (
          <span className="text-[10px] font-mono-tabular text-white/75 drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]">
            {wheelOpacityHint}%
          </span>
        )}

        {/* Subtle Hover Actions: Borderless & Background-Free with Soft White Glow */}
        {!clickThroughLocked && (
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenSettings();
              }}
              title="打开独立设置页面 (或双击细线)"
              className="p-1 text-white/45 hover:text-white/95 hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.75)] transition-all duration-150 cursor-pointer"
            >
              <Settings className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleQuitApp();
              }}
              title="关闭并退出 AuraLine"
              className="p-1 text-white/45 hover:text-white/95 hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.75)] transition-all duration-150 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
