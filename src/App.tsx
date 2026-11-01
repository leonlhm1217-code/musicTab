/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AURA_THEMES,
  AuraThemeId,
  AudioTelemetry,
  DEFAULT_SETTINGS,
  StealthLineSettings,
  TaskbarSlotTelemetry,
} from './types/audio';
import { RealtimeAudioEngine } from './services/audioEngine';
import { MiniAuraWidget } from './components/MiniAuraWidget';
import { SettingsPage } from './components/SettingsPage';
import {
  Code2,
  FolderClosed,
  Globe,
  MessageSquare,
  Minus,
  Music2,
  Plus,
  Search,
  Settings,
  Terminal,
  Wifi,
  Volume2,
  X,
} from 'lucide-react';

const STORAGE_KEY = 'auraline_vfd_taskbar_settings_v4';
const WEB_DRAG_STORAGE_KEY = 'auraline_web_drag_offset_v4';

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
    spectrumBands: new Array(32).fill(0),
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

  const [isSettingsRoute, setIsSettingsRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      (engineRef.current?.isSettingsWindow() ?? false) ||
      window.location.hash.includes('settings') ||
      window.location.search.includes('settings')
    );
  });
  const [settings, setSettings] = useState<StealthLineSettings>(loadSavedSettings);
  const [taskbarSlot, setTaskbarSlot] = useState<TaskbarSlotTelemetry | null>(null);
  const [clickThroughLocked, setClickThroughLocked] = useState<boolean>(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState<boolean>(false);
  const [isClosedInWebPreview, setIsClosedInWebPreview] = useState<boolean>(false);
  const [wheelOpacityHint, setWheelOpacityHint] = useState<number | null>(null);
  const wheelHintTimerRef = useRef<number | null>(null);

  // Interactive simulated taskbar app count (ONLY used in browser preview to demonstrate centered taskbar expansion)
  const [simAppCount, setSimAppCount] = useState<number>(4);

  // Persisted drag position when taskbarDockMode === 'manual'
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>(loadSavedWebDragOffset);
  const dragOffsetRef = useRef<{ x: number; y: number }>(dragOffset);
  dragOffsetRef.current = dragOffset;
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number }>({
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const [isSleepingState, setIsSleepingState] = useState<boolean>(false);

  // Sync hash route changes (#settings vs main taskbar spectrum window) & body background
  useEffect(() => {
    const syncRoute = () => {
      const nextIsSettings =
        (engineRef.current?.isSettingsWindow() ?? false) ||
        window.location.hash.includes('settings') ||
        window.location.search.includes('settings');
      setIsSettingsRoute(nextIsSettings);
      document.body.style.backgroundColor = nextIsSettings ? '#09090B' : 'transparent';
    };
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  // Cross-window real-time settings synchronization + Win32 Taskbar Slot sensor subscription
  useEffect(() => {
    let disposed = false;
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

    let unlistenSettings: (() => void) | null = null;
    let unlistenTaskbar: (() => void) | null = null;

    engineRef.current
      ?.subscribeToSettingsBroadcast((partial) => {
        if (!disposed) {
          setSettings((prev) => ({ ...prev, ...partial }));
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlistenSettings = fn;
        }
      });

    engineRef.current
      ?.subscribeToTaskbarSlot((slot) => {
        if (!disposed) {
          setTaskbarSlot(slot);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlistenTaskbar = fn;
        }
      });

    return () => {
      disposed = true;
      window.removeEventListener('storage', onStorage);
      if (unlistenSettings) unlistenSettings();
      if (unlistenTaskbar) unlistenTaskbar();
    };
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
    dragOffsetRef.current = { x: 0, y: 0 };
    try {
      localStorage.setItem(WEB_DRAG_STORAGE_KEY, JSON.stringify({ x: 0, y: 0 }));
    } catch {
      // ignore
    }
    updateSettings({ taskbarDockMode: 'left_edge', taskbarOffsetX: 0 });
    engineRef.current?.resetWindowToBottomCenter();
  }, [updateSettings]);

  const handleOpenSettings = useCallback(async () => {
    const openedNative = await engineRef.current?.openNativeSettingsWindow();
    if (!openedNative) {
      window.location.hash = '#settings';
      setIsSettingsRoute(true);
    }
  }, []);

  const handleCloseSettings = useCallback(async () => {
    const closedNative = await engineRef.current?.closeNativeSettingsWindow();
    if (!closedNative) {
      window.location.hash = '';
      setIsSettingsRoute(false);
    }
  }, []);

  const handleQuitApp = useCallback(async () => {
    if (engineRef.current?.isRunningInTauri()) {
      await engineRef.current.quitNativeApp();
    } else {
      setIsClosedInWebPreview(true);
    }
  }, []);

  // Mouse wheel on the spectrum bar directly adjusts Master Opacity (20% to 100%)
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

  // Clean up wheel opacity hint timer on unmount
  useEffect(() => {
    return () => {
      if (wheelHintTimerRef.current !== null) {
        window.clearTimeout(wheelHintTimerRef.current);
      }
    };
  }, []);

  // Automatically connect to output soundcard loopback on launch + init taskbar adaptive watcher
  useEffect(() => {
    let disposed = false;
    const engine = engineRef.current;
    if (!engine) return;

    engine.startAutoConnect();
    engine.getAutoStartEnabled().then((val) => {
      if (!disposed) setAutoStartEnabled(val);
    });
    engine.getClickThroughEnabled().then((val) => {
      if (!disposed) setClickThroughLocked(val);
    });

    if (!engine.isSettingsWindow()) {
      const saved = loadSavedSettings();
      engine.initWindowPositionMemory(saved.taskbarDockMode ?? 'left_edge');
      engine.syncSettingsAcrossWindows(saved);
    }

    let unlistenTray: (() => void) | null = null;
    engine
      .subscribeToTrayCommands((cmd) => {
        if (disposed) return;
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
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlistenTray = fn;
        }
      });

    const resumeOnFirstInteraction = () => {
      engine.resetSilenceTimer();
    };
    window.addEventListener('pointerdown', resumeOnFirstInteraction, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener('pointerdown', resumeOnFirstInteraction);
      if (unlistenTray) unlistenTray();
      engine.stopAudioStream();
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
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }

    // Lock out left-click dragging when in automatic taskbar docking modes ('left_edge' / 'after_icons' / 'before_tray')
    const currentDockMode = settings.taskbarDockMode ?? 'left_edge';
    if (currentDockMode !== 'manual') {
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
      origX: dragOffsetRef.current.x,
      origY: dragOffsetRef.current.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const nextPos = {
      x: dragStartRef.current.origX + (e.clientX - dragStartRef.current.startX),
      y: dragStartRef.current.origY + (e.clientY - dragStartRef.current.startY),
    };
    dragOffsetRef.current = nextPos;
    setDragOffset(nextPos);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      localStorage.setItem(WEB_DRAG_STORAGE_KEY, JSON.stringify(dragOffsetRef.current));
    } catch {
      // ignore
    }
  };

  const isTauri = engineRef.current?.isRunningInTauri() ?? false;

  // 1. STANDALONE SETTINGS PAGE / WINDOW (#settings)
  if (isSettingsRoute) {
    return (
      <div className="h-screen w-full overflow-y-auto">
        <SettingsPage
          settings={settings}
          telemetryRef={telemetryRef}
          taskbarSlot={taskbarSlot}
          isSleepingState={isSleepingState}
          clickThroughLocked={clickThroughLocked}
          autoStartEnabled={autoStartEnabled}
          isStandaloneWindow={isTauri}
          onUpdateSettings={updateSettings}
          onToggleClickThrough={toggleClickThrough}
          onToggleAutoStart={handleToggleAutoStart}
          onResetPosition={handleResetPosition}
          onCloseSettings={handleCloseSettings}
          onQuitApp={handleQuitApp}
        />
      </div>
    );
  }

  if (isClosedInWebPreview) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-transparent text-zinc-400 text-xs">
        <span>任务栏车载 VFD 频谱已关闭（在桌面 .exe 中会直接退出进程）</span>
        <button
          type="button"
          onClick={() => setIsClosedInWebPreview(false)}
          className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 cursor-pointer"
        >
          重新唤醒车载频谱
        </button>
      </div>
    );
  }

  // Compute adaptive bar count & width:
  // When centered taskbar icons expand outward as more apps open, left space shrinks if > 6 icons
  const simCrowdedFactor = Math.max(0, simAppCount - 6);
  const simMaxWidth = Math.max(140, settings.lineWidth - simCrowdedFactor * 28);
  const effectiveWidth = isTauri
    ? taskbarSlot
      ? Math.max(100, Math.min(settings.lineWidth, taskbarSlot.availableWidth - 8))
      : settings.lineWidth
    : Math.min(settings.lineWidth, simMaxWidth);

  const effectiveBands = isTauri
    ? taskbarSlot
      ? Math.min(settings.preferredBands, taskbarSlot.recommendedBands)
      : settings.preferredBands
    : effectiveWidth < 150
    ? 16
    : effectiveWidth < 210
    ? Math.min(settings.preferredBands, 24)
    : settings.preferredBands;

  const activeDockMode = settings.taskbarDockMode ?? 'left_edge';
  const isManualDock = activeDockMode === 'manual';

  const SpectrumWidgetNode = (
    <div
      {...(isManualDock ? { 'data-tauri-drag-region': true } : {})}
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
        transform:
          !isTauri && isManualDock
            ? `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`
            : !isTauri
            ? `translate3d(${settings.taskbarOffsetX ?? 0}px, 0, 0)`
            : undefined,
      }}
      title={
        clickThroughLocked
          ? '已开启鼠标穿透锁定 (右键右下角系统托盘图标可解锁)'
          : isManualDock
          ? '车载 VFD 频谱 · 手动自由拖拽模式 · 左键拖动位置 · 滚轮调透明度 · 双击打开设置'
          : '车载 VFD 频谱 · 已锁定在任务栏自动停靠槽位 · 滚轮调透明度 · 双击打开设置'
      }
      className={`group relative flex items-center px-1 py-0.5 transition-all duration-200 box-border ${
        clickThroughLocked
          ? 'pointer-events-none'
          : isManualDock
          ? 'cursor-grab active:cursor-grabbing'
          : 'cursor-default'
      } touch-none`}
    >
      {/* Classic Car Stereo VFD Spectrum Analyzer */}
      <div
        style={{ opacity: settings.masterOpacity ?? 1.0 }}
        className="transition-opacity duration-150"
      >
        <MiniAuraWidget
          telemetryRef={telemetryRef}
          settings={settings}
          activeBands={effectiveBands}
          effectiveWidth={effectiveWidth}
        />
      </div>

      {/* Ephemeral Mouse Wheel Opacity Indicator */}
      {wheelOpacityHint !== null && (
        <span className="ml-1.5 text-[10px] font-mono-tabular text-white/80 drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]">
          {wheelOpacityHint}%
        </span>
      )}

      {/* Subtle Hover Actions: Floating overlay badge on the right edge so it never shrinks the spectrum bar width */}
      {!clickThroughLocked && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#09090B]/90 border border-white/15 opacity-0 group-hover:opacity-100 transition-all duration-150 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenSettings();
            }}
            title="打开设置面板 (或直接双击频谱柱)"
            className="p-0.5 text-zinc-300 hover:text-[#E5C158] transition-colors cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleQuitApp();
            }}
            title="关闭并退出 AuraLine"
            className="p-0.5 text-zinc-300 hover:text-red-400 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );

  // 2A. NATIVE WINDOWS .EXE VIEW: 100% Pure Transparent Taskbar-Embedded Spectrum Bar ONLY
  if (isTauri) {
    return (
      <div
        className="h-screen w-full flex items-center justify-start bg-transparent select-none overflow-hidden"
        style={{ background: 'transparent' }}
      >
        {SpectrumWidgetNode}
      </div>
    );
  }

  // 2B. WEB PREVIEW VIEW: Windows 11 Centered Taskbar Simulation (Spectrum at Far-Left Edge + Centered Search & Icons)
  const simulatedIcons = [
    { icon: Globe, label: '浏览器' },
    { icon: FolderClosed, label: '资源管理器' },
    { icon: Music2, label: 'QQ音乐 (播放中)' },
    { icon: Code2, label: 'VS Code' },
    { icon: MessageSquare, label: '微信办公' },
    { icon: Terminal, label: '终端' },
    { icon: Globe, label: '文档中心' },
    { icon: FolderClosed, label: '项目归档' },
    { icon: Code2, label: '调试器' },
  ].slice(0, simAppCount);

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-transparent select-none overflow-hidden">
      {/* Top Instrument Telemetry Bar (Web Preview Only — Not shown in .exe) */}
      <div className="w-full flex items-center justify-between gap-4 px-5 py-3 text-xs text-zinc-400 border-b border-white/[0.06] bg-[#09090B]/90 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0 truncate">
          <span className="font-mono-tabular text-[11px] font-semibold tracking-wider text-[#E5C158] whitespace-nowrap shrink-0">
            AURALINE VFD
          </span>
          <span className="text-zinc-600 shrink-0">·</span>
          <span className="truncate text-zinc-300">
            Windows 居中搜索栏任务栏预览（频谱锚定于任务栏最左端，打包为{' '}
            <code className="font-mono-tabular text-zinc-200">
              AuraLine-Portable.exe
            </code>{' '}
            后仅保留纯透明频谱嵌入真实任务栏）
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSimAppCount((c) => Math.max(2, c - 1))}
            className="px-2.5 py-1 rounded bg-[#121217] hover:bg-[#1A1A22] border border-white/[0.08] text-zinc-300 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            title="模拟关闭居中任务栏图标"
          >
            <Minus className="w-3 h-3 shrink-0" />
            <span>减少图标</span>
          </button>
          <button
            type="button"
            onClick={() => setSimAppCount((c) => Math.min(9, c + 1))}
            className="px-2.5 py-1 rounded bg-[#121217] hover:bg-[#1A1A22] border border-white/[0.08] text-zinc-300 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            title="模拟居中图标向两侧扩展，测试最左侧频谱自动防遮挡缩减柱数"
          >
            <Plus className="w-3 h-3 shrink-0" />
            <span>新增图标</span>
            <span className="font-mono-tabular text-[#E5C158] ml-0.5">
              {simAppCount}
            </span>
          </button>
          <button
            type="button"
            onClick={handleOpenSettings}
            className="px-2.5 py-1 rounded bg-[#1C1C22] hover:bg-[#24242C] border border-[#D4AF37]/45 text-[#F4F4F6] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <Settings className="w-3 h-3 text-[#E5C158] shrink-0" />
            <span>调音台设置</span>
          </button>
        </div>
      </div>

      {/* Simulated Windows 11 Taskbar with Centered Search Bar & Far-Left VFD Spectrum */}
      <div className="relative w-full h-12 bg-[#141519]/95 border-t border-white/10 px-2.5 flex items-center justify-between backdrop-blur-md">
        {/* Far-Left Edge: Default Dock Position ('left_edge' or 'manual') */}
        <div className="flex items-center shrink-0 z-10">
          {(activeDockMode === 'left_edge' || activeDockMode === 'manual') &&
            SpectrumWidgetNode}
        </div>

        {/* Center of Taskbar: Windows Start Orb + Centered Search Bar + Running App Icons */}
        <div className="flex items-center justify-center gap-2 min-w-0">
          {/* Windows Start Orb */}
          <div className="w-8 h-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
            <div className="grid grid-cols-2 gap-0.5 w-3.5 h-3.5">
              <span className="bg-sky-400 rounded-[1px]" />
              <span className="bg-sky-500 rounded-[1px]" />
              <span className="bg-sky-500 rounded-[1px]" />
              <span className="bg-sky-600 rounded-[1px]" />
            </div>
          </div>

          {/* Centered Taskbar Search Box */}
          <div className="h-8 px-3 rounded-full bg-white/8 border border-white/10 flex items-center gap-2 text-xs text-zinc-400 w-40 shrink-0">
            <Search className="w-3.5 h-3.5 text-zinc-400" />
            <span className="truncate">搜索</span>
          </div>

          {/* Centered Running App Icons */}
          <div className="flex items-center gap-1 shrink-0">
            {simulatedIcons.map((item, idx) => {
              const IconComp = item.icon;
              const isMusic = idx === 2;
              return (
                <div
                  key={`${item.label}-${idx}`}
                  title={item.label}
                  className={`relative w-9 h-8 rounded-md flex items-center justify-center transition-all ${
                    isMusic
                      ? 'bg-white/12 text-emerald-300'
                      : 'hover:bg-white/8 text-zinc-300'
                  }`}
                >
                  <IconComp className="w-4 h-4" />
                  <span
                    className={`absolute bottom-0.5 h-[2px] rounded-full ${
                      isMusic ? 'w-4 bg-emerald-400' : 'w-1.5 bg-zinc-400'
                    }`}
                  />
                </div>
              );
            })}
          </div>

          {/* Optional Dock Mode: Immediately After Centered Icons */}
          {activeDockMode === 'after_icons' && (
            <div className="ml-2 flex items-center shrink-0">
              {SpectrumWidgetNode}
            </div>
          )}
        </div>

        {/* Right Side: Optional Dock Before System Tray + System Tray Clock/Icons */}
        <div className="flex items-center gap-2 shrink-0 z-10">
          {activeDockMode === 'before_tray' && (
            <div className="mr-1 flex items-center">{SpectrumWidgetNode}</div>
          )}

          <div className="h-8 px-2.5 rounded-md bg-white/5 border border-white/5 flex items-center gap-2.5 text-zinc-300 text-xs">
            <Wifi className="w-3.5 h-3.5 text-zinc-400" />
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            <div className="text-right leading-tight font-mono-tabular text-[10px]">
              <div>14:32</div>
              <div className="text-zinc-500">2026/10/30</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
