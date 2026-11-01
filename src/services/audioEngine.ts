import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioTelemetry, StealthLineSettings, TaskbarSlotTelemetry } from '../types/audio';

const NOTE_STRINGS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WINDOW_POS_STORAGE_KEY = 'auraline_window_pos_v1';
const AUTO_START_FALLBACK_KEY = 'auraline_autostart_fallback_v1';
const NUM_SPECTRUM_BANDS = 32;

export interface TauriTelemetryPayload {
  rmsVolume: number;
  dbLevel: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  dominantPitchHz: number;
  isBeat: boolean;
  waveformSlice: number[];
  spectrumBands?: number[];
  deviceName?: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: {
      event?: {
        listen: <T>(
          event: string,
          handler: (e: { payload: T }) => void
        ) => Promise<() => void>;
      };
    };
  }
}

function frequencyToNoteName(freq: number): string {
  if (!freq || freq < 28 || freq > 14000) return '--';
  const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
  const midi = Math.round(noteNum) + 69;
  if (midi < 12 || midi > 120) return '--';
  const note = NOTE_STRINGS[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export class RealtimeAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private silentSynthTimer: number | null = null;
  private unlistenTauri: UnlistenFn | null = null;
  private unlistenTray: UnlistenFn | null = null;
  private unlistenSettings: UnlistenFn | null = null;
  private unlistenTaskbar: UnlistenFn | null = null;
  private unlistenMoved: UnlistenFn | null = null;
  private latestNativePacket: TauriTelemetryPayload | null = null;
  private lastNativePacketTimeMs = 0;
  private isTauriNative = false;
  private currentDockMode = 'left_edge';

  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private timeData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private smoothedBands: number[] = new Array(NUM_SPECTRUM_BANDS).fill(0);

  private prevBassEnergy = 0;
  private beatCooldown = 0;
  private springScale = 1.0;
  private springVelocity = 0;
  private smoothedPitchHz = 0;
  private synthStep = 0;
  private silentStartMs: number = performance.now();

  public resetSilenceTimer(): void {
    this.silentStartMs = performance.now();
  }

  public isRunningInTauri(): boolean {
    return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
  }

  public isSettingsWindow(): boolean {
    if (typeof window === 'undefined') return false;
    const winAny = window as unknown as { __AURALINE_WINDOW_LABEL__?: string };
    if (winAny.__AURALINE_WINDOW_LABEL__ === 'settings') {
      return true;
    }
    if (this.isRunningInTauri()) {
      try {
        if (getCurrentWindow().label === 'settings') {
          return true;
        }
      } catch {
        // ignore
      }
    }
    return window.location.hash === '#settings' || window.location.search.includes('settings');
  }

  public async getAutoStartEnabled(): Promise<boolean> {
    if (!this.isRunningInTauri()) {
      return localStorage.getItem(AUTO_START_FALLBACK_KEY) === 'true';
    }
    try {
      return await invoke<boolean>('get_auto_start_enabled');
    } catch {
      return false;
    }
  }

  public async setAutoStartEnabled(enabled: boolean): Promise<boolean> {
    if (!this.isRunningInTauri()) {
      try {
        localStorage.setItem(AUTO_START_FALLBACK_KEY, String(enabled));
      } catch {
        // ignore
      }
      return enabled;
    }
    try {
      return await invoke<boolean>('set_auto_start_enabled', { enabled });
    } catch {
      return false;
    }
  }

  public async openNativeSettingsWindow(): Promise<boolean> {
    if (!this.isRunningInTauri()) return false;
    try {
      await invoke('open_settings_window');
      return true;
    } catch {
      return false;
    }
  }

  public async closeNativeSettingsWindow(): Promise<boolean> {
    if (!this.isRunningInTauri()) return false;
    try {
      await invoke('close_settings_window');
      return true;
    } catch {
      try {
        await getCurrentWindow().hide();
        return true;
      } catch {
        return false;
      }
    }
  }

  public async quitNativeApp(): Promise<void> {
    if (!this.isRunningInTauri()) return;
    try {
      await invoke('quit_app');
    } catch {
      try {
        await getCurrentWindow().close();
      } catch {
        // ignore
      }
    }
  }

  public async syncSettingsAcrossWindows(settings: StealthLineSettings): Promise<void> {
    this.currentDockMode = settings.taskbarDockMode ?? 'left_edge';
    if (!this.isRunningInTauri()) return;
    try {
      await invoke('update_taskbar_config', {
        dockMode: this.currentDockMode,
        offsetX: settings.taskbarOffsetX ?? 0,
        desiredWidth: settings.lineWidth,
        desiredHeight: settings.lineHeight,
        preferredBands: settings.preferredBands ?? 24,
      });
      if (this.currentDockMode === 'manual') {
        await invoke('resize_main_bar_window', {
          lineWidth: settings.lineWidth,
          lineHeight: settings.lineHeight,
        });
      }
      await invoke('broadcast_settings', {
        settingsJson: JSON.stringify(settings),
      });
    } catch {
      // ignore in web preview
    }
  }

  public async subscribeToSettingsBroadcast(
    onSettingsUpdated: (settings: Partial<StealthLineSettings>) => void
  ): Promise<() => void> {
    if (!this.isRunningInTauri()) return () => {};
    try {
      if (this.unlistenSettings) {
        this.unlistenSettings();
        this.unlistenSettings = null;
      }
      const unlisten = await listen<string>('settings-updated', (event) => {
        try {
          const parsed = JSON.parse(event.payload) as Partial<StealthLineSettings>;
          if (parsed.taskbarDockMode) {
            this.currentDockMode = parsed.taskbarDockMode;
          }
          onSettingsUpdated(parsed);
        } catch {
          // ignore malformed payload
        }
      });
      this.unlistenSettings = unlisten;
      return () => {
        unlisten();
        if (this.unlistenSettings === unlisten) {
          this.unlistenSettings = null;
        }
      };
    } catch {
      return () => {};
    }
  }

  public async subscribeToTaskbarSlot(
    onSlotUpdated: (slot: TaskbarSlotTelemetry) => void
  ): Promise<() => void> {
    if (!this.isRunningInTauri()) return () => {};
    try {
      if (this.unlistenTaskbar) {
        this.unlistenTaskbar();
        this.unlistenTaskbar = null;
      }
      const unlisten = await listen<TaskbarSlotTelemetry>(
        'taskbar-slot-updated',
        (event) => {
          onSlotUpdated(event.payload);
        }
      );
      this.unlistenTaskbar = unlisten;
      return () => {
        unlisten();
        if (this.unlistenTaskbar === unlisten) {
          this.unlistenTaskbar = null;
        }
      };
    } catch {
      return () => {};
    }
  }

  public async getClickThroughEnabled(): Promise<boolean> {
    if (!this.isRunningInTauri()) return false;
    try {
      return await invoke<boolean>('get_click_through_enabled');
    } catch {
      return false;
    }
  }

  public async setNativeClickThrough(ignore: boolean): Promise<void> {
    if (!this.isRunningInTauri()) return;
    try {
      await invoke('set_click_through', { ignore });
    } catch {
      try {
        await getCurrentWindow().setIgnoreCursorEvents(ignore);
      } catch {
        // Ignore in web preview fallback
      }
    }
  }

  public async startNativeWindowDrag(): Promise<void> {
    if (!this.isRunningInTauri()) return;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      try {
        await invoke('start_window_drag');
      } catch {
        // Ignore in web preview fallback
      }
    }
    await this.saveCurrentWindowPosition();
  }

  public async initWindowPositionMemory(initialDockMode = 'left_edge'): Promise<void> {
    this.currentDockMode = initialDockMode;
    if (!this.isRunningInTauri()) return;
    try {
      // Only restore manual x/y coordinates when explicitly in 'manual' free-drag mode.
      // When in 'left_edge' (or other auto taskbar dock modes), let taskbar_layout.rs position the window directly.
      if (this.currentDockMode === 'manual') {
        const raw = localStorage.getItem(WINDOW_POS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { x: number; y: number };
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            await invoke('set_window_position', { x: parsed.x, y: parsed.y });
          }
        }
      }

      if (this.unlistenMoved) {
        this.unlistenMoved();
        this.unlistenMoved = null;
      }

      const win = getCurrentWindow();
      this.unlistenMoved = await win.onMoved(({ payload }) => {
        if (this.currentDockMode !== 'manual') {
          return;
        }
        try {
          localStorage.setItem(
            WINDOW_POS_STORAGE_KEY,
            JSON.stringify({ x: payload.x, y: payload.y })
          );
        } catch {
          // ignore storage quota errors
        }
      });
    } catch {
      // Ignore outside Tauri runtime
    }
  }

  public async saveCurrentWindowPosition(): Promise<void> {
    if (!this.isRunningInTauri()) return;
    try {
      const [x, y] = await invoke<[number, number]>('get_window_position');
      localStorage.setItem(WINDOW_POS_STORAGE_KEY, JSON.stringify({ x, y }));
    } catch {
      // ignore
    }
  }

  public async resetWindowToBottomCenter(): Promise<void> {
    if (!this.isRunningInTauri()) return;
    try {
      const [x, y] = await invoke<[number, number]>('reset_window_to_bottom_center');
      localStorage.setItem(WINDOW_POS_STORAGE_KEY, JSON.stringify({ x, y }));
    } catch {
      // ignore
    }
  }

  public async subscribeToTrayCommands(
    onCommand: (cmd: string) => void
  ): Promise<() => void> {
    if (!this.isRunningInTauri()) return () => {};
    try {
      if (this.unlistenTray) {
        this.unlistenTray();
        this.unlistenTray = null;
      }
      const unlisten = await listen<string>('tray-command', (event) => {
        onCommand(event.payload);
      });
      this.unlistenTray = unlisten;
      return () => {
        unlisten();
        if (this.unlistenTray === unlisten) {
          this.unlistenTray = null;
        }
      };
    } catch {
      return () => {};
    }
  }

  public stopAudioStream(): void {
    if (this.unlistenTauri) {
      this.unlistenTauri();
      this.unlistenTauri = null;
    }
    if (this.silentSynthTimer !== null) {
      window.clearInterval(this.silentSynthTimer);
      this.silentSynthTimer = null;
    }
    this.latestNativePacket = null;
  }

  public async startAutoConnect(): Promise<void> {
    this.stopAudioStream();

    if (this.isRunningInTauri()) {
      this.isTauriNative = true;
      try {
        this.unlistenTauri = await listen<TauriTelemetryPayload>('audio-telemetry', (event) => {
          this.latestNativePacket = event.payload;
          this.lastNativePacketTimeMs = performance.now();
        });
        return;
      } catch {
        try {
          if (window.__TAURI__?.event?.listen) {
            this.unlistenTauri = await window.__TAURI__.event.listen<TauriTelemetryPayload>(
              'audio-telemetry',
              (event) => {
                this.latestNativePacket = event.payload;
                this.lastNativePacketTimeMs = performance.now();
              }
            );
            return;
          }
        } catch {
          // Continue if running outside Tauri webview
        }
      }
    }

    this.startInternalPreviewSignal();
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.72;
      this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    }
    return this.ctx;
  }

  private startInternalPreviewSignal(): void {
    const ctx = this.ensureContext();
    const feedGain = ctx.createGain();
    feedGain.gain.value = 0.35;
    feedGain.connect(this.analyser!);

    const muteOut = ctx.createGain();
    muteOut.gain.value = 0.0;
    this.analyser!.connect(muteOut);
    muteOut.connect(ctx.destination);

    const bassNotes = [55.0, 65.41, 82.41, 98.0, 110.0, 73.42, 65.41, 87.31];
    const midNotes = [261.63, 329.63, 392.0, 523.25, 659.25, 440.0, 349.23, 293.66];
    const highNotes = [1760.0, 2637.02, 3520.0, 5274.0, 7040.0, 10548.0];

    const stepFn = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const now = this.ctx.currentTime;
      const step = this.synthStep++;

      // Sub-bass & Kick drum (32Hz - 140Hz)
      if (step % 4 === 0 || step % 8 === 3 || step % 8 === 6) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.14);
        g.gain.setValueAtTime(0.88, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.connect(g);
        g.connect(feedGain);
        osc.start(now);
        osc.stop(now + 0.25);
      }

      if (step % 2 === 0) {
        const bOsc = this.ctx.createOscillator();
        const bG = this.ctx.createGain();
        bOsc.type = 'sawtooth';
        bOsc.frequency.setValueAtTime(bassNotes[Math.floor(step / 2) % bassNotes.length], now);
        bG.gain.setValueAtTime(0.32, now);
        bG.gain.exponentialRampToValueAtTime(0.008, now + 0.3);
        bOsc.connect(bG);
        bG.connect(feedGain);
        bOsc.start(now);
        bOsc.stop(now + 0.32);
      }

      // Vocals / Synth Chord (250Hz - 2.5kHz)
      if (step % 2 === 0 || step % 8 === 5) {
        const mOsc = this.ctx.createOscillator();
        const mG = this.ctx.createGain();
        mOsc.type = 'triangle';
        mOsc.frequency.setValueAtTime(midNotes[step % midNotes.length], now);
        mG.gain.setValueAtTime(0.36, now);
        mG.gain.exponentialRampToValueAtTime(0.008, now + 0.36);
        mOsc.connect(mG);
        mG.connect(feedGain);
        mOsc.start(now);
        mOsc.stop(now + 0.38);
      }

      // Hi-Hat / Cymbal Harmonics (2kHz - 12kHz)
      const hOsc = this.ctx.createOscillator();
      const hG = this.ctx.createGain();
      hOsc.type = 'sine';
      hOsc.frequency.setValueAtTime(highNotes[step % highNotes.length], now);
      hG.gain.setValueAtTime(step % 2 === 1 ? 0.24 : 0.12, now);
      hG.gain.exponentialRampToValueAtTime(0.002, now + 0.14);
      hOsc.connect(hG);
      hG.connect(feedGain);
      hOsc.start(now);
      hOsc.stop(now + 0.15);
    };

    stepFn();
    this.silentSynthTimer = window.setInterval(stepFn, 190);
  }

  public stopAll(): void {
    if (this.unlistenTauri) {
      this.unlistenTauri();
      this.unlistenTauri = null;
    }
    if (this.unlistenTray) {
      this.unlistenTray();
      this.unlistenTray = null;
    }
    if (this.unlistenSettings) {
      this.unlistenSettings();
      this.unlistenSettings = null;
    }
    if (this.unlistenTaskbar) {
      this.unlistenTaskbar();
      this.unlistenTaskbar = null;
    }
    if (this.unlistenMoved) {
      this.unlistenMoved();
      this.unlistenMoved = null;
    }
    if (this.silentSynthTimer !== null) {
      window.clearInterval(this.silentSynthTimer);
      this.silentSynthTimer = null;
    }
    this.latestNativePacket = null;
  }

  public sampleTelemetry(
    elasticIntensity = 1.0,
    autoSleepEnabled = true,
    autoSleepDelaySec = 10
  ): AudioTelemetry {
    const nowMs = performance.now();

    if (this.isTauriNative) {
      const packetAgeMs = nowMs - this.lastNativePacketTimeMs;
      const isStreamIdle = !this.latestNativePacket || packetAgeMs > 150;

      if (isStreamIdle && this.latestNativePacket) {
        const prevBands = this.latestNativePacket.spectrumBands ?? new Array(NUM_SPECTRUM_BANDS).fill(0);
        this.latestNativePacket = {
          ...this.latestNativePacket,
          rmsVolume:
            this.latestNativePacket.rmsVolume < 0.01
              ? 0
              : this.latestNativePacket.rmsVolume * 0.72,
          bassEnergy:
            this.latestNativePacket.bassEnergy < 0.01
              ? 0
              : this.latestNativePacket.bassEnergy * 0.72,
          midEnergy:
            this.latestNativePacket.midEnergy < 0.01
              ? 0
              : this.latestNativePacket.midEnergy * 0.72,
          trebleEnergy:
            this.latestNativePacket.trebleEnergy < 0.01
              ? 0
              : this.latestNativePacket.trebleEnergy * 0.72,
          spectrumBands: prevBands.map((v) => (v < 0.015 ? 0 : v * 0.68)),
          dbLevel: -60,
          dominantPitchHz: 0,
          isBeat: false,
        };
      }

      const pkt = this.latestNativePacket;
      const bassEnergy = Math.min(1, Math.max(0, pkt?.bassEnergy ?? 0));
      const midEnergy = Math.min(1, Math.max(0, pkt?.midEnergy ?? 0));
      const trebleEnergy = Math.min(1, Math.max(0, pkt?.trebleEnergy ?? 0));
      const rmsVolume = Math.min(1, Math.max(0, pkt?.rmsVolume ?? 0));
      const dbLevel = pkt?.dbLevel ?? -60;

      if (rmsVolume >= 0.035 && !isStreamIdle) {
        this.silentStartMs = nowMs;
      }
      const silentDurationSec = Math.max(0, (nowMs - this.silentStartMs) / 1000);
      const isSleeping = autoSleepEnabled && silentDurationSec >= autoSleepDelaySec;

      const dominantPitchHz = Math.round(pkt?.dominantPitchHz ?? 0);
      const noteName = frequencyToNoteName(dominantPitchHz);
      const pitchNormalized =
        dominantPitchHz > 70
          ? Math.max(0, Math.min(1, Math.log2(dominantPitchHz / 70) / Math.log2(1500 / 70)))
          : 0.5;

      const bassDelta = bassEnergy - this.prevBassEnergy;
      this.prevBassEnergy = bassEnergy * 0.65 + this.prevBassEnergy * 0.35;
      if (this.beatCooldown > 0) this.beatCooldown--;
      const isBeat =
        !isSleeping &&
        !isStreamIdle &&
        Boolean(pkt?.isBeat || (bassDelta > 0.08 && bassEnergy > 0.2 && this.beatCooldown === 0));
      if (isBeat) {
        this.beatCooldown = 8;
        this.springVelocity += Math.min(
          0.095,
          (bassDelta * 0.55 + rmsVolume * 0.12) * elasticIntensity
        );
      }

      const targetScale = isSleeping ? 1.0 : 1.0 + rmsVolume * 0.045 * elasticIntensity;
      this.springVelocity = (this.springVelocity + (targetScale - this.springScale) * 0.24) * 0.74;
      this.springScale = Math.max(0.96, Math.min(1.24, this.springScale + this.springVelocity));

      return {
        rmsVolume,
        dbLevel,
        bassEnergy,
        midEnergy,
        trebleEnergy,
        dominantPitchHz,
        noteName,
        pitchNormalized,
        isBeat,
        springScale: this.springScale,
        springVelocity: this.springVelocity,
        waveformSlice:
          !isStreamIdle && pkt?.waveformSlice && pkt.waveformSlice.length > 0
            ? pkt.waveformSlice
            : new Array(48).fill(0),
        spectrumBands:
          pkt?.spectrumBands && pkt.spectrumBands.length === NUM_SPECTRUM_BANDS
            ? pkt.spectrumBands
            : new Array(NUM_SPECTRUM_BANDS).fill(0),
        dominantInstrumentLabel: isSleeping
          ? '自动休眠省电中'
          : pkt?.deviceName
          ? `声卡输出: ${pkt.deviceName}`
          : '声卡输出直连运行中',
        silentDurationSec,
        isSleeping,
      };
    }

    if (!this.analyser || !this.ctx) {
      const silentDurationSec = Math.max(0, (nowMs - this.silentStartMs) / 1000);
      const isSleeping = autoSleepEnabled && silentDurationSec >= autoSleepDelaySec;
      return {
        rmsVolume: 0.02,
        dbLevel: -58,
        bassEnergy: 0.03,
        midEnergy: 0.03,
        trebleEnergy: 0.02,
        dominantPitchHz: 0,
        noteName: '--',
        pitchNormalized: 0.5,
        isBeat: false,
        springScale: 1.0,
        springVelocity: 0,
        waveformSlice: new Array(48).fill(0),
        spectrumBands: new Array(NUM_SPECTRUM_BANDS).fill(0),
        dominantInstrumentLabel: isSleeping ? '自动休眠省电中' : '声卡输出静默监听中',
        silentDurationSec,
        isSleeping,
      };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    const sampleRate = this.ctx.sampleRate || 48000;
    const binCount = this.analyser.frequencyBinCount;
    const nyquist = sampleRate / 2;
    const hzPerBin = nyquist / binCount;

    const lowStart = Math.max(1, Math.floor(20 / hzPerBin));
    const lowEnd = Math.min(binCount - 1, Math.floor(250 / hzPerBin));
    const midEnd = Math.min(binCount - 1, Math.floor(2500 / hzPerBin));
    const highEnd = Math.min(binCount - 1, Math.floor(14000 / hzPerBin));

    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let maxBinVal = 0;
    let maxBinIdx = 0;

    for (let i = lowStart; i <= highEnd; i++) {
      const val = this.freqData[i];
      if (i <= lowEnd) {
        lowSum += val;
      } else if (i <= midEnd) {
        midSum += val;
      } else {
        highSum += val;
      }
      if (i >= lowStart && i <= midEnd && val > maxBinVal) {
        maxBinVal = val;
        maxBinIdx = i;
      }
    }

    // Compute 32 Logarithmic Frequency Bands (32 Hz to 16 kHz)
    const minF = 32;
    const maxF = 16000;
    const ratio = maxF / minF;
    const spectrumBands: number[] = new Array(NUM_SPECTRUM_BANDS);

    for (let b = 0; b < NUM_SPECTRUM_BANDS; b++) {
      const f0 = minF * Math.pow(ratio, b / NUM_SPECTRUM_BANDS);
      const f1 = minF * Math.pow(ratio, (b + 1) / NUM_SPECTRUM_BANDS);
      const idx0 = Math.max(1, Math.min(binCount - 1, Math.floor(f0 / hzPerBin)));
      const idx1 = Math.max(idx0, Math.min(binCount - 1, Math.ceil(f1 / hzPerBin)));

      let peak = 0;
      let sum = 0;
      for (let i = idx0; i <= idx1; i++) {
        const v = this.freqData[i] / 255;
        if (v > peak) peak = v;
        sum += v;
      }
      const avg = peak * 0.65 + (sum / Math.max(1, idx1 - idx0 + 1)) * 0.35;
      const tilt = 1.0 + (b / NUM_SPECTRUM_BANDS) * 0.95;
      const rawVal = Math.min(1, Math.pow(avg * tilt, 0.85));
      const prev = this.smoothedBands[b] || 0;
      const next = rawVal > prev ? prev * 0.25 + rawVal * 0.75 : prev * 0.6 + rawVal * 0.4;
      this.smoothedBands[b] = next < 0.015 ? 0 : next;
      spectrumBands[b] = this.smoothedBands[b];
    }

    const lowCount = Math.max(1, lowEnd - lowStart + 1);
    const midCount = Math.max(1, midEnd - lowEnd);
    const highCount = Math.max(1, highEnd - midEnd);

    const bassEnergy = Math.min(1, (lowSum / (lowCount * 255)) * 1.45);
    const midEnergy = Math.min(1, (midSum / (midCount * 255)) * 1.65);
    const trebleEnergy = Math.min(1, (highSum / (highCount * 255)) * 2.35);

    let sumSquares = 0;
    const waveformSlice: number[] = [];
    const step = Math.max(1, Math.floor(binCount / 48));
    for (let i = 0; i < binCount; i++) {
      const norm = (this.timeData[i] - 128) / 128;
      sumSquares += norm * norm;
      if (waveformSlice.length < 48 && i % step === 0) {
        waveformSlice.push(norm);
      }
    }
    const rawRms = Math.sqrt(sumSquares / binCount);
    const energyBlend = bassEnergy * 0.42 + midEnergy * 0.38 + trebleEnergy * 0.2;
    const rmsVolume = Math.min(1, Math.max(rawRms * 2.1, energyBlend));
    const dbLevel = rmsVolume > 0.0005 ? Math.max(-60, Math.round(20 * Math.log10(rmsVolume))) : -60;

    if (rmsVolume >= 0.038) {
      this.silentStartMs = nowMs;
    }
    const silentDurationSec = Math.max(0, (nowMs - this.silentStartMs) / 1000);
    const isSleeping = autoSleepEnabled && silentDurationSec >= autoSleepDelaySec;

    const rawPitchHz = maxBinVal > 28 ? maxBinIdx * hzPerBin : 0;
    if (rawPitchHz > 0) {
      this.smoothedPitchHz =
        this.smoothedPitchHz === 0
          ? rawPitchHz
          : this.smoothedPitchHz * 0.78 + rawPitchHz * 0.22;
    } else {
      this.smoothedPitchHz *= 0.92;
    }
    const dominantPitchHz = this.smoothedPitchHz > 35 ? Math.round(this.smoothedPitchHz) : 0;
    const noteName = frequencyToNoteName(dominantPitchHz);

    const pitchNormalized =
      dominantPitchHz > 70
        ? Math.max(0, Math.min(1, Math.log2(dominantPitchHz / 70) / Math.log2(1500 / 70)))
        : 0.5;

    const bassDelta = bassEnergy - this.prevBassEnergy;
    this.prevBassEnergy = bassEnergy * 0.65 + this.prevBassEnergy * 0.35;

    if (this.beatCooldown > 0) this.beatCooldown--;
    const isBeat = !isSleeping && bassDelta > 0.085 && bassEnergy > 0.22 && this.beatCooldown === 0;
    if (isBeat) {
      this.beatCooldown = 8;
      this.springVelocity += Math.min(0.095, (bassDelta * 0.55 + rmsVolume * 0.12) * elasticIntensity);
    }

    const targetScale = isSleeping ? 1.0 : 1.0 + rmsVolume * 0.045 * elasticIntensity;
    const stiffness = 0.24;
    const damping = 0.74;
    const force = (targetScale - this.springScale) * stiffness;
    this.springVelocity = (this.springVelocity + force) * damping;
    this.springScale = Math.max(0.96, Math.min(1.24, this.springScale + this.springVelocity));

    return {
      rmsVolume,
      dbLevel,
      bassEnergy,
      midEnergy,
      trebleEnergy,
      dominantPitchHz,
      noteName,
      pitchNormalized,
      isBeat,
      springScale: this.springScale,
      springVelocity: this.springVelocity,
      waveformSlice,
      spectrumBands,
      dominantInstrumentLabel: isSleeping ? '自动休眠省电中' : '声卡输出直连运行中',
      silentDurationSec,
      isSleeping,
    };
  }
}
