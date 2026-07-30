import { loadEras } from '../data/loader.js';

/* 타임라인 — 46억 년을 세로 스크롤로 훑습니다.
 *
 * 핵심 설계: 각 대(代)의 세로 길이를 eras.json 의 sharePercent 에 정비례시킵니다.
 * 선캄브리아시대가 88.2% 이므로 스크롤의 88.2% 를 그 시대가 차지합니다.
 * "길다"고 읽는 게 아니라 엄지로 직접 겪게 하는 것이 이 화면의 목적입니다.
 *
 * 길이가 duration 에 정비례하므로 현재 연대는 한 줄로 계산됩니다.
 *   ma = 4567 × (1 − 스크롤진행률)
 */

const ERA_ORDER = ['precambrian', 'paleozoic', 'mesozoic', 'cenozoic'];

export default async function timeline(outlet) {
  const eras = await loadEras();
  const earthAge = eras.earthAgeMa;
  const series = ERA_ORDER.map((id) => eras.series.find((s) => s.id === id)).filter(Boolean);

  outlet.innerHTML = `
    <div class="tl">
      <aside class="tl__rail" aria-hidden="true">
        ${series
          .map((s) => `<i class="tl__seg" data-era="${s.id}" style="flex:${s.sharePercent}"></i>`)
          .join('')}
        <span class="tl__marker" id="tl-marker"></span>
      </aside>

      <div class="tl__meter" role="status" aria-live="off">
        <b class="tl__ma mono" id="tl-ma">${fmtAgo(earthAge)}</b>
        <span class="tl__now" id="tl-now">선캄브리아시대</span>
      </div>

      <button class="tl__skip" id="tl-skip" type="button" hidden>고생대로 건너뛰기 ↓</button>

      <div class="tl__flow" id="tl-flow">
        <section class="tl__intro">
          <div class="tl__card">
            <p class="tl__eyebrow mono">지구의 나이 ${fmtDuration(earthAge)}</p>
            <h1 class="tl__introtitle">아래로 내려가 보세요.</h1>
            <p class="tl__lead">
              화면을 끝까지 내리면 지구의 처음부터 지금까지를 지나게 됩니다.
              내려가는 데 걸리는 시간이 그 시대의 길이입니다.
            </p>
            <p class="tl__hint">↓</p>
          </div>
        </section>

        ${series.map(eraSection).join('')}
      </div>

      <section class="tl__outro">
        <div class="tl__card">
          <h2 class="tl__eratitle">여기까지가 46억 년입니다.</h2>
          <p class="tl__lead">
            방금 지나온 길의 대부분은 선캄브리아시대였습니다.
            화석이 풍부한 고생대·중생대·신생대를 모두 합쳐도 전체의 약 12%뿐입니다.
          </p>
          <button class="btn btn--ghost" type="button" disabled>
            다음 — 데이터 탐구 (준비 중)
          </button>
        </div>
      </section>
    </div>
  `;

  /* ── 스크롤 → 연대 계산 ─────────────────────────────────── */
  const flow = outlet.querySelector('#tl-flow');
  const elMa = outlet.querySelector('#tl-ma');
  const elNow = outlet.querySelector('#tl-now');
  const elMarker = outlet.querySelector('#tl-marker');
  const elSkip = outlet.querySelector('#tl-skip');

  let ticking = false;
  let lastEraId = null;

  function measure() {
    const rect = flow.getBoundingClientRect();
    const total = flow.offsetHeight - window.innerHeight;
    const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    const p = total > 0 ? scrolled / total : 0;
    const ma = earthAge * (1 - p);

    elMa.textContent = fmtAgo(ma);
    elMarker.style.top = `${(p * 100).toFixed(3)}%`;

    const era = series.find((s) => ma <= s.startMa && ma > s.endMa) ?? series[series.length - 1];
    if (era.id !== lastEraId) {
      lastEraId = era.id;
      elNow.textContent = era.nameKo;
      document.documentElement.style.setProperty('--tl-active', `var(--era-${era.id})`);
    }

    // 선캄브리아시대를 지나는 동안에만 탈출구를 띄웁니다.
    elSkip.hidden = !(era.id === 'precambrian' && p > 0.02);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      measure();
      ticking = false;
    });
  }

  function onSkip() {
    outlet.querySelector('#era-paleozoic')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  elSkip.addEventListener('click', onSkip);
  measure();

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    elSkip.removeEventListener('click', onSkip);
    document.documentElement.style.removeProperty('--tl-active');
  };
}

/* ── 대(代) 한 칸 ────────────────────────────────────────── */
function eraSection(s) {
  return `
    <section class="tl__era" id="era-${s.id}" data-era="${s.id}" style="--share:${s.sharePercent}">
      <header class="tl__pin">
        <span class="tl__pinname">${esc(s.nameKo)}</span>
        <span class="tl__pinshare mono">${s.sharePercent}%</span>
      </header>

      <div class="tl__card">
        <p class="tl__eyebrow mono">전체의 ${s.sharePercent}% · ${fmtDuration(s.durationMa)}</p>
        <h2 class="tl__eratitle">${esc(s.nameKo)}</h2>
        <p class="tl__lead">${esc(s.headline)}</p>

        <h3 class="tl__h3">환경</h3>
        <p>${esc(s.environment)}</p>

        <h3 class="tl__h3">생물</h3>
        <p>${esc(s.lifeSummary)}</p>

        ${
          s.keyEvents?.length
            ? `<h3 class="tl__h3">주요 사건</h3>
               <ul class="tl__events">${s.keyEvents.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
            : ''
        }

        ${
          s.representativeLife?.length
            ? `<h3 class="tl__h3">이 시대에 살았던 생물</h3>
               <ul class="tl__life">${s.representativeLife
                 .map((l) => `<li>${esc(l)}</li>`)
                 .join('')}</ul>
               <p class="tl__caption">교과서에 나온 예시입니다. 이름을 외울 필요는 없습니다.</p>`
            : ''
        }

        ${
          s.misconceptionNote
            ? `<aside class="tl__note"><b>헷갈리기 쉬운 점</b><p>${esc(s.misconceptionNote)}</p></aside>`
            : ''
        }

        ${
          s.glossary
            ? `<dl class="tl__glossary">${Object.entries(s.glossary)
                .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
                .join('')}</dl>`
            : ''
        }
      </div>

      <div class="tl__span" aria-hidden="true"></div>
    </section>
  `;
}

/* ── 숫자 표기 ──────────────────────────────────────────── */

/** 기간: 4028 → "약 40억 2,800만 년" */
function fmtDuration(ma) {
  const man = Math.round(ma * 100); // 1 Ma = 100만 년
  const eok = Math.floor(man / 10000);
  const rest = Math.round((man % 10000) / 100) * 100;
  if (eok === 0) return `약 ${man.toLocaleString('ko-KR')}만 년`;
  if (rest === 0) return `약 ${eok}억 년`;
  return `약 ${eok}억 ${rest.toLocaleString('ko-KR')}만 년`;
}

/** 현재 연대: 4567 → "45.7억 년 전" (한눈에 읽히도록 짧게) */
function fmtAgo(ma) {
  if (ma < 1) return '현재';
  if (ma < 100) return `${Math.round(ma * 100).toLocaleString('ko-KR')}만 년 전`;
  return `${(ma / 100).toFixed(1)}억 년 전`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
