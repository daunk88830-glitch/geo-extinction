import {
  Chart,
  RadarController,
  RadialLinearScale,
  LineElement,
  PointElement,
  Filler,
} from 'chart.js';

Chart.register(RadarController, RadialLinearScale, LineElement, PointElement, Filler);

const css = (n, f = '#888') =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

const alpha = (hex, a) => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/* 판정 결과 요약 레이더.
 * "판단 보류"(null)는 0 으로 그립니다 — 중심에 붙어 있는 축이
 * "이 기준은 판단할 수 없었다"를 시각적으로 드러냅니다.
 * 점수가 낮거나 보류가 많은 모양도 정당한 결과입니다.
 */
export function createRadar(canvas, criteria, scores) {
  const labels = criteria.map((c) => shorten(c.label));

  return new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [
        {
          data: criteria.map((c) => scores[c.id] ?? 0),
          borderColor: () => css('--accent'),
          backgroundColor: () => alpha(css('--accent', '#3e6b8c'), 0.22),
          borderWidth: 2,
          pointBackgroundColor: () => css('--accent'),
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        r: {
          min: 0,
          max: 5,
          ticks: { stepSize: 1, display: false },
          grid: { color: () => css('--line') },
          angleLines: { color: () => css('--line') },
          pointLabels: {
            color: () => css('--muted'),
            font: { size: 11 },
          },
        },
      },
    },
  });
}

/* 기준 문구가 길어서 레이더 꼭짓점에 그대로 넣으면 겹칩니다.
   물음표를 떼고 핵심어만 남깁니다. */
function shorten(label) {
  return label
    .replace(/\?$/, '')
    .replace('과학적 증거가 있는가', '증거')
    .replace('전 지구적인 환경 변화를 초래하였는가', '전 지구적 규모')
    .replace('다른 과학적 사실에 어긋나지 않는가', '시기·모순 없음')
    .replace('생물을 멸종할 만큼 위력적이었는가', '멸종시킬 위력');
}
