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

    const midZoneStart = Math.floor(totalSegments * 0.56);
    const redZoneStart = Math.floor(totalSegments * 0.82);

    // Pre-rendered offscreen canvases & palette cache to eliminate ~700 fillRect calls per frame
    let cachedSpriteKey = '';
    let lowPeakFillStyle = '';
    let highPeakFillStyle = '';

    const bgGridCanvas = document.createElement('canvas');
    bgGridCanvas.width = width * dpr;
    bgGridCanvas.height = vfdHeight * dpr;
    const bgGridCtx = bgGridCanvas.getContext('2d');

    const litColCanvas = document.createElement('canvas');
    litColCanvas.width = colWidth * dpr;
    litColCanvas.height = vfdHeight * dpr;
    const litColCtx = litColCanvas.getContext('2d');

    // Track previous frame's lit segment counts and peak indices for dirty-frame skipping
    const prevLitCounts = new Int16Array(bandCount).fill(-1);
    const prevPeakIndices = new Int16Array(bandCount).fill(-1);
    let lastDrawnSpriteKey = '';

    const ensureOffscreenSprites = (themeId: string, lightCanvasBg: boolean) => {
      const key = `${themeId}:${lightCanvasBg ? 1 : 0}`;
      if (cachedSpriteKey === key) {
        return key;
      }
      cachedSpriteKey = key;
      const p = AURA_THEMES[themeId as keyof typeof AURA_THEMES] ?? AURA_THEMES.minimal_white;
      const [bR, bG, bB] = p.bassColor;
      const [mR, mG, mB] = p.midColor;
      const [tR, tG, tB] = p.trebleColor;

      lowPeakFillStyle = `rgba(${mR}, ${mG}, ${mB}, 0.96)`;
      highPeakFillStyle = `rgba(${tR}, ${tG}, ${tB}, 0.96)`;

      // 1. Pre-render full unlit VFD vacuum fluorescent matrix onto bgGridCanvas
      if (bgGridCtx) {
        bgGridCtx.save();
        bgGridCtx.setTransform(1, 0, 0, 1, 0, 0);
        bgGridCtx.clearRect(0, 0, bgGridCanvas.width, bgGridCanvas.height);
        bgGridCtx.scale(dpr, dpr);

        const ghostCellColor = lightCanvasBg
          ? 'rgba(24, 24, 27, 0.15)'
          : 'rgba(255, 255, 255, 0.055)';
        bgGridCtx.fillStyle = ghostCellColor;

        for (let b = 0; b < bandCount; b++) {
          const x = Math.floor(startOffsetX + b * (colWidth + colGap));
          for (let s = 0; s < totalSegments; s++) {
            const y = bottomBaselineY - (s + 1) * stepY;
            bgGridCtx.fillRect(x, y, colWidth, segHeight);
          }
        }
        bgGridCtx.restore();
      }

      // 2. Pre-render a single full-height lit VFD column onto litColCanvas
      if (litColCtx) {
        litColCtx.save();
        litColCtx.setTransform(1, 0, 0, 1, 0, 0);
        litColCtx.clearRect(0, 0, litColCanvas.width, litColCanvas.height);
        litColCtx.scale(dpr, dpr);

        for (let s = 0; s < totalSegments; s++) {
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
          const y = bottomBaselineY - (s + 1) * stepY;
          litColCtx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${segAlpha.toFixed(3)})`;
          litColCtx.fillRect(0, y, colWidth, segHeight);
        }
        litColCtx.restore();
      }

      return key;
    };

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
      const spriteKey = ensureOffscreenSprites(liveSettings.theme, !!liveSettings.lightCanvasBg);
      const currentPalette = AURA_THEMES[liveSettings.theme] ?? AURA_THEMES.minimal_white;
      const [bR, bG, bB] = currentPalette.bassColor;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bgGridCanvas, 0, 0);
      ctx.scale(dpr, dpr);

      // Faint standby floor pilot segment
      ctx.fillStyle = `rgba(${bR}, ${bG}, ${bB}, 0.18)`;
      for (let b = 0; b < bandCount; b++) {
        const x = Math.floor(startOffsetX + b * (colWidth + colGap));
        ctx.fillRect(x, bottomBaselineY - stepY, colWidth, 1);
      }

      ctx.restore();
      lastDrawnSpriteKey = `dormant:${spriteKey}`;
      prevLitCounts.fill(-1);
      prevPeakIndices.fill(-1);

      if (wrapperRef.current) {
        wrapperRef.current.style.opacity = '0.52';
      }
      if (volumeTrackRef.current) {
        volumeTrackRef.current.style.opacity = '0';
      }
    };

    const curLitCounts = new Int16Array(bandCount);
    const curPeakIndices = new Int16Array(bandCount);

    const render = (timestamp: number) => {
      animId = requestAnimationFrame(render);
      const t = telemetryRef.current;
      const liveSettings = settingsRef.current;

      // Fast path when already dormant in freeze mode: only check every 400ms
      if (t.isSleeping && lastDormantSignature !== '') {
        if (timestamp - lastFrameTime < 400) {
          return;
        }
      }

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
          lastFrameTime = timestamp;
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
        const frameInterval = liveSettings.workLowPower30Fps ? 33 : 20;
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

      // Bottom 1px stereo level underline (Visible ONLY when dbLevel > -40dB, expanding from center outward)
      const isAboveMinus40dB = !t.isSleeping && t.dbLevel > -40;
      const targetFill = isAboveMinus40dB
        ? Math.max(0.03, Math.min(1.0, (t.dbLevel + 40) / 40))
        : 0;
      smoothedVolFill += (targetFill - smoothedVolFill) * 0.28;

      if (volumeTrackRef.current && volumeFillRef.current) {
        volumeTrackRef.current.style.opacity = isAboveMinus40dB ? '0.88' : '0';
        volumeFillRef.current.style.transform = `scale3d(${Math.max(
          0,
          Math.min(1, smoothedVolFill)
        ).toFixed(4)}, 1, 1)`;
      }

      const spriteKey = ensureOffscreenSprites(liveSettings.theme, !!liveSettings.lightCanvasBg);
      const sens = liveSettings.auraSensitivity ?? 1.1;
      const elasticBoost = 1 + beatFlash * 0.14 * (liveSettings.elasticIntensity ?? 1.15);
      const showCaps = liveSettings.showPeakHoldCaps ?? true;

      let frameDirty = lastDrawnSpriteKey !== spriteKey;

      // 1. Update physics and check if any column's discrete segment or peak cap changed
      for (let b = 0; b < bandCount; b++) {
        const st = peakStates[b];
        const rawEnergy = t.isSleeping
          ? 0
          : sampleBandFrom32(t.spectrumBands, b) * sens * elasticBoost;
        const clampedEnergy = Math.max(0, Math.min(1.0, rawEnergy));

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
        curLitCounts[b] = litCount;

        let effectivePeakIdx = -1;
        if (showCaps) {
          const currentTopSeg = litCount;
          if (currentTopSeg >= st.peakSeg && currentTopSeg > 0) {
            st.peakSeg = currentTopSeg;
            st.holdFrames = 15;
            st.velocity = 0;
          } else {
            if (st.holdFrames > 0) {
              st.holdFrames--;
            } else if (st.peakSeg > 0) {
              st.velocity += 0.024;
              st.peakSeg = Math.max(0, st.peakSeg - st.velocity);
            }
          }

          const peakIndex = Math.min(totalSegments - 1, Math.floor(st.peakSeg));
          if (st.peakSeg >= 0.85 && peakIndex >= litCount) {
            effectivePeakIdx = peakIndex;
          }
        }
        curPeakIndices[b] = effectivePeakIdx;

        if (litCount !== prevLitCounts[b] || effectivePeakIdx !== prevPeakIndices[b]) {
          frameDirty = true;
        }
      }

      // Skip Canvas clear & redraw entirely if no column's integer segment state changed
      if (!frameDirty) {
        return;
      }

      lastDrawnSpriteKey = spriteKey;

      // 2. Blit pre-rendered unlit VFD grid in a single drawImage call
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bgGridCanvas, 0, 0);
      ctx.scale(dpr, dpr);

      // 3. Blit lit column sprites & peak caps
      for (let b = 0; b < bandCount; b++) {
        const litCount = curLitCounts[b];
        const peakIndex = curPeakIndices[b];
        prevLitCounts[b] = litCount;
        prevPeakIndices[b] = peakIndex;

        const x = Math.floor(startOffsetX + b * (colWidth + colGap));

        if (litCount > 0) {
          const topSegY = bottomBaselineY - litCount * stepY;
          const cropH = vfdHeight - topSegY;
          ctx.drawImage(
            litColCanvas,
            0,
            topSegY * dpr,
            colWidth * dpr,
            cropH * dpr,
            x,
            topSegY,
            colWidth,
            cropH
          );
        }

        if (peakIndex >= 0) {
          const capY = bottomBaselineY - (peakIndex + 1) * stepY;
          ctx.fillStyle = peakIndex >= midZoneStart ? highPeakFillStyle : lowPeakFillStyle;
          ctx.fillRect(x, capY, colWidth, segHeight);

          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.fillRect(x, capY, colWidth, 1);
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

      {/* Ultra-slender 1px VFD stereo level meter at the very bottom (Expands symmetrically from center to both sides when volume > -40dB) */}
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
            transformOrigin: 'center center',
            background: `linear-gradient(90deg, rgb(${tR},${tG},${tB}) 0%, rgb(${mR},${mG},${mB}) 22%, rgb(${bR},${bG},${bB}) 50%, rgb(${mR},${mG},${mB}) 78%, rgb(${tR},${tG},${tB}) 100%)`,
          }}
          className="w-full h-full will-change-transform"
        />
      </div>
    </div>
  );
};
