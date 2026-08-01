import { loadEras } from '../data/loader.js';

/* 시대별 그림은 data-raw/eras-source.png 에서 잘라낸 것입니다.
   npm run images 로 만들어지며 목록은 era-images.json 에 있습니다. */
async function loadEraImages() {
  try {
    const res = await fetch('/data/era-images.json');
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()).eras || {};
  } catch (e) {
    console.warn('[timeline] 시대 그림을 불러오지 못했습니다. 글자만 표시합니다:', e.message);
    return {};
  }
}

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
  const [eras, images] = await Promise.all([loadEras(), loadEraImages()]);
  const earthAge = eras.earthAgeMa;
  const series = ERA_ORDER.map((id) => eras.series.find((s) => s.id === id)).filter(Boolean);

  outlet.innerHTML = `
    <div class="tl">
      <!-- 화면에 고정된 배경 한 장. 시대가 바뀔 때 두 겹이 서로 교차하며 넘어갑니다.
           구간마다 sticky 로 붙이면 긴 구간에서 끊기거나 겹칠 수 있어
           고정 한 장을 자바스크립트로 바꾸는 쪽이 확실합니다. -->
      <div class="tl__stage" aria-hidden="true">
        <i class="tl__layer tl__layer--on" id="tl-layerA"></i>
        <i class="tl__layer" id="tl-layerB"></i>
      </div>

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

        ${series.map((s) => eraSection(s, images[s.id])).join('')}
      </div>

      <section class="tl__outro">
        <div class="tl__card">
          <h2 class="tl__eratitle">여기까지가 46억 년입니다.</h2>
          <p class="tl__lead">
            방금 지나온 길의 대부분은 선캄브리아시대였습니다.
            화석이 풍부한 고생대·중생대·신생대를 모두 합쳐도 전체의 약 12%뿐입니다.
          </p>
          <a class="btn" href="#/explore">다음 — 데이터 탐구</a>
        </div>
      </section>
    </div>
  `;

  /* ── 스크롤 → 연대 계산 ───────────────────────────────────
     전체 스크롤 진행률에서 연대를 역산하지 않습니다.
     그 방식은 "구간 높이 ∝ 기간"이 정확히 성립해야만 맞는데,
     카드 내용이 min-height 를 넘으면(신생대는 25vh 배정에 내용이 90vh)
     비례가 깨져서 화면에 보이는 시대와 표시가 어긋납니다.
     지금 화면 한가운데에 걸린 구간을 찾아 그 안에서 연대를 구합니다. */
  const sectionOf = {};
  for (const s of series) sectionOf[s.id] = outlet.querySelector(`#era-${s.id}`);

  // 레일 눈금은 시간 비율이므로 sharePercent 누적으로 계산합니다.
  const cumBefore = {};
  let acc = 0;
  for (const s of series) {
    cumBefore[s.id] = acc;
    acc += s.sharePercent;
  }

  const elMa = outlet.querySelector('#tl-ma');
  const elNow = outlet.querySelector('#tl-now');
  const elMarker = outlet.querySelector('#tl-marker');
  const elSkip = outlet.querySelector('#tl-skip');

  let ticking = false;
  let lastEraId = null;

  /* 배경 교차 전환.
     두 겹을 번갈아 쓰면서 하나는 사라지고 하나는 나타나게 합니다.
     같은 겹에서 그림만 바꾸면 순간 깜빡입니다. */
  const layers = [outlet.querySelector('#tl-layerA'), outlet.querySelector('#tl-layerB')];
  let front = 0;

  function setStage(url) {
    if (!url) return;
    const back = 1 - front;
    layers[back].style.backgroundImage = `url('${url}')`;
    layers[back].classList.add('tl__layer--on');
    layers[front].classList.remove('tl__layer--on');
    front = back;
  }

  /* 미리 받아 둡니다. 시대가 바뀌는 순간 빈 화면이 스치지 않게. */
  for (const s of series) {
    const src = images[s.id]?.scene;
    if (src) new Image().src = src;
  }

  function measure() {
    // 화면 한가운데를 기준선으로 삼습니다.
    const probe = window.innerHeight * 0.5;

    let era = series[0];
    let within = 0; // 그 구간을 얼마나 지났는지 0~1

    for (const s of series) {
      const r = sectionOf[s.id].getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) {
        era = s;
        within = Math.min(Math.max((probe - r.top) / r.height, 0), 1);
        break;
      }
      // 기준선이 이 구간보다 아래에 있으면 계속 다음 구간으로
      if (r.bottom <= probe) {
        era = s;
        within = 1;
      }
    }

    // 연대는 그 구간의 시작~끝을 구간 안 진행률로 나눕니다. 항상 정확합니다.
    const ma = era.startMa + (era.endMa - era.startMa) * within;
    elMa.textContent = fmtAgo(ma);

    // 레일 위치는 시간 비율(sharePercent 누적)로 잡습니다.
    const railP = (cumBefore[era.id] + era.sharePercent * within) / 100;
    elMarker.style.top = `${(railP * 100).toFixed(3)}%`;

    if (era.id !== lastEraId) {
      lastEraId = era.id;
      elNow.textContent = era.nameKo;
      document.documentElement.style.setProperty('--tl-active', `var(--era-${era.id})`);
      setStage(images[era.id]?.scene);
    }

    // 선캄브리아시대를 지나는 동안에만 탈출구를 띄웁니다.
    elSkip.hidden = !(era.id === 'precambrian' && within > 0.01);
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

/* ── 대(代) 한 칸 ──────────────────────────────────────────
   내용을 한 덩어리로 두지 않고 주제별 카드로 나눕니다.
   환경 → 생물 → 주요 사건 → 대표 표준화석 순서로, 한 장에 한 가지만.
   스크롤로 시간을 겪는 화면이라 세로로 쌓는 편이 맞습니다.
   가로로 넘기게 하면 뒤 카드를 못 보고 지나치는 학생이 생깁니다. */
function eraSection(s, img) {
  /* 그림에 딸린 질문이 있으면(중생대) 오개념 안내를 그냥 보여주지 않고
     먼저 묻고 나중에 답을 여는 형태로 바꿉니다. 답 문장은 eras.json 의
     misconceptionNote 를 그대로 씁니다 — 같은 내용을 두 곳에 적지 않습니다. */
  const q = img?.sceneQuestion;

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

        ${
          img?.scene
            ? `<figure class="tl__scene">
                 <img src="${img.scene}" alt="${esc(img.sceneAlt || s.nameKo + ' 상상도')}" loading="lazy" />
               </figure>`
            : ''
        }

        ${
          q
            ? `<aside class="tl__ask">
                 <b>${esc(q.ask)}</b>
                 <p>${esc(q.hint)}</p>
                 <details>
                   <summary>확인하기</summary>
                   <p>${esc(s.misconceptionNote || '')}</p>
                 </details>
               </aside>`
            : ''
        }

        ${
          s.misconceptionNote && !q
            ? `<aside class="tl__note"><b>헷갈리기 쉬운 점</b><p>${esc(s.misconceptionNote)}</p></aside>`
            : ''
        }
      </div>

      ${topicCards(s, img)}

      <div class="tl__span" aria-hidden="true"></div>
    </section>
  `;
}

/* 주제 카드 — 한 장에 한 가지.
 *
 * 순서: 환경 · 주요 사건  /  생물 · 표준화석
 * 넓은 화면에서는 두 칸씩 나란히 놓여 위 두 장이 "무대", 아래 두 장이
 * "그 무대에 살던 것"으로 읽힙니다.
 * 좁은 화면(학생 스마트폰)에서는 한 줄로 내려오는데, 그때도 이 순서가
 * 자연스럽게 이어집니다.
 */
function topicCards(s, img) {
  const cards = [];

  cards.push({
    key: 'env',
    label: '환경',
    body:
      points(s.environmentPoints, s.environment) +
      (s.glossary
        ? `<dl class="tl__glossary">${Object.entries(s.glossary)
            .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
            .join('')}</dl>`
        : ''),
  });

  if (s.keyEvents?.length) {
    cards.push({
      key: 'events',
      label: '주요 사건',
      body: `<ul class="tl__events">${s.keyEvents.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`,
    });
  }

  cards.push({
    key: 'life',
    label: '이 시대에 살았던 생물',
    body:
      points(s.lifePoints, s.lifeSummary) +
      (s.representativeLife?.length
        ? `<ul class="tl__life">${s.representativeLife
            .map((l) => `<li>${esc(l)}</li>`)
            .join('')}</ul>`
        : ''),
  });

  if (img?.fossils?.length) {
    cards.push({
      key: 'fossil',
      label: '이 시대의 대표 표준화석',
      body: `<ul class="tl__fossils">${img.fossils
        .map(
          (f) => `<li>
            <img src="${f.src}" alt="${esc(f.label)} 화석 사진" loading="lazy" />
            <span>${esc(f.label)}</span>
          </li>`
        )
        .join('')}</ul>`,
    });
  }

  return `<div class="tl__grid">${cards
    .map(
      (c, i) => `
      <article class="tl__topic" data-topic="${c.key}">
        <header class="tl__topicHead">
          <h3 class="tl__topicLabel">${c.label}</h3>
          <span class="tl__topicNo mono">${i + 1} / ${cards.length}</span>
        </header>
        ${c.body}
      </article>`
    )
    .join('')}</div>`;
}

/* 요점 목록 + 교과서 원문.
 * 화면에는 짧은 요점만 보여 줍니다. 줄글은 스마트폰에서 읽히지 않습니다.
 * 다만 교과서 문장 자체가 근거 자료라, 접어 두고 필요할 때 펼치게 합니다. */
function points(list, full) {
  if (!list?.length) return `<p class="tl__body">${esc(full ?? '')}</p>`;
  return (
    `<ul class="tl__points">${list.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` +
    (full
      ? `<details class="tl__full">
           <summary>교과서 문장으로 보기</summary>
           <p>${esc(full)}</p>
         </details>`
      : '')
  );
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
