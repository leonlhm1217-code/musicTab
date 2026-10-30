import { AudioSourceMode, AudioTelemetry } from '../types/audio';

const NOTE_STRINGS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const DEMO_LYRICS_SEQUENCE = [
  { text: '星河在低音的脉搏里缓缓苏醒', sub: 'Sub-Bass 65Hz · 暖调大提琴与底鼓共鸣' },
  { text: '指尖划过琴键 泛起清澈的声波涟漪', sub: 'Mid-Vocal 523Hz · 电钢琴与人声中频流光' },
  { text: '高频泛音如微光粒子 在夜色中绽放', sub: 'Hi-Strings 4.2kHz · 弦乐泛音与星尘微粒' },
  { text: '每一句歌词 都随着节拍自由呼吸律动', sub: 'Full-Band Ensemble · 三频流光交织共振' },
  { text: '静谧工位一隅 留一抹不打扰的音乐流光', sub: 'AuraLyric Mini · 轻量级桌面伴侣模式' },
];

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
  private mediaStream: MediaStream | null = null;
  private sourceNode: AudioNode | null = null;
  private fileAudioElement: HTMLAudioElement | null = null;
  private demoTimerId: number | null = null;
  private demoMasterGain: GainNode | null = null;

  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private timeData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));

  private mode: AudioSourceMode = 'none';
  private prevBassEnergy = 0;
  private beatCooldown = 0;
  private springScale = 1.0;
  private springVelocity = 0;
  private smoothedPitchHz = 0;
  private demoStep = 0;
  private currentLyricIndex = 0;
  private silentStartMs: number = performance.now();

  public getMode(): AudioSourceMode {
    return this.mode;
  }

  public getCurrentLyric() {
    return DEMO_LYRICS_SEQUENCE[this.currentLyricIndex % DEMO_LYRICS_SEQUENCE.length];
  }

  public resetSilenceTimer(): void {
    this.silentStartMs = performance.now();
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
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

  public stopAll(): void {
    if (this.demoTimerId !== null) {
      window.clearInterval(this.demoTimerId);
      this.demoTimerId = null;
    }
    if (this.demoMasterGain) {
      try {
        this.demoMasterGain.disconnect();
      } catch {
        // ignore
      }
      this.demoMasterGain = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.fileAudioElement) {
      this.fileAudioElement.pause();
      this.fileAudioElement.src = '';
      this.fileAudioElement = null;
    }
    this.mode = 'none';
  }

  /**
   * Capture System / Tab Audio (for QQ Music Desktop or Web Player)
   */
  public async startSystemAudio(onStreamEnded?: () => void): Promise<void> {
    this.stopAll();
    const ctx = this.ensureContext();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('当前浏览器环境不支持系统屏幕音频捕获，请尝试使用「麦克风/混音输入」或「内置三频示范曲」。');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
    });

    const audioTracks = stream.getAudioTracks();
    // Stop video track immediately if we only need audio, keeping CPU ultra-low for work computer
    stream.getVideoTracks().forEach((vt) => vt.stop());

    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('未检测到共享音频流。请在弹出的系统共享窗口底部勾选「同时共享系统音频 / 共享标签页音频」。');
    }

    const audioOnlyStream = new MediaStream(audioTracks);
    this.mediaStream = audioOnlyStream;

    audioTracks[0].onended = () => {
      this.stopAll();
      if (onStreamEnded) onStreamEnded();
    };

    const src = ctx.createMediaStreamSource(audioOnlyStream);
    src.connect(this.analyser!);
    this.sourceNode = src;
    this.mode = 'system';
  }

  /**
   * Capture Microphone or Stereo Mix (立体声混音)
   */
  public async startMicrophoneAudio(): Promise<void> {
    this.stopAll();
    const ctx = this.ensureContext();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风音频输入。');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    this.mediaStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(this.analyser!);
    this.sourceNode = src;
    this.mode = 'mic';
  }

  /**
   * Play Local Audio File
   */
  public async startLocalFileAudio(file: File): Promise<void> {
    this.stopAll();
    const ctx = this.ensureContext();
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.loop = true;
    audio.crossOrigin = 'anonymous';
    await audio.play();

    const src = ctx.createMediaElementSource(audio);
    src.connect(this.analyser!);
    this.analyser!.connect(ctx.destination);

    this.fileAudioElement = audio;
    this.sourceNode = src;
    this.mode = 'file';
  }

  /**
   * Built-in 3-Band Multi-Instrument Synth Demo Track
   * Simulates Low (Kick + Bass), Mid (Vocal/Rhodes Melody), and High (Hi-Hat + String Harmonics)
   */
  public startBuiltInDemo(audibleVolume = 0.22): void {
    this.stopAll();
    const ctx = this.ensureContext();

    const master = ctx.createGain();
    master.gain.value = audibleVolume;
    master.connect(this.analyser!);
    master.connect(ctx.destination);
    this.demoMasterGain = master;
    this.mode = 'demo';
    this.demoStep = 0;

    // Musical scale frequencies (C major / A minor pentatonic lush progression)
    const bassNotes = [65.41, 65.41, 87.31, 87.31, 110.0, 98.0, 73.42, 82.41]; // C2, F2, A2, G2, D2, E2
    const midMelodyNotes = [
      261.63, 329.63, 392.0, 523.25, 440.0, 392.0, 349.23, 329.63,
      293.66, 392.0, 493.88, 587.33, 659.25, 523.25, 440.0, 392.0,
    ];
    const highArpNotes = [2093.0, 2637.02, 3135.96, 3520.0, 4186.01, 2793.83, 3951.07, 3135.96];

    const triggerStep = () => {
      if (!this.ctx || this.mode !== 'demo' || !this.demoMasterGain) return;
      const now = this.ctx.currentTime;
      const step = this.demoStep;

      // Update demo lyric line every 16 steps (~3.2 seconds)
      if (step % 16 === 0) {
        this.currentLyricIndex = Math.floor(step / 16) % DEMO_LYRICS_SEQUENCE.length;
      }

      // 1. LOW BAND: Punchy Kick Drum + Sub Bass on beats 0, 3, 4, 6
      if (step % 4 === 0 || step % 8 === 3 || step % 8 === 6) {
        const kickOsc = this.ctx.createOscillator();
        const kickGain = this.ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(135, now);
        kickOsc.frequency.exponentialRampToValueAtTime(48, now + 0.14);

        kickGain.gain.setValueAtTime(0.85, now);
        kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

        kickOsc.connect(kickGain);
        kickGain.connect(this.demoMasterGain);
        kickOsc.start(now);
        kickOsc.stop(now + 0.29);
      }

      if (step % 2 === 0) {
        const bassFreq = bassNotes[Math.floor(step / 4) % bassNotes.length];
        const bassOsc = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(bassFreq, now);

        bassGain.gain.setValueAtTime(0.45, now);
        bassGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        bassOsc.connect(bassGain);
        bassGain.connect(this.demoMasterGain);
        bassOsc.start(now);
        bassOsc.stop(now + 0.36);
      }

      // 2. MID BAND: Warm Rhodes / Vocal Lead Melody
      if (step % 2 === 0 || step % 8 === 5) {
        const midFreq = midMelodyNotes[step % midMelodyNotes.length];
        const midOsc = this.ctx.createOscillator();
        const midSub = this.ctx.createOscillator();
        const midGain = this.ctx.createGain();

        midOsc.type = 'sine';
        midSub.type = 'triangle';
        midOsc.frequency.setValueAtTime(midFreq, now);
        midSub.frequency.setValueAtTime(midFreq * 1.5, now); // Fifth harmonic for rich mid-band presence

        midGain.gain.setValueAtTime(0.01, now);
        midGain.gain.linearRampToValueAtTime(0.38, now + 0.04);
        midGain.gain.exponentialRampToValueAtTime(0.008, now + 0.42);

        midOsc.connect(midGain);
        midSub.connect(midGain);
        midGain.connect(this.demoMasterGain);
        midOsc.start(now);
        midSub.start(now);
        midOsc.stop(now + 0.44);
        midSub.stop(now + 0.44);
      }

      // 3. HIGH BAND: Shimmering String Harmonics & Crisp Hi-Hat Overtones
      if (step % 2 === 1 || step % 4 === 2) {
        const hiFreq = highArpNotes[step % highArpNotes.length];
        const hiOsc = this.ctx.createOscillator();
        const hiGain = this.ctx.createGain();
        hiOsc.type = 'sine';
        hiOsc.frequency.setValueAtTime(hiFreq, now);
        hiOsc.frequency.exponentialRampToValueAtTime(hiFreq * 1.02, now + 0.16);

        hiGain.gain.setValueAtTime(0.24, now);
        hiGain.gain.exponentialRampToValueAtTime(0.002, now + 0.18);

        hiOsc.connect(hiGain);
        hiGain.connect(this.demoMasterGain);
        hiOsc.start(now);
        hiOsc.stop(now + 0.19);
      }

      this.demoStep++;
    };

    triggerStep();
    this.demoTimerId = window.setInterval(triggerStep, 210);
  }

  public setDemoAudibleVolume(val: number): void {
    if (this.demoMasterGain && this.ctx) {
      this.demoMasterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.05);
    }
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

    if (!this.analyser || !this.ctx || this.mode === 'none') {
      const silentDurationSec = Math.max(0, (nowMs - this.silentStartMs) / 1000);
      const isSleeping = autoSleepEnabled && silentDurationSec >= autoSleepDelaySec;

      const nowSec = nowMs * 0.001;
      const idleWave: number[] = [];
      for (let i = 0; i < 48; i++) {
        idleWave.push(isSleeping ? 0 : Math.sin(nowSec * 1.6 + i * 0.22) * 0.05);
      }
      this.springScale += (1.0 - this.springScale) * 0.15;
      return {
        rmsVolume: 0.03,
        dbLevel: -58,
        bassEnergy: isSleeping ? 0.02 : 0.05 + Math.sin(nowSec * 1.2) * 0.02,
        midEnergy: isSleeping ? 0.02 : 0.06 + Math.cos(nowSec * 1.5) * 0.02,
        trebleEnergy: isSleeping ? 0.01 : 0.04 + Math.sin(nowSec * 2.1) * 0.015,
        dominantPitchHz: 0,
        noteName: '--',
        pitchNormalized: 0.5,
        isBeat: false,
        springScale: isSleeping ? 1.0 : this.springScale,
        springVelocity: 0,
        waveformSlice: idleWave,
        dominantInstrumentLabel: isSleeping ? '自动休眠省电中' : '待机静默 · 等待QQ音乐音频流',
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

    // Frequency band bin boundaries:
    // Low (Drums / Bass): 20Hz - 250Hz
    // Mid (Vocals / Piano / Guitar): 250Hz - 2500Hz
    // High (Strings / Cymbals / Synths): 2500Hz - 14000Hz
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
      // Track dominant melodic peak in vocal/instrument fundamental range (65Hz - 2400Hz)
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

    // Compute RMS volume from time domain + frequency energy blend
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

    // Silence detection for Auto-Sleep (threshold: rmsVolume < 0.038)
    if (rmsVolume >= 0.038) {
      this.silentStartMs = nowMs;
    }
    const silentDurationSec = Math.max(0, (nowMs - this.silentStartMs) / 1000);
    const isSleeping = autoSleepEnabled && silentDurationSec >= autoSleepDelaySec;

    // Dominant Pitch estimation
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

    // Map pitch logarithmically between 70Hz and 1500Hz to [0, 1]
    const pitchNormalized =
      dominantPitchHz > 70
        ? Math.max(0, Math.min(1, Math.log2(dominantPitchHz / 70) / Math.log2(1500 / 70)))
        : 0.5;

    // Onset Beat Detection & Damped Harmonic Spring Physics for Lyrics Elastic Bounce
    const bassDelta = bassEnergy - this.prevBassEnergy;
    this.prevBassEnergy = bassEnergy * 0.65 + this.prevBassEnergy * 0.35;

    if (this.beatCooldown > 0) this.beatCooldown--;
    const isBeat = !isSleeping && bassDelta > 0.085 && bassEnergy > 0.22 && this.beatCooldown === 0;
    if (isBeat) {
      this.beatCooldown = 8;
      this.springVelocity += Math.min(0.095, (bassDelta * 0.55 + rmsVolume * 0.12) * elasticIntensity);
    }

    // Damped spring simulation towards target base scale
    const targetScale = isSleeping ? 1.0 : 1.0 + rmsVolume * 0.045 * elasticIntensity;
    const stiffness = 0.24;
    const damping = 0.74;
    const force = (targetScale - this.springScale) * stiffness;
    this.springVelocity = (this.springVelocity + force) * damping;
    this.springScale = Math.max(0.96, Math.min(1.24, this.springScale + this.springVelocity));

    // Determine dominant instrument / frequency layer description
    let dominantInstrumentLabel = '轻柔背景律动';
    if (isSleeping) {
      dominantInstrumentLabel = '自动休眠省电中';
    } else if (rmsVolume < 0.04) {
      dominantInstrumentLabel = '静音间隙 · 呼吸待机';
    } else if (bassEnergy > midEnergy * 1.18 && bassEnergy > trebleEnergy * 1.25) {
      dominantInstrumentLabel = '低频主导 · 鼓组与贝斯脉冲';
    } else if (trebleEnergy > midEnergy * 1.05 && trebleEnergy > 0.22) {
      dominantInstrumentLabel = '高频突出 · 弦乐泛音与镲片星尘';
    } else if (midEnergy > 0.18 && bassEnergy > 0.24 && trebleEnergy > 0.18) {
      dominantInstrumentLabel = '全频合奏 · 人声与器乐交织绽放';
    } else {
      dominantInstrumentLabel = '中频主导 · 人声主旋律与琴键流光';
    }

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
      dominantInstrumentLabel,
      silentDurationSec,
      isSleeping,
    };
  }
}
