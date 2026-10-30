import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioTelemetry } from '../types/audio';

const NOTE_STRINGS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WINDOW_POS_STORAGE_KEY = 'auraline_window_pos_v1';

export interface TauriTelemetryPayload {
  rmsVolume: number;
  dbLevel: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  dominantPitchHz: number;
  isBeat: boolean;
  waveformSlice: number[];
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
  private unlistenMoved: UnlistenFn | null = null;
  private latestNativePacket: TauriTelemetryPayload | null = null;
  private isTauriNative = false;

  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private timeData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));

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

  /**
   * Invokes the Rust native command `set_click_through` via @tauri-apps/api/core
   * so mouse clicks pass directly through the transparent window to desktop apps behind it.
   */
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

  /**
   * Starts native frameless OS window dragging via @tauri-apps/api/window or Rust command,
   * and persists the final screen coordinates after dragging completes.
   */
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

  /**
   * Restores the saved desktop screen position (X, Y) on `.exe` launch,
   * or docks the stealth fine line at the bottom center of the primary screen on first launch.
   */
  public async initWindowPositionMemory(): Promise<void> {
    if (!this.isRunningInTauri()) return;
    try {
      const raw = localStorage.getItem(WINDOW_POS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { x: number; y: number };
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          await invoke('set_window_position', { x: parsed.x, y: parsed.y });
        }
      } else {
        const [x, y] = await invoke<[number, number]>('reset_window_to_bottom_center');
        localStorage.setItem(WINDOW_POS_STORAGE_KEY, JSON.stringify({ x, y }));
      }

      // Listen for native OS window move events to persist position automatically
      const win = getCurrentWindow();
      this.unlistenMoved = await win.onMoved(({ payload }) => {
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

  /**
   * Subscribes to native Windows System Tray right-click menu actions emitted by Rust.
   */
  public async subscribeToTrayCommands(onCommand: (cmd: string) => void): Promise<void> {
    if (!this.isRunningInTauri()) return;
    try {
      if (this.unlistenTray) {
        this.unlistenTray();
      }
      this.unlistenTray = await listen<string>('tray-command', (event) => {
        onCommand(event.payload);
      });
    } catch {
      // ignore in web preview
    }
  }

  /**
   * Automatically connects to the sound card output on launch with ZERO microphone access:
   * 1. In Tauri v2 Native `.exe`: Subscribes to Rust `cpal` `default_output_device()` WASAPI Loopback
   *    stream (`"audio-telemetry"`). Microphones (`default_input_device`) are 100% physically untouched.
   * 2. In Web Preview Fallback: Runs an internal zero-speaker-volume acoustic signal generator into
   *    AnalyserNode (`navigator.mediaDevices.getUserMedia` is 100% removed so the browser never touches
   *    or requests any microphone).
   */
  public async startAutoConnect(): Promise<void> {
    this.stopAll();

    // 1. Official @tauri-apps/api/event Native Soundcard Output Loopback Subscription
    if (this.isRunningInTauri()) {
      this.isTauriNative = true;
      try {
        this.unlistenTauri = await listen<TauriTelemetryPayload>('audio-telemetry', (event) => {
          this.latestNativePacket = event.payload;
        });
        return;
      } catch {
        try {
          if (window.__TAURI__?.event?.listen) {
            this.unlistenTauri = await window.__TAURI__.event.listen<TauriTelemetryPayload>(
              'audio-telemetry',
              (event) => {
                this.latestNativePacket = event.payload;
              }
            );
            return;
          }
        } catch {
          // Continue if running outside Tauri webview
        }
      }
    }

    // 2. Web Preview Mode: 100% zero microphone calls; use internal silent-speaker synth for visual preview
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
      this.analyser.smoothingTimeConstant = 0.78;
      this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    }
    return this.ctx;
  }

  /**
   * Feeds a realistic 3-band musical signal into the AnalyserNode (with 0.0 speaker gain)
   * when previewed in a browser environment without Tauri native WASAPI loopback.
   */
  private startInternalPreviewSignal(): void {
    const ctx = this.ensureContext();
    const feedGain = ctx.createGain();
    feedGain.gain.value = 0.35;
    feedGain.connect(this.analyser!);

    // Keep speaker output completely silent (0.0) in office preview while feeding AnalyserNode
    const muteOut = ctx.createGain();
    muteOut.gain.value = 0.0;
    this.analyser!.connect(muteOut);
    muteOut.connect(ctx.destination);

    const bassNotes = [65.41, 65.41, 87.31, 87.31, 110.0, 98.0, 73.42, 82.41];
    const midNotes = [261.63, 329.63, 392.0, 523.25, 440.0, 392.0, 349.23, 329.63];
    const highNotes = [2637.02, 3135.96, 3520.0, 4186.01];

    const stepFn = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const now = this.ctx.currentTime;
      const step = this.synthStep++;

      // Low Band (Kick & Bass)
      if (step % 4 === 0 || step % 8 === 3 || step % 8 === 6) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.exponentialRampToValueAtTime(48, now + 0.14);
        g.gain.setValueAtTime(0.85, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.connect(g);
        g.connect(feedGain);
        osc.start(now);
        osc.stop(now + 0.27);
      }

      if (step % 2 === 0) {
        const bOsc = this.ctx.createOscillator();
        const bG = this.ctx.createGain();
        bOsc.type = 'triangle';
        bOsc.frequency.setValueAtTime(bassNotes[Math.floor(step / 4) % bassNotes.length], now);
        bG.gain.setValueAtTime(0.42, now);
        bG.gain.exponentialRampToValueAtTime(0.01, now + 0.32);
        bOsc.connect(bG);
        bG.connect(feedGain);
        bOsc.start(now);
        bOsc.stop(now + 0.34);
      }

      // Mid Band (Vocal/Piano Lead)
      if (step % 2 === 0 || step % 8 === 5) {
        const mOsc = this.ctx.createOscillator();
        const mG = this.ctx.createGain();
        mOsc.type = 'sine';
        mOsc.frequency.setValueAtTime(midNotes[step % midNotes.length], now);
        mG.gain.setValueAtTime(0.36, now);
        mG.gain.exponentialRampToValueAtTime(0.008, now + 0.38);
        mOsc.connect(mG);
        mG.connect(feedGain);
        mOsc.start(now);
        mOsc.stop(now + 0.4);
      }

      // High Band (Strings/Hi-hat Harmonics)
      if (step % 2 === 1) {
        const hOsc = this.ctx.createOscillator();
        const hG = this.ctx.createGain();
        hOsc.type = 'sine';
        hOsc.frequency.setValueAtTime(highNotes[step % highNotes.length], now);
        hG.gain.setValueAtTime(0.22, now);
        hG.gain.exponentialRampToValueAtTime(0.002, now + 0.16);
        hOsc.connect(hG);
        hG.connect(feedGain);
        hOsc.start(now);
        hOsc.stop(now + 0.17);
      }
    };

    stepFn();
    this.silentSynthTimer = window.setInterval(stepFn, 220);
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

  /**
   * Real-time frame telemetry extraction for 60fps/30fps/Auto-Sleep Canvas & Spring Physics
   */
  public sampleTelemetry(
    elasticIntensity = 1.0,
    autoSleepEnabled = true,
    autoSleepDelaySec = 10
  ): AudioTelemetry {
    const nowMs = performance.now();

    // 1. Tauri v2 Rust WASAPI Output Loopback Native Stream
    if (this.isTauriNative && this.latestNativePacket) {
      const pkt = this.latestNativePacket;
      const bassEnergy = Math.min(1, Math.max(0, pkt.bassEnergy ?? 0.02));
      const midEnergy = Math.min(1, Math.max(0, pkt.midEnergy ?? 0.02));
      const trebleEnergy = Math.min(1, Math.max(0, pkt.trebleEnergy ?? 0.01));
      const rmsVolume = Math.min(1, Math.max(0, pkt.rmsVolume ?? 0.02));
      const dbLevel = pkt.dbLevel ?? -60;

      if (rmsVolume >= 0.038) {
        this.silentStartMs = nowMs;
      }
      const silentDurationSec = Math.max(0, (nowMs - this.silentStartMs) / 1000);
      const isSleeping = autoSleepEnabled && silentDurationSec >= autoSleepDelaySec;

      const dominantPitchHz = Math.round(pkt.dominantPitchHz ?? 0);
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
        (pkt.isBeat || (bassDelta > 0.08 && bassEnergy > 0.2 && this.beatCooldown === 0));
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
          pkt.waveformSlice && pkt.waveformSlice.length > 0
            ? pkt.waveformSlice
            : new Array(48).fill(0),
        dominantInstrumentLabel: isSleeping
          ? '自动休眠省电中'
          : pkt.deviceName
          ? `声卡输出: ${pkt.deviceName}`
          : '声卡输出直连运行中',
        silentDurationSec,
        isSleeping,
      };
    }

    // 2. Web Audio AnalyserNode Path (Preview only, zero microphone access)
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
      dominantInstrumentLabel: isSleeping ? '自动休眠省电中' : '声卡输出直连运行中',
      silentDurationSec,
      isSleeping,
    };
  }
}
