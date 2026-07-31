import * as store from '../store.js';
import { go } from '../router.js';
import { joinClass, authErrorMessage } from '../services/auth.js';
import { configured } from '../firebase.js';

/* 홈 — 학번·이름·모둠번호를 받고 익명 로그인까지 마칩니다.
 *
 * 여기서 발급받은 uid 가 marks·claims·quizAnswers 문서 이름의 앞부분이 되고,
 * 보안 규칙이 그 uid 를 검사해 "남의 데이터는 건드릴 수 없다"를 보장합니다.
 */

const GROUPS = [1, 2, 3, 4, 5, 6];

export default function home(outlet) {
  const u = store.get('user');

  outlet.innerHTML = `
    <div class="wrap home">
      <div class="home__brand">
        <p class="home__eyebrow mono">고1 통합과학2</p>
        <h1 class="home__title">지질시대와<br />대멸종</h1>
        <p class="home__sub">46억 년을 직접 스크롤하고, 다섯 번의 대멸종을 데이터로 판정합니다.</p>
      </div>

      <form id="join" novalidate>
        <label class="field">
          <span class="field__label">학번</span>
          <input class="field__input" id="f-sid" inputmode="numeric"
                 autocomplete="off" placeholder="예: 10315" value="${esc(u.studentId)}" />
        </label>

        <label class="field">
          <span class="field__label">이름</span>
          <input class="field__input" id="f-name"
                 autocomplete="off" placeholder="예: 김지질" value="${esc(u.name)}" />
        </label>

        <fieldset class="field home__groups">
          <legend class="field__label">모둠</legend>
          <div class="home__grouprow">
            ${GROUPS.map(
              (g) => `
              <label class="chip">
                <input type="radio" name="grp" value="${g}" ${u.groupId === g ? 'checked' : ''} />
                <span>${g}모둠</span>
              </label>`
            ).join('')}
          </div>
        </fieldset>

        <p class="err" id="f-err" role="alert"></p>
        <button class="btn home__submit" type="submit">시작하기</button>
      </form>

      <p class="home__note">
        입력한 학번과 이름은 이 수업의 활동 기록에만 쓰입니다.
      </p>

      ${
        configured
          ? ''
          : `<p class="home__warn">Firebase 설정 전입니다. 입력한 내용은 이 브라우저에만
             저장되고 서버로 올라가지 않습니다. (.env.local 을 채우면 해결됩니다)</p>`
      }
    </div>
  `;

  const form = outlet.querySelector('#join');
  const err = outlet.querySelector('#f-err');
  const submit = outlet.querySelector('.home__submit');

  async function onSubmit(e) {
    e.preventDefault();

    const studentId = outlet.querySelector('#f-sid').value.trim();
    const name = outlet.querySelector('#f-name').value.trim();
    const picked = outlet.querySelector('input[name="grp"]:checked');

    if (!studentId) return fail('학번을 입력해 주세요.');
    if (!/^\d{4,6}$/.test(studentId)) return fail('학번은 숫자 4~6자리로 입력해 주세요.');
    if (!name) return fail('이름을 입력해 주세요.');
    if (name.length > 20) return fail('이름이 너무 깁니다.');
    if (!picked) return fail('모둠을 선택해 주세요.');

    err.textContent = '';
    setBusy(true);

    try {
      // 익명 로그인 + sessions/{세션}/students/{uid} 등록
      await joinClass({ studentId, name, groupId: Number(picked.value) });
      // 타임라인이 아니라 선개념 확인으로 갑니다. 수업 전 상태를 먼저 남깁니다.
      go('#/precheck');
    } catch (e2) {
      console.error('[home] 로그인 실패:', e2);
      fail(authErrorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  function setBusy(on) {
    store.patch('ui', { busy: on });
    submit.disabled = on;
    submit.textContent = on ? '연결하는 중…' : '시작하기';
  }

  function fail(msg) {
    err.textContent = msg;
  }

  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
