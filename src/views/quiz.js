import { loadQuiz, saveAnswer, sectionLink } from '../services/quiz.js';
import { fetchFeedback } from '../services/ai.js';
import { QUESTIONS, CHOICES } from '../data/preconceptions.js';
import { saveResponses, subscribeResponses } from '../services/preconceptions.js';
import { configured } from '../firebase.js';
import * as store from '../store.js';

/* 형성평가.
 *  - 선택형: 고르는 즉시 채점하고, 틀리면 해당 활동으로 돌아가는 길을 띄웁니다.
 *  - 서술형: 저장한 뒤 루브릭 피드백을 받습니다.
 *
 * 피드백은 hypotheses.json 의 rubric_서술형 규칙을 따릅니다 —
 * 점수나 수준을 학생에게 보이지 않고, 포함된 요소 / 빠진 요소(최대 2개) /
 * 다시 볼 자료 세 항목만 보여줍니다. 수준은 교사 대시보드에만 남습니다.
 */

export default async function quiz(outlet) {
  const items = await loadQuiz();
  const source = store.get('quiz').source;

  outlet.innerHTML = `
    <div class="qz">
      <header class="qz__head wrap">
        <p class="qz__eyebrow mono">형성평가</p>
        <h1 class="qz__title">오늘 배운 것을 확인합니다</h1>
        <p class="qz__lead">
          선택형은 고르면 바로 채점됩니다. 틀려도 괜찮습니다 —
          어디를 다시 봐야 하는지 알려줍니다.
        </p>
        ${
          source === 'sample'
            ? '<p class="qz__note">시트가 연결되지 않아 기본 문항으로 진행합니다.</p>'
            : ''
        }
      </header>

      <div class="wrap">
        ${items.map((it, i) => renderItem(it, i)).join('')}

        <section class="qz__item" id="qz-post"></section>

        <p class="qz__msg" id="qz-msg" role="status"></p>
        <a class="btn btn--ghost qz__done" href="#/court">가설 법정으로 돌아가기</a>
      </div>
    </div>
  `;

  const cleanups = [];
  let msgTimer = 0;

  function flash(t) {
    const el = outlet.querySelector('#qz-msg');
    el.textContent = t;
    clearTimeout(msgTimer);
    if (t) msgTimer = setTimeout(() => (el.textContent = ''), 3000);
  }

  /* ── 선택형 ─────────────────────────────────────────── */
  for (const it of items.filter((x) => x.type === 'choice')) {
    const box = outlet.querySelector(`#q-${it.id}`);
    const result = outlet.querySelector(`#r-${it.id}`);

    const onPick = async (e) => {
      const btn = e.target.closest('[data-choice]');
      if (!btn || box.dataset.done) return;

      const picked = Number(btn.dataset.choice);
      const correct = picked === it.answer;
      box.dataset.done = '1';

      box.querySelectorAll('[data-choice]').forEach((b) => {
        b.disabled = true;
        const n = Number(b.dataset.choice);
        if (n === it.answer) b.classList.add('qz__choice--answer');
        else if (n === picked) b.classList.add('qz__choice--wrong');
      });

      const link = correct ? null : sectionLink(it.section);
      result.hidden = false;
      result.className = `qz__result ${correct ? 'qz__result--ok' : 'qz__result--no'}`;
      result.innerHTML = `
        <b>${correct ? '맞았습니다' : '다시 생각해 봅시다'}</b>
        ${it.explain ? `<p>${esc(it.explain)}</p>` : ''}
        ${link ? `<a class="qz__link" href="${link.href}">${link.label} →</a>` : ''}
      `;

      const r = await saveAnswer(it, { raw: picked, correct });
      if (r === 'denied') flash('답안 저장 권한이 없습니다. 보안 규칙을 확인해 주세요.');
      else if (r === 'error') flash('답안을 저장하지 못했습니다.');
    };

    box.addEventListener('click', onPick);
    cleanups.push(() => box.removeEventListener('click', onPick));
  }

  /* ── 서술형 ─────────────────────────────────────────── */
  for (const it of items.filter((x) => x.type === 'text')) {
    const area = outlet.querySelector(`#t-${it.id}`);
    const btn = outlet.querySelector(`#s-${it.id}`);
    const result = outlet.querySelector(`#r-${it.id}`);

    const onSubmit = async () => {
      const raw = area.value.trim();
      if (raw.length < 20) {
        flash('조금 더 자세히 써 주세요. (20자 이상)');
        return;
      }

      btn.disabled = true;
      btn.textContent = '제출하는 중…';

      // 먼저 답안을 저장합니다. AI 가 실패해도 답안은 남아야 합니다.
      const saved = await saveAnswer(it, { raw });
      if (saved !== 'ok') flash('답안을 저장하지 못했습니다. 화면을 닫지 마세요.');

      btn.textContent = '피드백을 받는 중…';
      const fb = await fetchFeedback({ question: it.question, answer: raw });

      if (fb) {
        // 수준(level)은 교사 대시보드용으로만 저장하고 화면에는 쓰지 않습니다.
        await saveAnswer(it, { level: fb.level, feedback: fb });
        result.hidden = false;
        result.className = 'qz__result qz__result--fb';
        result.innerHTML = feedbackHtml(fb);
      } else {
        result.hidden = false;
        result.className = 'qz__result qz__result--ok';
        result.innerHTML =
          '<b>제출했습니다</b><p>피드백을 받지 못했지만 답안은 저장되었습니다.</p>';
      }

      btn.disabled = false;
      btn.textContent = '다시 제출';
    };

    btn.addEventListener('click', onSubmit);
    cleanups.push(() => btn.removeEventListener('click', onSubmit));
  }

  /* ── 사후 선개념 확인 ───────────────────────────────────
     수업 전에 답했던 다섯 문항을 그대로 다시 묻고, 두 답을 나란히 보여줍니다.
     정답을 알려주는 대신 "내 생각이 어디서 바뀌었는지"를 보게 하는 것이
     이 활동의 마무리입니다. */
  const postBox = outlet.querySelector('#qz-post');
  const unsubPre = subscribeResponses(() => {});
  const unsubStore = store.subscribe('preconceptions', renderPost);
  let postBusy = false;

  function renderPost() {
    const { pre, post } = store.get('preconceptions');

    if (!pre) {
      postBox.innerHTML = `
        <h2 class="qz__q">다시 생각해보기</h2>
        <p class="qz__lead">수업 시작 전 선개념 확인을 하지 않아 비교할 답이 없습니다.</p>`;
      return;
    }

    if (post) {
      postBox.innerHTML = `
        <h2 class="qz__q">생각이 이렇게 달라졌습니다</h2>
        <div class="pc__compare">
          ${QUESTIONS.map((q) => {
            const a = pre.answers?.[q.id];
            const b = post.answers?.[q.id];
            const changed = a !== b;
            return `<div class="pc__row">
              <span>${esc(q.text)}</span>
              <b class="pc__same">${labelOf(a)}</b>
              <span class="pc__arrow">→</span>
              <b class="${changed ? 'pc__changed' : 'pc__same'}">${labelOf(b)}</b>
            </div>`;
          }).join('')}
        </div>`;
      return;
    }

    postBox.innerHTML = `
      <h2 class="qz__q">다시 생각해보기</h2>
      <p class="qz__lead">수업 시작 전에 답했던 질문입니다. 지금은 어떻게 생각하나요?</p>
      <form id="qz-postForm">
        ${QUESTIONS.map(
          (q, i) => `
          <fieldset class="pc__q">
            <legend><span class="pc__num mono">${i + 1}</span>${esc(q.text)}</legend>
            <div class="pc__choices">
              ${CHOICES.map(
                (c) => `<label class="pc__choice">
                  <input type="radio" name="p-${q.id}" value="${c.value}" />
                  <span>${c.label}</span>
                </label>`
              ).join('')}
            </div>
          </fieldset>`
        ).join('')}
        <button class="btn pc__submit" type="submit">제출하기</button>
      </form>`;

    postBox.querySelector('#qz-postForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (postBusy) return;

      const answers = {};
      for (const q of QUESTIONS) {
        const picked = postBox.querySelector(`input[name="p-${q.id}"]:checked`);
        if (!picked) return flash('아직 고르지 않은 질문이 있습니다.');
        answers[q.id] = picked.value;
      }

      postBusy = true;
      const r = await saveResponses('post', answers);
      postBusy = false;
      if (r !== 'ok') flash('저장하지 못했습니다.');
      else if (!configured) renderPost();
    });
  }

  renderPost();

  return () => {
    clearTimeout(msgTimer);
    cleanups.forEach((fn) => fn());
    unsubPre();
    unsubStore();
  };
}

function labelOf(v) {
  return CHOICES.find((c) => c.value === v)?.label ?? '—';
}

function renderItem(it, i) {
  const head = `
    <div class="qz__num mono">${i + 1}</div>
    <h2 class="qz__q">${esc(it.question)}</h2>`;

  if (it.type === 'text') {
    return `
      <section class="qz__item">
        ${head}
        <textarea class="qz__text" id="t-${it.id}" rows="6"
          placeholder="오늘 본 그래프와 증거를 근거로 들어 설명해 보세요."></textarea>
        <button class="btn qz__submit" id="s-${it.id}" type="button">제출</button>
        <div class="qz__result" id="r-${it.id}" hidden></div>
      </section>`;
  }

  return `
    <section class="qz__item" id="q-${it.id}">
      ${head}
      <div class="qz__choices">
        ${it.choices
          .map(
            (c, n) =>
              `<button class="qz__choice" type="button" data-choice="${n + 1}">
                 <span class="qz__ord mono">${n + 1}</span>${esc(c)}
               </button>`
          )
          .join('')}
      </div>
      <div class="qz__result" id="r-${it.id}" hidden></div>
    </section>`;
}

/* rubric_서술형 의 AI_피드백_규칙: 세 항목만, 점수·수준은 보이지 않게 */
function feedbackHtml(fb) {
  const list = (title, arr) =>
    arr?.length
      ? `<div class="qz__fbBlock"><b>${title}</b><ul>${arr
          .map((s) => `<li>${esc(s)}</li>`)
          .join('')}</ul></div>`
      : '';

  return `
    <b>제출했습니다</b>
    ${list('답안에 담긴 것', fb.included)}
    ${list('더 넣으면 좋을 것', fb.missing)}
    ${list('다시 볼 자료', fb.revisit)}
  `;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
