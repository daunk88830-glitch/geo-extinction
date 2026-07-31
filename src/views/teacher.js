import {
  watchTeacherAuth,
  teacherSignIn,
  teacherSignOut,
  subscribeDashboard,
  clusterAnswers,
} from '../services/teacher.js';
import { loadQuiz } from '../services/quiz.js';
import { configured } from '../firebase.js';

/* 교사 대시보드 — 읽기 전용.
 *
 * 보안 규칙이 quizAnswers 에 교사 쓰기를 허용하지 않으므로,
 * "읽기 전용"은 화면의 약속이 아니라 서버에서 강제됩니다.
 *
 * rubric_서술형 의 규칙 중 하나를 여기서 구현합니다 —
 * "2수준 이하 응답이 학급의 3분의 1을 넘으면 교사 대시보드에 경고를 표시한다"
 */

const LOW_LEVEL_RATIO = 1 / 3;

export default async function teacher(outlet) {
  const items = await loadQuiz();
  const choiceItems = items.filter((i) => i.type === 'choice');
  const textItems = items.filter((i) => i.type === 'text');

  let unsubData = null;
  let clusters = null;
  let clustering = false;
  let data = { students: [], claims: [], answers: [] };

  outlet.innerHTML = '<div class="tc" id="tc-root"></div>';
  const root = outlet.querySelector('#tc-root');

  const unsubAuth = watchTeacherAuth((user) => {
    unsubData?.();
    unsubData = null;
    clusters = null;

    if (!user) {
      renderLogin();
      return;
    }

    renderDashboard();
    unsubData = subscribeDashboard(
      (d) => {
        data = d;
        renderDashboard();
      },
      (e, name) => {
        if (e.code === 'permission-denied') {
          renderLogin(
            `이 계정에는 열람 권한이 없습니다. Firestore 의 sessions/${'{세션}'}/teachers 아래에 ` +
              '이 계정의 uid 로 문서를 만들어 주세요.'
          );
        } else {
          console.error(name, e);
        }
      }
    );
  });

  /* ── 로그인 ─────────────────────────────────────────── */
  function renderLogin(error) {
    root.innerHTML = `
      <div class="wrap tc__login">
        <p class="tc__eyebrow mono">교사용</p>
        <h1 class="tc__title">학급 현황</h1>
        <p class="tc__lead">교사 계정으로 로그인하세요. 이 화면은 읽기 전용입니다.</p>

        ${
          configured
            ? ''
            : '<p class="tc__warn">Firebase 설정 전에는 사용할 수 없습니다.</p>'
        }

        <form id="tc-form">
          <label class="field">
            <span class="field__label">이메일</span>
            <input class="field__input" id="tc-email" type="email" autocomplete="username" />
          </label>
          <label class="field">
            <span class="field__label">비밀번호</span>
            <input class="field__input" id="tc-pw" type="password" autocomplete="current-password" />
          </label>
          <p class="err" id="tc-err">${error ? esc(error) : ''}</p>
          <button class="btn" type="submit" style="width:100%">로그인</button>
        </form>

        <p class="tc__note">
          학생 기기에서는 로그인하지 마세요. 이 계정은 학급 전체의 답안을 볼 수 있습니다.
        </p>
      </div>
    `;

    root.querySelector('#tc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = root.querySelector('#tc-err');
      err.textContent = '';
      try {
        await teacherSignIn(
          root.querySelector('#tc-email').value.trim(),
          root.querySelector('#tc-pw').value
        );
      } catch (e2) {
        err.textContent =
          e2.code === 'auth/invalid-credential' || e2.code === 'auth/wrong-password'
            ? '이메일 또는 비밀번호가 맞지 않습니다.'
            : `로그인 실패 (${e2.code || e2.message})`;
      }
    });
  }

  /* ── 대시보드 ───────────────────────────────────────── */
  function renderDashboard() {
    const { students, claims, answers } = data;

    const submittedClaims = claims.filter((c) => c.status === 'submitted');
    const textAnswers = answers.filter((a) => a.type === 'text' && a.raw);
    const graded = textAnswers.filter((a) => typeof a.level === 'number');
    const low = graded.filter((a) => a.level <= 2);
    const lowAlert = graded.length >= 3 && low.length / graded.length > LOW_LEVEL_RATIO;

    root.innerHTML = `
      <div class="wrap tc__head">
        <div class="tc__headRow">
          <div>
            <p class="tc__eyebrow mono">교사용 · 읽기 전용</p>
            <h1 class="tc__title">학급 현황</h1>
          </div>
          <button class="btn btn--ghost tc__out" id="tc-out" type="button">로그아웃</button>
        </div>

        <div class="tc__stats">
          ${stat('접속 학생', students.length)}
          ${stat('제출된 판정', `${submittedClaims.length} / 20`)}
          ${stat('서술형 제출', textAnswers.length)}
        </div>

        ${
          lowAlert
            ? `<div class="tc__alert">
                 <b>다시 짚어야 할 수 있습니다</b>
                 <p>서술형 채점 ${graded.length}건 중 ${low.length}건이 "환경이 변하면 멸종한다"에서
                 멈추고 대멸종 이후 다양성이 회복되는 국면을 다루지 않았습니다.
                 학급의 3분의 1을 넘습니다.</p>
               </div>`
            : ''
        }
      </div>

      <section class="wrap tc__sec">
        <h2 class="tc__h2">문항별 정답률</h2>
        ${
          choiceItems.length
            ? choiceItems.map((it) => rateRow(it, answers)).join('')
            : '<p class="tc__empty">선택형 문항이 없습니다.</p>'
        }
      </section>

      <section class="wrap tc__sec">
        <h2 class="tc__h2">모둠별 판정 진행</h2>
        ${groupTable(claims)}
      </section>

      <section class="wrap tc__sec">
        <div class="tc__secHead">
          <h2 class="tc__h2">서술형 응답 <em>${textAnswers.length}건</em></h2>
          <button class="btn btn--ghost tc__cluster" id="tc-cluster" type="button"
            ${textAnswers.length < 2 || clustering ? 'disabled' : ''}>
            ${clustering ? '분류하는 중…' : '오개념 유형별로 묶기'}
          </button>
        </div>

        ${clusters ? clusterHtml(clusters, textAnswers) : ''}

        ${
          textAnswers.length
            ? textAnswers.map((a) => answerCard(a)).join('')
            : '<p class="tc__empty">아직 제출된 서술형 응답이 없습니다.</p>'
        }
      </section>
    `;

    root.querySelector('#tc-out').addEventListener('click', () => teacherSignOut());

    root.querySelector('#tc-cluster')?.addEventListener('click', async () => {
      clustering = true;
      renderDashboard();
      const res = await clusterAnswers(textAnswers);
      clustering = false;
      clusters = res;
      renderDashboard();
      if (!res) {
        const btn = root.querySelector('#tc-cluster');
        if (btn) btn.textContent = '묶기 실패 — 다시 시도';
      }
    });
  }

  function rateRow(item, answers) {
    const mine = answers.filter((a) => a.qid === item.id && a.type === 'choice');
    const n = mine.length;
    const ok = mine.filter((a) => a.correct).length;
    const pct = n ? Math.round((ok / n) * 100) : null;

    // 정답률이 낮을수록 진하게 — 눈에 먼저 들어와야 하는 쪽이 낮은 문항입니다.
    const heat = pct === null ? 0 : (100 - pct) / 100;

    return `
      <div class="tc__rate">
        <div class="tc__rateHead">
          <span class="tc__rateQ">${esc(item.question)}</span>
          <b class="mono">${pct === null ? '—' : `${pct}%`}</b>
        </div>
        <div class="tc__bar"><i style="width:${pct ?? 0}%"></i></div>
        <div class="tc__rateSub mono" style="--heat:${heat.toFixed(2)}">
          ${n}명 응답 · 정답 ${ok}명${item.section ? ` · ${sectionName(item.section)}` : ''}
        </div>
      </div>`;
  }

  function groupTable(claims) {
    const groups = [1, 2, 3, 4, 5, 6];
    return `
      <div class="tc__groups">
        ${groups
          .map((g) => {
            const mine = claims.filter((c) => c.groupId === g);
            const done = mine.filter((c) => c.status === 'submitted').length;
            return `<div class="tc__group">
              <b>${g}모둠</b>
              <span class="mono">${done} / ${mine.length || 0}</span>
              <em>맡은 칸 ${mine.length}개 중 제출 ${done}개</em>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  function answerCard(a) {
    return `
      <article class="tc__answer">
        <div class="tc__ahead">
          <b>${esc(a.name || '이름 없음')}</b>
          <span class="mono">${a.groupId ? `${a.groupId}모둠` : ''} ${esc(a.studentId || '')}</span>
        </div>
        <p class="tc__atext">${esc(a.raw)}</p>
        ${
          typeof a.level === 'number'
            ? `<p class="tc__alevel mono" data-low="${a.level <= 2}">채점 수준 ${a.level}</p>`
            : ''
        }
      </article>`;
  }

  function clusterHtml(list, answers) {
    const byId = new Map(answers.map((a) => [a.docId, a]));
    return `
      <div class="tc__clusters">
        ${list
          .map(
            (c) => `
          <div class="tc__cluster">
            <div class="tc__chead">
              <b>${esc(c.label)}</b>
              <span class="mono">${c.answerIds.length}명</span>
            </div>
            <p>${esc(c.description)}</p>
            <p class="tc__csuggest">→ ${esc(c.suggestion)}</p>
            <p class="tc__cnames">${c.answerIds
              .map((id) => esc(byId.get(id)?.name || '?'))
              .join(', ')}</p>
          </div>`
          )
          .join('')}
      </div>`;
  }

  return () => {
    unsubAuth?.();
    unsubData?.();
  };
}

function stat(label, value) {
  return `<div class="tc__stat"><b class="mono">${value}</b><span>${label}</span></div>`;
}

function sectionName(s) {
  return { timeline: '타임라인', explore: '데이터 탐구', court: '가설 법정' }[s] || s;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
