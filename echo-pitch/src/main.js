import './style.css';

// ══════════════════════════════════════════
// Project ECHO — Pitch Landing Page
// ══════════════════════════════════════════

document.getElementById('app').innerHTML = `
<!-- ── Navbar ── -->
<nav class="navbar" id="navbar">
  <div class="container">
    <a href="#" class="nav-brand">★ PROJECT ECHO</a>
    <ul class="nav-links">
      <li><a href="#problem">문제</a></li>
      <li><a href="#simulation">시뮬레이션</a></li>
      <li><a href="#how">작동 원리</a></li>
      <li><a href="#device">디바이스</a></li>
      <li><a href="#roadmap">로드맵</a></li>
    </ul>
  </div>
</nav>

<!-- ── Hero ── -->
<section class="hero" id="hero">
  <div class="container">
    <div class="hero-grid">
      <div class="hero-content fade-up">
        <div class="hero-badge">
          <span class="dot"></span>
          EVEN G2 + GEMINI AI
        </div>
        <h1>
          <span class="gradient-text">3초의 뇌 정지</span>를<br>
          물리적으로<br>파괴합니다
        </h1>
        <p class="hero-desc">
          AR 스마트 글래스에 장착하는 실시간 스텔스 튜터.<br>
          침묵을 감지하고, 1초 만에 첫 세 단어를 띄워<br>
          번역 버퍼링 없이 반사적으로 입을 열게 만듭니다.
        </p>
        <div class="hero-actions">
          <button class="btn-primary" onclick="document.getElementById('simulation').scrollIntoView({behavior:'smooth'})">
            ▶ 시뮬레이션 보기
          </button>
          <a href="https://github.com" class="btn-outline" target="_blank">
            GitHub 오픈소스
          </a>
        </div>
      </div>
      <div class="hero-visual fade-up" style="transition-delay:.2s">
        <div class="hero-image-wrap">
          <img src="https://cdn.shopify.com/s/files/1/0600/4513/1891/files/even-g2-a-smart-glasses-three-quarter-view-brown.png?v=1772527415" alt="EVEN G2 A 스마트 글래스 — 실제 제품" />
          <div class="hero-image-overlay"></div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── Problem ── -->
<section id="problem">
  <div class="container">
    <div class="section-label fade-up">THE PROBLEM</div>
    <h2 class="section-title fade-up">
      토익 900점이어도<br>
      <span class="gradient-text">입이 안 떨어지는 이유</span>
    </h2>
    <p class="section-desc fade-up">
      영어를 몰라서가 아닙니다. 머릿속에서 '한국어→영어'로 번역하느라 발생하는
      <strong>모국어 개입</strong>, 즉 3초의 뇌 정지 버퍼링이 대화를 끊어버립니다.
    </p>
    <div class="problem-grid">
      <div class="problem-image fade-up">
        <img src="/images/before-after.png" alt="Before vs After 비교" />
      </div>
      <div class="problem-steps fade-up" style="transition-delay:.15s">
        <div class="step">
          <div class="step-num">01</div>
          <div>
            <h4>외국인의 질문</h4>
            <p>"Where can I find good seafood?" — 분명 아는 내용인데...</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">02</div>
          <div>
            <h4>번역 버퍼링 (3초)</h4>
            <p>머릿속에서 한국어 문장을 영어로 완벽하게 번역하려는 습관이 발동합니다.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">03</div>
          <div>
            <h4>대화의 텐션 붕괴</h4>
            <p>3초의 침묵. 상대방의 눈빛이 식어갑니다. 기회는 사라졌습니다.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">★</div>
          <div>
            <h4 style="color:var(--green-primary)">ECHO의 해결책</h4>
            <p>침묵 3초 → 안경에 첫 세 단어 → 번역할 틈 없이 반사적 발화!</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── Live Simulation ── -->
<section id="simulation">
  <div class="container">
    <div class="section-label fade-up">LIVE SIMULATION</div>
    <h2 class="section-title fade-up">
      <span class="gradient-text">남포동 시나리오</span> 체험
    </h2>
    <p class="section-desc fade-up">
      EVEN G2 안경을 쓰고 남포동 비프광장을 걷는 상황을 재현합니다.
      ▶ 버튼을 눌러 시뮬레이션을 시작하세요.
    </p>
    <div class="sim-container fade-up" style="transition-delay:.1s">
      <div class="sim-window">
        <div class="sim-toolbar">
          <span class="sim-dot r"></span>
          <span class="sim-dot y"></span>
          <span class="sim-dot g"></span>
          <span class="sim-toolbar-title">ECHO_SIMULATION.exe — NAMPO-DONG</span>
        </div>
        <div class="sim-body" id="sim-body">
          <!-- Play Overlay -->
          <div class="sim-play-overlay" id="sim-play">
            <div class="sim-play-btn">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="#000">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>
          <!-- Scene -->
          <div class="sim-scene" id="sim-scene" style="background:linear-gradient(135deg,#1a1020,#0d1117 40%,#0a1628)">
            <div class="sim-neon" style="top:8%;left:10%;color:#ff4444;border:1px solid #ff4444;background:rgba(255,50,50,.12)">자갈치</div>
            <div class="sim-neon" style="top:5%;left:42%;color:#ffb400;border:1px solid #ffb400;background:rgba(255,180,0,.1);font-size:18px">남포동 맛집</div>
            <div class="sim-neon" style="top:11%;right:14%;color:#00c8ff;border:1px solid #00c8ff;background:rgba(0,200,255,.1)">SEAFOOD</div>
            <div class="sim-neon" style="top:17%;left:28%;color:#c800ff;border:1px solid #c800ff;background:rgba(200,0,255,.08);font-size:12px">회센터</div>
            <div class="sim-street"></div>
          </div>
          <!-- Tourist -->
          <div class="sim-tourist" id="sim-tourist">
            <div class="sim-tourist-speech" id="sim-speech"></div>
            <div class="sim-tourist-head"></div>
            <div class="sim-tourist-body"></div>
          </div>
          <!-- AR Frame -->
          <div class="sim-ar-frame"></div>
          <!-- HUD -->
          <div class="sim-hud" id="sim-hud">
            <div class="sim-hud-header">★ PROJECT ECHO</div>
            <div class="sim-hud-sep"></div>
            <div class="sim-hud-topic">NAMPO-DONG TOURIST ASSIST</div>
            <div class="sim-hud-chat" id="sim-chat"></div>
            <div class="sim-hud-status" id="sim-status"></div>
          </div>
          <!-- Gauge -->
          <div class="sim-gauge" id="sim-gauge">
            <div class="sim-gauge-bar"><div class="sim-gauge-fill" id="sim-gauge-fill"></div></div>
            <div class="sim-gauge-label" id="sim-gauge-label"></div>
          </div>
          <!-- Phase -->
          <div class="sim-phase" id="sim-phase"></div>
          <!-- Caption -->
          <div class="sim-caption">
            <div class="sim-caption-text" id="sim-caption"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── How It Works ── -->
<section id="how">
  <div class="container">
    <div class="section-label fade-up">HOW IT WORKS</div>
    <h2 class="section-title fade-up">
      <span class="gradient-text">스텔스 튜터</span> 작동 원리
    </h2>
    <p class="section-desc fade-up">
      마이크 → 침묵 감지 → AI 생성 → HUD 표시. 모든 것이 1초 안에 일어납니다.
    </p>
    <div class="how-grid">
      <div class="glass-card how-card fade-up">
        <div class="how-icon">🎙️</div>
        <h3>VAD 침묵 감지</h3>
        <p>G2 안경의 마이크가 실시간으로 음성을 분석합니다. 3초간 침묵이 감지되면 AI에 신호를 보냅니다.</p>
      </div>
      <div class="glass-card how-card fade-up" style="transition-delay:.1s">
        <div class="how-icon">🧠</div>
        <h3>Gemini AI 청크 생성</h3>
        <p>대화 맥락을 파악한 AI가 상황에 맞는 '첫 세 단어 청크'를 0.8초 만에 생성합니다.</p>
      </div>
      <div class="glass-card how-card fade-up" style="transition-delay:.2s">
        <div class="how-icon">👓</div>
        <h3>HUD 스텔스 표시</h3>
        <p>안경 시야 정중앙에 반투명 텍스트가 뜹니다. 상대방은 모르고, 당신만 볼 수 있습니다.</p>
      </div>
    </div>
  </div>
</section>

<!-- ── Device ── -->
<section id="device">
  <div class="container">
    <div class="section-label fade-up">THE DEVICE</div>
    <h2 class="section-title fade-up">
      <span class="gradient-text">EVEN G2</span> 스마트 글래스
    </h2>
    <p class="section-desc fade-up">
      36g 초경량 티타늄 합금 프레임. 일반 안경과 구별 불가능한 디자인 속에
      3D 헤드업 디스플레이와 마이크가 내장되어 있습니다.
    </p>
    <div class="device-showcase fade-up" style="transition-delay:.1s">
      <div class="device-grid">
        <div class="device-card">
          <div class="device-image-wrap">
            <img src="https://cdn.shopify.com/s/files/1/0600/4513/1891/files/even-g2-a-smart-glasses-three-quarter-view-brown.png?v=1772527415" alt="EVEN G2 A — Crown Panto" />
          </div>
          <h4>EVEN G2 A</h4>
          <p>Crown Panto — 클래식한 라운드 디자인</p>
        </div>
        <div class="device-card">
          <div class="device-image-wrap">
            <img src="https://cdn.shopify.com/s/files/1/0600/4513/1891/files/even-g2-b-smart-glasses-three-quarter-view-green.png?v=1762523502" alt="EVEN G2 B — Rectangular" />
          </div>
          <h4>EVEN G2 B</h4>
          <p>Rectangular — 모던한 사각 디자인</p>
        </div>
      </div>
      <div class="device-specs">
        <div class="spec-item">
          <div class="spec-value">36g</div>
          <div class="spec-label">초경량</div>
        </div>
        <div class="spec-item">
          <div class="spec-value">576×288</div>
          <div class="spec-label">HUD 해상도</div>
        </div>
        <div class="spec-item">
          <div class="spec-value">4-bit</div>
          <div class="spec-label">그레이스케일</div>
        </div>
        <div class="spec-item">
          <div class="spec-value">BLE+WiFi</div>
          <div class="spec-label">TriSync</div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── Roadmap ── -->
<section id="roadmap">
  <div class="container">
    <div class="section-label fade-up">ROADMAP</div>
    <h2 class="section-title fade-up">
      <span class="gradient-text">향후 일정</span>
    </h2>
    <div class="roadmap">
      <div class="roadmap-item fade-up">
        <div class="roadmap-dot">1</div>
        <div class="roadmap-content">
          <div class="month">1개월 차</div>
          <h4>남포동 필드 테스트 & 수요 검증</h4>
          <p>핵심 기능만 최소 구현 → 남포동 외국인 실전 대화 POV 데모 영상 촬영 → 숏폼 미디어 배포 → 얼리액세스 대기자 이메일 1,000개 확보</p>
        </div>
      </div>
      <div class="roadmap-item fade-up" style="transition-delay:.1s">
        <div class="roadmap-dot">2</div>
        <div class="roadmap-content">
          <div class="month">2개월 차</div>
          <h4>코어 엔진 완성 & 오픈소스 배포</h4>
          <p>G2 안경 마이크 연동 + 침묵 감지 + Gemini API 결합 완료 → GitHub 오픈소스 공개 → 글로벌 개발자 커뮤니티 기여 유도</p>
        </div>
      </div>
      <div class="roadmap-item fade-up" style="transition-delay:.2s">
        <div class="roadmap-dot">3</div>
        <div class="roadmap-content">
          <div class="month">3개월 차</div>
          <h4>$0.99 데이터셋 판매 수익화</h4>
          <p>시스템은 무료, 실전 데이터셋을 판매 — 남포동 상인 응대 팩, 해외여행 위기탈출 팩, 실리콘밸리 면접 팩 등 $0.99 상황별 작전 팩</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── CTA ── -->
<section class="cta-section">
  <div class="container">
    <h2 class="fade-up"><span class="gradient-text">공부가 아닌, 장착</span></h2>
    <p class="fade-up">
      긴 시간을 들여 영어를 '공부'하는 대신, 상황에 맞는 대본을 안경에 '장착'하세요.
      누구나 즉시 언어의 마술사가 됩니다.
    </p>
    <div class="fade-up" style="transition-delay:.1s">
      <button class="btn-primary" onclick="document.getElementById('simulation').scrollIntoView({behavior:'smooth'})">
        ▶ 시뮬레이션 다시 보기
      </button>
    </div>
  </div>
</section>

<!-- ── Footer ── -->
<footer class="footer">
  <div class="container">
    <div class="footer-brand">★ PROJECT ECHO</div>
    <p>Glanceable Fluency Coach - EVEN G2 x Gemini AI x Open Source</p>
    <p style="margin-top:4px">© 2026 CHEATKEY. All rights reserved.</p>
  </div>
</footer>
`;

// ══════════════════════════════════════════
// Scroll Animation Observer
// ══════════════════════════════════════════
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);
document.querySelectorAll('.fade-up').forEach((el) => observer.observe(el));

// ══════════════════════════════════════════
// Simulation Engine
// ══════════════════════════════════════════
const simEl = {
  play: document.getElementById('sim-play'),
  tourist: document.getElementById('sim-tourist'),
  speech: document.getElementById('sim-speech'),
  hud: document.getElementById('sim-hud'),
  chat: document.getElementById('sim-chat'),
  status: document.getElementById('sim-status'),
  gauge: document.getElementById('sim-gauge'),
  gaugeFill: document.getElementById('sim-gauge-fill'),
  gaugeLabel: document.getElementById('sim-gauge-label'),
  phase: document.getElementById('sim-phase'),
  caption: document.getElementById('sim-caption'),
};

let simRunning = false;
let gaugeAnim = null;

function simCaption(text) {
  simEl.caption.style.opacity = '0';
  setTimeout(() => {
    simEl.caption.textContent = text;
    if (text) simEl.caption.style.opacity = '1';
  }, 250);
}

function simAddChat(type, text) {
  const div = document.createElement('div');
  div.className = `sim-chat-line ${type}`;
  div.textContent = text;
  simEl.chat.appendChild(div);
  while (simEl.chat.children.length > 6) simEl.chat.removeChild(simEl.chat.firstChild);
  requestAnimationFrame(() => div.classList.add('visible'));
}

function startGauge(duration) {
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const pct = Math.min(100, (elapsed / duration) * 100);
    simEl.gaugeFill.style.width = pct + '%';
    simEl.gaugeLabel.textContent = `SILENCE: ${(elapsed / 1000).toFixed(1)}s / ${(duration / 1000).toFixed(1)}s`;
    if (elapsed < duration) gaugeAnim = requestAnimationFrame(tick);
  }
  gaugeAnim = requestAnimationFrame(tick);
}

function resetSim() {
  simEl.tourist.style.opacity = '0';
  simEl.speech.style.opacity = '0';
  simEl.speech.textContent = '';
  simEl.hud.style.opacity = '0';
  simEl.chat.innerHTML = '';
  simEl.status.textContent = '';
  simEl.gauge.style.opacity = '0';
  simEl.gaugeFill.style.width = '0%';
  simEl.phase.style.opacity = '0';
  simEl.phase.textContent = '';
  simEl.caption.style.opacity = '0';
  if (gaugeAnim) cancelAnimationFrame(gaugeAnim);
}

const TIMELINE = [
  { t: 0, fn() { simEl.phase.style.opacity = '1'; simEl.phase.textContent = 'SCENE: 남포동 비프광장'; } },
  { t: 500, fn() { simCaption('부산 남포동. 당신은 EVEN G2 안경을 쓰고 길을 걷고 있습니다.'); } },
  { t: 3000, fn() { simEl.tourist.style.opacity = '1'; } },
  { t: 3500, fn() { simCaption('외국인 관광객이 다가와 질문합니다.'); } },
  { t: 5000, fn() {
    simEl.speech.textContent = 'Excuse me! Where can I find good seafood?';
    simEl.speech.style.opacity = '1';
    simCaption('');
  }},
  { t: 6000, fn() { simEl.phase.textContent = 'SITUATION: 외국인 질문 감지'; } },
  { t: 8000, fn() {
    simEl.phase.textContent = 'NEED A CUE?';
    simCaption('머릿속에 답은 있지만... 입이 떨어지지 않습니다.');
    simEl.gauge.style.opacity = '1';
    startGauge(3000);
  }},
  { t: 11000, fn() {
    simEl.gauge.style.opacity = '0';
    simEl.hud.style.opacity = '1';
    simEl.phase.textContent = 'CUE READY';
    simCaption('');
  }},
  { t: 11500, fn() { simAddChat('system', 'Pause reached 3s'); } },
  { t: 12200, fn() { simAddChat('system', 'Preparing a context cue...'); } },
  { t: 13000, fn() {
    simAddChat('hint', '▶ Actually, you should try...');
    simEl.status.textContent = 'Cue ready - latency: 0.8s';
    simCaption('안경에 첫 세 단어가 뜹니다. 반사적으로 입을 엽니다!');
  }},
  { t: 16000, fn() {
    simEl.phase.textContent = '● SPEAKING — FLUENT';
    simAddChat('transcript', 'You: Actually, you should try the back alleys of Jagalchi Market!');
    simEl.status.textContent = '▁▂▃▅▆█▇▆ SPEAKING';
  }},
  { t: 18000, fn() {
    simAddChat('transcript', 'You: They have the freshest sashimi — locals go there every morning.');
    simCaption('유창하게 대화를 이어갑니다. 눈 맞춤을 유지한 채로.');
  }},
  { t: 20500, fn() {
    simAddChat('system', 'Nice recovery');
    simEl.status.textContent = 'Nice recovery';
  }},
  { t: 22000, fn() {
    simEl.speech.textContent = 'Wow, that sounds amazing! Thank you!';
    simCaption('관광객이 감탄합니다. 자신감이 장착된 순간.');
  }},
  { t: 25000, fn() {
    simEl.hud.style.opacity = '0';
    simEl.tourist.style.opacity = '0';
    simEl.phase.textContent = 'ECHO SESSION COMPLETE';
    simCaption('');
  }},
  { t: 27000, fn() {
    simEl.phase.textContent = '';
    simCaption('시뮬레이션 완료. ▶ 버튼을 눌러 다시 체험하세요.');
    simEl.play.style.opacity = '1';
    simEl.play.style.pointerEvents = 'auto';
    simRunning = false;
  }},
];

simEl.play.addEventListener('click', () => {
  if (simRunning) return;
  simRunning = true;
  resetSim();
  simEl.play.style.opacity = '0';
  simEl.play.style.pointerEvents = 'none';
  TIMELINE.forEach((step) => setTimeout(step.fn, step.t + 500));
});

// ── Navbar scroll effect ──
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  const st = window.scrollY;
  if (st > 100) {
    navbar.style.background = 'rgba(6, 8, 13, 0.95)';
  } else {
    navbar.style.background = 'rgba(6, 8, 13, 0.8)';
  }
  lastScroll = st;
});
