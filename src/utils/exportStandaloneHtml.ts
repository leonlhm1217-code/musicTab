import { StealthLineSettings } from '../types/audio';

export function downloadStandaloneHtml(currentSettings: StealthLineSettings): void {
  const htmlContent = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AuraLine — 本地声学隐身细线 (离线单文件版)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: ${currentSettings.lightCanvasBg ? '#F4F4F5' : '#09090B'};
      color: ${currentSettings.lightCanvasBg ? '#18181B' : '#F4F4F5'};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      overflow: hidden;
      transition: background 0.2s, color 0.2s;
    }
    body.light { background: #F4F4F5; color: #18181B; }
    header, footer {
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      font-size: 12px;
      opacity: 0.42;
      transition: opacity 0.2s;
    }
    header:hover, footer:hover { opacity: 1; }
    header { border-bottom: 1px solid rgba(128,128,128,0.15); }
    footer { border-top: 1px solid rgba(128,128,128,0.15); flex-direction: column; align-items: stretch; }
    body.pure header, body.pure footer { display: none; }
    main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    #dragBox {
      cursor: grab;
      padding: 16px;
      will-change: transform;
    }
    #dragBox:active { cursor: grabbing; }
    .btn {
      padding: 4px 9px;
      border-radius: 6px;
      border: 1px solid rgba(128,128,128,0.25);
      background: transparent;
      color: inherit;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .btn:hover { background: rgba(128,128,128,0.15); }
    .btn.active {
      background: #F4F4F5;
      color: #09090B;
      border-color: transparent;
      font-weight: 600;
    }
    body.light .btn.active {
      background: #18181B;
      color: #FFFFFF;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
    #restoreBtn {
      position: fixed;
      top: 10px;
      right: 14px;
      opacity: 0.15;
      display: none;
    }
    #restoreBtn:hover { opacity: 0.9; }
    body.pure #restoreBtn { display: block; }
  </style>
</head>
<body class="${currentSettings.lightCanvasBg ? 'light' : ''}">
  <header>
    <strong style="letter-spacing:-0.02em">AuraLine 离线单文件版</strong>
    <span class="mono" style="font-size:11px;opacity:0.75">100% 本地内存 FFT · 零网络请求</span>
  </header>

  <button id="restoreBtn" class="btn" onclick="togglePure()">显示微调栏 (Alt+H)</button>

  <main>
    <div id="dragBox" title="按住可拖动位置" style="display:flex;flex-direction:column;align-items:center">
      <div id="filamentWrap" style="will-change:transform;display:flex;align-items:center;justify-content:center;transition:opacity 0.3s">
        <canvas id="auraCanvas"></canvas>
      </div>
      <div id="volTrack" style="height:1.5px;border-radius:999px;overflow:hidden;opacity:0;transition:opacity 0.15s;background:rgba(255,255,255,0.08);width:${currentSettings.lineWidth}px">
        <div id="volFill" style="width:100%;height:100%;transform:scale3d(0,1,1);transform-origin:left center;will-change:transform"></div>
      </div>
    </div>
  </main>

  <footer>
    <div class="row-between">
      <div class="row">
        <button id="btnSys" class="btn" onclick="startSystemAudio()">系统音频监听 (QQ音乐)</button>
        <button id="btnMic" class="btn" onclick="startMicAudio()">本机麦克风/混音</button>
        <button id="btnDemo" class="btn" onclick="toggleDemo()">内置测试流</button>
        <button class="btn" onclick="stopAudio()">停止</button>
      </div>
      <div class="row">
        <span>长度</span>
        <input type="range" min="160" max="640" step="10" value="${currentSettings.lineWidth}" oninput="updateSize(this.value, null)" />
        <span>粗细</span>
        <input type="range" min="4" max="16" step="1" value="${currentSettings.lineHeight}" oninput="updateSize(null, this.value)" />
      </div>
      <div class="row">
        <button class="btn" onclick="toggleBg()">切换底色</button>
        <button class="btn" onclick="popPip()">弹出独立置顶小窗</button>
        <button class="btn" onclick="togglePure()">纯细线 (Alt+H)</button>
      </div>
    </div>
    <div class="row-between" style="padding-top:6px;border-top:1px solid rgba(128,128,128,0.12);font-size:11px">
      <div class="row">
        <span>色彩预设</span>
        <button id="theme_minimal_white" class="btn ${currentSettings.theme === 'minimal_white' ? 'active' : ''}" onclick="setTheme('minimal_white')">
          <span class="dot" style="background:#FFFFFF;border:1px solid #71717A"></span>极简白
        </button>
        <button id="theme_deep_sea" class="btn ${currentSettings.theme === 'deep_sea' ? 'active' : ''}" onclick="setTheme('deep_sea')">
          <span class="dot" style="background:#38BDF8"></span>深海静谧
        </button>
        <button id="theme_vibrant_pulse" class="btn ${currentSettings.theme === 'vibrant_pulse' ? 'active' : ''}" onclick="setTheme('vibrant_pulse')">
          <span class="dot" style="background:#FB923C"></span>活力律动
        </button>
        <button id="theme_forest_mist" class="btn ${currentSettings.theme === 'forest_mist' ? 'active' : ''}" onclick="setTheme('forest_mist')">
          <span class="dot" style="background:#2DD4BF"></span>森屿微光
        </button>
      </div>
      <div class="row">
        <button id="btnSleepToggle" class="btn ${currentSettings.autoSleepEnabled ? 'active' : ''}" onclick="toggleAutoSleep()">
          自动休眠：${currentSettings.autoSleepEnabled ? '开' : '关'}
        </button>
        <select id="sleepDelaySel" class="btn" onchange="setSleepDelay(this.value)">
          <option value="5" ${currentSettings.autoSleepDelaySec === 5 ? 'selected' : ''}>5秒</option>
          <option value="10" ${currentSettings.autoSleepDelaySec === 10 ? 'selected' : ''}>10秒</option>
          <option value="30" ${currentSettings.autoSleepDelaySec === 30 ? 'selected' : ''}>30秒</option>
          <option value="60" ${currentSettings.autoSleepDelaySec === 60 ? 'selected' : ''}>60秒</option>
        </select>
        <select id="sleepBehaviorSel" class="btn" onchange="setSleepBehavior(this.value)">
          <option value="freeze" ${currentSettings.autoSleepBehavior === 'freeze' ? 'selected' : ''}>0FPS暂停</option>
          <option value="low_fps" ${currentSettings.autoSleepBehavior === 'low_fps' ? 'selected' : ''}>2FPS省电</option>
        </select>
      </div>
      <span id="readout" class="mono" style="font-size:11px">低 5% · 中 6% · 高 4%</span>
    </div>
  </footer>

  <script>
    const THEMES = {
      minimal_white: { bass: [161,161,170], mid: [255,255,255], treble: [212,212,216] },
      deep_sea: { bass: [99,102,241], mid: [56,189,248], treble: [192,132,252] },
      vibrant_pulse: { bass: [244,63,94], mid: [251,146,60], treble: [251,191,36] },
      forest_mist: { bass: [16,185,129], mid: [45,212,191], treble: [167,243,208] }
    };
    let lineWidth = ${currentSettings.lineWidth};
    let lineHeight = ${currentSettings.lineHeight};
    let currentTheme = '${currentSettings.theme}';
    let autoSleepEnabled = ${currentSettings.autoSleepEnabled};
    let autoSleepDelaySec = ${currentSettings.autoSleepDelaySec};
    let autoSleepBehavior = '${currentSettings.autoSleepBehavior}';
    let silentStartMs = performance.now();
    let isSleeping = false, dormantDrawn = false;
    let audioCtx = null, analyser = null, mediaStream = null, demoTimer = null, mode = 'none';
    let freqData = new Uint8Array(1024), timeData = new Uint8Array(1024);
    let prevBass = 0, beatCooldown = 0, springScale = 1, springVel = 0, smoothPitch = 0;

    const canvas = document.getElementById('auraCanvas');
    const ctx = canvas.getContext('2d');
    const filamentWrap = document.getElementById('filamentWrap');
    const readoutEl = document.getElementById('readout');

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ch = lineHeight + 24;
      canvas.width = lineWidth * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = lineWidth + 'px';
      canvas.style.height = ch + 'px';
      dormantDrawn = false;
    }
    resizeCanvas();

    function updateSize(w, h) {
      if (w) lineWidth = parseInt(w, 10);
      if (h) lineHeight = parseInt(h, 10);
      silentStartMs = performance.now();
      resizeCanvas();
    }
    function setTheme(t) {
      currentTheme = t;
      silentStartMs = performance.now();
      dormantDrawn = false;
      ['minimal_white','deep_sea','vibrant_pulse','forest_mist'].forEach(k => {
        const el = document.getElementById('theme_' + k);
        if (el) el.classList.toggle('active', k === t);
      });
    }
    function toggleBg() { document.body.classList.toggle('light'); dormantDrawn = false; }
    function togglePure() { document.body.classList.toggle('pure'); }
    function toggleAutoSleep() {
      autoSleepEnabled = !autoSleepEnabled;
      silentStartMs = performance.now();
      dormantDrawn = false;
      const btn = document.getElementById('btnSleepToggle');
      btn.textContent = '自动休眠：' + (autoSleepEnabled ? '开' : '关');
      btn.classList.toggle('active', autoSleepEnabled);
    }
    function setSleepDelay(v) { autoSleepDelaySec = parseInt(v, 10); silentStartMs = performance.now(); }
    function setSleepBehavior(v) { autoSleepBehavior = v; dormantDrawn = false; }

    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); togglePure(); }
    });

    function ensureAudio() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.78;
        freqData = new Uint8Array(analyser.frequencyBinCount);
        timeData = new Uint8Array(analyser.frequencyBinCount);
      }
    }

    function stopAudio() {
      if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
      if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
      mode = 'none';
      document.querySelectorAll('#btnSys,#btnMic,#btnDemo').forEach(b => b.classList.remove('active'));
    }

    async function startSystemAudio() {
      stopAudio(); ensureAudio(); silentStartMs = performance.now();
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        s.getVideoTracks().forEach(v => v.stop());
        if (!s.getAudioTracks().length) { alert('请在共享窗口底部勾选「同时共享系统音频」'); return; }
        mediaStream = new MediaStream(s.getAudioTracks());
        audioCtx.createMediaStreamSource(mediaStream).connect(analyser);
        mode = 'system';
        document.getElementById('btnSys').classList.add('active');
      } catch (e) {}
    }

    async function startMicAudio() {
      stopAudio(); ensureAudio(); silentStartMs = performance.now();
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
        audioCtx.createMediaStreamSource(mediaStream).connect(analyser);
        mode = 'mic';
        document.getElementById('btnMic').classList.add('active');
      } catch (e) {}
    }

    function toggleDemo() {
      if (mode === 'demo') { stopAudio(); return; }
      stopAudio(); ensureAudio(); silentStartMs = performance.now();
      mode = 'demo';
      document.getElementById('btnDemo').classList.add('active');
      const gain = audioCtx.createGain();
      gain.gain.value = 0.16;
      gain.connect(analyser);
      gain.connect(audioCtx.destination);
      let step = 0;
      const notes = [261.6, 329.6, 392.0, 523.2, 440.0, 392.0, 349.2, 329.6];
      demoTimer = setInterval(() => {
        if (mode !== 'demo') return;
        const now = audioCtx.currentTime;
        if (step % 2 === 0) {
          const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
          osc.frequency.setValueAtTime(step % 4 === 0 ? 110 : 73.4, now);
          osc.frequency.exponentialRampToValueAtTime(48, now + 0.16);
          g.gain.setValueAtTime(0.7, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
          osc.connect(g); g.connect(gain); osc.start(now); osc.stop(now + 0.25);
        }
        const mOsc = audioCtx.createOscillator(), mG = audioCtx.createGain();
        mOsc.type = 'triangle';
        mOsc.frequency.setValueAtTime(notes[step % notes.length], now);
        mG.gain.setValueAtTime(0.3, now); mG.gain.exponentialRampToValueAtTime(0.005, now + 0.32);
        mOsc.connect(mG); mG.connect(gain); mOsc.start(now); mOsc.stop(now + 0.34);
        step++;
      }, 220);
    }

    async function popPip() {
      if (!window.documentPictureInPicture) { togglePure(); return; }
      try {
        const w = await window.documentPictureInPicture.requestWindow({ width: lineWidth + 24, height: lineHeight + 36 });
        w.document.body.style.margin = '0';
        w.document.body.style.background = document.body.classList.contains('light') ? '#F4F4F5' : '#09090B';
        w.document.body.style.display = 'flex';
        w.document.body.style.alignItems = 'center';
        w.document.body.style.justifyContent = 'center';
        w.document.body.style.height = '100vh';
        w.document.body.appendChild(filamentWrap);
        w.addEventListener('pagehide', () => { document.getElementById('dragBox').appendChild(filamentWrap); });
      } catch (e) { togglePure(); }
    }

    const dragBox = document.getElementById('dragBox');
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    dragBox.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX - ox; sy = e.clientY - oy; dragBox.setPointerCapture(e.pointerId); });
    dragBox.addEventListener('pointermove', (e) => { if (!dragging) return; ox = e.clientX - sx; oy = e.clientY - sy; dragBox.style.transform = \`translate3d(\${ox}px,\${oy}px,0)\`; });
    dragBox.addEventListener('pointerup', () => { dragging = false; });

    let phase = 0, lastUi = 0, lastFrame = 0;
    function loop(ts) {
      requestAnimationFrame(loop);

      if (isSleeping && ts - lastFrame < (autoSleepBehavior === 'freeze' ? 200 : 500)) {
        return;
      }

      let bass = 0.02, mid = 0.02, treble = 0.01, rms = 0.02, pitchNorm = 0.5;
      if (analyser && mode !== 'none') {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
        let lSum = 0, mSum = 0, hSum = 0, maxV = 0, maxI = 0;
        for (let i = 1; i < 320; i++) {
          const v = freqData[i];
          if (i < 12) lSum += v;
          else if (i < 110) mSum += v;
          else hSum += v;
          if (i < 110 && v > maxV) { maxV = v; maxI = i; }
        }
        bass = Math.min(1, (lSum / (11 * 255)) * 1.5);
        mid = Math.min(1, (mSum / (98 * 255)) * 1.7);
        treble = Math.min(1, (hSum / (210 * 255)) * 2.4);
        rms = Math.min(1, bass * 0.45 + mid * 0.35 + treble * 0.2);
        if (rms >= 0.038) silentStartMs = ts;
        const hz = maxV > 30 ? maxI * (audioCtx.sampleRate / 2048) : 0;
        if (hz > 60) {
          smoothPitch = smoothPitch ? smoothPitch * 0.8 + hz * 0.2 : hz;
          pitchNorm = Math.max(0, Math.min(1, Math.log2(smoothPitch / 70) / Math.log2(1500 / 70)));
        }
      }

      const silentSec = (ts - silentStartMs) / 1000;
      isSleeping = autoSleepEnabled && silentSec >= autoSleepDelaySec;
      lastFrame = ts;

      const volTrack = document.getElementById('volTrack');
      const volFill = document.getElementById('volFill');
      if (volTrack) volTrack.style.width = lineWidth + 'px';

      if (isSleeping && autoSleepBehavior === 'freeze') {
        if (volTrack) volTrack.style.opacity = '0';
        if (!dormantDrawn) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const ch = lineHeight + 24, cy = ch * 0.5, hb = lineHeight * 0.5;
          ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, lineWidth, ch);
          ctx.beginPath(); ctx.roundRect(0, cy - hb, lineWidth, lineHeight, hb);
          ctx.fillStyle = document.body.classList.contains('light') ? 'rgba(15,15,18,0.22)' : 'rgba(255,255,255,0.06)';
          ctx.fill(); ctx.restore();
          filamentWrap.style.transform = 'scale3d(1,1,1)';
          filamentWrap.style.opacity = '0.45';
          readoutEl.textContent = '休眠省电中 (0 FPS)';
          dormantDrawn = true;
        }
        return;
      }

      dormantDrawn = false;
      filamentWrap.style.opacity = isSleeping ? '0.55' : '1';

      const bDelta = bass - prevBass;
      prevBass = bass * 0.65 + prevBass * 0.35;
      if (beatCooldown > 0) beatCooldown--;
      let isBeat = false;
      if (!isSleeping && bDelta > 0.08 && bass > 0.2 && beatCooldown === 0) {
        beatCooldown = 8;
        springVel += 0.075;
        isBeat = true;
      }
      if (isBeat) {
        window._beatFlash = Math.min(1.0, 0.78 + bass * 0.35);
      } else {
        window._beatFlash = (window._beatFlash || 0) * 0.82;
      }
      const beatFlash = window._beatFlash || 0;

      springVel = (springVel + (1 + rms * 0.05 - springScale) * 0.24) * 0.74;
      springScale = Math.max(0.96, Math.min(1.22, springScale + springVel));

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ch = lineHeight + 24, cy = ch * 0.5;
      const activeH = lineHeight + beatFlash * Math.max(2.2, lineHeight * 0.42);
      const hb = activeH * 0.5;
      const pal = THEMES[currentTheme];

      const dbLevel = rms > 0.0005 ? Math.max(-60, Math.round(20 * Math.log10(rms))) : -60;
      const isAbove40 = !isSleeping && mode !== 'none' && dbLevel > -40;
      const targetVolFill = isAbove40 ? Math.max(0.03, Math.min(1, (dbLevel + 40) / 40)) : 0;
      window._smoothVol = (window._smoothVol || 0) + (targetVolFill - (window._smoothVol || 0)) * 0.28;
      if (volTrack && volFill) {
        volTrack.style.opacity = isAbove40 ? '0.88' : '0';
        volFill.style.background = \`linear-gradient(90deg, rgb(\${pal.bass.join(',')}) 0%, rgb(\${pal.mid.join(',')}) 55%, rgb(\${pal.treble.join(',')}) 100%)\`;
        volFill.style.transform = \`scale3d(\${Math.max(0, Math.min(1, window._smoothVol)).toFixed(4)}, 1, 1)\`;
      }

      ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, lineWidth, ch);
      ctx.beginPath(); ctx.roundRect(0, cy - hb, lineWidth, activeH, hb);
      ctx.fillStyle = document.body.classList.contains('light') ? 'rgba(15,15,18,0.92)' : \`rgba(255,255,255,\${(0.07 + beatFlash * 0.08).toFixed(3)})\`;
      ctx.fill();
      ctx.save(); ctx.clip(); ctx.globalCompositeOperation = 'screen';

      const drawBlob = (x, span, col, a) => {
        const g = ctx.createRadialGradient(x, cy, 1, x, cy, span);
        g.addColorStop(0, \`rgba(\${col[0]},\${col[1]},\${col[2]},\${a})\`);
        g.addColorStop(1, \`rgba(\${col[0]},\${col[1]},\${col[2]},0)\`);
        ctx.fillStyle = g; ctx.fillRect(0, cy - hb, lineWidth, activeH);
      };
      drawBlob(lineWidth * 0.18, lineWidth * (0.28 + (bass + beatFlash * 0.25) * 0.45), pal.bass, Math.min(1.0, 0.25 + (bass + beatFlash * 0.35) * 0.75));
      drawBlob(lineWidth * (0.5 + (pitchNorm - 0.5) * 0.42), lineWidth * (0.32 + (mid + beatFlash * 0.22) * 0.45), pal.mid, Math.min(1.0, 0.28 + (mid + beatFlash * 0.3) * 0.72));
      drawBlob(lineWidth * 0.82, lineWidth * (0.26 + treble * 0.45), pal.treble, Math.min(0.98, 0.22 + treble * 0.78));

      if (beatFlash > 0.02) {
        const fg = ctx.createLinearGradient(0, cy - hb, lineWidth, cy + hb);
        const fp = Math.min(0.72, beatFlash * 0.55);
        fg.addColorStop(0, \`rgba(\${pal.bass[0]},\${pal.bass[1]},\${pal.bass[2]},\${fp*0.45})\`);
        fg.addColorStop(0.5, \`rgba(255,255,255,\${fp})\`);
        fg.addColorStop(1, \`rgba(\${pal.treble[0]},\${pal.treble[1]},\${pal.treble[2]},\${fp*0.45})\`);
        ctx.fillStyle = fg; ctx.fillRect(0, cy - hb, lineWidth, activeH);
      }

      phase += 0.06 + rms * 0.15;
      ctx.beginPath();
      for (let i = 0; i < 48; i++) {
        const px = (i / 47) * lineWidth;
        const env = Math.sin((i / 47) * Math.PI);
        const s = mode !== 'none' ? (timeData[i * 10] - 128) / 128 : 0;
        const py = cy + (s * 0.8 + Math.sin(i * 0.3 + phase) * 0.25) * (activeH * 0.55) * (0.2 + rms) * env;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = \`rgba(\${pal.mid[0]},\${pal.mid[1]},\${pal.mid[2]},\${Math.min(0.95, 0.75 + beatFlash * 0.25)})\`;
      ctx.lineWidth = Math.max(1, activeH * 0.14 + beatFlash * 0.5); ctx.stroke();
      ctx.restore(); ctx.restore();

      filamentWrap.style.transform = \`scale3d(\${(1+(springScale-1)*0.55+beatFlash*0.018).toFixed(3)}, \${(1+(springScale-1)*1.15+beatFlash*0.12).toFixed(3)}, 1)\`;
      if (ts - lastUi > 160) {
        lastUi = ts;
        readoutEl.textContent = isSleeping
          ? '休眠省电中 (2 FPS)'
          : \`低 \${Math.round(bass*100)}% · 中 \${Math.round(mid*100)}% · 高 \${Math.round(treble*100)}%\`;
      }
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'AuraLine-隐身声学细线-离线版.html';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
