/* ============================================================
   乐理通关工作台 · app.js
   界面渲染 / 游戏化 / 评分交互 / AI 通道 / 练琴工具
   ============================================================ */
(function () {
  "use strict";
  const C = CURRICULUM, E = window.MTD_ENGINE;
  const KEY = "mtdojo_v1";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = d => { try { return new Date(d).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (e) { return d; } };
  const dimKeys = ["pitch", "rhythm", "complete", "fluency", "expression"];
  const dimNames = { pitch: "音准", rhythm: "节奏", complete: "完整度", fluency: "流畅度", expression: "表现力" };

  /* ---------- 状态 ---------- */
  function defaults() {
    return {
      xp: 0, streak: 0, lastDay: "", scores: {}, notes: {}, badges: [], history: [],
      current: 1, tab: "theory", instrument: "piano",
      settings: {
        aiMode: "chat",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        model: "glm-4-flash", apiKey: "", proxy: "http://127.0.0.1:8765/chat"
      }
    };
  }
  let S;
  try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch (e) { S = defaults(); }
  S.settings = Object.assign(defaults().settings, S.settings || {});
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function stage() { return C.stages.find(s => s.id === S.current) || C.stages[0]; }
  function bestOf(id, inst) {
    const a = (S.scores[id] && S.scores[id][inst]) || [];
    return a.length ? a.reduce((m, x) => x.total > m.total ? x : m) : null;
  }
  function level() { return Math.floor(S.xp / 200) + 1; }
  function levelName() {
    const n = level();
    return ["见习生", "认音者", "节奏学徒", "识谱者", "音阶行者", "音程猎手", "调式旅人", "和弦学徒", "进行者", "和声师", "织体匠", "即兴者", "演奏家"][Math.min(n - 1, 12)];
  }
  function toast(msg, ms) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), ms || 2600);
  }
  function touchDay() {
    const d = today();
    if (S.lastDay !== d) {
      const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      S.streak = S.lastDay === y ? (S.streak + 1) : 1;
      S.lastDay = d; save();
    }
  }

  /* ---------- 顶栏 / 侧栏 ---------- */
  function renderTop() {
    const passed = C.stages.filter(s => bestOf(s.id, "guitar") && bestOf(s.id, "guitar").passed || bestOf(s.id, "piano") && bestOf(s.id, "piano").passed).length;
    const pct = Math.round(S.xp % 200 / 200 * 100);
    $("topStats").innerHTML =
      `<span class="chip"><span class="dot"></span><b>Lv.${level()} ${levelName()}</b></span>` +
      `<span class="chip">XP <b>${S.xp}</b><span class="xpbar"><i style="width:${pct}%"></i></span></span>` +
      `<span class="chip">🔥 连续 <b>${S.streak}</b> 天</span>` +
      `<span class="chip">🏅 通关 <b>${passed}/12</b></span>` +
      `<span class="chip">🎖 徽章 <b>${S.badges.length}/12</b></span>`;
    $("xpBar").style.width = pct + "%";
    $("lvText").textContent = `Lv.${level()} ${levelName()}`;
    $("xpText").textContent = `${S.xp} XP · ${passed}/12 通关`;
    const r = 26, circ = 2 * Math.PI * r, done = C.stages.filter(s => bestOf(s.id, "guitar")?.passed || bestOf(s.id, "piano")?.passed).length;
    const p = done / 12;
    $("ring").innerHTML = `<svg width="66" height="66"><circle cx="33" cy="33" r="${r}" fill="none" stroke="#e9e9ef" stroke-width="7"/><circle cx="33" cy="33" r="${r}" fill="none" stroke="#007aff" stroke-width="7" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - p)}"/></svg><div class="txt">${done}/12</div>`;
  }
  function renderNav() {
    $("stageNav").innerHTML = C.stages.map(s => {
      const g = bestOf(s.id, "guitar"), p = bestOf(s.id, "piano");
      const bs = [g, p].filter(Boolean);
      const mx = bs.length ? Math.max.apply(null, bs.map(x => x.total)) : 0;
      const st = bs.length ? (bs.some(x => x.passed) ? "✅" : "⭐".repeat(Math.max(0, Math.min(3, bs[0].stars))) || "·") : "🔓";
      const sub = bs.length ? `最高 ${mx} 分 · 吉他 ${g ? g.total : "—"} / 钢琴 ${p ? p.total : "—"}` : s.tag + " · 未测评";
      return `<button class="navitem ${s.id === S.current ? "active" : ""}" onclick="MTD.go(${s.id})">
        <span class="no">${s.id}</span><span class="meta"><span class="nm">${s.icon} ${esc(s.title.split("：")[0])}</span><span class="sub">${esc(sub)}</span></span><span class="st">${st}</span></button>`;
    }).join("");
  }
  function renderHero() {
    const s = stage(), g = bestOf(s.id, "guitar"), p = bestOf(s.id, "piano");
    const bs = [g, p].filter(Boolean), mx = bs.length ? Math.max.apply(null, bs.map(x => x.total)) : 0;
    $("hero").innerHTML = `<div class="card hero">
      <div class="row1">
        <div class="ic">${s.icon}</div>
        <div style="flex:1;min-width:260px">
          <div class="tagrow"><span class="tag blue">第 ${s.id} / 12 关</span><span class="tag">${s.tag}</span><span class="tag green">${s.weeks}</span><span class="tag orange">预计 ${s.est}</span><span class="tag">🔓 已解锁</span></div>
          <h1>${esc(s.title)}</h1><div class="sub">${esc(s.sub)}</div>
        </div>
        <div class="right"><div class="score-mini">本关最高<b>${mx || "—"}</b></div>
          <div style="margin-top:6px">${bs.length ? "⭐".repeat(Math.max(0, Math.min(3, Math.max(g ? g.stars : 0, p ? p.stars : 0)))) : '<span class="muted">尚未测评</span>'}</div></div>
      </div>
      <div class="goal">🎯 <b>学完这一关你能：</b>${esc(s.goal)}</div>
      <div class="btnrow"><span class="muted" style="margin-right:4px">当前乐器轨道</span>
        <div class="seg"><button class="${S.instrument === "guitar" ? "on" : ""}" onclick="MTD.setInstrument('guitar')">🎸 吉他</button><button class="${S.instrument === "piano" ? "on" : ""}" onclick="MTD.setInstrument('piano')">🎹 钢琴</button></div>
        <span class="muted" style="margin-left:auto">通关线：总分 ≥ 60 ｜ 音准 ≥ 55 ｜ 完整度 ≥ 60</span></div>
    </div>`;
  }
  const TABS = [["theory", "📖 详细讲义"], ["videos", "🎬 教学视频"], ["test", "🎯 通关测试"], ["ai", "🤖 AI 助教"], ["notes", "📝 我的笔记"]];
  function renderTabs() {
    $("tabs").innerHTML = TABS.map(t => `<button class="${S.tab === t[0] ? "on" : ""}" onclick="MTD.setTab('${t[0]}')">${t[1]}</button>`).join("");
  }
  function renderAll() { renderTop(); renderNav(); renderHero(); renderTabs(); renderPanel(); }

  /* ---------- 讲义 ---------- */
  function panelTheory(s) {
    const accs = s.sections.map((x, i) => `<div class="acc ${i === 0 ? "open" : ""}"><div class="hd" onclick="this.parentNode.classList.toggle('open')"><span class="n">${i + 1}</span>${esc(x.t)}<span class="ar">›</span></div><div class="bd">${x.h}</div></div>`).join("");
    const terms = s.terms.map(t => `<div class="term"><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join("");
    const mistakes = s.mistakes.map(m => `<div class="mistake"><span class="x">✕</span><span>${esc(m)}</span></div>`).join("");
    const quiz = s.quiz.map(q => `<div class="quiz" onclick="this.classList.toggle('show')"><div class="q">❓ ${esc(q[0])} <span style="margin-left:auto;color:var(--blue);font-size:11px">点击看答案</span></div><div class="a">✅ ${esc(q[1])}</div></div>`).join("");
    const inst = S.instrument === "guitar" ? s.guitar : s.piano;
    const instName = S.instrument === "guitar" ? "🎸 吉他" : "🎹 钢琴";
    return `<div class="card"><h3 class="sec-h"><span class="bar"></span>知识讲解 · ${s.sections.length} 节</h3>${accs}</div>
      <div class="card"><h3 class="sec-h"><span class="bar"></span>${instName} · 本关上手要点</h3>
        <div class="box" style="background:var(--blue-soft);border-color:#cfe4ff"><div style="font-size:13px;line-height:1.85">${inst.h}</div></div>
        <div class="grid2" style="margin-top:14px"><div class="box"><h4>💡 练习提示</h4><ul>${inst.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>
        <div class="box"><h4>🎯 另一轨速览</h4><ul>${(S.instrument === "guitar" ? s.piano : s.guitar).tips.slice(0, 3).map(t => `<li>${esc(t)}</li>`).join("")}</ul><div class="muted" style="margin-top:8px">点顶部「吉他 / 钢琴」切换查看完整双轨内容</div></div></div></div>
      <div class="grid2"><div class="card"><h3 class="sec-h"><span class="bar"></span>术语表 · ${s.terms.length} 条</h3>${terms}</div>
        <div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--red)"></span>新手常见误区</h3>${mistakes}</div></div>
      <div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--green)"></span>自测题 · 点击展开答案</h3>${quiz}</div>`;
  }

  /* ---------- 视频 ---------- */
  let curVideo = null;
  function panelVideos(s) {
    const b = s.videos.bili, y = s.videos.yt;
    setTimeout(() => { const f = (s.videos.yt || []).find(v => v.vid); if (f) selectYT(f.vid); else selectVideo(0); }, 0);
    const bl = b.map((v, i) => `<div class="vitem ${i === 0 ? "on" : ""}" id="vb${i}" onclick="MTD.selectVideo(${i})">
        <div class="p">B站 · ${esc(v.bvid)} · P${v.page || 1}</div><div class="t">${esc(v.label)}</div><div class="n">${esc(v.note || "")}</div></div>`).join("");
    const yl = y.map(v => {
      if (v.vid) return `<div class="vitem" onclick="MTD.selectYT('${v.vid}')"><div class="p">YouTube 主源</div><div class="t">${esc(v.label)}</div><div class="n">${esc(v.note || "")}</div></div>`;
      if (v.search) return `<a class="vitem" style="display:block" href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.search)}" target="_blank" rel="noopener"><div class="p">YouTube 搜索（新窗口）</div><div class="t">${esc(v.label)}</div><div class="n">${esc(v.note || "")}</div></a>`;
      return `<a class="vitem" style="display:block" href="${esc(v.url)}" target="_blank" rel="noopener"><div class="p">外部资源（新窗口）</div><div class="t">${esc(v.label)}</div><div class="n">${esc(v.note || "")}</div></a>`;
    }).join("");
    const demos = s.song.demo.map(d => {
      if (d.bvid) return `<a class="btn sec sm" href="https://www.bilibili.com/video/${d.bvid}/?p=${d.page || 1}" target="_blank" rel="noopener">▶ ${esc(d.label)}</a>`;
      return `<a class="btn sec sm" href="${esc(d.url)}" target="_blank" rel="noopener">▶ ${esc(d.label)}</a>`;
    }).join("");
    const scores = s.song.scores.map(x => `<a class="btn gray sm" href="${esc(x.url)}" target="_blank" rel="noopener">📄 ${esc(x.label)}</a>`).join("");
    return `<div class="notice">📺 <b>视频来自公开网络 · 已设为 YouTube 优先</b>：进入本页会自动播放本关 YouTube 主源，点上方任意一集即可切换；<b>手机 / iPad 会自动变成「点一下跳转原站」的大卡片</b>（iOS 会拦截内嵌播放器，跳转反而最稳）。内容完全一样，建议用 B 站或 YouTube App 打开。若内嵌黑屏也可随时点「↗ 在新窗口打开」。<b>YouTube 主源</b>用于海外网络环境。</div>
      <div class="card"><h3 class="sec-h"><span class="bar"></span>本关教学视频 · B站中文系统课 · 兜底（${b.length} 集）</h3>
        <div class="vlist">${bl}</div>
        <div class="vsrc"><button class="btn sm" id="openVideoBtn" onclick="MTD.openVideoNew()">↗ 在新窗口打开</button><button class="btn gray sm" onclick="MTD.selectVideo(0)">↺ 回到第一集</button><span class="muted" id="curVideoLabel"></span></div>
        <div id="playerBox" style="margin-top:10px"><div class="player-ph"><div><div class="big">▶</div>选择左侧一集开始播放</div></div></div>
      </div>
      <div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--red)"></span>YouTube 主源 · 推荐（${y.length} 个）</h3><div class="vlist">${yl}</div>
        <div class="muted">备用全套系统课：<a href="https://www.youtube.com/watch?v=rgaTLrZGlk0" target="_blank" rel="noopener">Andrew Huang 半小时乐理</a> · <a href="https://www.youtube.com/watch?v=QWnTVipZgT4" target="_blank" rel="noopener">Corey Lennox 完整入门课</a> · <a href="https://www.youtube.com/@nicechordwiwi" target="_blank" rel="noopener">好和弦 NiceChord（中文）</a></div></div>
      <div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--green)"></span>本关通关曲 · 演奏示范与曲谱</h3>
        <div style="font-size:13.5px;font-weight:650;margin-bottom:4px">🎵 ${esc(s.song.title)}</div><div class="muted" style="margin-bottom:12px">${esc(s.song.why)}</div>
        <div class="btnrow" style="margin-bottom:12px">${demos}</div><div class="btnrow">${scores}</div>
        <div class="muted" style="margin-top:10px">谱子建议打印出来放琴架上；MuseScore / IMSLP 均为免费或公共领域资源。</div></div>`;
  }
  function isMobile() {
    return window.matchMedia ? window.matchMedia("(max-width:820px)").matches : (window.innerWidth <= 820);
  }
  function mobileCardHtml(label, sub, url) {
    return `<a class="mob-player" href="${url}" target="_blank" rel="noopener">
      <span class="big">▶</span><span class="t">${esc(label)}</span>
      <span class="s">${esc(sub || "点一下跳转到原站观看 · 手机上比内嵌更稳")}</span>
      <span class="s" style="margin-top:6px;display:block;font-weight:700">↗ 在新窗口打开</span></a>`;
  }
  function selectVideo(i) {
    const s = stage(), v = s.videos.bili[i]; if (!v) return;
    curVideo = { type: "bili", v };
    const pb = $("playerBox"); if (!pb) return;
    document.querySelectorAll(".vitem").forEach(x => x.classList.remove("on"));
    const n = $("vb" + i); if (n) n.classList.add("on");
    const src = `https://player.bilibili.com/player.html?bvid=${v.bvid}&page=${v.page || 1}&high_quality=1&danmaku=0&autoplay=0`;
    const pageUrl = `https://www.bilibili.com/video/${v.bvid}/?p=${v.page || 1}`;
    const mob = isMobile() ? mobileCardHtml(v.label, "B 站 · " + v.bvid + " · P" + (v.page || 1), pageUrl) : "";
    pb.innerHTML = mob + `<div class="${isMobile() ? "pc-player" : ""}"><iframe class="player" src="${src}" allowfullscreen scrolling="no" frameborder="0" referrerpolicy="no-referrer"></iframe></div>`;
    const lb = $("curVideoLabel"); if (lb) lb.textContent = "正在播放：" + v.label;
  }
  function selectYT(vid) {
    curVideo = { type: "yt", vid };
    const pb = $("playerBox"); if (!pb) return;
    const url = `https://www.youtube.com/watch?v=${vid}`;
    const mob = isMobile() ? mobileCardHtml("YouTube 主源课程", "海外网络推荐 · 点开即播", url) : "";
    pb.innerHTML = mob + `<div class="${isMobile() ? "pc-player" : ""}"><iframe class="player" src="https://www.youtube.com/embed/${vid}" allowfullscreen frameborder="0" allow="accelerometer; encrypted-media; picture-in-picture"></iframe></div>`;
    const lb = $("curVideoLabel"); if (lb) lb.textContent = "正在播放 YouTube 主源";
  }
  function openVideoNew() {
    if (!curVideo) return toast("请先选一集视频");
    const url = curVideo.type === "bili" ? `https://www.bilibili.com/video/${curVideo.v.bvid}/?p=${curVideo.v.page || 1}` : `https://www.youtube.com/watch?v=${curVideo.vid}`;
    window.open(url, "_blank", "noopener");
  }

  /* ---------- 通关测试 ---------- */
  let lastResult = null, analysing = false;
  function panelTest(s) {
    const inst = S.instrument === "guitar" ? s.guitar : s.piano;
    const instName = S.instrument === "guitar" ? "吉他" : "钢琴";
    const track = s.song.notes.map((m, i) => `<div class="note-cell" title="第 ${i + 1} 个音">${esc(s.song.names[i])}<small>${s.song.beats[i]} 拍</small></div>`).join("");
    const hist = (S.scores[s.id] && S.scores[s.id][S.instrument]) || [];
    const histHtml = hist.length ? hist.slice().reverse().slice(0, 8).map(h => `<tr><td>${fmtDate(h.date)}</td><td><b style="color:var(--blue)">${h.total}</b></td><td>${"⭐".repeat(h.stars) || "—"}</td><td>${h.passed ? "✅ 通关" : "未通关"}</td><td class="muted">${dimKeys.map(k => dimNames[k] + " " + h.dims[k]).join(" · ")}</td></tr>`).join("") : `<tr><td colspan="5" class="muted">还没有成绩，上传一段演奏试试</td></tr>`;
    return `<div class="card"><h3 class="sec-h"><span class="bar"></span>本关通关曲 · ${esc(s.song.title)}</h3>
      <div class="tagrow"><span class="tag blue">${esc(s.song.key)}</span><span class="tag">${esc(s.song.meter)}</span><span class="tag">${s.song.bpm} BPM</span><span class="tag green">${s.song.notes.length} 个音</span><span class="tag orange">${esc(instName)}轨</span></div>
      <div style="font-size:13px;color:var(--ink2);margin-bottom:10px">${esc(s.song.why)}</div>
      <div class="box" style="background:var(--blue-soft);border-color:#cfe4ff;font-size:12.8px;line-height:1.8"><b>${esc(instName)}怎么弹：</b>${s.song[S.instrument]}</div>
      <h4 style="font-size:12.5px;margin:16px 0 6px">🎼 标准音符序列（点击「听示范」可逐音核对）</h4><div class="note-track">${track}</div>
      <div class="btnrow"><button class="btn sm" onclick="MTD.playDemo()">🔊 听标准示范</button><button class="btn gray sm" onclick="MTD.stopDemo()">⏹ 停止</button><span class="muted" id="demoHint">建议先听 2 遍，再自己弹</span></div>
      <div class="prog" id="demoProg" style="display:none"><i id="demoProgI"></i></div>
      <div class="muted" style="margin-top:12px;padding:10px 12px;background:#fff8e8;border-radius:10px;border:1px solid #ffe4a3;color:#8a6100">⚠️ <b>评测说明：</b>${esc(s.passNote)} 评分引擎检测的是<b>单音旋律的音高与节奏</b>；和弦是否按干净、手型姿势、踏板/消音、乐句表现力请交给 AI 助教结合视频点评。</div>
    </div>
    <div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--green)"></span>上传你的演奏 · 一键自动出分</h3>
      <div class="upload" id="uploadZone" onclick="document.getElementById('fileInput').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="MTD.onDrop(event)">
        <div class="ic">📹</div><div class="t">点击选择 / 拖入演奏视频或音频</div>
        <div class="s">支持 mp4 / mov / webm / mp3 / wav / m4a ｜ 手机横拍，能看清手，环境安静，别开原曲伴奏</div>
      </div>
      <input type="file" id="fileInput" hidden accept="video/*,audio/*,.mp4,.mov,.webm,.mp3,.wav,.m4a" onchange="MTD.onFile(this.files[0]);this.value=''">
      <div class="btnrow" style="margin-top:12px"><button class="btn sec sm" id="recBtn" onclick="MTD.toggleRecord()">🎤 直接录音（不用传文件）</button><span class="muted" id="fileHint">本地分析，不上传任何服务器，完全免费</span></div>
      <div class="prog" id="anaProg" style="display:none"><i id="anaProgI"></i></div><div class="muted" id="anaMsg" style="display:none;margin-top:6px"></div>
      <div id="resultBox"></div>
    </div>
    <div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--purple)"></span>${esc(instName)}轨 · 历史成绩</h3>
      <table class="tb"><thead><tr><th>时间</th><th>总分</th><th>星级</th><th>状态</th><th>五维</th></tr></thead><tbody>${histHtml}</tbody></table></div>`;
  }
  function playDemo() {
    const s = stage();
    $("demoProg").style.display = "block";
    E.playDemo(s, p => { $("demoProgI").style.width = (p * 100) + "%"; }, () => { $("demoHint").textContent = "示范播放完毕，轮到你了 🎸"; setTimeout(() => { $("demoProg").style.display = "none"; }, 700); });
    $("demoHint").textContent = "正在播放标准答案…";
  }
  function stopDemo() { E.stopDemo(); $("demoProg").style.display = "none"; $("demoHint").textContent = "已停止"; }
  function onDrop(ev) { ev.preventDefault(); $("uploadZone").classList.remove("drag"); const f = ev.dataTransfer.files[0]; if (f) onFile(f); }
  async function onFile(file) {
    if (!file || analysing) return;
    analysing = true;
    $("anaProg").style.display = "block"; $("anaMsg").style.display = "block";
    $("fileHint").textContent = "正在分析：" + file.name;
    $("resultBox").innerHTML = "";
    const prog = (p, msg) => { $("anaProgI").style.width = Math.round(p * 100) + "%"; $("anaMsg").textContent = msg || "正在提取音高与节拍…"; };
    try {
      prog(0.03, "正在读取文件…");
      const r = await E.analyseFile(file, p => prog(p, p < 0.9 ? "正在提取音高与起音节拍…" : "正在对齐标准答案并计算五维分数…"));
      prog(1, "分析完成");
      const result = E.score(r.notes, stage());
      if (result.error) { $("resultBox").innerHTML = `<div class="notice" style="margin-top:14px">⚠️ ${esc(result.error)}</div>`; return; }
      result.mode = r.mode; result.file = file.name;
      lastResult = result;
      saveScore(result);
      renderResult(result);
      toast(result.passed ? `🎉 通关！${result.total} 分` : `完成评分：${result.total} 分，继续加油`);
    } catch (e) {
      $("resultBox").innerHTML = `<div class="notice" style="margin-top:14px">⚠️ 分析失败：${esc(e.message)}<br><br>建议：① 改用 mp3/wav 音频文件 ② 或用「🎤 直接录音」 ③ 确认浏览器是 Chrome / Edge ④ 录音里只有你的乐器、没有原曲伴奏。</div>`;
    } finally {
      analysing = false; $("anaMsg").style.display = "none"; $("anaProg").style.display = "none";
    }
  }
  function saveScore(r) {
    const s = stage();
    S.scores[s.id] = S.scores[s.id] || {};
    const arr = S.scores[s.id][S.instrument] = S.scores[s.id][S.instrument] || [];
    const rec = { date: new Date().toISOString(), total: r.total, dims: r.dims, stars: r.stars, passed: r.passed, issues: r.issues, advice: r.advice, transpose: r.transpose, instrument: S.instrument, stage: s.id };
    arr.push(rec);
    S.history.push(rec);
    S.xp += Math.ceil(r.total / 10) + (r.passed ? 50 : 0) + (r.stars === 3 ? 30 : 0);
    if (r.passed && S.badges.indexOf(s.id) < 0) S.badges.push(s.id);
    touchDay(); save(); renderTop(); renderNav(); renderHero();
  }
  function renderResult(r) {
    const s = stage();
    const dims = dimKeys.map(k => `<div class="dim"><div class="k"><span>${dimNames[k]}</span><b>${r.dims[k]}</b></div><div class="bar"><i style="width:${r.dims[k]}%;background:${r.dims[k] >= 75 ? "var(--green)" : r.dims[k] >= 60 ? "var(--blue)" : "var(--orange)"}"></i></div></div>`).join("");
    $("resultBox").innerHTML = `<div class="result">
      <div class="bigscore"><div class="num">${r.total}<small> / 100</small></div><div><div class="stars">${"⭐".repeat(r.stars)}${"☆".repeat(3 - r.stars)}</div><div class="muted" style="margin-top:2px">${r.stars === 3 ? "完美通关" : r.stars === 2 ? "良好" : r.stars === 1 ? "及格" : "再练一遍"}</div></div>
      <span class="verdict ${r.passed ? "pass" : "fail"}">${r.passed ? "✅ 本关通关" : "⏳ 未达通关线"}</span>
      <span class="muted" style="margin-left:auto">检出 ${r.detectedCount} 音 / 标准 ${r.targetCount} 音 · 匹配 ${r.matched} · 时长 ${r.duration}s · ${r.transpose === 0 ? "原调" : (r.transpose > 0 ? "+" : "") + r.transpose + " 半音移调"}</span></div>
      <div class="dims">${dims}</div>
      <div class="radarwrap"><canvas id="radarC" width="420" height="420"></canvas><div style="flex:1;min-width:220px">
        <h4 style="font-size:13px;margin-bottom:8px">📋 检出的问题</h4><div class="issues" style="margin-top:0"><ul style="margin:0;padding-left:18px">${r.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div></div></div>
      <div class="advice"><h4 style="font-size:13px;margin-bottom:8px">💡 下一步怎么练（内置建议引擎）</h4>${r.advice.map((a, i) => `<div class="a"><span class="i">${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "📌"][i] || "•"}</span><span>${esc(a)}</span></div>`).join("")}</div>
      <div class="divider"></div>
      <div class="btnrow"><button class="btn" onclick="MTD.aiReview()">🤖 让 AI 深度点评</button><button class="btn sec" onclick="MTD.copyReport()">📋 复制报告发到 WorkBuddy 对话</button><button class="btn gray" onclick="MTD.reAnalyse()">🔄 重新评一次</button></div>
      <div class="muted" style="margin-top:9px">成绩已自动存档到本关「${S.instrument === "guitar" ? "吉他" : "钢琴"}」轨，可在📊成绩单查看雷达图与进步曲线。表现力为力度动态代用指标，请结合 AI 点评理解。</div>
      <div id="aiOut"></div>
    </div>`;
    setTimeout(() => drawRadar($("radarC"), dimKeys.map(k => r.dims[k])), 30);
  }
  function reAnalyse() { $("resultBox").innerHTML = ""; lastResult = null; $("fileHint").textContent = "可以再上传一次"; document.getElementById("fileInput").click(); }

  /* ---------- AI 助教 ---------- */
  function panelAI(s) {
    const st = S.settings;
    const modeTxt = { chat: "WorkBuddy 对话（零配置 · 推荐）", api: "浏览器直连免费 API", proxy: "本地代理转发（智谱/DeepSeek）" }[st.aiMode];
    return `<div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--purple)"></span>AI 助教 / 评委 · 当前通道：${modeTxt}</h3>
      <div class="notice">💡 <b>先说清楚能力边界（很重要）</b>：免费大模型 API 只能读文字和图片，<b>不能「听」音频、「看」视频</b>。所以工作台的「自动出分」由本地音频引擎完成（音准/节奏/完整度/流畅度/表现力），AI 负责<b>把测量结果翻译成针对你个人的教练式点评</b>。<br>要做 Yousician 那种逐音毫秒级实时打分需要专门的音频算法服务（GitHub 上 MusicMash 用 pYIN + DTW 实现），那是另一个工程量级 —— 对 0 基础阶段，本工作台的方案够用且完全免费。</div>
      <div class="grid2"><div class="box"><h4>① 本地评分引擎（永远可用）</h4><p class="muted" style="margin:0">浏览器内跑 Web Audio + 自相关 + DTW，零配置、断网可用、无需任何 Key。上传即出五维分数与练习处方。</p></div>
        <div class="box"><h4>② AI 深度点评（可选）</h4><p class="muted" style="margin:0">把评分结果 + 本关讲义要点发给免费大模型（智谱 GLM-4-Flash 永久免费），生成「为什么错 + 下次 10 分钟怎么练」的个性化建议。不配 Key 也能用 WorkBuddy 对话。</p></div></div>
      <div class="divider"></div>
      <h4 style="font-size:13px;margin-bottom:9px">📋 本关评分提示词（可复制，也可直接发到 WorkBuddy 对话）</h4>
      <div class="btnrow"><button class="btn sm" onclick="MTD.buildPrompt()">🔧 生成 / 刷新提示词</button><button class="btn sec sm" onclick="MTD.copyPrompt()">📋 复制提示词</button><button class="btn gray sm" onclick="MTD.openSettings()">⚙️ 切换 AI 通道</button></div>
      <div class="promptbox" id="promptBox">点「生成 / 刷新提示词」后显示。提示词会自动带上本关知识点、通关曲、五维量规和你最近一次的评分结果。</div>
      <div class="divider"></div>
      <h4 style="font-size:13px;margin-bottom:9px">💬 快捷提问（复制后发到 WorkBuddy 对话，我直接回答）</h4>
      <div class="btnrow">
        <button class="btn sec sm" onclick="MTD.quickAsk('explain')">🧠 用大白话讲一遍本关</button>
        <button class="btn sec sm" onclick="MTD.quickAsk('quiz')">❓ 给我出 5 道题</button>
        <button class="btn sec sm" onclick="MTD.quickAsk('practice')">🎯 排一个 7 天练习计划</button>
        <button class="btn sec sm" onclick="MTD.quickAsk('song')">🎵 分析通关曲的和声</button>
        <button class="btn sec sm" onclick="MTD.quickAsk('why')">🔍 我总弹不好，帮我找原因</button></div>
      <div id="aiTabOut"></div>
    </div>`;
  }
  function currentPrompt() {
    const s = stage();
    const extra = (S.notes[s.id] || "").trim();
    return E.buildPrompt(s, S.instrument, lastResult, extra);
  }
  function buildPrompt() { $("promptBox").textContent = currentPrompt(); toast("提示词已生成，可复制使用"); }
  function copyPrompt() { const t = $("promptBox").textContent; if (!t || t.indexOf("点「生成") === 0) buildPrompt(); copyText(currentPrompt(), "提示词已复制，粘贴到 WorkBuddy 对话即可"); }
  function copyReport() {
    if (!lastResult) return toast("请先上传演奏完成一次评分");
    const s = stage();
    const txt = `【乐理通关工作台 · 第 ${s.id} 关评分报告】\n关卡：${s.title}\n乐器：${S.instrument === "guitar" ? "吉他" : "钢琴"}\n通关曲：${s.song.title}（${s.song.key} / ${s.song.meter} / ${s.song.bpm} BPM）\n\n总分 ${lastResult.total} / 100 ｜ ${"⭐".repeat(lastResult.stars)} ｜ ${lastResult.passed ? "已通关" : "未通关"}\n五维：${dimKeys.map(k => dimNames[k] + " " + lastResult.dims[k]).join(" / ")}\n检出：${lastResult.detectedCount} 音 / 标准 ${lastResult.targetCount} 音，匹配 ${lastResult.matched}，移调 ${lastResult.transpose} 半音\n\n问题：\n- ${lastResult.issues.join("\n- ")}\n\n内置建议：\n- ${lastResult.advice.join("\n- ")}\n\n---\n${currentPrompt()}`;
    copyText(txt, "完整报告已复制，粘贴到 WorkBuddy 对话让我深度点评");
  }
  function copyText(t, ok) {
    const done = () => toast(ok || "已复制");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
    } else fallbackCopy(t, done);
  }
  function fallbackCopy(t, done) {
    const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动选中文本框内容复制"); }
    document.body.removeChild(ta);
  }
  function quickAsk(kind) {
    const s = stage();
    const base = `我在学「第 ${s.id} 关：${s.title}」，乐器是${S.instrument === "guitar" ? "吉他" : "钢琴"}，完全 0 基础。本关讲义要点：${s.sections.map(x => x.t).join("；")}。通关曲是《${s.song.title}》。`;
    const q = {
      explain: base + "请用完全不讲术语的大白话，把这一关的核心知识重新讲一遍，各举一个吉他和钢琴上的例子，最后用 3 句话总结。",
      quiz: base + "请出 5 道由浅入深的小测题（含 2 道在乐器上操作的实操题），先只给题目，答案统一放在最后，并说明每道题在考哪个知识点。",
      practice: base + `请给我排一个 7 天练习计划，每天 20~30 分钟，写明每天练什么、用多少 BPM、练几遍、达成什么标准才能进入下一天，并标出最容易放弃的两天该怎么熬过去。`,
      song: base + `请分析《${s.song.title}》的调号/拍号/和弦进行/乐句结构，指出这一关的哪些知识点在这首曲子里用上了，并给我在${S.instrument === "guitar" ? "吉他" : "钢琴"}上弹好它的 3 个关键点。`,
      why: base + `我这一关总是弹不好。请列出 0 基础学员在这一关最常见的 6 个「卡住原因」，每个给出可自查的判断方法和对应练法，帮我逐一排查。`
    }[kind];
    copyText(q, "问题已复制，粘贴到 WorkBuddy 对话，我马上答");
    const box = $("promptBox"); if (box) box.textContent = q;
  }
  async function aiReview() {
    if (!lastResult) return toast("请先在「通关测试」上传演奏完成一次评分");
    const st = S.settings;
    if (st.aiMode === "chat") {
      copyReport();
      toast("当前是 WorkBuddy 对话模式：报告已复制，粘贴到对话里即可");
      return;
    }
    let out = $("aiOut");
    if (!out) {
      out = document.createElement("div"); out.id = "aiOut";
      const host = $("resultBox") || $("aiTabOut");
      if (!host) { S.tab = "test"; renderTabs(); renderPanel(); }
      ($("resultBox") || $("aiTabOut") || document.body).appendChild(out);
    }
    out.innerHTML = `<div class="notice" style="margin-top:14px">🤖 正在请求 AI 点评…（首次使用需确认设置里的通道与 Key 正确）</div>`;
    const messages = [
      { role: "system", content: "你是一位耐心、具体、不讲空话的零基础乐理与器乐老师。用中文回答，按用户要求的格式输出。" },
      { role: "user", content: currentPrompt() }
    ];
    try {
      const txt = await callAI(messages);
      out.innerHTML = `<div class="card" style="margin-top:14px;background:linear-gradient(135deg,#faf7ff,#fff);border-color:#e4d8f7"><h3 class="sec-h"><span class="bar" style="background:var(--purple)"></span>🤖 AI 教练点评</h3><div style="font-size:13px;line-height:1.85;white-space:pre-wrap">${esc(txt)}</div><div class="muted" style="margin-top:12px">由 ${esc(st.model)} 生成 · 本地评分数据由浏览器音频引擎提供</div></div>`;
      toast("AI 点评已生成");
    } catch (e) {
      out.innerHTML = `<div class="notice" style="margin-top:14px">⚠️ AI 点评失败：${esc(e.message)}<br><br><b>可以这样处理：</b>① 点「📋 复制报告发到 WorkBuddy 对话」，粘贴到本对话我来点评（零配置、免费）；② 或到 ⚙️设置 检查通道与 Key；③ 若用本地代理，请先双击文件夹里的「启动AI代理.bat」并保持窗口开着。</div>`;
    }
  }
  async function callAI(messages) {
    const st = S.settings;
    let url, body, headers = { "Content-Type": "application/json" };
    if (st.aiMode === "proxy") {
      url = st.proxy;
      body = { endpoint: st.endpoint, apiKey: st.apiKey, model: st.model, messages, temperature: 0.7, max_tokens: 1400 };
    } else {
      url = st.endpoint;
      body = { model: st.model, messages, temperature: 0.7, max_tokens: 1400, stream: false };
      if (st.apiKey) headers.Authorization = "Bearer " + st.apiKey;
    }
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const j = await resp.json();
    if (j.proxy_error) throw new Error(j.proxy_error);
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content)
      || (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0].text)
      || j.output_text || (j.content && j.content[0] && j.content[0].text);
    if (!txt) throw new Error("接口返回里没有找到文本内容：" + JSON.stringify(j).slice(0, 260));
    return txt;
  }

  /* ---------- 笔记 ---------- */
  function panelNotes(s) {
    const v = esc(S.notes[s.id] || "");
    return `<div class="card"><h3 class="sec-h"><span class="bar" style="background:var(--orange)"></span>我的笔记 · 第 ${s.id} 关</h3>
      <div class="muted" style="margin-bottom:10px">自动保存在本机浏览器。写在这里的内容会<b>自动附到 AI 评分提示词</b>里 —— 建议记下：你配的和弦、标出的技术难点、想让 AI 重点看的手型/姿势/乐句处理。</div>
      <textarea class="ta" id="noteTa" placeholder="例：本关我用 Am-F-C-G 给《天空之城》配了和弦；第 3 小节的 G→C 跳进总按不准；请重点看我的左手手型…" oninput="MTD.saveNote(this.value)">${v}</textarea>
      <div class="muted" id="noteSaved" style="margin-top:8px">${v ? "已保存" : "开始记录吧"}</div></div>
    <div class="card"><h3 class="sec-h"><span class="bar"></span>本关术语速查</h3>${s.terms.map(t => `<div class="term"><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join("")}</div>`;
  }
  function saveNote(v) { S.notes[stage().id] = v; save(); $("noteSaved") && ($("noteSaved").textContent = "已自动保存 " + new Date().toLocaleTimeString("zh-CN")); }

  /* ---------- 面板分发 ---------- */
  function renderPanel() {
    const s = stage();
    const map = { theory: panelTheory, videos: panelVideos, test: panelTest, ai: panelAI, notes: panelNotes };
    $("panel").innerHTML = (map[S.tab] || panelTheory)(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- 雷达图 / 折线 ---------- */
  function drawRadar(cv, vals) {
    if (!cv) return;
    const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W * 0.34;
    ctx.clearRect(0, 0, W, H);
    const n = 5, ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const a = ang(i), r = R * ring / 4; i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      ctx.closePath(); ctx.strokeStyle = "#e6e6ec"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    for (let i = 0; i < n; i++) { const a = ang(i); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); ctx.strokeStyle = "#e6e6ec"; ctx.stroke(); }
    ctx.beginPath();
    vals.forEach((v, i) => { const a = ang(i), r = R * Math.max(0, Math.min(100, v)) / 100; i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); });
    ctx.closePath(); ctx.fillStyle = "rgba(0,122,255,.18)"; ctx.fill(); ctx.strokeStyle = "#007aff"; ctx.lineWidth = 3; ctx.stroke();
    vals.forEach((v, i) => { const a = ang(i), r = R * Math.max(0, Math.min(100, v)) / 100; ctx.beginPath(); ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 4, 0, 7); ctx.fillStyle = "#007aff"; ctx.fill(); });
    ctx.font = "600 17px -apple-system, PingFang SC, sans-serif"; ctx.fillStyle = "#515154"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const labels = ["音准", "节奏", "完整度", "流畅度", "表现力"];
    labels.forEach((t, i) => { const a = ang(i), r = R + 26; ctx.fillText(t, cx + r * Math.cos(a), cy + r * Math.sin(a)); });
  }
  function drawLine(cv, vals, labels) {
    if (!cv) return;
    const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const pad = { l: 40, r: 16, t: 18, b: 30 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    ctx.strokeStyle = "#e6e6ec"; ctx.lineWidth = 1; ctx.font = "11px sans-serif"; ctx.fillStyle = "#86868b"; ctx.textAlign = "right";
    for (let g = 0; g <= 4; g++) { const y = pad.t + h * g / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(String(100 - g * 25), pad.l - 7, y + 4); }
    if (!vals.length) { ctx.fillStyle = "#86868b"; ctx.textAlign = "center"; ctx.fillText("还没有成绩，去通关测试上传一段演奏吧", W / 2, H / 2); return; }
    const X = i => pad.l + (vals.length === 1 ? w / 2 : w * i / (vals.length - 1));
    const Y = v => pad.t + h * (1 - Math.max(0, Math.min(100, v)) / 100);
    ctx.beginPath(); vals.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.strokeStyle = "#007aff"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(0), pad.t + h); vals.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(vals.length - 1), pad.t + h); ctx.closePath();
    ctx.fillStyle = "rgba(0,122,255,.10)"; ctx.fill();
    vals.forEach((v, i) => { ctx.beginPath(); ctx.arc(X(i), Y(v), 4.5, 0, 7); ctx.fillStyle = "#007aff"; ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(v), X(i), Y(v) - 12); });
  }

  /* ============================================================
     PART2 · 练琴工具箱 / 弹窗 / 初始化
     ============================================================ */

  /* ---------- 抽屉与弹窗 ---------- */
  function openModal(html) {
    $("modalBody").innerHTML = html;
    $("modal").classList.add("show");
    $("overlay").classList.add("show");
  }
  function closeAll() {
    $("overlay").classList.remove("show");
    $("toolsDrawer").classList.remove("show");
    $("modal").classList.remove("show");
    E.Metronome.stop();
    const mb = $("metroBtn"); if (mb) mb.textContent = "▶ 开始";
  }
  function openTools() {
    $("toolsDrawer").classList.add("show");
    $("overlay").classList.add("show");
    initBeatDots();
  }

  /* ---------- 节拍器 ---------- */
  let metroOn = false, tapTimes = [];
  function initBeatDots() {
    const n = +(($("metroBeats") || {}).value) || 4;
    $("beatDots").innerHTML = Array.from({ length: n }, () => "<i></i>").join("");
  }
  function toggleMetro() {
    const btn = $("metroBtn");
    if (metroOn) {
      E.Metronome.stop(); metroOn = false; btn.textContent = "▶ 开始";
      document.querySelectorAll("#beatDots i").forEach(x => x.className = "");
    } else {
      initBeatDots();
      const bpm = +(($("metroBpm") || {}).value) || 60, beats = +(($("metroBeats") || {}).value) || 4;
      E.Metronome.start(bpm, beats, (idx, down) => {
        document.querySelectorAll("#beatDots i").forEach((x, i) => x.className = i === idx ? (down ? "on down" : "on") : "");
      }, true);
      metroOn = true; btn.textContent = "⏹ 停止";
    }
  }
  function metroTap() {
    const now = performance.now();
    tapTimes = tapTimes.filter(t => now - t < 2500); tapTimes.push(now);
    if (tapTimes.length >= 2) {
      const gaps = []; for (let i = 1; i < tapTimes.length; i++) gaps.push(tapTimes[i] - tapTimes[i - 1]);
      const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
      const v = Math.max(40, Math.min(220, bpm));
      $("metroBpm").value = v; $("metroBpmV").textContent = v + " BPM";
      $("metroBpmV").textContent = v + " BPM（测速）";
    }
  }

  /* ---------- 调音器 ---------- */
  let tunerOn = false;
  async function toggleTuner() {
    const btn = $("tunerBtn");
    if (tunerOn) {
      await E.Tuner.stop(); tunerOn = false; btn.textContent = "🎤 开始";
      $("tunerNote").textContent = "--"; $("tunerCents").textContent = "已停止";
    } else {
      try {
        await E.Tuner.start(d => {
          $("tunerNote").textContent = d.name;
          $("tunerCents").textContent = d.f0 ? `${d.hz} Hz ｜ ${d.cents > 0 ? "+" : ""}${d.cents} 音分 ${Math.abs(d.cents) <= 8 ? "✅ 准" : d.cents > 0 ? "偏高" : "偏低"}` : "等待声音…";
          $("centsNeedle").style.left = Math.max(2, Math.min(98, 50 + d.cents / 50 * 48)) + "%";
        });
        tunerOn = true; btn.textContent = "⏹ 停止";
      } catch (e) { toast("麦克风开启失败：" + e.message + "（请允许浏览器使用麦克风）"); }
    }
  }

  /* ---------- 虚拟钢琴 ---------- */
  function buildPiano() {
    const white = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83];
    const black = [[0, 61], [1, 63], [3, 66], [4, 68], [5, 70], [7, 73], [8, 75], [10, 78], [11, 80], [12, 82]];
    const ww = 100 / 14, bw = ww * 0.62;
    let html = white.map((m, i) => `<div class="pkey" data-m="${m}" onclick="MTD.pianoHit(${m},this)">${m === 60 ? "C4" : ""}${m === 72 ? "C5" : ""}</div>`).join("");
    html += black.map(([i, m]) => `<div class="bkey" data-m="${m}" style="left:${(i + 1) * ww - bw / 2}%;width:${bw}%" onclick="MTD.pianoHit(${m},this)"></div>`).join("");
    $("piano").innerHTML = html;
  }
  function pianoHit(m, el) {
    E.playNote(m, 0.65);
    el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 160);
    toast(E.noteName(m) + " ｜ " + Math.round(E.midiToFreq(m)) + " Hz", 900);
  }

  /* ---------- 吉他指板 ---------- */
  function buildFretboard() {
    const strings = [["1弦", 64], ["2弦", 59], ["3弦", 55], ["4弦", 50], ["5弦", 45], ["6弦", 40]];
    let html = "<table><tr><th>弦＼品</th>" + Array.from({ length: 13 }, (_, i) => `<th>${i}</th>`).join("") + "</tr>";
    strings.forEach(([nm, open]) => {
      html += `<tr><th>${nm}</th>` + Array.from({ length: 13 }, (_, f) => {
        const m = open + f;
        return `<td class="${f === 0 ? "o" : ""}" onclick="MTD.fretHit(${m},'${nm}',${f},this)">${E.noteName(m).replace(/-?\d+$/, "")}</td>`;
      }).join("") + "</tr>";
    });
    $("fretboard").innerHTML = html + "</table>";
  }
  function fretHit(m, sn, f, el) {
    E.playNote(m, 0.6);
    toast(`${sn} ${f === 0 ? "空弦" : f + " 品"} = ${E.noteName(m)}（MIDI ${m}）`, 1100);
    el.style.background = "var(--blue)"; el.style.color = "#fff";
    setTimeout(() => { el.style.background = ""; el.style.color = ""; }, 220);
  }

  /* ---------- 练耳小游戏 ---------- */
  let earCur = null, earOk = 0, earAll = 0;
  const EAR_SETS = {
    note: { labels: ["C", "D", "E", "F", "G", "A", "B"], type: "note" },
    interval: { labels: ["大二度", "小三度", "大三度", "纯四度", "纯五度", "小六度", "大六度", "纯八度"], semis: [2, 3, 4, 5, 7, 8, 9, 12], type: "interval" },
    chord: { labels: ["大三和弦（明亮）", "小三和弦（忧郁）"], type: "chord" }
  };
  function renderEarOpts() {
    const set = EAR_SETS[(($("earMode") || {}).value) || "note"] || EAR_SETS.note;
    $("earOpts").innerHTML = set.labels.map((l, i) => `<button onclick="MTD.earAnswer(${i})">${l}</button>`).join("");
    $("earStat").textContent = `答对 ${earOk} / ${earAll}`;
  }
  function earPlay() {
    const mode = (($("earMode") || {}).value) || "note", set = EAR_SETS[mode] || EAR_SETS.note;
    const idx = Math.floor(Math.random() * set.labels.length);
    earCur = { mode, idx, set };
    const base = 60 + Math.floor(Math.random() * 5);
    if (mode === "note") E.playNote(base + [0, 2, 4, 5, 7, 9, 11][idx], 0.9);
    else if (mode === "interval") E.playInterval(base, set.semis[idx], 0.62);
    else E.playChord(idx === 0 ? [base, base + 4, base + 7] : [base, base + 3, base + 7], 1.1);
    document.querySelectorAll("#earOpts button").forEach(b => b.className = "");
    toast("🔊 已播放，选出你的答案");
  }
  function earAnswer(i) {
    if (!earCur) return toast("先点「播放题目」");
    if (earCur.mode !== ((($("earMode") || {}).value) || "note")) return renderEarOpts();
    earAll++;
    const ok = i === earCur.idx;
    if (ok) earOk++;
    const btns = document.querySelectorAll("#earOpts button");
    if (btns[i]) btns[i].className = ok ? "right" : "wrong";
    if (!ok && btns[earCur.idx]) btns[earCur.idx].className = "right";
    $("earStat").textContent = `答对 ${earOk} / ${earAll}`;
    toast(ok ? "✅ 答对了！" : `❌ 正确答案：${earCur.set.labels[earCur.idx]}`, 1600);
    setTimeout(() => { document.querySelectorAll("#earOpts button").forEach(b => b.className = ""); }, 1400);
  }

  /* ---------- 直接录音 ---------- */
  let recording = false;
  async function toggleRecord() {
    const btn = $("recBtn");
    if (!recording) {
      try {
        await E.Recorder.start(); recording = true;
        btn.textContent = "⏹ 停止录音并评分"; btn.className = "btn sm";
        toast("🎤 录音中…弹完整首后点「停止录音并评分」");
      } catch (e) { toast("麦克风开启失败：" + e.message); }
    } else {
      recording = false;
      btn.textContent = "🎤 直接录音（不用传文件）"; btn.className = "btn sec sm";
      try { const f = await E.Recorder.stop(); toast("录音完成，开始评分…"); onFile(f); }
      catch (e) { toast("录音失败：" + e.message); }
    }
  }

  /* ---------- 成绩单 ---------- */
  function openReport() {
    const all = S.history || [];
    const avg = all.length ? Math.round(all.reduce((s, x) => s + x.total, 0) / all.length) : 0;
    const passed = C.stages.filter(s => (bestOf(s.id, "guitar") || {}).passed || (bestOf(s.id, "piano") || {}).passed).length;
    const radarVals = dimKeys.map(k => all.length ? Math.round(all.reduce((s, x) => s + ((x.dims && x.dims[k]) || 0), 0) / all.length) : 0);
    const lineVals = all.slice(-14).map(x => x.total);
    const rows = C.stages.map(s => {
      const g = bestOf(s.id, "guitar"), p = bestOf(s.id, "piano");
      const ok = (g && g.passed) || (p && p.passed);
      return `<tr><td>${s.id}. ${esc(s.title.split("：")[0])}</td><td>${g ? `<b style="color:${g.passed ? "#1e9e48" : "var(--blue)"}">${g.total}</b> ${"⭐".repeat(g.stars)}` : "—"}</td><td>${p ? `<b style="color:${p.passed ? "#1e9e48" : "var(--blue)"}">${p.total}</b> ${"⭐".repeat(p.stars)}` : "—"}</td><td>${ok ? '<span style="color:#1e9e48">✅ 通关</span>' : '<span class="muted">未通关 · 内容仍可看</span>'}</td></tr>`;
    }).join("");
    const badges = C.stages.map(s => `<div class="badge ${S.badges.indexOf(s.id) >= 0 ? "got" : ""}"><span class="e">${s.badge.icon}</span><div class="n">${esc(s.badge.name)}</div><div class="d">${esc(s.badge.desc)}</div></div>`).join("");
    openModal(`<div class="mh"><h3>📊 我的成绩单</h3><button onclick="MTD.closeAll()">×</button></div>
      <div class="statgrid"><div class="stat"><b>${S.xp}</b><span>总 XP · Lv.${level()}</span></div><div class="stat"><b>${passed}/12</b><span>通关关卡</span></div><div class="stat"><b>${avg || "—"}</b><span>平均分（${all.length} 次测评）</span></div><div class="stat"><b>${S.streak}</b><span>连续打卡（天）</span></div></div>
      <div class="grid2"><div class="card tight"><h3 class="sec-h"><span class="bar"></span>五维能力雷达（全部测评均值）</h3><div style="text-align:center"><canvas id="reportRadar" width="420" height="420" style="width:240px;height:240px"></canvas></div></div>
        <div class="card tight"><h3 class="sec-h"><span class="bar" style="background:var(--green)"></span>成绩进步曲线（最近 14 次）</h3><canvas id="reportLine" width="440" height="240" style="width:100%;height:200px"></canvas></div></div>
      <div class="card tight"><h3 class="sec-h"><span class="bar" style="background:var(--purple)"></span>12 关双轨成绩</h3><table class="tb"><thead><tr><th>关卡</th><th>🎸 吉他</th><th>🎹 钢琴</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="muted" style="margin-top:10px">🔓 全部 12 关内容从第一天起就能查看，通关只影响徽章与成绩。</div></div>
      <div class="card tight"><h3 class="sec-h"><span class="bar" style="background:var(--gold)"></span>徽章墙（${S.badges.length}/12）</h3><div class="badges">${badges}</div></div>
      <div class="card tight"><h3 class="sec-h"><span class="bar"></span>数据管理</h3><div class="btnrow"><button class="btn sec sm" onclick="MTD.exportData()">⬇ 导出成绩备份（JSON）</button><button class="btn gray sm" onclick="document.getElementById('importFile').click()">⬆ 导入备份</button><button class="btn gray sm" onclick="MTD.clearData()">🗑 清空所有数据</button></div>
        <input type="file" id="importFile" hidden accept=".json" onchange="MTD.importData(this.files[0]);this.value=''">
        <div class="muted" style="margin-top:9px">成绩保存在本机浏览器 localStorage，换浏览器/清缓存会丢失，建议偶尔导出备份。</div></div>`);
    setTimeout(() => { drawRadar($("reportRadar"), radarVals); drawLine($("reportLine"), lineVals); }, 40);
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `乐理工作台_成绩备份_${today()}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("备份已导出");
  }
  function importData(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (!j || typeof j !== "object" || !("scores" in j)) throw new Error("不是有效的备份文件");
        S = Object.assign(defaults(), j);
        S.settings = Object.assign(defaults().settings, j.settings || {});
        save(); closeAll(); renderAll(); buildPiano(); buildFretboard(); renderEarOpts();
        toast("备份导入成功");
      } catch (e) { toast("导入失败：" + e.message); }
    };
    r.readAsText(file);
  }
  function clearData() {
    if (!confirm("确定清空所有成绩、笔记、徽章和 XP 吗？\n\n此操作不可撤销，建议先「导出成绩备份」。")) return;
    if (!confirm("再确认一次：真的要清空吗？")) return;
    localStorage.removeItem(KEY); S = defaults(); save(); closeAll(); renderAll();
    toast("已清空，重新开始吧");
  }

  /* ---------- 设置 ---------- */
  function openSettings() {
    const st = S.settings;
    openModal(`<div class="mh"><h3>⚙️ 设置 · AI 点评通道</h3><button onclick="MTD.closeAll()">×</button></div>
      <div class="notice">🔎 <b>调研结论（2026-11 核实）</b>：智谱 <b>GLM-4-Flash / GLM-4.7-Flash 永久免费</b>（OpenAI 兼容格式，注册送 2000 万 Token）。但<b>智谱生产端点不允许浏览器直连</b>（CORS 不放行 Authorization 头），纯网页 fetch 会被拦。<br>所以工作台默认用「WorkBuddy 对话」通道（零配置、零成本）；想要页面内一键 AI 点评，请选「本地代理」并双击文件夹里的 <b>启动AI代理.bat</b>。海外网络也可选「浏览器直连」接 Gemini 等支持 CORS 的端点。</div>
      <div class="card tight"><h3 class="sec-h"><span class="bar"></span>选择 AI 通道</h3>
        <div style="display:flex;flex-direction:column;gap:11px">
          <label class="radio"><input type="radio" name="aiMode" value="chat" ${st.aiMode === "chat" ? "checked" : ""}><span><b>WorkBuddy 对话（推荐 · 零配置）</b><br><span class="muted">工作台生成结构化报告，你粘贴到本对话，我来深度点评。完全不用买 token、不用配置任何 Key。</span></span></label>
          <label class="radio"><input type="radio" name="aiMode" value="proxy" ${st.aiMode === "proxy" ? "checked" : ""}><span><b>本地代理转发（智谱 / DeepSeek，推荐国内）</b><br><span class="muted">先双击「启动AI代理.bat」保持窗口开着，再在这里填 Key。代理只监听 127.0.0.1:8765，Key 不落盘。</span></span></label>
          <label class="radio"><input type="radio" name="aiMode" value="api" ${st.aiMode === "api" ? "checked" : ""}><span><b>浏览器直连（需端点支持 CORS，如 Gemini / 本地 Ollama）</b><br><span class="muted">若请求被 CORS 拦截，工作台会自动提示改用代理或对话模式。</span></span></label>
        </div></div>
      <div class="card tight"><h3 class="sec-h"><span class="bar"></span>接口参数</h3>
        <div class="formrow"><label>接口地址</label><input id="setEndpoint" value="${esc(st.endpoint)}" placeholder="https://open.bigmodel.cn/api/paas/v4/chat/completions"></div>
        <div class="formrow"><label>模型</label><input id="setModel" value="${esc(st.model)}" placeholder="glm-4-flash"></div>
        <div class="formrow"><label>API Key</label><input id="setKey" type="password" value="${esc(st.apiKey)}" placeholder="留空也能用本地评分 + WorkBuddy 对话"></div>
        <div class="formrow"><label>代理地址</label><input id="setProxy" value="${esc(st.proxy)}"></div>
        <div class="btnrow" style="margin-top:6px">
          <button class="btn gray sm" onclick="MTD.preset('glm')">智谱 GLM-4-Flash（免费）</button>
          <button class="btn gray sm" onclick="MTD.preset('deepseek')">DeepSeek</button>
          <button class="btn gray sm" onclick="MTD.preset('gemini')">Gemini</button>
        </div>
        <div class="muted" style="margin-top:9px">🔑 免费 Key 获取：打开 <a href="https://open.bigmodel.cn/" target="_blank" rel="noopener">open.bigmodel.cn</a> → 注册/登录 → 控制台「API Keys」→ 复制粘贴到上面。GLM-4-Flash 调用不计费。Key 只存在本机浏览器，不会上传到任何第三方。</div>
      </div>
      <div class="btnrow"><button class="btn" onclick="MTD.saveSettings()">💾 保存设置</button><button class="btn sec" onclick="MTD.testAI()">🔌 测试连接</button><button class="btn gray" onclick="MTD.closeAll()">取消</button></div>
      <div id="testOut" class="muted" style="margin-top:10px"></div>`);
  }
  function preset(k) {
    const p = {
      glm: ["https://open.bigmodel.cn/api/paas/v4/chat/completions", "glm-4-flash", "proxy"],
      deepseek: ["https://api.deepseek.com/v1/chat/completions", "deepseek-chat", "proxy"],
      gemini: ["https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-2.0-flash", "api"]
    }[k];
    if (!p) return;
    $("setEndpoint").value = p[0]; $("setModel").value = p[1];
    document.querySelector(`input[name="aiMode"][value="${p[2]}"]`).checked = true;
    toast("已填入预设，记得保存");
  }
  function saveSettings() {
    const st = S.settings;
    st.aiMode = (document.querySelector('input[name="aiMode"]:checked') || {}).value || "chat";
    st.endpoint = $("setEndpoint").value.trim();
    st.model = $("setModel").value.trim() || "glm-4-flash";
    st.apiKey = $("setKey").value.trim();
    st.proxy = $("setProxy").value.trim() || "http://127.0.0.1:8765/chat";
    save(); toast("设置已保存");
  }
  async function testAI() {
    saveSettings();
    const out = $("testOut"); out.textContent = "🔌 正在测试…";
    try {
      const txt = await callAI([{ role: "user", content: "请只回复四个字：连接成功" }]);
      out.innerHTML = `<span style="color:#1e9e48">✅ 连接成功，模型回复：${esc(txt.slice(0, 80))}</span>`;
    } catch (e) {
      out.innerHTML = `<span style="color:var(--red)">❌ 测试失败：${esc(e.message)}</span><br>建议：① 检查是否双击了「启动AI代理.bat」且窗口还开着；② 确认 Key 正确；③ 或切回「WorkBuddy 对话」通道（零配置）。`;
    }
  }

  /* ---------- 帮助 ---------- */
  function openHelp() {
    openModal(`<div class="mh"><h3>❓ 使用说明</h3><button onclick="MTD.closeAll()">×</button></div>
      <div class="help">
      <h4>🚀 六步上手</h4>
      <ol>
        <li>左侧点任意一关（<b>12 关全部解锁</b>，跳着看也行）；顶部切「🎸 吉他 / 🎹 钢琴」轨道，两套讲解与成绩独立。</li>
        <li>「📖 详细讲义」看完 6 节知识讲解 + 双轨要点 + 术语 + 误区 + 自测题。</li>
        <li>「🎬 教学视频」直接在工作台内播 B 站课程；内嵌黑屏就点「在新窗口打开」。YouTube 主源给海外网络用。</li>
        <li>「🎯 通关测试」先点「🔊 听标准示范」，照着音符序列练熟，然后上传演奏视频/音频，或点「🎤 直接录音」。</li>
        <li>工作台自动跑五维评分（音准/节奏/完整度/流畅度/表现力），出分数、星级、错误清单、练习处方，成绩自动存档。</li>
        <li>「🤖 AI 助教」把报告发给我（WorkBuddy 对话）或配免费 API 一键拿深度点评；「📊 成绩单」看雷达图、进步曲线、徽章。</li>
      </ol>
      <h4>🤖 AI 打分到底怎么跑的（诚实说明）</h4>
      <p><b>能不买 token 吗？能。</b>工作台是本地网页，静态页面本身不会调 AI。所以「一键自动出分」由<b>浏览器内的音频引擎</b>完成：Web Audio 解码 → 自相关法提取基频 → 分割成音符事件 → DTW 与标准答案对齐（自动允许整体移调/移八度）→ 算出五维分数。这一步<b>零配置、断网可用、不花一分钱</b>。</p>
      <p>免费的文本大模型（智谱/DeepSeek/通义）只能读文字和图片，<b>不能听音频、看视频</b>，所以它们负责的是第二层：把测量出的结构化数据 + 本关知识点，翻译成「你哪里错、为什么错、下次 10 分钟怎么练」的教练式点评。<b>Yousician 那种逐音毫秒级实时打分</b>需要专门的音频算法服务（参考 GitHub 上 MusicMash 的 pYIN + DTW），对零基础阶段不是必需。</p>
      <p>三条 AI 通道：① <b>WorkBuddy 对话</b>（默认，复制报告粘贴到本对话，我直接点评，零成本）；② <b>本地代理</b>（智谱 GLM-4-Flash 永久免费，需双击「启动AI代理.bat」）；③ <b>浏览器直连</b>（Gemini 等支持 CORS 的端点）。任何一条失败都不影响本地评分与成绩存档。</p>
      <h4>📁 文件说明</h4>
      <ul>
        <li><b>乐理通关工作台.html</b> 或 <b>index.html</b>：双击打开就能用（本文件夹里三个 js 要跟它在同一目录）。</li>
        <li><b>启动AI代理.bat</b>：只在你想用「页面内一键 AI 点评」时双击，保持黑窗口开着；不用 AI 点评就完全不用管它。</li>
        <li><b>ai_proxy.py</b>：代理本体，Python 标准库写的，无需 pip 安装任何东西。</li>
      </ul>
      <h4>❓ 常见问题</h4>
      <ul>
        <li><b>视频内嵌黑屏？</b>点「↗ 在新窗口打开」跳原站，内容一样。本地 file:// 打开时个别浏览器会拦 iframe。</li>
        <li><b>评分说没检测到音？</b>确认录音里只有你的乐器、没有原曲伴奏；用 mp3/wav 或「直接录音」；尽量弹单音旋律（和弦会干扰基频检测）。</li>
        <li><b>我弹的是别的调 / 低八度？</b>没问题，引擎会自动搜索 ±12 半音的整体移调并对齐。</li>
        <li><b>和弦按得干不干净能量出来吗？</b>不能，这部分请录视频 + 在 AI 助教里补充说明，我结合画面点评。工作台已在报告里标注这一限制。</li>
        <li><b>麦克风弹授权失败？</b>用 Chrome / Edge 打开，地址栏点允许；或直接用上传文件方式。</li>
        <li><b>换电脑成绩会没吗？</b>会（存在本机浏览器）。「📊 成绩单 → 导出成绩备份」保存 JSON，新电脑导入即可。</li>
      </ul>
      <h4>📚 课程与资源来源</h4>
      <p class="muted">${C.meta.sources.map(x => "· " + esc(x)).join("<br>")}</p>
      <p class="muted">教学视频版权归原作者所有，本工作台仅做公开链接聚合与内嵌播放，不下载、不转载、不商用。</p>
      </div>`);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    touchDay();
    buildPiano(); buildFretboard(); renderEarOpts(); initBeatDots();
    $("metroBeats").addEventListener("change", initBeatDots);
    $("earMode").addEventListener("change", () => { earCur = null; renderEarOpts(); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeAll();
      const map = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72 };
      if (!$("toolsDrawer").classList.contains("show")) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = (e.key || "").toLowerCase();
      if (map[k] != null) { E.playNote(map[k], 0.4); const el = document.querySelector(`#piano [data-m="${map[k]}"]`); if (el) { el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 150); } }
    });
    renderAll();
    setTimeout(() => toast("🎸 欢迎回来！12 关全部已解锁，点左侧任意一关开始"), 700);
  }
  /* ---------- 对外接口 ---------- */
  window.MTD = {
    go(id) { S.current = id; S.tab = "theory"; save(); renderAll(); },
    setTab(t) { S.tab = t; save(); renderTabs(); renderPanel(); },
    setInstrument(i) { S.instrument = i; save(); renderHero(); renderPanel(); },
    selectVideo, selectYT, openVideoNew, playDemo, stopDemo,
    onFile, onDrop, reAnalyse, saveNote, buildPrompt, copyPrompt, copyReport, quickAsk, aiReview,
    closeAll, openTools, openReport, openSettings, openHelp,
    pianoHit, fretHit, earPlay, earAnswer,
    toggleMetro, metroTap, toggleTuner, toggleRecord,
    exportData, importData, clearData, preset, saveSettings, testAI
  };
  init();
})();
