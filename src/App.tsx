/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AURA_THEMES,
  AuraThemeId,
  AudioSourceMode,
  AudioTelemetry,
  AutoSleepBehavior,
  StealthLineSettings,
} from './types/audio';
import { RealtimeAudioEngine } from './services/audioEngine';
import { MiniAuraWidget } from './components/MiniAuraWidget';
import { downloadStandaloneHtml } from './utils/exportStandaloneHtml';
import {
  Cpu,
  Download,
  Eye,
  EyeOff,
  FileAudio,
  Mic,
  MonitorSpeaker,
  Palette,
  PictureInPicture2,
  Play,
  ShieldCheck,
  Square,
  Sun,
  Moon,
} from 'lucide-react';

interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
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
    dominantInstrumentLabel: '待机静默',
    silentDurationSec: 0,
    isSleeping: false,
  });

  const [audioMode, setAudioMode] = useState<AudioSourceMode>('none');
  const [hideControls, setHideControls] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [settings, setSettings] = useState<StealthLineSettings>({
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
  });

  // Free drag position for the stealth line
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number }>({
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  // Document Picture-in-Picture state for detaching just the stealth line
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);

  // Subtle live readout
  const [readout, setReadout] = useState({
    bassPct: 5,
    midPct: 6,
    treblePct: 4,
    noteName: '--',
    pitchHz: 0,
    isSleeping: false,
    silentSec: 0,
  });

  const updateSettings = useCallback((partial: Partial<StealthLineSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    engineRef.current?.resetSilenceTimer();
  }, []);

  // Real-time local Web Audio sampling loop with Auto-Sleep CPU throttling
  useEffect(() => {
    let rafId = 0;
    let lastSampleTime = 0;
    let lastUiUpdate = 0;

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

      if (now - lastUiUpdate > 160) {
        lastUiUpdate = now;
        setReadout({
          bassPct: Math.round(sample.bassEnergy * 100),
          midPct: Math.round(sample.midEnergy * 100),
          treblePct: Math.round(sample.trebleEnergy * 100),
          noteName: sample.noteName,
          pitchHz: sample.dominantPitchHz,
          isSleeping: sample.isSleeping,
          silentSec: Math.floor(sample.silentDurationSec),
        });
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

  // Shortcut Alt + H toggles control bar visibility for instant pure stealth
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setHideControls((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      engineRef.current?.stopAll();
      if (pipWindow) pipWindow.close();
    };
  }, [pipWindow]);

  // 100% Local In-Memory Audio Handlers
  const handleStartSystemAudio = async () => {
    setStatusNotice(null);
    engineRef.current?.resetSilenceTimer();
    try {
      await engineRef.current?.startSystemAudio(() => {
        setAudioMode('none');
      });
      setAudioMode('system');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '无法开启系统音频捕获';
      setStatusNotice(msg);
    }
  };

  const handleStartMicAudio = async () => {
    setStatusNotice(null);
    engineRef.current?.resetSilenceTimer();
    try {
      await engineRef.current?.startMicrophoneAudio();
      setAudioMode('mic');
    } catch {
      setStatusNotice('未授予本地麦克风权限，已切换至本地内置合成测试频段。');
      handleStartDemoAudio();
    }
  };

  const handleStartDemoAudio = () => {
    setStatusNotice(null);
    engineRef.current?.resetSilenceTimer();
    engineRef.current?.startBuiltInDemo(0.18);
    setAudioMode('demo');
  };

  const handleLocalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusNotice(null);
    engineRef.current?.resetSilenceTimer();
    try {
      await engineRef.current?.startLocalFileAudio(file);
      setAudioMode('file');
    } catch {
      setStatusNotice('本地音频读取失败。');
    }
  };

  const handleStopAudio = () => {
    engineRef.current?.stopAll();
    setAudioMode('none');
  };

  // Pop-out Stealth Line into a tiny borderless Picture-in-Picture window
  const handleTogglePip = async () => {
    if (pipWindow) {
      pipWindow.close();
      setPipWindow(null);
      setPipContainer(null);
      return;
    }

    if (window.documentPictureInPicture) {
      try {
        const win = await window.documentPictureInPicture.requestWindow({
          width: settings.lineWidth + 24,
          height: settings.lineHeight + 36,
        });

        Array.from(document.styleSheets).forEach((styleSheet) => {
          try {
            const cssRules = Array.from(styleSheet.cssRules)
              .map((r) => r.cssText)
              .join('');
            const style = win.document.createElement('style');
            style.textContent = cssRules;
            win.document.head.appendChild(style);
          } catch {
            // ignore cross-origin stylesheet
          }
        });

        win.document.body.style.margin = '0';
        win.document.body.style.backgroundColor = settings.lightCanvasBg ? '#F4F4F5' : '#09090B';
        win.document.body.style.display = 'flex';
        win.document.body.style.alignItems = 'center';
        win.document.body.style.justifyContent = 'center';
        win.document.body.style.height = '100vh';
        win.document.body.style.overflow = 'hidden';

        const mountNode = win.document.createElement('div');
        win.document.body.appendChild(mountNode);

        win.addEventListener('pagehide', () => {
          setPipWindow(null);
          setPipContainer(null);
        });

        setPipWindow(win);
        setPipContainer(mountNode);
        return;
      } catch {
        // Fallback when inside restricted preview iframe
      }
    }

    setHideControls(true);
  };

  // Dragging handlers for positioning the Stealth Line anywhere
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
    setDragOffset({
      x: dragStartRef.current.origX + (e.clientX - dragStartRef.current.startX),
      y: dragStartRef.current.origY + (e.clientY - dragStartRef.current.startY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const isLight = settings.lightCanvasBg;

  return (
    <div
      className={`min-h-screen w-full flex flex-col justify-between transition-colors duration-200 select-none overflow-hidden ${
        isLight ? 'bg-[#F4F4F5] text-zinc-900' : 'bg-[#09090B] text-zinc-100'
      }`}
    >
      {/* Minimal Top Bar Contract (Hidden when user enters pure stealth mode) */}
      {!hideControls && (
        <header
          className={`flex items-center justify-between gap-8 px-6 py-3 border-b text-xs transition-opacity duration-200 opacity-45 hover:opacity-100 ${
            isLight ? 'border-zinc-200/80' : 'border-zinc-800/60'
          }`}
        >
          {/* Zone 1: Single Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setDragOffset({ x: 0, y: 0 });
            }}
            className="font-display font-semibold tracking-tight whitespace-nowrap shrink-0"
          >
            AuraLine
          </a>

          {/* Zone 2: Concise Single-Line Theme Links */}
          <nav className="hidden sm:flex items-center gap-6">
            {(Object.keys(AURA_THEMES) as AuraThemeId[]).map((tKey) => {
              const t = AURA_THEMES[tKey];
              const active = settings.theme === tKey;
              return (
                <a
                  key={tKey}
                  href={`#${tKey}`}
                  onClick={(e) => {
                    e.preventDefault();
                    updateSettings({ theme: tKey });
                  }}
                  className={`transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? isLight
                        ? 'text-zinc-900 font-semibold underline underline-offset-4'
                        : 'text-white font-semibold underline underline-offset-4'
                      : isLight
                      ? 'text-zinc-500 hover:text-zinc-900'
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {t.name}
                </a>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={audioMode !== 'none' ? handleStopAudio : handleStartSystemAudio}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                audioMode !== 'none'
                  ? isLight
                    ? 'bg-zinc-200 text-zinc-900 hover:bg-zinc-300'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                  : isLight
                  ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                  : 'bg-zinc-100 text-zinc-950 hover:bg-white'
              }`}
            >
              {audioMode !== 'none' ? '停止本地监听' : '监听本机音频'}
            </button>
          </div>
        </header>
      )}

      {/* Restore Button when in Pure Stealth Mode */}
      {hideControls && (
        <button
          type="button"
          onClick={() => setHideControls(false)}
          title="显示微调栏 (Alt + H)"
          className={`fixed top-3 right-4 z-30 p-1.5 rounded-md opacity-15 hover:opacity-90 transition-opacity cursor-pointer ${
            isLight ? 'text-zinc-700 hover:bg-zinc-200' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}

      {/* CENTER STAGE: ONLY THE STEALTH ACOUSTIC FINE LINE */}
      <main className="flex-1 flex flex-col items-center justify-center relative px-4">
        {pipWindow && pipContainer ? (
          <>
            {createPortal(
              <MiniAuraWidget telemetryRef={telemetryRef} settings={settings} />,
              pipContainer
            )}
            <div className="text-center space-y-2">
              <p className="text-xs text-zinc-500">隐身细线已弹出为独立小窗</p>
              <button
                type="button"
                onClick={handleTogglePip}
                className={`px-3 py-1 text-xs rounded border cursor-pointer ${
                  isLight
                    ? 'border-zinc-300 text-zinc-700 hover:bg-zinc-200'
                    : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900'
                }`}
              >
                收回细线
              </button>
            </div>
          </>
        ) : (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
            }}
            title="按住可任意拖动隐身细线位置"
            className="cursor-grab active:cursor-grabbing touch-none py-4 px-4"
          >
            <MiniAuraWidget telemetryRef={telemetryRef} settings={settings} />
          </div>
        )}

        {statusNotice && !hideControls && (
          <div
            className={`mt-4 px-3 py-1.5 rounded text-xs flex items-center gap-3 ${
              isLight ? 'bg-zinc-200/80 text-zinc-700' : 'bg-zinc-900 text-zinc-400'
            }`}
          >
            <span>{statusNotice}</span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="underline cursor-pointer whitespace-nowrap"
            >
              已知晓
            </button>
          </div>
        )}
      </main>

      {/* WHISPER-QUIET BOTTOM SETTINGS BAR (Includes Color Presets, Auto-Sleep & Local Privacy) */}
      {!hideControls && (
        <footer
          className={`px-6 py-3 border-t text-xs transition-opacity duration-200 opacity-45 hover:opacity-100 ${
            isLight ? 'border-zinc-200/80 text-zinc-600' : 'border-zinc-800/60 text-zinc-400'
          }`}
        >
          <div className="max-w-6xl mx-auto flex flex-col gap-2.5">
            {/* Row 1: Audio Sources + Line Dimensions + Export / PiP */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleStartSystemAudio}
                  className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    audioMode === 'system'
                      ? isLight
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-950 font-medium'
                      : isLight
                      ? 'hover:bg-zinc-200 text-zinc-700'
                      : 'hover:bg-zinc-800/80 text-zinc-300'
                  }`}
                >
                  <MonitorSpeaker className="w-3.5 h-3.5" />
                  <span>系统音频</span>
                </button>

                <button
                  type="button"
                  onClick={handleStartMicAudio}
                  className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    audioMode === 'mic'
                      ? isLight
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-950 font-medium'
                      : isLight
                      ? 'hover:bg-zinc-200 text-zinc-700'
                      : 'hover:bg-zinc-800/80 text-zinc-300'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>本机麦克风/混音</span>
                </button>

                <button
                  type="button"
                  onClick={audioMode === 'demo' ? handleStopAudio : handleStartDemoAudio}
                  className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    audioMode === 'demo'
                      ? isLight
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-950 font-medium'
                      : isLight
                      ? 'hover:bg-zinc-200 text-zinc-700'
                      : 'hover:bg-zinc-800/80 text-zinc-300'
                  }`}
                >
                  {audioMode === 'demo' ? (
                    <Square className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  <span>内置测试流</span>
                </button>

                <label
                  className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    audioMode === 'file'
                      ? isLight
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-950 font-medium'
                      : isLight
                      ? 'hover:bg-zinc-200 text-zinc-700'
                      : 'hover:bg-zinc-800/80 text-zinc-300'
                  }`}
                >
                  <FileAudio className="w-3.5 h-3.5" />
                  <span>本地文件</span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleLocalFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Center: Sliders for Fine Line Length & Thickness */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] whitespace-nowrap">长度</span>
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
                  <span className="font-mono-tabular text-[11px] w-10">
                    {settings.lineWidth}px
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] whitespace-nowrap">细线粗细</span>
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
                  <span className="font-mono-tabular text-[11px] w-7">
                    {settings.lineHeight}px
                  </span>
                </div>
              </div>

              {/* Right: Download Offline HTML, Pop-out PiP, Pure Stealth */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateSettings({ lightCanvasBg: !isLight })}
                  title={isLight ? '切换纯黑底色' : '切换办公浅灰底色'}
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    isLight ? 'hover:bg-zinc-200' : 'hover:bg-zinc-800'
                  }`}
                >
                  {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => downloadStandaloneHtml(settings)}
                  title="下载单文件离线版 (.html)，双击即可在公司电脑断网本地运行"
                  className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    isLight
                      ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                      : 'bg-zinc-100 text-zinc-950 hover:bg-white font-medium'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载离线单文件 (.html)</span>
                </button>

                <button
                  type="button"
                  onClick={handleTogglePip}
                  title="弹出为独立置顶细线小窗 (Document PiP)"
                  className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    isLight ? 'hover:bg-zinc-200' : 'hover:bg-zinc-800'
                  }`}
                >
                  <PictureInPicture2 className="w-3.5 h-3.5" />
                  <span>弹出独立小窗</span>
                </button>

                <button
                  type="button"
                  onClick={() => setHideControls(true)}
                  title="隐藏工具栏，仅留隐身细线 (Alt + H)"
                  className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    isLight ? 'hover:bg-zinc-200' : 'hover:bg-zinc-800'
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>纯细线</span>
                </button>
              </div>
            </div>

            {/* Row 2: Fluid Aura Color Presets + Auto-Sleep CPU Power-Saving Settings */}
            <div
              className={`pt-2 border-t flex flex-wrap items-center justify-between gap-4 text-[11px] ${
                isLight ? 'border-zinc-200/60' : 'border-zinc-800/50'
              }`}
            >
              {/* Left: Fluid Aura Color Preset Switcher */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 opacity-75 whitespace-nowrap">
                  <Palette className="w-3 h-3" />
                  <span>光晕色彩预设</span>
                </span>
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
                              ? 'bg-zinc-800 text-white font-medium'
                              : 'bg-zinc-200 text-zinc-950 font-medium'
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

              {/* Center: Auto-Sleep CPU Saving Controls */}
              <div className="flex flex-wrap items-center gap-2.5">
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
                  <span>自动休眠：{settings.autoSleepEnabled ? '开' : '关'}</span>
                </button>

                {settings.autoSleepEnabled && (
                  <>
                    <div className="flex items-center gap-1">
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
                              : 'opacity-65 hover:opacity-100'
                          }`}
                        >
                          {sec}秒
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1">
                      {(
                        [
                          { id: 'freeze' as AutoSleepBehavior, label: '0FPS暂停' },
                          { id: 'low_fps' as AutoSleepBehavior, label: '2FPS省电' },
                        ] as const
                      ).map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => updateSettings({ autoSleepBehavior: mode.id })}
                          className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap ${
                            settings.autoSleepBehavior === mode.id
                              ? isLight
                                ? 'bg-zinc-300 text-zinc-900 font-semibold'
                                : 'bg-zinc-700 text-white font-semibold'
                              : 'opacity-65 hover:opacity-100'
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Right: Live Sleep / Active Telemetry + 100% Local Guarantee */}
              <div className="flex items-center gap-2.5 font-mono-tabular">
                {readout.isSleeping ? (
                  <span className="opacity-85">
                    休眠省电中 ({settings.autoSleepBehavior === 'freeze' ? '0 FPS' : '2 FPS'})
                  </span>
                ) : (
                  <span className="opacity-75">
                    低 {readout.bassPct}% · 中 {readout.midPct}% · 高 {readout.treblePct}%
                    {readout.pitchHz > 0 ? ` · ${readout.noteName}` : ''}
                  </span>
                )}
                <span aria-hidden="true" className="opacity-40">
                  ·
                </span>
                <span className="inline-flex items-center gap-1 opacity-75 font-sans whitespace-nowrap">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>本机内存运算</span>
                </span>
              </div>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
