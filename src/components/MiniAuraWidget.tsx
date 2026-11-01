import React, { useEffect, useRef } from 'react';
import {
  AURA_THEMES,
  AudioTelemetry,
  StealthLineSettings,
} from '../types/audio';

interface MiniAuraWidgetProps {
  telemetryRef: React.MutableRefObject<AudioTelemetry>;
  settings: StealthLineSettings;
  /** Dynamically adapted bar count from taskbar empty-slot sensor (12 / 16 / 24 / 32) */
  activeBands?: number;
  /** Dynamically constrained pixel width when taskbar space is tight */
  effectiveWidth?: number;
}

interface PeakCapState {
  peakSeg: number;
  holdFrames: number;
  velocity: number;
  smoothedEnergy: number;
}

export const MiniAuraWidget: React.FC<MiniAuraWidgetProps> = ({
  telemetryRef,
  settings,
  activeBands,
  effectiveWidth,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const volumeTrackRef = useRef<HTMLDivElement | null>(null);
  const volumeFillRef = useRef<HTMLDivElement | null>(null);

  const settingsRef = useRef<StealthLineSettings>(settings);
  settingsRef.current = settings;

  const bandCount = Math.max(
    8,
    Math.min(32, activeBands ?? settings.preferredBands ?? 24)
  );
  const width = Math.max(100, Math.round(effectiveWidth ?? settings.lineWidth ?? 320));
  const vfdHeight = Math.max(22, Math.min(54, Math.round(settings.lineHeight ?? 38)));
  const palette = AURA_THEMES[settings.theme] ?? AURA_THEMES.minimal_white;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = vfdHeight * dpr;

    // VFD cell vertical geometry: scales to 3px LED cell height when vfdHeight >= 34px for bold desktop visibility
    const segHeight = vfdHeight >= 34 ? 3 : 2;
    const segGap = 1;
    const stepY = segHeight + segGap;
    const totalSegments = Math.max(6, Math.floor((vfdHeight - 2) / stepY));
    const bottomBaselineY = vfdHeight - 1;

    // Horizontal column geometry (pixel-snapped for razor-sharp VFD segments)
    const colGap = bandCount >= 28 ? 2 : 2.5;
    const rawColWidth = (width - (bandCount - 1) * colGap) / bandCount;
    const colWidth = Math.max(3, Math.floor(rawColWidth));
    const totalUsedWidth = bandCount * colWidth + (bandCount - 1) * colGap;
    const startOffsetX = Math.max(0, Math.floor((width - totalUsedWidth) * 0.5));

    const peakStates: PeakCapState[] = Array.from({ length: bandCount }, () => ({
      peakSeg: 0,
      holdFrames: 0,
      velocity: 0,
      smoothedEnergy: 0,
    }));

    let animId = 0;
    let lastFrameTime = 0;
    let beatFlash = 0;
    let smoothedVolFill = 0;
    let lastDormantSignature = '';

    const sampleBandFrom32 = (bands32: number[] | undefined, idx: number): number => {
      if (!bands32 || bands32.length === 0) return 0;
      const srcLen = bands32.length;
      if (bandCount === srcLen) {
        return bands32[idx] || 0;
      }
      // Map column [0..bandCount-1] across the 32 logarithmic bands with local peak preservation
      const ratioStart = idx / bandCount;
      const ratioEnd = (idx + 1) / bandCount;
      const i0 = Math.floor(ratioStart * srcLen);
      const i1 = Math.max(i0, Math.min(srcLen - 1, Math.ceil(ratioEnd * srcLen) - 1));
      let maxVal = 0;
      let sumVal = 0;
      let count = 0;
      for (let i = i0; i <= i1; i++) {
        const v = bands32[i] || 0;
        if (v > maxVal) maxVal = v;
        sumVal += v;
        count++;
      }
      const avgVal = count > 0 ? sumVal / count : 0;
      return maxVal * 0.65 + avgVal * 0.35;
    };

    const drawDormantVfdGrid = (liveSettings: StealthLineSettings) => {
      const currentPalette = AURA_THEMES[liveSettings.theme] ?? AURA_THEMES.minimal_white;
      const [bR, bG, bB] = currentPalette.bassColor;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, vfdHeight);

      const ghostColor = liveSettings.lightCanvasBg
        ? 'rgba(24, 24, 27, 0.13)'
        : 'rgba(255, 255, 255, 0.05)';

      for (let b = 0; b < bandCount; b++) {
        const x = Math.floor(startOffsetX + b * (colWidth + colGap));
        // Subtle unlit VFD vacuum display matrix
        ctx.fillStyle = ghostColor;
        for (let s = 0; s < totalSegments; s++) {
          const y = bottomBaselineY - (s + 1) * stepY;
          ctx.fillRect(x, y, colWidth, segHeight);
        }
        // Faint standby floor pilot segment
        ctx.fillStyle = `rgba(${bR}, ${bG}, ${bB}, 0.18)`;
        ctx.fillRect(x, bottomBaselineY - stepY, colWidth, 1);
      }

      ctx.restore();

      if (wrapperRef.current) {
        wrapperRef.current.style.opacity = '0.52';
      }
      if (volumeTrackRef.current) {
        volumeTrackRef.current.style.opacity = '0';
      }
    };

    const render = (timestamp: number) => {
      animId = requestAnimationFrame(render);
      const t = telemetryRef.current;
      const liveSettings = settingsRef.current;

      // Check if all peak caps have settled to 0 before freezing on Auto-Sleep
      let anyPeakRemaining = false;
      for (let i = 0; i < bandCount; i++) {
        if (peakStates[i].peakSeg > 0.15 || peakStates[i].smoothedEnergy > 0.02) {
          anyPeakRemaining = true;
          break;
        }
      }

      if (t.isSleeping && !anyPeakRemaining) {
        beatFlash = 0;
        smoothedVolFill = 0;
        if (volumeTrackRef.current) {
          volumeTrackRef.current.style.opacity = '0';
        }
        if (liveSettings.autoSleepBehavior === 'freeze') {
          const sig = `${liveSettings.theme}:${liveSettings.lightCanvasBg ? 1 : 0}`;
          if (lastDormantSignature !== sig) {
            drawDormantVfdGrid(liveSettings);
            lastDormantSignature = sig;
          }
          return;
        } else {
          if (lastDormantSignature !== '' && wrapperRef.current) {
            wrapperRef.current.style.opacity = '1';
            lastDormantSignature = '';
          }
          if (timestamp - lastFrameTime < 500) {
            return;
          }
        }
      } else {
        if (lastDormantSignature !== '' && wrapperRef.current) {
          wrapperRef.current.style.opacity = '1';
          lastDormantSignature = '';
        }
        const frameInterval = liveSettings.workLowPower30Fps ? 33 : 16;
        if (timestamp - lastFrameTime < frameInterval) return;
      }

      lastFrameTime = timestamp;

      // Transient beat impulse
      if (!t.isSleeping && t.isBeat) {
        beatFlash = Math.min(1.0, 0.72 + t.bassEnergy * 0.35);
      } else {
        beatFlash *= 0.82;
        if (beatFlash < 0.01) beatFlash = 0;
      }

      // Bottom 1px stereo level underline (Visible ONLY when dbLevel > -40dB)
      const isAboveMinus40dB = !t.isSleeping && t.dbLevel > -40;
      const targetFill = isAboveMinus40dB
        ? Math.max(0.03, Math.min(1.0, (t.dbLevel + 40) / 40))
        : 0;
      smoothedVolFill += (targetFill - smoothedVolFill) * 0.28;

      if (volumeTrackRef.current && volumeFillRef.current) {
        volumeTrackRef.current.style.opacity = isAboveMinus40dB ? '0.82' : '0';
        volumeFillRef.current.style.transform = `scale3d(${Math.max(
          0,
          Math.min(1, smoothedVolFill)
        ).toFixed(4)}, 1, 1)`;
      }

      const currentPalette = AURA_THEMES[liveSettings.theme] ?? AURA_THEMES.minimal_white;
      const [bR, bG, bB] = currentPalette.bassColor;
      const [mR, mG, mB] = currentPalette.midColor;
      const [tR, tG, tB] = currentPalette.trebleColor;
      const sens = liveSettings.auraSensitivity ?? 1.1;
      const elasticBoost = 1 + beatFlash * 0.14 * (liveSettings.elasticIntensity ?? 1.15);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, vfdHeight);

      const ghostCellColor = liveSettings.lightCanvasBg
        ? 'rgba(24, 24, 27, 0.15)'
        : 'rgba(255, 255, 255, 0.055)';

      const midZoneStart = Math.floor(totalSegments * 0.56);
      const redZoneStart = Math.floor(totalSegments * 0.82);

      for (let b = 0; b < bandCount; b++) {
        const x = Math.floor(startOffsetX + b * (colWidth + colGap));
        const st = peakStates[b];

        // 1. Draw unlit VFD vacuum fluorescent background matrix cells
        ctx.fillStyle = ghostCellColor;
        for (let s = 0; s < totalSegments; s++) {
          const y = bottomBaselineY - (s + 1) * stepY;
          ctx.fillRect(x, y, colWidth, segHeight);
        }

        // 2. Sample real-time energy for this frequency column
        const rawEnergy = t.isSleeping
          ? 0
          : sampleBandFrom32(t.spectrumBands, b) * sens * elasticBoost;
        const clampedEnergy = Math.max(0, Math.min(1.0, rawEnergy));

        // Fast attack, crisp automotive VFD decay
        if (clampedEnergy >= st.smoothedEnergy) {
          st.smoothedEnergy = st.smoothedEnergy * 0.25 + clampedEnergy * 0.75;
        } else {
          st.smoothedEnergy = st.smoothedEnergy * 0.76 + clampedEnergy * 0.24;
          if (st.smoothedEnergy < 0.01) st.smoothedEnergy = 0;
        }

        const litCount = Math.min(
          totalSegments,
          Math.round(st.smoothedEnergy * totalSegments)
        );

        // 3. Draw active lit VFD LED segments from bottom to litCount
        for (let s = 0; s < litCount; s++) {
          const y = bottomBaselineY - (s + 1) * stepY;
          let r = bR;
          let g = bG;
          let bl = bB;

          if (s >= redZoneStart) {
            r = tR;
            g = tG;
            bl = tB;
          } else if (s >= midZoneStart) {
            r = mR;
            g = mG;
            bl = mB;
          }

          const segAlpha = Math.min(1.0, 0.82 + (s / totalSegments) * 0.18);
          ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${segAlpha.toFixed(3)})`;
          ctx.fillRect(x, y, colWidth, segHeight);
        }

        // 4. Classic Car Stereo Peak-Hold Floating & Falling Cap Block
        if (liveSettings.showPeakHoldCaps ?? true) {
          const currentTopSeg = litCount;
          if (currentTopSeg >= st.peakSeg && currentTopSeg > 0) {
            st.peakSeg = currentTopSeg;
            st.holdFrames = 15; // Hold floating at the peak for ~250ms
            st.velocity = 0;
          } else {
            if (st.holdFrames > 0) {
              st.holdFrames--;
            } else if (st.peakSeg > 0) {
              st.velocity += 0.024; // Gravity acceleration downward
              st.peakSeg = Math.max(0, st.peakSeg - st.velocity);
            }
          }

          const peakIndex = Math.min(totalSegments - 1, Math.floor(st.peakSeg));
          if (st.peakSeg >= 0.85 && peakIndex >= litCount) {
            const capY = bottomBaselineY - (peakIndex + 1) * stepY;
            const isHighPeak = peakIndex >= midZoneStart;
            const [cR, cG, cB] = isHighPeak
              ? [tR, tG, tB]
              : [mR, mG, mB];

            ctx.fillStyle = `rgba(${cR}, ${cG}, ${cB}, 0.96)`;
            ctx.fillRect(x, capY, colWidth, segHeight);

            // Crisp top specular edge on the Peak-Hold block
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.fillRect(x, capY, colWidth, 1);
          }
        }
      }

      ctx.restore();
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [bandCount, width, vfdHeight, telemetryRef]);

  const [bR, bG, bB] = palette.bassColor;
  const [mR, mG, mB] = palette.midColor;
  const [tR, tG, tB] = palette.trebleColor;

  return (
    <div
      style={{ width: `${width}px` }}
      className="relative flex flex-col items-center justify-center select-none"
    >
      <div
        ref={wrapperRef}
        style={{ width: `${width}px`, height: `${vfdHeight}px` }}
        className="relative flex items-center justify-center transition-opacity duration-300"
      >
        <canvas
          ref={canvasRef}
          style={{ width: `${width}px`, height: `${vfdHeight}px` }}
          className="block pointer-events-none"
        />
      </div>

      {/* Ultra-slender 1px VFD stereo level meter at the very bottom (Visible ONLY when volume > -40dB) */}
      <div
        ref={volumeTrackRef}
        style={{
          width: `${width}px`,
          opacity: 0,
        }}
        className={`h-[1px] rounded-full overflow-hidden pointer-events-none transition-opacity duration-150 ${
          settings.lightCanvasBg ? 'bg-zinc-900/15' : 'bg-white/10'
        }`}
      >
        <div
          ref={volumeFillRef}
          style={{
            transform: 'scale3d(0, 1, 1)',
            transformOrigin: 'left center',
            background: `linear-gradient(90deg, rgb(${bR},${bG},${bB}) 0%, rgb(${mR},${mG},${mB}) 60%, rgb(${tR},${tG},${tB}) 100%)`,
          }}
          className="w-full h-full will-change-transform"
        />
      </div>
    </div>
  );
};
