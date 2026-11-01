export type AuraThemeId = 'minimal_white' | 'deep_sea' | 'vibrant_pulse' | 'forest_mist';

export type AutoSleepBehavior = 'freeze' | 'low_fps';

export type TaskbarDockMode = 'left_edge' | 'after_icons' | 'before_tray' | 'manual';

export interface AudioTelemetry {
  rmsVolume: number;           // 0 to 1 overall amplitude
  dbLevel: number;             // -60 to 0 dB
  bassEnergy: number;          // 0 to 1 (20Hz - 250Hz)
  midEnergy: number;           // 0 to 1 (250Hz - 2500Hz)
  trebleEnergy: number;        // 0 to 1 (2500Hz - 16000Hz)
  dominantPitchHz: number;     // Estimated dominant pitch in Hz
  noteName: string;            // Musical pitch label e.g. "A4", "E3", "--"
  pitchNormalized: number;     // 0 to 1 normalized pitch position
  isBeat: boolean;             // True on transient onset beat
  springScale: number;         // Damped spring scale multiplier
  springVelocity: number;      // Internal spring velocity
  waveformSlice: number[];     // 48-point normalized wave array (-1 to 1)
  spectrumBands: number[];     // 32 logarithmic frequency bands (32Hz to 16kHz, 0..1)
  dominantInstrumentLabel: string; // Active acoustic range
  silentDurationSec: number;   // Continuous seconds without audio input
  isSleeping: boolean;         // True when Auto-Sleep has been triggered
}

export interface TaskbarSlotTelemetry {
  x: number;
  y: number;
  availableWidth: number;
  taskbarHeight: number;
  recommendedBands: number;
  centeredLeftX: number;
  iconsRightX: number;
  trayLeftX: number;
}

export interface AuraThemePalette {
  id: AuraThemeId;
  name: string;
  desc: string;
  bassColor: [number, number, number];    // Bottom zone segments (Normal level)
  midColor: [number, number, number];     // Upper-mid zone segments (Warm level)
  trebleColor: [number, number, number];  // Top zone & Peak-Hold cap color (Peak level)
}

export interface StealthLineSettings {
  lineWidth: number;                   // Max spectrum bar width: 120px to 420px (default 220px)
  lineHeight: number;                  // Spectrum height inside taskbar: 20px to 40px (default 28px)
  preferredBands: 16 | 24 | 32;        // Max frequency bars (auto-scales down if taskbar is crowded)
  taskbarDockMode: TaskbarDockMode;    // 'left_edge' | 'after_icons' | 'before_tray' | 'manual'
  taskbarOffsetX: number;              // Fine horizontal adjustment (-120 to +120 px)
  showPeakHoldCaps: boolean;           // Classic car stereo floating Peak-Hold top blocks
  masterOpacity: number;               // 0.20 to 1.00 (default 1.00) overall opacity
  theme: AuraThemeId;
  elasticIntensity: number;            // 0.5 to 2.0
  auraSensitivity: number;             // 0.5 to 2.0
  workLowPower30Fps: boolean;          // 30fps office mode vs 60fps
  lightCanvasBg: boolean;
  autoSleepEnabled: boolean;           // Automatically sleep on prolonged silence
  autoSleepDelaySec: number;           // Silence threshold in seconds (5, 10, 30, 60)
  autoSleepBehavior: AutoSleepBehavior; // 'freeze' (0 FPS pause) or 'low_fps' (2 FPS standby)
}

export const AURA_THEMES: Record<AuraThemeId, AuraThemePalette> = {
  minimal_white: {
    id: 'minimal_white',
    name: '经典车载 VFD',
    desc: '先锋/阿尔派经典荧光冰青底格 + 琥珀中段 + 绯红峰值顶格',
    bassColor: [0, 245, 212],     // Classic VFD Ice Cyan (#00F5D4)
    midColor: [251, 191, 36],     // Automotive Amber (#FBBF24)
    trebleColor: [244, 63, 94],   // Peak Hold Crimson Red (#F43F5E)
  },
  deep_sea: {
    id: 'deep_sea',
    name: '深海静谧',
    desc: '靛蓝低频灯珠 + 电光青中段 + 星云紫白峰值顶格',
    bassColor: [99, 102, 241],    // Deep Indigo (#6366F1)
    midColor: [56, 189, 248],     // Ocean Cyan-Blue (#38BDF8)
    trebleColor: [232, 121, 249], // Bright Neon Fuchsia-Violet (#E879F9)
  },
  vibrant_pulse: {
    id: 'vibrant_pulse',
    name: '复古琥珀',
    desc: '80年代老式车载暖橙琥珀灯珠 + 烈焰红中段 + 纯白峰值顶格',
    bassColor: [245, 158, 11],    // Retro Automotive Amber (#F59E0B)
    midColor: [249, 115, 22],     // Bright Orange-Red (#F97316)
    trebleColor: [255, 255, 255], // Crisp White Peak Cap (#FFFFFF)
  },
  forest_mist: {
    id: 'forest_mist',
    name: '极简纯白',
    desc: '无缝融入 Win10/11 任务栏的银灰底格与纯白高亮峰值顶格',
    bassColor: [161, 161, 170],   // Zinc Silver (#A1A1AA)
    midColor: [228, 228, 231],    // Crisp Platinum (#E4E4E7)
    trebleColor: [255, 255, 255], // Pure White Peak Cap (#FFFFFF)
  },
};

export const DEFAULT_SETTINGS: StealthLineSettings = {
  lineWidth: 320,
  lineHeight: 38,
  preferredBands: 24,
  taskbarDockMode: 'left_edge',
  taskbarOffsetX: 0,
  showPeakHoldCaps: true,
  masterOpacity: 1.0,
  theme: 'minimal_white',
  elasticIntensity: 1.15,
  auraSensitivity: 1.25,
  workLowPower30Fps: true,
  lightCanvasBg: false,
  autoSleepEnabled: true,
  autoSleepDelaySec: 10,
  autoSleepBehavior: 'freeze',
};

