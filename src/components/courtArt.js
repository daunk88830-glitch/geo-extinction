/* 원인 찾기 화면의 도식들.
 *
 * 사진 대신 도식을 씁니다. 이 활동에서 필요한 건 "멋진 그림"이 아니라
 * 지금 무엇을 읽고 있는지 한눈에 알아보는 것이기 때문입니다.
 * 외부 파일 없이 인라인 SVG 라서 내려받을 것도, 깨질 것도 없습니다.
 */

const svg = (vb, inner, cls = '') =>
  `<svg viewBox="${vb}" class="${cls}" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/* ── 증거의 종류 ─────────────────────────────────────────────
   sourceType 이 24가지나 되어 그대로 두면 학생이 구분하지 못합니다.
   성격이 같은 것끼리 묶어 6가지로 줄이고 각각 다른 도식을 답니다.

   특히 "부재 증거"는 따로 뗐습니다. 이 데이터에 6장이나 있고,
   "찾아봤는데 없다"는 것이 이 수업에서 가장 중요한 증거의 종류입니다.
   다른 카드와 생김새가 확실히 달라야 학생이 멈춰서 생각합니다.        */
const KINDS = {
  absence: {
    label: '찾았지만 없음',
    icon: svg('0 0 24 24', `
      <circle cx="12" cy="12" r="8" stroke-dasharray="3 3" />
      <path d="M8 16L16 8" />`),
  },
  rock: {
    label: '암석·지층',
    icon: svg('0 0 24 24', `
      <path d="M3 8h18M3 13h18M3 18h18" />
      <path d="M7 8v5M15 13v5" />`),
  },
  fossil: {
    label: '화석 기록',
    icon: svg('0 0 24 24', `
      <path d="M12 4a8 8 0 1 1-7.7 10" />
      <path d="M12 8a4 4 0 1 0 3.9 5" />
      <circle cx="12" cy="12" r="1" />`),
  },
  mechanism: {
    label: '과정 설명',
    icon: svg('0 0 24 24', `
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 6H14a4 4 0 0 1 4 4v5.5" />
      <path d="M12 3.5L14.5 6 12 8.5" />`),
  },
  climate: {
    label: '기후 복원',
    icon: svg('0 0 24 24', `
      <path d="M3 18l4-6 4 3 4-8 6 5" />
      <path d="M3 21h18" />`),
  },
  paper: {
    label: '연구 논문',
    icon: svg('0 0 24 24', `
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />`),
  },
  opinion: {
    label: '학계 견해',
    icon: svg('0 0 24 24', `
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M9 9h6M9 12h4" />`),
  },
};

/** sourceType 문자열을 6가지 종류 중 하나로 분류합니다. */
export function evidenceKind(sourceType = '') {
  const s = String(sourceType);
  if (s.includes('부재')) return 'absence';
  if (s.includes('논문')) return 'paper';
  if (s.includes('지질') || s.includes('지층') || s.includes('연대 측정')) return 'rock';
  if (s.includes('화석')) return 'fossil';
  if (s.includes('메커니즘')) return 'mechanism';
  if (s.includes('고기후')) return 'climate';
  return 'opinion';
}

export function evidenceBadge(sourceType) {
  const kind = evidenceKind(sourceType);
  const k = KINDS[kind];
  return `<span class="ct__kind" data-kind="${kind}" title="${escAttr(sourceType)}">
    ${k.icon}<span>${k.label}</span>
  </span>`;
}

/* ── 사건 위치 띠 ────────────────────────────────────────────
   지금 보고 있는 사건이 현생누대 어디쯤인지 보여 주고, 동시에
   다른 사건으로 건너뛰는 길이 됩니다. 번호가 든 원을 누르면 이동합니다.
   데이터 탐구에서 본 시간축과 방향이 같습니다(왼쪽 과거 → 오른쪽 현재).
   다섯 사건이 고르게 흩어져 있지 않다는 것도 함께 드러납니다.

   SVG 가 아니라 HTML 단추로 만듭니다 — 눌러야 하는 것이므로
   키보드 이동과 화면 낭독기가 그대로 동작해야 합니다.               */
const X_MAX = 540;

export function eventStrip(events, currentId, locks = {}) {
  const dots = events
    .map((ev, i) => {
      const ma = (ev.ageMa[0] + ev.ageMa[1]) / 2;
      const pct = ((X_MAX - ma) / X_MAX) * 100;
      const on = ev.id === currentId;
      const g = locks[ev.id]?.groupId;

      return `
        <button type="button"
          class="ct__stripDot${on ? ' is-on' : ''}"
          style="left:${pct.toFixed(1)}%"
          data-goto="${ev.id}"
          ${g ? `data-group="${g}"` : ''}
          ${on ? 'aria-current="true"' : ''}
          aria-label="${escAttr(ev.studentLabel)} — ${escAttr(ev.studentEra)}${
            g ? `, ${g}모둠이 맡음` : ', 아직 맡은 모둠 없음'
          }">${i + 1}</button>`;
    })
    .join('');

  return `
    <div class="ct__strip">
      <p class="ct__stripTitle">
        다섯 번의 대멸종 <em>번호를 누르면 그 사건으로 이동합니다</em>
      </p>
      <div class="ct__stripTrack">
        <span class="ct__stripLine" aria-hidden="true"></span>
        ${dots}
      </div>
      <div class="ct__stripEnds"><span>과거</span><span>현재</span></div>
    </div>`;
}
function escAttr(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}
