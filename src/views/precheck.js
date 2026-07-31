import { QUESTIONS, CHOICES, distribution } from '../data/preconceptions.js';
import { saveResponses, subscribeResponses } from '../services/preconceptions.js';
import { configured } from '../firebase.js';
import * as store from '../store.js';

/* 선개념 확인 (수업 전).
 *
 * 정답을 알려주지 않습니다. 지금 무엇을 알고 있는지 확인하는 것이 목적이고,
 * 여기서 답을 주면 스스로 뒤집는 경험이 사라집니다.
 *
 * 제출하고 나면 안내 카드가 나오는데, 순서가 고정이 아니라
 * 반 전체가 어느 오개념을 많이 골랐는지에 따라 재구성됩니다.
 * 반 응답이 실시간으로 들어오므로 뒤에 제출한 학생일수록 정확한 순서를 봅니다.
 */

export default function precheck(outlet) {
  outlet.innerHTML = '<div class="pc" id="pc-root"></div>';
  const root = outlet.querySelector('#pc-root');

  const unsubRemote = subscribeResponses(() =>
    console.warn('[precheck] 반 응답을 읽지 못했습니다')
  );
  const unsubStore = store.subscribe('preconceptions', render);

  let submitting = false;

  function render() {
    const pre = store.get('preconceptions').pre;
    if (pre) renderResult();
    else renderForm();
  }

  /* ── 문항 ─────────────────────────────────────────────── */
  function renderForm() {
    root.innerHTML = `
      <div class="wrap pc__head">
        <p class="pc__eyebrow mono">시작하기 전에</p>
        <h1 class="pc__title">지금 어떻게 생각하고 있나요?</h1>
        <p class="pc__lead">
          맞히는 문제가 아닙니다. 오늘 수업이 끝난 뒤 같은 질문을 다시 물어보고,
          생각이 어떻게 달라졌는지 함께 봅니다. 지금 떠오르는 대로 고르세요.
        </p>
      </div>

      <form class="wrap" id="pc-form">
        ${QUESTIONS.map(
          (q, i) => `
          <fieldset class="pc__q" data-q="${q.id}">
            <legend>
              <span class="pc__num mono">${i + 1}</span>
              ${esc(q.text)}
            </legend>
            <div class="pc__choices">
              ${CHOICES.map(
                (c) => `
                <label class="pc__choice">
                  <input type="radio" name="${q.id}" value="${c.value}" />
                  <span>${c.label}</span>
                </label>`
              ).join('')}
            </div>
          </fieldset>`
        ).join('')}

        <p class="err" id="pc-err"></p>
        <button class="btn pc__submit" type="submit">제출하기</button>

        ${
          configured
            ? ''
            : '<p class="pc__warn">Firebase 설정 전이라 응답이 이 브라우저에만 남습니다.</p>'
        }
      </form>
    `;

    root.querySelector('#pc-form').addEventListener('submit', onSubmit);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const err = root.querySelector('#pc-err');
    const answers = {};
    for (const q of QUESTIONS) {
      const picked = root.querySelector(`input[name="${q.id}"]:checked`);
      if (!picked) {
        err.textContent = '아직 고르지 않은 질문이 있습니다.';
        return;
      }
      answers[q.id] = picked.value;
    }

    err.textContent = '';
    submitting = true;
    const btn = root.querySelector('.pc__submit');
    btn.disabled = true;
    btn.textContent = '보내는 중…';

    const r = await saveResponses('pre', answers);
    submitting = false;

    if (r !== 'ok') {
      btn.disabled = false;
      btn.textContent = '제출하기';
      err.textContent =
        r === 'denied' ? '저장 권한이 없습니다. 보안 규칙을 확인해 주세요.' : '저장에 실패했습니다.';
      return;
    }

    // Firebase 미설정 상태에서는 구독이 없으므로 직접 그립니다.
    if (!configured) renderResult();
  }

  /* ── 결과 — 반 분포로 재구성되는 카드 ─────────────────── */
  function renderResult() {
    const { all, pre } = store.get('preconceptions');
    const preDocs = (all || []).filter((d) => d.phase === 'pre');
    const dist = distribution(preDocs.length ? preDocs : [pre].filter(Boolean));

    const mine = pre?.answers || {};

    /* 카드로 띄울 것: 반에서 한 명이라도 고른 오개념, 또는 내가 고른 오개념.
       정렬은 반 비율이 높은 순 — 이것이 "반별 재구성"입니다. */
    const cards = dist
      .map((d) => ({ ...d, isMine: mine[d.question.id] === d.question.misconception }))
      .filter((d) => d.held > 0 || d.isMine)
      .sort((a, b) => b.ratio - a.ratio || Number(b.isMine) - Number(a.isMine));

    const n = preDocs.length;

    root.innerHTML = `
      <div class="wrap pc__head">
        <p class="pc__eyebrow mono">우리 반 ${n || 1}명 응답 기준</p>
        <h1 class="pc__title">오늘 함께 확인할 것</h1>
        <p class="pc__lead">
          반에서 많이 나온 생각부터 정리했습니다. 오늘 활동에서 하나씩 직접 확인하게 됩니다.
          ${n < 3 ? '<b>친구들이 답할수록 순서가 바뀝니다.</b>' : ''}
        </p>
      </div>

      <div class="wrap">
        ${
          cards.length
            ? cards.map((c, i) => cardHtml(c, i, n)).join('')
            : `<div class="pc__none">
                 <b>확인이 필요한 항목이 없습니다.</b>
                 <p>오늘 활동에서 각자의 생각을 데이터로 검증해 봅시다.</p>
               </div>`
        }

        <div class="pc__mine">
          <h2 class="pc__h2">내가 고른 답</h2>
          <p class="pc__mineNote">정답은 지금 알려주지 않습니다. 수업이 끝난 뒤 다시 물어봅니다.</p>
          <ul class="pc__mineList">
            ${QUESTIONS.map(
              (q) => `<li><span>${esc(q.text)}</span><b>${labelOf(mine[q.id])}</b></li>`
            ).join('')}
          </ul>
        </div>

        <a class="btn pc__next" href="#/timeline">타임라인 시작하기</a>
      </div>
    `;
  }

  function cardHtml(c, i, total) {
    const pct = c.answered ? Math.round(c.ratio * 100) : 0;
    const top = i < 2 && c.held > 0;
    return `
      <article class="pc__card${top ? ' pc__card--top' : ''}">
        <div class="pc__cardHead">
          <b>${esc(c.question.card.title)}</b>
          ${
            c.held > 0
              ? `<span class="pc__pct mono">${pct}%</span>`
              : '<span class="pc__pct mono">나만</span>'
          }
        </div>
        <p class="pc__why">${esc(c.question.card.why)}</p>
        <p class="pc__where">${esc(c.question.card.where)}</p>
        <div class="pc__cardFoot">
          ${
            c.isMine
              ? '<span class="pc__tag">내가 고른 생각</span>'
              : `<span class="pc__tag pc__tag--class">반에서 ${c.held}명</span>`
          }
          <a class="pc__go" href="${c.question.card.href}">${esc(c.question.card.action)} →</a>
        </div>
      </article>`;
  }

  render();

  return () => {
    unsubRemote();
    unsubStore();
  };
}

function labelOf(v) {
  return CHOICES.find((c) => c.value === v)?.label ?? '—';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
