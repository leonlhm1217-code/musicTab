import React, { useEffect, useRef } from 'react';
import {
  AURA_THEMES,
  AudioTelemetry,
  StealthLineSettings,
} from '../types/audio';

interface StealthLineWidgetProps {
  telemetryRef: React.MutableRefObject<AudioTelemetry>;
  settings: StealthLineSettings;
}

interface FilamentRipple {
  x: number;
  radiusX: number;
  maxRadiusX: number;
  alpha: number;
  color: [number, number, number];
}

interface MicroParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  band: 'bass' | 'mid' | 'treble';
  phase: number;
}

export const MiniAuraWidget: React.FC<StealthLineWidgetProps> = ({
  telemetryRef,
  settings,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const filamentWrapperRef = useRef<HTMLDivElement | null>(null);
  const volumeTrackRef = useRef<HTMLDivElement | null>(null);
  const volumeFillRef = useRef<HTMLDivElement | null>(null);

  const width = settings.lineWidth;
  const barThickness = settings.lineHeight;
  const canvasHeight = barThickness + 28;
  const palette = AURA_THEMES[settings.theme];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = canvasHeight * dpr;

    const ripples: FilamentRipple[] = [];
    const particles: MicroParticle[] = [];
    const particleCount = 26;
    const centerY = canvasHeight * 0.5;

    for (let i = 0; i < particleCount; i++) {
      const bands: ('bass' | 'mid' | 'treble')[] = ['bass', 'mid', 'treble'];
      particles.push({
        x: Math.random() * width,
        y: centerY + (Math.random() - 0.5) * barThickness,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.3,
        size: 0.9 + Math.random() * 1.5,
        alpha: 0.25 + Math.random() * 0.6,
        band: bands[i % 3],
        phase: Math.random() * Math.PI * 2,
      });
    }

    let animId = 0;
    let lastFrameTime = 0;
    let phase = 0;
    let beatFlash = 0; // Transient 0..1 envelope triggered by telemetry.isBeat
    let smoothedVolFill = 0; // Smoothed 0..1 fill ratio when dbLevel > -40dB
    let hasRenderedDormantFrame = false;

    const drawDormantFrame = () => {
      const currentPalette = AURA_THEMES[settings.theme];
      const [mR, mG, mB] = currentPalette.midColor;
      const cy = canvasHeight * 0.5;
      const halfBar = barThickness * 0.5;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, canvasHeight);

      ctx.beginPath();
      ctx.roundRect(0, cy - halfBar, width, barThickness, halfBar);
      ctx.fillStyle = settings.lightCanvasBg
        ? 'rgba(24, 24, 27, 0.22)'
        : 'rgba(255, 255, 255, 0.05)';
      ctx.fill();

      const grad = ctx.createRadialGradient(width * 0.5, cy, 2, width * 0.5, cy, width * 0.45);
      grad.addColorStop(0, `rgba(${mR}, ${mG}, ${mB}, 0.22)`);
      grad.addColorStop(1, `rgba(${mR}, ${mG}, ${mB}, 0)`);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.restore();

      if (filamentWrapperRef.current) {
        filamentWrapperRef.current.style.transform = 'scale3d(1, 1, 1)';
        filamentWrapperRef.current.style.opacity = '0.45';
      }
      if (volumeTrackRef.current) {
        volumeTrackRef.current.style.opacity = '0';
      }
    };

    const render = (timestamp: number) => {
      animId = requestAnimationFrame(render);

      const t = telemetryRef.current;

      // AUTO-SLEEP CPU SAVING HANDLER
      if (t.isSleeping) {
        beatFlash = 0;
        smoothedVolFill = 0;
        if (volumeTrackRef.current) {
          volumeTrackRef.current.style.opacity = '0';
        }
        if (settings.autoSleepBehavior === 'freeze') {
          if (!hasRenderedDormantFrame) {
            drawDormantFrame();
            hasRenderedDormantFrame = true;
          }
          return;
        } else {
          if (timestamp - lastFrameTime < 500) return;
        }
      } else {
        if (hasRenderedDormantFrame && filamentWrapperRef.current) {
          filamentWrapperRef.current.style.opacity = '1';
          hasRenderedDormantFrame = false;
        }
        const frameInterval = settings.workLowPower30Fps ? 33 : 16;
        if (timestamp - lastFrameTime < frameInterval) return;
      }

      lastFrameTime = timestamp;

      // Trigger instantaneous beat flash & thickening impulse when telemetry.isBeat is true
      if (!t.isSleeping && t.isBeat) {
        beatFlash = Math.min(1.0, 0.78 + t.bassEnergy * 0.35);
      } else {
        beatFlash *= 0.82;
        if (beatFlash < 0.01) beatFlash = 0;
      }

      // Ultra-thin bottom volume progress bar logic (Visible ONLY when dbLevel > -40dB)
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

      const currentPalette = AURA_THEMES[settings.theme];
      const [bR, bG, bB] = currentPalette.bassColor;
      const [mR, mG, mB] = currentPalette.midColor;
      const [tR, tG, tB] = currentPalette.trebleColor;
      const sens = settings.auraSensitivity;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, canvasHeight);

      const cy = canvasHeight * 0.5;
      const thicknessBoost =
        beatFlash * Math.max(2.2, barThickness * 0.42) * settings.elasticIntensity;
      const activeThickness = barThickness + thicknessBoost;
      const halfBar = activeThickness * 0.5;

      // 0. Outer Beat Halo Glow when beatFlash > 0
      if (beatFlash > 0.04) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const haloSpread = activeThickness * (1.35 + beatFlash * 1.1);
        const haloGrad = ctx.createLinearGradient(0, cy - haloSpread, 0, cy + haloSpread);
        const haloAlpha = beatFlash * (settings.lightCanvasBg ? 0.28 : 0.42);
        haloGrad.addColorStop(0, `rgba(${mR}, ${mG}, ${mB}, 0)`);
        haloGrad.addColorStop(0.5, `rgba(${mR}, ${mG}, ${mB}, ${haloAlpha})`);
        haloGrad.addColorStop(1, `rgba(${bR}, ${bG}, ${bB}, 0)`);
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.roundRect(0, cy - haloSpread * 0.65, width, haloSpread * 1.3, haloSpread * 0.65);
        ctx.fill();
        ctx.restore();
      }

      // 1. Subtle Base Hairline Track (Capsule geometry with dynamic beat thickness)
      ctx.beginPath();
      ctx.roundRect(0, cy - halfBar, width, activeThickness, halfBar);
      ctx.fillStyle = settings.lightCanvasBg
        ? 'rgba(15, 15, 18, 0.92)'
        : `rgba(255, 255, 255, ${(0.07 + beatFlash * 0.08).toFixed(3)})`;
      ctx.fill();

      // Clip interior fluid aura to rounded capsule
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, cy - halfBar, width, activeThickness, halfBar);
      ctx.clip();

      ctx.globalCompositeOperation = 'screen';

      // 2. THREE-BAND INSTRUMENT FLUID CORE (左低频鼓贝斯 · 中频人声随音高滑动 · 右高频泛音)
      const bassX = width * (0.18 + Math.sin(timestamp * 0.0018) * 0.04);
      const bassSpan = width * (0.28 + (t.bassEnergy + beatFlash * 0.25) * 0.42 * sens);
      const bassGrad = ctx.createRadialGradient(bassX, cy, 1, bassX, cy, bassSpan);
      const bassAlpha = Math.min(1.0, 0.22 + (t.bassEnergy + beatFlash * 0.35) * 0.78 * sens);
      bassGrad.addColorStop(0, `rgba(${bR}, ${bG}, ${bB}, ${bassAlpha})`);
      bassGrad.addColorStop(0.5, `rgba(${bR}, ${bG}, ${bB}, ${bassAlpha * 0.48})`);
      bassGrad.addColorStop(1, `rgba(${bR}, ${bG}, ${bB}, 0)`);
      ctx.fillStyle = bassGrad;
      ctx.fillRect(0, cy - halfBar, width, activeThickness);

      const pitchOffset = (t.pitchNormalized - 0.5) * width * 0.42;
      const midX = width * 0.5 + pitchOffset;
      const midSpan = width * (0.32 + (t.midEnergy + beatFlash * 0.22) * 0.45 * sens);
      const midGrad = ctx.createRadialGradient(midX, cy, 1, midX, cy, midSpan);
      const midAlpha = Math.min(1.0, 0.26 + (t.midEnergy + beatFlash * 0.3) * 0.75 * sens);
      midGrad.addColorStop(0, `rgba(${mR}, ${mG}, ${mB}, ${midAlpha})`);
      midGrad.addColorStop(0.55, `rgba(${mR}, ${mG}, ${mB}, ${midAlpha * 0.52})`);
      midGrad.addColorStop(1, `rgba(${mR}, ${mG}, ${mB}, 0)`);
      ctx.fillStyle = midGrad;
      ctx.fillRect(0, cy - halfBar, width, activeThickness);

      const trebleX = width * (0.82 + Math.cos(timestamp * 0.0022) * 0.04);
      const trebleSpan = width * (0.25 + t.trebleEnergy * 0.44 * sens);
      const trebleGrad = ctx.createRadialGradient(trebleX, cy, 1, trebleX, cy, trebleSpan);
      const trebleAlpha = Math.min(0.98, 0.18 + t.trebleEnergy * 0.8 * sens);
      trebleGrad.addColorStop(0, `rgba(${tR}, ${tG}, ${tB}, ${trebleAlpha})`);
      trebleGrad.addColorStop(0.5, `rgba(${tR}, ${tG}, ${tB}, ${trebleAlpha * 0.42})`);
      trebleGrad.addColorStop(1, `rgba(${tR}, ${tG}, ${tB}, 0)`);
      ctx.fillStyle = trebleGrad;
      ctx.fillRect(0, cy - halfBar, width, activeThickness);

      // 2b. Instantaneous Beat Highlight Flash Overlay across the Filament Core
      if (beatFlash > 0.02) {
        const flashGrad = ctx.createLinearGradient(0, cy - halfBar, width, cy + halfBar);
        const flashPeak = Math.min(0.75, beatFlash * 0.58);
        flashGrad.addColorStop(0, `rgba(${bR}, ${bG}, ${bB}, ${flashPeak * 0.45})`);
        flashGrad.addColorStop(0.5, `rgba(255, 255, 255, ${flashPeak})`);
        flashGrad.addColorStop(1, `rgba(${tR}, ${tG}, ${tB}, ${flashPeak * 0.45})`);
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, cy - halfBar, width, activeThickness);
      }

      // 3. Horizontal Propagating Soundwave Pulses inside the Stealth Line
      if (
        !t.isSleeping &&
        (t.isBeat || (t.rmsVolume > 0.25 && Math.random() < 0.1)) &&
        ripples.length < 6
      ) {
        const isBass = t.bassEnergy >= t.midEnergy;
        ripples.push({
          x: isBass ? bassX : midX,
          radiusX: 6,
          maxRadiusX: width * (0.35 + t.rmsVolume * 0.3),
          alpha: Math.min(0.9, 0.4 + t.rmsVolume * 0.5),
          color: isBass ? [bR, bG, bB] : [mR, mG, mB],
        });
      }

      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.radiusX += (rp.maxRadiusX - rp.radiusX) * 0.08 + 1.8;
        rp.alpha *= 0.93;
        if (rp.alpha < 0.02) {
          ripples.splice(i, 1);
          continue;
        }
        const g = ctx.createRadialGradient(rp.x, cy, rp.radiusX * 0.65, rp.x, cy, rp.radiusX);
        g.addColorStop(0, `rgba(${rp.color[0]}, ${rp.color[1]}, ${rp.color[2]}, 0)`);
        g.addColorStop(0.8, `rgba(${rp.color[0]}, ${rp.color[1]}, ${rp.color[2]}, ${rp.alpha})`);
        g.addColorStop(1, `rgba(${rp.color[0]}, ${rp.color[1]}, ${rp.color[2]}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, cy - halfBar, width, activeThickness);
      }

      // 4. Fine Acoustic Waveform Filament along the Center Axis
      phase += 0.06 + t.rmsVolume * 0.16;
      const slice = t.waveformSlice;
      const len = slice.length || 48;
      ctx.beginPath();
      for (let i = 0; i < len; i++) {
        const px = (i / (len - 1)) * width;
        const env = Math.sin((i / (len - 1)) * Math.PI);
        const sample = slice[i] || 0;
        const py =
          cy +
          (sample * 0.85 + Math.sin(i * 0.3 + phase) * 0.25) *
            (activeThickness * 0.55) *
            (0.2 + t.rmsVolume * 1.1) *
            env;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = `rgba(${mR}, ${mG}, ${mB}, ${Math.min(
        0.95,
        0.35 + t.midEnergy * 0.6 + beatFlash * 0.35
      )})`;
      ctx.lineWidth = Math.max(1, activeThickness * 0.14 + beatFlash * 0.6);
      ctx.stroke();

      ctx.restore(); // End capsule clip

      // 5. Micro Fluid Particles hovering delicately inside & around the Stealth Line
      if (!t.isSleeping) {
        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const energy =
            p.band === 'bass'
              ? t.bassEnergy
              : p.band === 'mid'
              ? t.midEnergy
              : t.trebleEnergy;

          p.phase += 0.04 + energy * 0.14 + beatFlash * 0.08;
          p.x += p.vx * (0.6 + energy * 2.2) + (t.pitchNormalized - 0.5) * 0.3;
          p.y =
            cy +
            Math.sin(p.phase) *
              (halfBar * 0.75 + energy * (activeThickness * 0.85) * sens);

          if (p.x < 4) p.x = width - 4;
          if (p.x > width - 4) p.x = 4;

          const c =
            p.band === 'bass'
              ? [bR, bG, bB]
              : p.band === 'mid'
              ? [mR, mG, mB]
              : [tR, tG, tB];
          const pAlpha = Math.min(
            0.95,
            p.alpha * (0.2 + (energy + beatFlash * 0.3) * 1.25 * sens) * (0.65 + 0.35 * Math.cos(p.phase))
          );
          const pRadius = p.size * (0.7 + energy * 0.8 + beatFlash * 0.35);

          ctx.beginPath();
          ctx.arc(p.x, p.y, pRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${pAlpha})`;
          ctx.fill();
        }
      }

      // 6. Subtle Specular Rim Border (Brightens transiently on beatFlash)
      ctx.beginPath();
      ctx.roundRect(0.5, cy - halfBar + 0.5, width - 1, activeThickness - 1, halfBar);
      const rimAlpha = Math.min(0.85, 0.14 + beatFlash * 0.52);
      ctx.strokeStyle = settings.lightCanvasBg
        ? `rgba(15, 15, 18, ${rimAlpha})`
        : `rgba(255, 255, 255, ${rimAlpha})`;
      ctx.lineWidth = 0.75 + beatFlash * 0.65;
      ctx.stroke();

      ctx.restore();

      // 7. Elastic Rhythm Bounce (Spring Physics on X & Y scale + Beat Flash Impulse)
      if (filamentWrapperRef.current) {
        const s = t.springScale;
        const sx = 1 + (s - 1) * 0.55 + beatFlash * 0.018;
        const sy = 1 + (s - 1) * 1.15 + beatFlash * 0.12;
        filamentWrapperRef.current.style.transform = `scale3d(${sx.toFixed(4)}, ${sy.toFixed(4)}, 1)`;
        filamentWrapperRef.current.style.opacity = t.isSleeping ? '0.55' : '1';
      }
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [
    width,
    barThickness,
    canvasHeight,
    settings.theme,
    settings.auraSensitivity,
    settings.elasticIntensity,
    settings.workLowPower30Fps,
    settings.lightCanvasBg,
    settings.autoSleepEnabled,
    settings.autoSleepBehavior,
    telemetryRef,
  ]);

  const [bR, bG, bB] = palette.bassColor;
  const [mR, mG, mB] = palette.midColor;
  const [tR, tG, tB] = palette.trebleColor;

  return (
    <div
      style={{ width: `${width}px` }}
      className="relative flex flex-col items-center justify-center select-none"
    >
      <div
        ref={filamentWrapperRef}
        style={{ width: `${width}px`, height: `${canvasHeight}px` }}
        className="relative flex items-center justify-center will-change-transform transition-opacity duration-300"
      >
        <canvas
          ref={canvasRef}
          style={{ width: `${width}px`, height: `${canvasHeight}px` }}
          className="block pointer-events-none"
        />
      </div>

      {/* Ultra-slender dynamic volume meter bar at the bottom (Visible ONLY when volume > -40dB) */}
      <div
        ref={volumeTrackRef}
        style={{
          width: `${width}px`,
          opacity: 0,
        }}
        className={`h-[1.5px] rounded-full overflow-hidden pointer-events-none transition-opacity duration-150 ${
          settings.lightCanvasBg ? 'bg-zinc-900/12' : 'bg-white/8'
        }`}
      >
        <div
          ref={volumeFillRef}
          style={{
            transform: 'scale3d(0, 1, 1)',
            transformOrigin: 'left center',
            background: `linear-gradient(90deg, rgb(${bR},${bG},${bB}) 0%, rgb(${mR},${mG},${mB}) 55%, rgb(${tR},${tG},${tB}) 100%)`,
          }}
          className="w-full h-full rounded-full will-change-transform"
        />
      </div>
    </div>
  );
};
