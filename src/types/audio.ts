export type AudioSourceMode = 'none' | 'system' | 'mic' | 'demo' | 'file';

export type AuraThemeId = 'minimal_white' | 'deep_sea' | 'vibrant_pulse' | 'forest_mist';

export type AutoSleepBehavior = 'freeze' | 'low_fps';

export interface AudioTelemetry {
  rmsVolume: number;           // 0 to 1 overall amplitude
  dbLevel: number;             // -60 to 0 dB
  bassEnergy: number;          // 0 to 1 (20Hz - 250Hz: Kick drum, Bass guitar)
  midEnergy: number;           // 0 to 1 (250Hz - 2500Hz: Vocals, Piano, Guitar)
  trebleEnergy: number;        // 0 to 1 (2500Hz - 16000Hz: Strings, Cymbals, Harmonics)
  dominantPitchHz: number;     // Estimated dominant pitch in Hz
  noteName: string;            // Musical pitch label e.g. "A4", "E3", "--"
  pitchNormalized: number;     // 0 to 1 normalized pitch position
  isBeat: boolean;             // True on transient onset beat
  springScale: number;         // Damped spring scale multiplier
  springVelocity: number;      // Internal spring velocity
  waveformSlice: number[];     // 48-point normalized wave array (-1 to 1)
  dominantInstrumentLabel: string; // Active acoustic range
  silentDurationSec: number;   // Continuous seconds without audio input
  isSleeping: boolean;         // True when Auto-Sleep has been triggered
}

export interface AuraThemePalette {
  id: AuraThemeId;
  name: string;
  desc: string;
  bassColor: [number, number, number];    // RGB for Low frequency (Drums/Bass)
  midColor: [number, number, number];     // RGB for Mid frequency (Vocals/Piano/Guitar)
  trebleColor: [number, number, number];  // RGB for High frequency (Strings/Hi-hats)
}

export interface StealthLineSettings {
  lineWidth: number;                   // 160px to 640px (default 360px)
  lineHeight: number;                  // 4px to 16px (default 8px)
  theme: AuraThemeId;
  elasticIntensity: number;            // 0.3 to 2.0
  auraSensitivity: number;             // 0.4 to 1.8
  workLowPower30Fps: boolean;          // 30fps office mode vs 60fps
  lightCanvasBg: boolean;              // Pure dark (#09090B) vs pure light (#F4F4F5) backdrop
  autoSleepEnabled: boolean;           // Automatically sleep on prolonged silence
  autoSleepDelaySec: number;           // Silence threshold in seconds (e.g. 5, 10, 30, 60)
  autoSleepBehavior: AutoSleepBehavior; // 'freeze' (0 FPS pause) or 'low_fps' (2 FPS standby)
}

export const AURA_THEMES: Record<AuraThemeId, AuraThemePalette> = {
  minimal_white: {
    id: 'minimal_white',
    name: '极简白',
    desc: '黑白对比 · 纯净银白高反差流光',
    bassColor: [161, 161, 170],   // Zinc Silver (#A1A1AA)
    midColor: [255, 255, 255],    // Crisp Pure White (#FFFFFF)
    trebleColor: [212, 212, 216], // Platinum Mist (#D4D4D8)
  },
  deep_sea: {
    id: 'deep_sea',
    name: '深海静谧',
    desc: '蓝紫色系 · 靛蓝低频与星云紫泛音',
    bassColor: [99, 102, 241],    // Deep Indigo (#6366F1)
    midColor: [56, 189, 248],     // Ocean Cyan-Blue (#38BDF8)
    trebleColor: [192, 132, 252], // Nebula Violet (#C084FC)
  },
  vibrant_pulse: {
    id: 'vibrant_pulse',
    name: '活力律动',
    desc: '橙红色系 · 绯红重低音与暖橙流金',
    bassColor: [244, 63, 94],     // Crimson Rose (#F43F5E)
    midColor: [251, 146, 60],     // Vibrant Orange (#FB923C)
    trebleColor: [251, 191, 36],  // Warm Amber Gold (#FBBF24)
  },
  forest_mist: {
    id: 'forest_mist',
    name: '森屿微光',
    desc: '青翠色系 · 翡翠冷杉与冰青薄雾',
    bassColor: [16, 185, 129],    // Emerald (#10B981)
    midColor: [45, 212, 191],     // Teal Mint (#2DD4BF)
    trebleColor: [167, 243, 208], // Soft Seafoam (#A7F3D0)
  },
};
