import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  Filler,
} from 'chart.js';
import { emit, on } from '../store.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, LogarithmicScale, Filler);

/* 다양성 · 기온 · CO2 세 차트를 세로로 쌓고 시간축을 공유합니다.
 *
 * 이 파일에서 신경 쓴 두 가지
 *
 * 1) 세 차트의 x축을 픽셀 단위까지 맞추기
 *    y축 라벨 길이가 서로 달라서("929" vs "3,000") 그냥 두면 그래프 영역의
 *    좌우 끝이 어긋납니다. 그러면 "같은 시각을 세로로 읽는다"는 이 화면의
 *    전제가 무너집니다. afterFit 으로 y축 폭을 상수로 못박아 해결합니다.
 *
 * 2) 크로스헤어를 캔버스에 그리지 않기
 *    손가락을 움직일 때마다 세 캔버스를 다시 그리면 스마트폰에서 끊깁니다.
 *    대신 차트 위에 얇은 <i> 를 띄워 두고 transform 만 바꿉니다.
 *    캔버스는 건드리지 않으므로 사실상 공짜입니다.
 */

const X_MIN = 0;
const X_MAX = 540;        // 현생누대 전체 (다양성 데이터 범위에 맞춤)
const Y_AXIS_W = 48;      // 세 차트 공통 y축 폭 — 이 값이 정렬의 핵심입니다
const HEAT_H = 24;        // 다양성 차트 아래에 비워 둘 히트맵 띠 높이(px)
const MARK_W = 6;         // 표시 하나의 최소 가로 폭(px). 자료 구간이 98개라
                          // 그냥 두면 막대가 5px 남짓이라 교실 뒤에서 안 보입니다.

const css = (name, fallback = '#888') =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const alpha = (hex, a) => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/* ── 학급 히트맵 + 내 표시를 다양성 차트 바닥에 그리는 플러그인 ────
   학생 탭이 들어올 때만 다시 그리므로 성능 부담이 없습니다.        */
const heatmapPlugin = {
  id: 'heatmap',
  afterDatasetsDraw(chart) {
    const bins = chart.$bins;
    if (!bins) return;

    const counts = chart.$classCounts || {};
    const mine = chart.$myMarks || new Set();
    const { ctx, chartArea: area, scales } = chart;
    const max = Math.max(1, ...Object.values(counts));

    /* 띠는 그래프 영역 "아래"에 그립니다. layout.padding.bottom 으로
       미리 비워 둔 자리라 곡선을 가리지 않습니다. */
    const stripTop = area.bottom + 2;

    ctx.save();

    // 구간이 좁아도 최소 폭은 확보하고, 가운데를 기준으로 넓힙니다.
    const span = (b) => {
      const l = scales.x.getPixelForValue(b.maxMa);
      const r = scales.x.getPixelForValue(b.minMa);
      const w = Math.max(r - l, MARK_W);
      return [l - (w - (r - l)) / 2, w];
    };

    // 학급 전체 탭 누적 — 진할수록 많이 찍힌 구간
    const heat = css('--c-heat', '#b2483c');
    for (const b of bins) {
      const n = counts[b.id];
      if (!n) continue;
      const [x, w] = span(b);
      ctx.fillStyle = alpha(heat, 0.18 + 0.72 * (n / max));
      ctx.fillRect(x, stripTop, w, 10);
    }

    // 내가 찍은 구간 — 학급 누적과 구분되도록 그 아래 굵은 밑줄.
    // 교실 뒤에서도 보이도록 학급 막대보다 두껍게 잡습니다.
    ctx.fillStyle = css('--text', '#000');
    for (const b of bins) {
      if (!mine.has(b.id)) continue;
      const [x, w] = span(b);
      ctx.fillRect(x, stripTop + 13, w, 6);
    }

    ctx.restore();
  },
};

/* ── 대멸종 위치 표시 플러그인 ────────────────────────────────
   기본은 숨김입니다. 학생이 스스로 급감 구간을 찾는 것이 활동이므로
   미리 답을 표시하면 활동이 성립하지 않습니다.
   5곳을 다 찍은 뒤에만 켭니다.

   중앙에 선 하나를 긋지 않고 ageMa 범위 전체를 띠로 칠합니다.
   대멸종 2 는 [372, 359] 로 13백만 년에 걸친 사건인데 중앙값(365.5)에
   선을 그으면 다양성이 이미 회복된 자리를 가리키게 됩니다.
   "대멸종은 한 순간이 아니라 기간"이라는 것도 이 띠로 함께 전달됩니다.  */
const eventsPlugin = {
  id: 'events',
  afterDatasetsDraw(chart) {
    if (!chart.$showEvents || !chart.$events) return;
    const { ctx, chartArea: area, scales } = chart;
    const h = area.bottom - area.top;

    ctx.save();
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';

    for (const ev of chart.$events) {
      const [older, younger] = ev.ageMa;
      if (younger > X_MAX) continue;

      const xOld = scales.x.getPixelForValue(Math.min(older, X_MAX));
      const xYoung = scales.x.getPixelForValue(younger);
      const w = Math.max(xYoung - xOld, 2);

      // 사건이 걸쳐 있는 기간 전체
      ctx.fillStyle = alpha(css('--muted', '#888'), 0.2);
      ctx.fillRect(xOld, area.top, w, h);

      // 시작 경계 — 멸종이 시작된 쪽
      ctx.strokeStyle = css('--muted', '#888');
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xOld, area.top);
      ctx.lineTo(xOld, area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      if (chart.$labelEvents) {
        ctx.fillStyle = css('--muted', '#888');
        ctx.fillText(ev.studentLabel, xOld + w / 2, area.top + 10);
      }
    }
    ctx.restore();
  },
};

/* ── 공통 축 설정 ───────────────────────────────────────── */
function baseOptions({ showXLabels }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,                 // 30명 동시 접속에서 애니메이션은 비용만 됩니다
    events: [],                       // Chart.js 자체 이벤트 처리를 끕니다.
                                      // 포인터는 우리가 직접 받아 크로스헤어로 씁니다.
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    layout: { padding: { top: 6, right: 8 } },
    scales: {
      x: {
        type: 'linear',
        reverse: true,                // 왼쪽이 과거, 오른쪽이 현재
        min: X_MIN,
        max: X_MAX,
        grid: { color: () => alpha(css('--line', '#ddd'), 0.9), drawTicks: false },
        border: { display: false },
        ticks: {
          display: showXLabels,
          color: () => css('--muted'),
          font: { size: 10 },
          maxRotation: 0,
          autoSkipPadding: 16,
          callback: (v) => (v === 0 ? '현재' : v),
        },
      },
      y: {
        // 세 차트의 그래프 영역을 정확히 겹치게 하는 부분입니다.
        afterFit(scale) {
          scale.width = Y_AXIS_W;
        },
        grid: { color: () => alpha(css('--line', '#ddd'), 0.9), drawTicks: false },
        border: { display: false },
        ticks: { color: () => css('--muted'), font: { size: 10 }, maxTicksLimit: 4, padding: 6 },
      },
    },
  };
}

const bandDataset = (data, key, color) => [
  {
    data: data.map((p) => ({ x: p.ma, y: p[`${key}Hi`] })),
    borderWidth: 0,
    pointRadius: 0,
    fill: '+1',
    backgroundColor: () => alpha(css(color), 0.16),
    spanGaps: false,
  },
  {
    data: data.map((p) => ({ x: p.ma, y: p[`${key}Lo`] })),
    borderWidth: 0,
    pointRadius: 0,
    fill: false,
  },
];

const lineDataset = (data, xKey, yKey, color) => ({
  data: data.map((p) => ({ x: p[xKey], y: p[yKey] })),
  borderColor: () => css(color),
  borderWidth: 2,
  pointRadius: 0,
  pointHitRadius: 0,
  tension: 0.15,
  fill: false,
});

/* ── 본체 ──────────────────────────────────────────────── */
export function createChartStack({ mount, diversity, climate, events, onTapBin }) {
  const bins = diversity.bins;
  const pts = climate.points;
  const climateOldest = climate.ageRangeMa[0];

  mount.innerHTML = `
    <div class="cs">
      <div class="cs__readout" id="cs-readout">
        <b class="cs__ma mono" id="cs-ma">시간축 위를 손가락으로 훑어 보세요</b>
        <span class="cs__vals mono" id="cs-vals"></span>
      </div>

      ${panel('div', '생물 다양성', '화석으로 확인된 속(genus) 수')}
      ${panel('occ', '화석 기록 수', '이 구간에서 조사된 화석 표본 수', true)}
      ${panel('gmst', '전 지구 평균 기온', '°C · 띠는 추정 범위')}
      ${panel('co2', '대기 중 이산화 탄소', 'ppm · 로그 눈금')}

      <p class="cs__axis mono">← 과거 &nbsp;·&nbsp; 백만 년 전 &nbsp;·&nbsp; 현재 →</p>
      <p class="cs__gap">${Math.round(climateOldest)}백만 년 전보다 이전은 기온·CO<sub>2</sub> 복원 자료가 없어 비어 있습니다.</p>
    </div>
  `;

  const KEYS = ['div', 'occ', 'gmst', 'co2'];
  const panelEl = {};
  const wraps = {};
  const lines = {};
  for (const k of KEYS) {
    panelEl[k] = mount.querySelector(`[data-key="${k}"]`);
    wraps[k] = panelEl[k].querySelector('.cs__canvas');
    lines[k] = panelEl[k].querySelector('.cs__cx');
  }

  const charts = {};

  charts.div = new Chart(wraps.div.querySelector('canvas'), {
    type: 'line',
    data: { datasets: [lineDataset(bins, 'midMa', 'value', '--c-div')] },
    options: {
      ...baseOptions({ showXLabels: false }),
      layout: { padding: { top: 6, right: 8, bottom: HEAT_H } },
      scales: {
        ...baseOptions({ showXLabels: false }).scales,
        y: { ...baseOptions({ showXLabels: false }).scales.y, beginAtZero: true },
      },
    },
    plugins: [heatmapPlugin, eventsPlugin],
  });
  charts.div.$bins = bins;
  charts.div.$events = events;
  charts.div.$labelEvents = true;

  /* 화석 기록 수. 기본은 숨김이고 학생이 5곳을 표시한 뒤에 켤 수 있습니다.
     다양성 곡선 바로 아래에 두어 두 곡선의 모양을 직접 비교하게 합니다.
     "화석 기록이 적어서 낮게 나온 것"과 "정말 생물이 줄어든 것"은
     이 그래프만으로 가릴 수 없습니다 — 그 판단이 다음 활동입니다. */
  charts.occ = new Chart(wraps.occ.querySelector('canvas'), {
    type: 'line',
    data: { datasets: [lineDataset(bins, 'midMa', 'nOccs', '--c-occ')] },
    options: {
      ...baseOptions({ showXLabels: false }),
      scales: {
        ...baseOptions({ showXLabels: false }).scales,
        y: {
          ...baseOptions({ showXLabels: false }).scales.y,
          beginAtZero: true,
          ticks: {
            ...baseOptions({ showXLabels: false }).scales.y.ticks,
            callback: (v) => (v >= 1000 ? `${v / 1000}천` : v),
          },
        },
      },
    },
  });

  charts.gmst = new Chart(wraps.gmst.querySelector('canvas'), {
    type: 'line',
    data: {
      datasets: [...bandDataset(pts, 'gmst', '--c-gmst'), lineDataset(pts, 'ma', 'gmst', '--c-gmst')],
    },
    options: baseOptions({ showXLabels: false }),
    plugins: [eventsPlugin],
  });
  charts.gmst.$events = events;

  charts.co2 = new Chart(wraps.co2.querySelector('canvas'), {
    type: 'line',
    data: {
      datasets: [...bandDataset(pts, 'co2', '--c-co2'), lineDataset(pts, 'ma', 'co2', '--c-co2')],
    },
    options: {
      ...baseOptions({ showXLabels: true }),
      scales: {
        ...baseOptions({ showXLabels: true }).scales,
        y: {
          ...baseOptions({ showXLabels: true }).scales.y,
          type: 'logarithmic',        // 239 ~ 3326 ppm. 선형이면 낮은 구간이 뭉갭니다
          min: 200,
          max: 4000,
          ticks: {
            ...baseOptions({ showXLabels: true }).scales.y.ticks,
            callback: (v) => ([250, 500, 1000, 2000, 4000].includes(v) ? v.toLocaleString() : ''),
          },
        },
      },
    },
    plugins: [eventsPlugin],
  });
  charts.co2.$events = events;

  /* ── 크로스헤어 ─────────────────────────────────────────
     캔버스를 다시 그리지 않고 얇은 막대의 위치만 옮깁니다.      */
  const elMa = mount.querySelector('#cs-ma');
  const elVals = mount.querySelector('#cs-vals');
  let raf = 0;
  let pendingMa = null;

  function paint() {
    raf = 0;
    const ma = pendingMa;
    if (ma === null) {
      for (const k in lines) lines[k].style.opacity = '0';
      elMa.textContent = '시간축 위를 손가락으로 훑어 보세요';
      elVals.textContent = '';
      return;
    }

    const px = charts.div.scales.x.getPixelForValue(ma);
    for (const k in lines) {
      lines[k].style.opacity = '1';
      lines[k].style.transform = `translateX(${px}px)`;
    }

    const bin = nearest(bins, 'midMa', ma);
    const pt = ma <= climateOldest ? nearest(pts, 'ma', ma) : null;

    /* 화석 기록 수를 함께 보여줍니다.
       이 값이 이웃 구간보다 크게 적으면, 다양성 감소가 "생물이 사라진 것"이
       아니라 "조사된 화석이 적은 것"일 수 있습니다. 예를 들어 약 88백만 년 전
       구간은 기록이 3,389개뿐이라 바로 뒤 구간의 9분의 1 수준입니다.
       학생이 급감 구간을 판정할 때 스스로 걸러낼 수 있게 하는 단서입니다. */
    elMa.textContent = `${fmtMa(ma)}`;
    elVals.innerHTML =
      (pt
        ? `다양성 <b>${bin.value}</b> · 기온 <b>${pt.gmst}°C</b> · CO<sub>2</sub> <b>${pt.co2.toLocaleString()}</b>ppm`
        : `다양성 <b>${bin.value}</b> · 기온·CO<sub>2</sub> <b>자료 없음</b>`) +
      ` · 화석기록 <b>${bin.nOccs.toLocaleString()}</b>`;
  }

  function setCrosshair(ma) {
    pendingMa = ma;
    if (!raf) raf = requestAnimationFrame(paint);
  }

  const offBus = on('crosshair', setCrosshair);

  /* ── 포인터 처리 ────────────────────────────────────────
     세 차트 어디를 훑어도 같은 연대가 세로로 이어집니다.
     다양성 차트에서는 "탭"으로 구간을 표시합니다.               */
  let down = null;

  function maFromEvent(e, wrap) {
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const scale = charts.div.scales.x;
    const ma = scale.getValueForPixel(x);
    return Math.min(X_MAX, Math.max(X_MIN, ma));
  }

  const handlers = [];
  for (const key of KEYS) {
    const wrap = wraps[key];

    const move = (e) => emit('crosshair', maFromEvent(e, wrap));
    const leave = () => emit('crosshair', null);
    const pdown = (e) => {
      down = { x: e.clientX, y: e.clientY, t: Date.now(), key };
      emit('crosshair', maFromEvent(e, wrap));
    };
    const pup = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = Date.now() - down.t < 600;
      const isTap = moved < 12 && quick && down.key === key;
      down = null;
      // 다양성 곡선에서의 탭만 "급감 구간 표시"로 받습니다.
      if (isTap && key === 'div' && onTapBin) {
        onTapBin(nearest(bins, 'midMa', maFromEvent(e, wrap)));
      }
    };

    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerleave', leave);
    wrap.addEventListener('pointerdown', pdown);
    wrap.addEventListener('pointerup', pup);
    wrap.addEventListener('pointercancel', () => { down = null; });
    handlers.push([wrap, move, leave, pdown, pup]);
  }

  /* 다크모드 전환 시 색을 다시 읽게 합니다(옵션이 함수라 update 만으로 반영). */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => Object.values(charts).forEach((c) => c.update('none'));
  mq.addEventListener?.('change', onTheme);

  return {
    /** 내 표시와 학급 누적을 갱신하고 히트맵을 다시 그립니다. */
    setMarks({ mine, classCounts }) {
      charts.div.$myMarks = new Set(mine);
      charts.div.$classCounts = classCounts || {};
      charts.div.update('none');
    },
    /** 대멸종 위치 표시를 켜고 끕니다. */
    setEventsVisible(v) {
      for (const c of Object.values(charts)) {
        c.$showEvents = v;
        c.update('none');
      }
    },
    /** 화석 기록 수 그래프를 켜고 끕니다. */
    setOccVisible(v) {
      panelEl.occ.hidden = !v;
      // 숨겨져 있는 동안 캔버스 크기가 0 이므로 다시 보일 때 재계산이 필요합니다.
      if (v) charts.occ.resize();
    },
    destroy() {
      offBus();
      cancelAnimationFrame(raf);
      mq.removeEventListener?.('change', onTheme);
      for (const [wrap, move, leave, pdown, pup] of handlers) {
        wrap.removeEventListener('pointermove', move);
        wrap.removeEventListener('pointerleave', leave);
        wrap.removeEventListener('pointerdown', pdown);
        wrap.removeEventListener('pointerup', pup);
      }
      Object.values(charts).forEach((c) => c.destroy());
    },
  };
}

function panel(key, title, sub, hidden = false) {
  return `
    <section class="cs__panel" data-key="${key}"${hidden ? ' hidden' : ''}>
      <h3 class="cs__title">${title} <em>${sub}</em></h3>
      <div class="cs__canvas"><canvas></canvas><i class="cs__cx"></i></div>
    </section>
  `;
}

function nearest(arr, key, ma) {
  let best = arr[0];
  let bd = Infinity;
  for (const it of arr) {
    const d = Math.abs(it[key] - ma);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

function fmtMa(ma) {
  if (ma < 1) return '현재';
  if (ma < 100) return `${Math.round(ma * 100).toLocaleString('ko-KR')}만 년 전`;
  return `${(ma / 100).toFixed(2)}억 년 전`;
}
