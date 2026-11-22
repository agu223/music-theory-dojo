/* ============================================================
   乐理通关工作台 · engine.js
   纯浏览器端音频分析 + 五维自动评分（零依赖、零 token、可离线）
   参考: MusicMash(pYIN/DTW) / audio-ai / listening-brain 的思路，
        用 Web Audio + 自相关(ACF) + DTW 做轻量可运行的实现
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 基础工具 ---------- */
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const noteName = m => NOTE_NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  let _ctx = null;
  function ensureCtx() {
    if (!_ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("当前浏览器不支持 Web Audio API，请改用 Chrome / Edge / Safari");
      _ctx = new AC();
    }
    if (_ctx.state === "suspended") _ctx.resume();
    return _ctx;
  }

  /* ---------- 发声（标准示范 / 虚拟钢琴 / 练耳） ---------- */
  function tone(midi, dur, when, gain, type) {
    const ctx = ensureCtx();
    const t = when != null ? when : ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "triangle";
    osc.frequency.value = midiToFreq(midi);
    const peak = gain == null ? 0.22 : gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(peak * 0.68, t + Math.max(0.05, dur * 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
    return { osc, g };
  }
  function playNote(midi, dur) { try { tone(midi, dur || 0.5); } catch (e) {} }
  function playChord(midis, dur) { try { midis.forEach(m => tone(m, dur || 1.0, null, 0.13)); } catch (e) {} }
  function playInterval(base, semitones, gap) {
    try {
      const ctx = ensureCtx();
      tone(base, 0.6, ctx.currentTime, 0.2);
      tone(base + semitones, 0.6, ctx.currentTime + (gap || 0), 0.2);
    } catch (e) {}
  }

  /* ---------- 标准示范播放 ---------- */
  let _demoTimer = null;
  function stopDemo() { if (_demoTimer) { clearTimeout(_demoTimer); _demoTimer = null; } }
  function playDemo(stage, onProgress, onEnd) {
    stopDemo();
    try {
      const ctx = ensureCtx();
      const beatSec = 60 / (stage.song.bpm || 90);
      const notes = stage.song.notes, beats = stage.song.beats;
      let acc = 0;
      const total = beats.reduce((a, b) => a + b * beatSec, 0);
      const t0 = ctx.currentTime + 0.12;
      notes.forEach((m, i) => {
        const d = (beats[i] || 1) * beatSec * 0.92;
        tone(m, d, t0 + acc, 0.20, "triangle");
        acc += (beats[i] || 1) * beatSec;
      });
      const started = performance.now();
      function tick() {
        const p = (performance.now() - started) / 1000 / total;
        if (onProgress) onProgress(clamp(p, 0, 1));
        if (p < 1) _demoTimer = setTimeout(tick, 80);
        else { _demoTimer = null; if (onEnd) onEnd(); }
      }
      tick();
      return total;
    } catch (e) { if (onEnd) onEnd(); return 0; }
  }

  /* ---------- 节拍器（lookahead 精确调度） ---------- */
  const Metronome = {
    _timer: null, _next: 0, _count: 0, _ctx: null,
    start(bpm, beatsPerBar, onTick, accent) {
      this.stop();
      const ctx = ensureCtx(); this._ctx = ctx;
      const interval = 60 / clamp(bpm, 30, 240);
      this._next = ctx.currentTime + 0.06; this._count = 0;
      const beatN = clamp(beatsPerBar || 4, 1, 12);
      const schedule = () => {
        while (this._next < ctx.currentTime + 0.12) {
          const idx = this._count % beatN;
          const isDown = idx === 0;
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = isDown ? (accent ? 1320 : 1000) : 800;
          g.gain.setValueAtTime(0.0001, this._next);
          g.gain.exponentialRampToValueAtTime(isDown ? 0.30 : 0.16, this._next + 0.002);
          g.gain.exponentialRampToValueAtTime(0.0001, this._next + 0.055);
          o.connect(g); g.connect(ctx.destination);
          o.start(this._next); o.stop(this._next + 0.06);
          if (onTick) { const k = idx; setTimeout(() => onTick(k, isDown), Math.max(0, (this._next - ctx.currentTime) * 1000)); }
          this._next += interval; this._count++;
        }
      };
      schedule();
      this._timer = setInterval(schedule, 25);
    },
    stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  };

  /* ---------- 基频检测：降采样 + 自相关(ACF) + 抛物线插值 ---------- */
  function downsample(src, factor) {
    const out = new Float32Array(Math.floor(src.length / factor));
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      for (let k = 0; k < factor; k++) s += src[i * factor + k] || 0;
      out[i] = s / factor;
    }
    return out;
  }

  function autoCorrelate(buf, rate) {
    const N = buf.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.008) return { f0: -1, rms };
    // 去直流
    let dc = 0; for (let i = 0; i < N; i++) dc += buf[i]; dc /= N;
    const minLag = Math.max(4, Math.floor(rate / 1100));
    const maxLag = Math.min(Math.floor(N / 2) - 2, Math.floor(rate / 65));
    if (maxLag <= minLag) return { f0: -1, rms };
    const c = new Float64Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < N - lag; i++) s += (buf[i] - dc) * (buf[i + lag] - dc);
      c[lag] = s / (N - lag);
    }
    // 跳过开头下降段，避免选到 2 倍周期
    let d = minLag;
    while (d < maxLag - 1 && c[d] > c[d + 1]) d++;
    let maxVal = -Infinity, maxPos = -1;
    for (let j = d; j <= maxLag; j++) if (c[j] > maxVal) { maxVal = c[j]; maxPos = j; }
    if (maxPos < 0 || maxVal <= 0) return { f0: -1, rms };
    const y1 = c[maxPos - 1] || 0, y2 = c[maxPos], y3 = c[maxPos + 1] || 0;
    const den = 2 * (2 * y2 - y1 - y3);
    const shift = den !== 0 ? clamp((y3 - y1) / den, -1, 1) : 0;
    const T = maxPos + shift;
    const f0 = T > 0 ? rate / T : -1;
    if (f0 < 60 || f0 > 1400) return { f0: -1, rms };
    return { f0, rms };
  }

  /* ---------- 帧 → 音符事件 ---------- */
  function framesToNotes(frames, rate) {
    const dsRate = rate / 4;
    const obs = [];
    for (const f of frames) {
      const ds = downsample(f.buf, 4);
      if (ds.length < 64) continue;
      const r = autoCorrelate(ds, dsRate);
      let midi = -1;
      if (r.f0 > 0) {
        const m = 69 + 12 * Math.log2(r.f0 / 440);
        if (m > 30 && m < 100) midi = m;
      }
      obs.push({ t: f.t, midi, rms: r.rms });
    }
    if (!obs.length) return [];
    // 简单中值平滑，去掉孤立误检
    for (let i = 1; i < obs.length - 1; i++) {
      if (obs[i].midi > 0 && obs[i - 1].midi < 0 && obs[i + 1].midi < 0) obs[i].midi = -1;
      if (obs[i].midi > 0 && obs[i - 1].midi > 0 && obs[i + 1].midi > 0) {
        const s = [obs[i - 1].midi, obs[i].midi, obs[i + 1].midi].sort((a, b) => a - b);
        if (Math.abs(obs[i].midi - s[1]) > 1.2) obs[i].midi = s[1];
      }
    }
    const notes = [];
    let cur = null;
    const finish = c => ({
      midi: c.midiSum / c.n,
      t: c.t0,
      dur: Math.max(0.07, c.t1 - c.t0 + 0.024),
      rms: c.rmsSum / c.n,
      cents: Math.round(((c.midiSum / c.n) % 1) * 100)
    });
    for (const o of obs) {
      const silent = o.midi < 0 || o.rms < 0.009;
      if (silent) {
        if (cur && cur.n >= 2) notes.push(finish(cur));
        cur = null;
        continue;
      }
      if (cur && Math.abs(o.midi - cur.midiSum / cur.n) < 0.72) {
        cur.midiSum += o.midi; cur.n++; cur.rmsSum += o.rms; cur.t1 = o.t;
      } else {
        if (cur && cur.n >= 2) notes.push(finish(cur));
        cur = { t0: o.t, t1: o.t, midiSum: o.midi, n: 1, rmsSum: o.rms };
      }
    }
    if (cur && cur.n >= 2) notes.push(finish(cur));
    return notes.filter(n => n.dur > 0.055 && n.midi > 30);
  }

  /* ---------- 离线分析（音频文件，秒出分） ---------- */
  function analyseBuffer(audioBuffer, onProgress) {
    const ch = audioBuffer.getChannelData(0);
    const rate = audioBuffer.sampleRate;
    const FRAME = 2048, HOP = 1024;
    const frames = [];
    for (let off = 0; off + FRAME <= ch.length; off += HOP) {
      frames.push({ t: off / rate, buf: ch.slice(off, off + FRAME) });
      if (frames.length % 120 === 0 && onProgress) onProgress(off / ch.length);
    }
    if (onProgress) onProgress(1);
    return framesToNotes(frames, rate);
  }

  /* ---------- 视频 / 无法 decode 时：MediaElement 实时分析 ---------- */
  function analyseMedia(file, onProgress) {
    return new Promise(async (resolve, reject) => {
      let url = null, el = null, raf = null;
      const cleanup = () => {
        if (raf) cancelAnimationFrame(raf);
        try { if (el) { el.pause(); el.src = ""; } } catch (e) {}
        if (url) URL.revokeObjectURL(url);
      };
      try {
        const ctx = ensureCtx();
        url = URL.createObjectURL(file);
        const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name);
        el = document.createElement(isVideo ? "video" : "audio");
        el.src = url; el.preload = "auto"; el.playsInline = true;
        el.style.display = "none"; document.body.appendChild(el);
        await new Promise((res, rej) => {
          el.onloadedmetadata = res;
          el.onerror = () => rej(new Error("无法读取该媒体文件的音轨，请改用音频文件（mp3/wav/m4a）或直接录音"));
          setTimeout(() => rej(new Error("读取媒体超时")), 12000);
        });
        if (!isFinite(el.duration) || el.duration <= 0) throw new Error("媒体时长异常");
        const source = ctx.createMediaElementSource(el);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        const buf = new Float32Array(analyser.fftSize);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        const frames = [];
        await el.play();
        raf = requestAnimationFrame(function tick() {
          analyser.getFloatTimeDomainData(buf);
          frames.push({ t: el.currentTime, buf: Float32Array.from(buf) });
          if (onProgress) onProgress(clamp(el.currentTime / el.duration, 0, 1));
          if (el.ended || el.currentTime >= el.duration - 0.05) {
            cleanup();
            resolve(framesToNotes(frames, ctx.sampleRate));
          } else raf = requestAnimationFrame(tick);
        });
      } catch (e) { cleanup(); reject(e); }
    });
  }

  /* ---------- 统一入口 ---------- */
  async function analyseFile(file, onProgress) {
    if (!file) throw new Error("请先选择演奏文件");
    const ctx = ensureCtx();
    let arr;
    try { arr = await file.arrayBuffer(); } catch (e) { throw new Error("读取文件失败：" + e.message); }
    try {
      const audioBuffer = await ctx.decodeAudioData(arr.slice(0));
      if (onProgress) onProgress(0.15);
      return { notes: analyseBuffer(audioBuffer, p => onProgress && onProgress(0.15 + p * 0.85)), mode: "audio" };
    } catch (e) {
      // 视频或不受支持的容器：走实时播放分析
      if (onProgress) onProgress(0.02);
      const notes = await analyseMedia(file, p => onProgress && onProgress(0.05 + p * 0.95));
      return { notes, mode: "media" };
    }
  }

  /* ---------- 麦克风直接录音 ---------- */
  const Recorder = {
    _rec: null, _stream: null, _chunks: [],
    async start() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this._stream = stream; this._chunks = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      this._rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      this._rec.ondataavailable = e => { if (e.data.size) this._chunks.push(e.data); };
      this._rec.start();
      ensureCtx();
    },
    stop() {
      return new Promise((resolve, reject) => {
        if (!this._rec) return reject(new Error("尚未开始录音"));
        this._rec.onstop = () => {
          const blob = new Blob(this._chunks, { type: this._rec.mimeType || "audio/webm" });
          try { this._stream.getTracks().forEach(t => t.stop()); } catch (e) {}
          resolve(new File([blob], "my_performance.webm", { type: blob.type }));
        };
        this._rec.stop();
      });
    }
  };

  /* ---------- 调音器（实时显示音名 / 音分） ---------- */
  const Tuner = {
    _stream: null, _raf: null, _analyser: null, _buf: null,
    async start(onData) {
      await this.stop();
      const ctx = ensureCtx();
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const src = ctx.createMediaStreamSource(this._stream);
      this._analyser = ctx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._buf = new Float32Array(this._analyser.fftSize);
      src.connect(this._analyser);
      const rate = ctx.sampleRate;
      const loop = () => {
        this._analyser.getFloatTimeDomainData(this._buf);
        const r = autoCorrelate(downsample(this._buf, 4), rate / 4);
        let name = "--", cents = 0, hz = 0;
        if (r.f0 > 0) {
          const m = 69 + 12 * Math.log2(r.f0 / 440);
          const near = Math.round(m);
          cents = Math.round((m - near) * 100);
          name = noteName(near); hz = Math.round(r.f0);
        }
        if (onData) onData({ name, cents, hz, rms: r.rms });
        this._raf = requestAnimationFrame(loop);
      };
      loop();
    },
    async stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      if (this._stream) { try { this._stream.getTracks().forEach(t => t.stop()); } catch (e) {} }
      this._stream = null;
    }
  };

  /* ---------- DTW 对齐（允许整体移调） ---------- */
  function dtw(a, b) {
    const n = a.length, m = b.length;
    const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
    D[0][0] = 0;
    const cost = (x, y) => Math.min(Math.abs(x - y), 8);
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++)
        D[i][j] = cost(a[i - 1], b[j - 1]) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
    const pairs = [], extra = [], missing = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      const v = [[D[i - 1][j - 1], 0], [D[i - 1][j], 1], [D[i][j - 1], 2]].sort((x, y) => x[0] - y[0])[0];
      if (v[1] === 0) { pairs.push([i - 1, j - 1]); i--; j--; }
      else if (v[1] === 1) { extra.push(i - 1); i--; }
      else { missing.push(j - 1); j--; }
    }
    while (i > 0) { extra.push(--i); }
    while (j > 0) { missing.push(--j); }
    pairs.reverse(); extra.reverse(); missing.reverse();
    return { dist: D[n][m], pairs, extra, missing };
  }

  /* ---------- 五维评分 ---------- */
  function score(detected, stage) {
    const tn = stage.song.notes, tb = stage.song.beats;
    if (!detected || detected.length < 2) {
      return { error: "没有检测到足够清晰的音高。请确认：① 录音里有乐器声音（不是纯伴奏） ② 环境安静、手机离乐器 1~1.5 米 ③ 尽量用单音旋律、避免同时弹和弦 ④ 或改用「直接录音」再试一次" };
    }
    const dm = detected.map(n => n.midi);
    let best = null;
    for (let off = -12; off <= 12; off++) {
      const r = dtw(dm, tn.map(x => x + off));
      if (!best || r.dist < best.dist) best = Object.assign({ off }, r);
    }
    const P = best.pairs;
    // 音准
    let err = 0, wrong = 0;
    const pitchIssues = [];
    for (const [di, tj] of P) {
      const d = detected[di].midi - (tn[tj] + best.off);
      err += Math.abs(d);
      if (Math.abs(d) > 0.55) {
        wrong++;
        if (pitchIssues.length < 6) pitchIssues.push(`第 ${tj + 1} 个音（${noteName(tn[tj] + best.off)}）${d > 0 ? "偏高" : "偏低"}约 ${Math.abs(d).toFixed(1)} 个半音`);
      }
    }
    const pitch = clamp(100 - (err / Math.max(1, P.length)) * 45 - wrong * 3, 0, 100);
    // 完整度
    const complete = clamp(100 * P.length / (tn.length + best.extra.length * 0.6), 0, 100);
    // 节奏（按「实际每拍秒数」归一化，能自适应你的演奏速度，且对 50~100ms 级抢拍敏感）
    const cum = [0]; for (const b of tb) cum.push(cum[cum.length - 1] + b);
    const totalB = cum[cum.length - 1] || 1;
    const t0 = detected[0].t;
    const tEnd = detected[detected.length - 1].t + detected[detected.length - 1].dur;
    const span = Math.max(0.2, tEnd - t0);
    // 最小二乘拟合「拍数 → 实际时间」斜率：自适应你的真实速度，且无累积偏差
    let sxy = 0, sxx = 0;
    for (const [di, tj] of P) { sxy += cum[tj] * (detected[di].t - t0); sxx += cum[tj] * cum[tj]; }
    const beatSec = sxx > 0 ? Math.max(0.08, Math.min(2.5, sxy / sxx)) : span / totalB;
    let devBeats = 0; let rush = 0, drag = 0;
    const rhythmIssues = [];
    for (const [di, tj] of P) {
      const expected = t0 + cum[tj] * beatSec;
      const ddBeats = (detected[di].t - expected) / beatSec;
      devBeats += Math.abs(ddBeats);
      if (Math.abs(ddBeats) > 0.18) {
        if (ddBeats < 0) rush++; else drag++;
        if (rhythmIssues.length < 4) rhythmIssues.push(`第 ${tj + 1} 个音${ddBeats < 0 ? "抢拍" : "拖拍"}约 ${Math.round(Math.abs(ddBeats) * beatSec * 1000)} ms`);
      }
    }
    const rhythm = clamp(100 - (devBeats / Math.max(1, P.length)) * 170, 0, 100);
    // 流畅度
    const gaps = [];
    for (let k = 1; k < detected.length; k++) gaps.push(Math.max(0, detected[k].t - (detected[k - 1].t + detected[k - 1].dur)));
    const gm = avg(gaps);
    const gsd = gaps.length ? Math.sqrt(avg(gaps.map(g => (g - gm) * (g - gm)))) : 0;
    const cv = gm > 0 ? gsd / gm : 1;
    const bigGaps = gaps.filter(g => g > 0.38).length;
    const fluency = clamp(100 - cv * 42 - bigGaps * 9, 0, 100);
    // 表现力（力度动态代用指标）
    const rms = detected.map(n => n.rms);
    const rm = avg(rms);
    const dyn = rm > 0 ? (Math.max.apply(null, rms) - Math.min.apply(null, rms)) / rm : 0;
    const expression = clamp(50 + dyn * 70, 0, 100);

    const dims = { pitch: Math.round(pitch), rhythm: Math.round(rhythm), complete: Math.round(complete), fluency: Math.round(fluency), expression: Math.round(expression) };
    const W = { pitch: 0.30, rhythm: 0.25, complete: 0.20, fluency: 0.15, expression: 0.10 };
    const total = Math.round(Object.keys(W).reduce((s, k) => s + dims[k] * W[k], 0));
    const stars = total >= 90 ? 3 : total >= 75 ? 2 : total >= 60 ? 1 : 0;
    const passed = total >= 60 && pitch >= 55 && complete >= 60;

    const issues = [];
    if (best.missing.length) issues.push(`漏弹 ${best.missing.length} 个音（第 ${best.missing.slice(0, 6).map(x => x + 1).join("、")} 个）`);
    if (best.extra.length) issues.push(`多出 ${best.extra.length} 个音（可能有重复拨弦或杂音被识别成音）`);
    issues.push.apply(issues, pitchIssues);
    issues.push.apply(issues, rhythmIssues);
    if (bigGaps) issues.push(`检测到 ${bigGaps} 处明显停顿（超过 0.38 秒）`);
    if (wrong === 0 && P.length >= tn.length * 0.85) issues.push("音高轮廓基本正确，没有明显错音");
    if (!issues.length) issues.push("整体平稳，未发现明显问题");

    return {
      dims, total, stars, passed, transpose: best.off,
      detectedCount: detected.length, targetCount: tn.length,
      matched: P.length, missing: best.missing.length, extra: best.extra.length,
      issues: issues.slice(0, 10),
      duration: Math.round(span * 10) / 10,
      advice: buildAdvice(dims, best, stage, { rush, drag, bigGaps, wrong })
    };
  }

  function buildAdvice(dims, best, stage, ex) {
    const out = [];
    if (dims.pitch < 75) out.push("【音准】把通关曲拆成每 2 个音一组，先弹→唱音名→再弹，用工作台「调音器」逐音核对。错音最多的那几个音单独抽出来练 20 遍。");
    if (dims.rhythm < 75) out.push("【节奏】把节拍器降到 " + Math.max(50, (stage.song.bpm || 90) - 30) + " BPM，先只数拍不弹，再出声数「1 & 2 &」跟着弹；连续 3 遍零失误后每次 +5 BPM。" + (ex.rush > ex.drag ? "你主要是抢拍，注意长音要按满时值再抬手。" : ex.drag > 0 ? "你有拖拍，手指要提前一拍准备下一个音。" : ""));
    if (dims.complete < 80) out.push("【完整度】录音里检出 " + best.pairs.length + " / " + stage.song.notes.length + " 个音。先放慢到能一口气弹完不断，再提速；漏音通常发生在乐句接口处，专门练「上一句最后两音 → 下一句第一音」的连接。");
    if (dims.fluency < 75) out.push("【流畅度】" + (ex.bigGaps ? "有明显停顿，多半是换把位/换和弦时手在找位置——把那个转换单独抽出无音慢练 30 次。" : "音符间隔不够均匀，用节拍器开重音，只弹一个音练匀速。") + "速度稳定优先于速度本身。");
    if (dims.expression < 60) out.push("【表现力】所有音力度几乎一样，容易听起来像机器。试着让旋律音略强、伴奏/过渡音略轻，乐句上行渐强、下行渐弱。这一维机器只能粗测，建议把视频发给 AI 助教看手型与乐句处理。");
    if (out.length === 0) out.push("五个维度都在良好区间。下一步：关掉节拍器完整录一遍，检查是否仍能保持匀速；再尝试加一点力度起伏和句尾收束，让演奏更「像音乐」。");
    out.push("【本关专项】" + stage.passNote);
    return out;
  }

  /* ---------- 生成给 AI / WorkBuddy 的结构化提示词 ---------- */
  function buildPrompt(stage, instrument, result, userNote) {
    const r = stage.rubric || CURRICULUM.rubric;
    const rubric = (CURRICULUM.rubric || r).map(x => `- ${x.name}（权重 ${Math.round(x.weight * 100)}%）：${x.desc}`).join("\n");
    const dimLine = result
      ? CURRICULUM.rubric.map(x => `${x.name} ${result.dims[x.key]} 分`).join(" / ")
      : "（尚未跑本地评分，请先上传演奏或手动填写自评分数）";
    return `你是一位耐心的零基础乐理与器乐老师。请针对我这一关的演奏做一次「教练式点评」，不要只复述分数。

【学习阶段】第 ${stage.id} 关：${stage.title}
【乐器】${instrument === "guitar" ? "吉他" : "钢琴"}（我是 0 基础小白）
【本关要掌握的乐理】${stage.goal}
【本关讲义要点】${stage.sections.map(s => s.t).join("；")}
【通关曲】${stage.song.title}（${stage.song.key}，${stage.song.meter}，${stage.song.bpm} BPM）
【通关标准】总分 ≥ 60，音准 ≥ 55，完整度 ≥ 60；五维量规：
${rubric}

【本地自动评分结果】总分 ${result ? result.total : "—"} 分，星级 ${result ? result.stars : "—"}
${dimLine}
【检出的问题】${result ? result.issues.join("；") : "（无）"}
【检测到的移调】${result ? (result.transpose === 0 ? "原调" : (result.transpose > 0 ? "+" : "") + result.transpose + " 半音") : "—"}

【我自己的补充说明】${userNote || "（无，可在此写：我配的和弦、标出的难点、想让你重点看的手型/姿势/乐句处理等）"}

请按以下格式输出，用中文、具体、可执行，不要空话：
1. 一句话总评（先肯定做得好的一点）
2. 最该优先解决的 3 个问题（按影响大小排序，每个都要说明「为什么会出现」）
3. 针对每个问题给出「下次练琴 10 分钟怎么练」的具体处方（写明速度、次数、练哪几个音）
4. 结合本关乐理知识点，出 2 道小测题帮我确认真的懂了（先给题，答案放在最后）
5. 下一关我应该先复习哪个知识点

注意：本地评分引擎只能测单音音高与节奏，无法判断和弦是否按干净、手型姿势、踏板/消音、乐句表现力。如果你看到了我附的演奏视频或文字描述，请把这些纳入点评；如果没有，请明确说明「这部分需要看视频才能判断」，不要凭空臆断。`;
  }

  /* ---------- 导出 ---------- */
  window.MTD_ENGINE = {
    ensureCtx, playNote, playChord, playInterval, playDemo, stopDemo,
    Metronome, Recorder, Tuner,
    analyseFile, score, buildPrompt,
    noteName, midiToFreq, clamp, avg
  };
})();
