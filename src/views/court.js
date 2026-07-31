import { loadHypotheses } from '../data/loader.js';
import {
  claimCell,
  savePatch,
  subscribeClaims,
  emptyClaim,
  CRITERIA,
  HOLD,
} from '../services/claims.js';
import { createRadar } from '../components/radar.js';
import { fetchRebuttals } from '../services/ai.js';
import { configured } from '../firebase.js';
import * as store from '../store.js';

/* 가설 법정 — 5개 사건 × 4개 가설 = 20칸.
 *
 * ── 절대 하지 않는 것 ─────────────────────────────────────────
 * evidenceStrength 를 학생 화면에 노출하지 않습니다. 매트릭스에서 "이 칸은
 * 증거가 약함"이라고 미리 알려주면 조사할 이유가 사라집니다.
 * 증거가 없는 칸(E1-H4, E3-H4)도 똑같이 선택할 수 있게 둡니다.
 * "증거를 찾지 못했다"는 결론에 도달하는 것 자체가 이 활동의 목표이고,
 * 그 결론도 정당한 판정으로 제출됩니다.
 * criteriaAnswerKey 와 teacherNote 도 교사용이라 화면에 쓰지 않습니다.
 *
 * ── 교육과정 표기 규칙 ────────────────────────────────────────
 * 학생 화면에는 studentLabel / studentEra 만 씁니다.
 * 기(紀) 명칭과 정확한 연대는 "심화 보기" 안에만 둡니다.
 */

const SAVE_DELAY = 600; // 타이핑이 멈추고 이만큼 뒤에 저장합니다

export default async function court(outlet) {
  const hyp = await loadHypotheses();
  const { events, hypotheses, criteria, cells } = hyp;

  const cellAt = (eventId, hypothesisId) =>
    cells.find((c) => c.eventId === eventId && c.hypothesisId === hypothesisId);

  let selectedId = null;
  let radar = null;
  const timers = new Map();

  outlet.innerHTML = '<div class="ct" id="ct-root"></div>';
  const root = outlet.querySelector('#ct-root');

  const unsubStore = store.subscribe('claims', onRemoteChange);
  const unsubRemote = subscribeClaims(() =>
    flash('학급 데이터 연결에 문제가 있습니다. 보안 규칙을 확인해 주세요.')
  );

  function onRemoteChange() {
    if (selectedId) syncDetail();
    else renderMatrix();
  }

  /* ── 매트릭스 ─────────────────────────────────────────── */
  function renderMatrix() {
    const { locks, byCell } = store.get('claims');
    const myGroup = store.get('user').groupId;

    root.innerHTML = `
      <header class="ct__head wrap">
        <p class="ct__eyebrow mono">가설 법정</p>
        <h1 class="ct__title">어떤 원인이 이 멸종을 설명하는가</h1>
        <p class="ct__lead">
          칸을 하나 골라 우리 모둠이 맡습니다. 증거를 읽고 네 기준으로 판정한 뒤,
          반론에 답하고 제출합니다. 한 칸은 한 모둠만 맡을 수 있고,
          다른 모둠의 칸은 열람만 됩니다.
        </p>
      </header>

      <div class="ct__matrixWrap">
        <table class="ct__matrix">
          <thead>
            <tr>
              <td class="ct__corner"></td>
              ${hypotheses
                .map((h) => `<th scope="col"><span>${esc(shortHyp(h.name))}</span></th>`)
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${events
              .map(
                (ev) => `
              <tr>
                <th scope="row">
                  <b>${esc(ev.studentLabel)}</b>
                  <em>${esc(ev.studentEra)}</em>
                </th>
                ${hypotheses
                  .map((h) => cellCell(ev, h, locks, byCell, myGroup))
                  .join('')}
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="ct__legend wrap">
        ${hypotheses.map((h) => `<span><b>${esc(shortHyp(h.name))}</b> ${esc(h.name)}</span>`).join('')}
      </div>

      <div class="wrap"><a class="btn btn--ghost ct__next" href="#/quiz">형성평가로</a></div>

      <p class="ct__msg wrap" id="ct-msg" role="status"></p>

      ${
        configured
          ? ''
          : `<p class="ct__warn wrap">Firebase 설정 전이라 점유·판정이 이 브라우저에만 남습니다.</p>`
      }
    `;

    root.querySelectorAll('[data-cell]').forEach((btn) => {
      btn.addEventListener('click', () => openCell(btn.dataset.cell));
    });
  }

  function cellCell(ev, h, locks, byCell, myGroup) {
    const cell = cellAt(ev.id, h.id);
    if (!cell) return '<td></td>';

    const lock = locks[cell.id];
    const claim = byCell[cell.id];
    const submitted = claim?.status === 'submitted';
    const mine = lock && lock.groupId === myGroup;

    let cls = 'ct__cell';
    let label = '맡기';
    if (submitted) {
      cls += ' ct__cell--done';
      label = `${lock.groupId}모둠 제출`;
    } else if (mine) {
      cls += ' ct__cell--mine';
      label = '우리 모둠';
    } else if (lock) {
      cls += ' ct__cell--other';
      label = `${lock.groupId}모둠`;
    } else {
      cls += ' ct__cell--free';
    }

    return `<td>
      <button class="${cls}" data-cell="${cell.id}" type="button"
        aria-label="${esc(ev.studentLabel)} × ${esc(h.name)} — ${label}">
        <span>${label}</span>
      </button>
    </td>`;
  }

  /* ── 칸 상세 ──────────────────────────────────────────── */
  async function openCell(cellId) {
    selectedId = cellId;
    renderDetail();
  }

  function renderDetail() {
    const cell = cells.find((c) => c.id === selectedId);
    const ev = events.find((e) => e.id === cell.eventId);
    const h = hypotheses.find((x) => x.id === cell.hypothesisId);

    const { locks, byCell } = store.get('claims');
    const myGroup = store.get('user').groupId;
    const lock = locks[cell.id];
    const claim = byCell[cell.id] || emptyClaim(cell.id, myGroup);

    const owned = lock && lock.groupId === myGroup;
    const readOnly = !owned || claim.status === 'submitted';

    root.innerHTML = `
      <div class="ct__detail">
        <button class="ct__back" id="ct-back" type="button">← 전체 칸으로</button>

        <header class="ct__dhead wrap">
          <p class="ct__eyebrow mono">${esc(ev.studentLabel)} · ${esc(ev.studentEra)}</p>
          <h1 class="ct__dtitle">${esc(h.name)}</h1>
          <p class="ct__owner" id="ct-owner"></p>
        </header>

        <div class="wrap">
          <details class="ct__adv">
            <summary>심화 보기</summary>
            <p><b>${esc(ev.teacherLabel)}</b> · 약 ${ev.ageMa[0]}~${ev.ageMa[1]}백만 년 전</p>
            <p>${esc(ev.marineGenusLossEstimate)}</p>
          </details>

          <section class="ct__sec">
            <h2 class="ct__h2">이 사건은</h2>
            <p>${esc(ev.distinctiveFeature)}</p>
          </section>

          <section class="ct__sec">
            <h2 class="ct__h2">이 가설의 주장</h2>
            <p>${esc(h.mechanism)}</p>
            ${h.evidenceType ? `<p class="ct__sub">찾아볼 증거의 종류 — ${esc(h.evidenceType)}</p>` : ''}
          </section>

          <section class="ct__sec">
            <h2 class="ct__h2">증거 카드 <em>${cell.cards.length}장</em></h2>
            ${cell.cards
              .map(
                (c) => `
              <article class="ct__card">
                <p class="ct__claim">${esc(c.claim)}</p>
                <p class="ct__cdetail">${esc(c.detail)}</p>
                <p class="ct__src mono">${esc(c.sourceType)}</p>
              </article>`
              )
              .join('')}
          </section>

          ${lock ? judgeSection(criteria, claim, readOnly) : claimPrompt()}

          ${lock ? extraSections(cell, claim, readOnly) : ''}

          <p class="ct__msg" id="ct-msg" role="status"></p>
        </div>
      </div>
    `;

    root.querySelector('#ct-back').addEventListener('click', () => {
      selectedId = null;
      radar?.destroy();
      radar = null;
      renderMatrix();
    });

    const claimBtn = root.querySelector('#ct-claim');
    if (claimBtn) claimBtn.addEventListener('click', onClaim);

    if (owned && claim.status !== 'submitted') wireInputs();
    if (lock) wireExtras(cell, claim, readOnly);

    syncDetail();
  }

  function claimPrompt() {
    return `
      <section class="ct__sec ct__claimbox">
        <p>이 칸은 아직 아무 모둠도 맡지 않았습니다.</p>
        <button class="btn" id="ct-claim" type="button">우리 모둠이 맡기</button>
      </section>`;
  }

  function judgeSection(criteria, claim, readOnly) {
    return `
      <section class="ct__sec">
        <h2 class="ct__h2">판정</h2>
        <p class="ct__sub">
          네 기준마다 점수를 정하고 그렇게 본 근거를 씁니다.
          판단할 수 없으면 <b>판단 보류</b>를 고르는 것도 정당한 결론입니다.
        </p>
        ${criteria
          .map(
            (c) => `
          <div class="ct__crit" data-crit="${c.id}">
            <h3 class="ct__critLabel">${esc(c.label)}</h3>
            <p class="ct__tip">${esc(c.tooltip)}</p>

            <div class="ct__scale">
              <input type="range" min="1" max="5" step="1"
                     id="sc-${c.id}" ${readOnly ? 'disabled' : ''} />
              <output class="mono" id="out-${c.id}"></output>
            </div>
            <div class="ct__scaleEnds mono"><span>아니다</span><span>그렇다</span></div>

            <label class="ct__hold">
              <input type="checkbox" id="hold-${c.id}" ${readOnly ? 'disabled' : ''} />
              <span>판단 보류 — 지금 자료로는 정할 수 없다</span>
            </label>

            <textarea class="ct__reason" id="rs-${c.id}" rows="3"
              placeholder="증거 카드의 어느 내용을 근거로 그렇게 보았나요?"
              ${readOnly ? 'disabled' : ''}></textarea>
          </div>`
          )
          .join('')}
      </section>`;
  }

  function extraSections(cell, claim, readOnly) {
    return `
      <section class="ct__sec">
        <h2 class="ct__h2">반론</h2>
        <p class="ct__sub">네 기준의 근거를 모두 쓰면 반론을 받을 수 있습니다.</p>
        <button class="btn btn--ghost" id="ct-rebut" type="button" ${readOnly ? 'disabled' : ''}>
          반론 받기
        </button>
        <div class="ct__rebuttals" id="ct-rebuttals"></div>

        <label class="ct__counterLabel" for="ct-counter">재반박</label>
        <textarea class="ct__reason" id="ct-counter" rows="4"
          placeholder="반론에 대해 어떻게 답하시겠습니까? 판정을 바꿔야 한다면 그것도 결론입니다."
          ${readOnly ? 'disabled' : ''}></textarea>
      </section>

      <section class="ct__sec ct__submit">
        <div class="ct__radarWrap" id="ct-radarWrap" hidden>
          <canvas id="ct-radar"></canvas>
        </div>
        <button class="btn" id="ct-submitBtn" type="button" ${readOnly ? 'disabled' : ''}>
          ${claim.status === 'submitted' ? '제출 완료' : '판정 제출'}
        </button>
      </section>`;
  }

  /* ── 입력 연결 ────────────────────────────────────────── */
  function wireInputs() {
    for (const id of CRITERIA) {
      const slider = root.querySelector(`#sc-${id}`);
      const hold = root.querySelector(`#hold-${id}`);
      const reason = root.querySelector(`#rs-${id}`);
      const out = root.querySelector(`#out-${id}`);
      if (!slider) continue;

      slider.addEventListener('input', () => {
        out.textContent = slider.value;
        hold.checked = false;
        queueSave(`sc-${id}`, { scores: { [id]: Number(slider.value) } });
      });

      hold.addEventListener('change', () => {
        slider.disabled = hold.checked;
        out.textContent = hold.checked ? '보류' : slider.value;
        // 보류는 HOLD(0) 로 저장합니다. null 로 두면 "아직 안 정함"과 구분되지 않습니다.
        queueSave(`sc-${id}`, { scores: { [id]: hold.checked ? HOLD : Number(slider.value) } });
      });

      reason.addEventListener('input', () => {
        queueSave(`rs-${id}`, { reasons: { [id]: reason.value } });
      });
    }
  }

  function wireExtras(cell, claim, readOnly) {
    const rebutBtn = root.querySelector('#ct-rebut');
    const counter = root.querySelector('#ct-counter');
    const submitBtn = root.querySelector('#ct-submitBtn');

    rebutBtn?.addEventListener('click', async () => {
      const cur = store.get('claims').byCell[cell.id] || claim;
      const missing = CRITERIA.filter((c) => !(cur.reasons?.[c] || '').trim());
      if (missing.length) {
        flash(`아직 근거를 쓰지 않은 기준이 ${missing.length}개 있습니다.`);
        return;
      }

      const ev = events.find((e) => e.id === cell.eventId);
      const h = hypotheses.find((x) => x.id === cell.hypothesisId);

      rebutBtn.disabled = true;
      rebutBtn.textContent = '반론을 준비하는 중…';

      /* AI 가 모둠의 근거를 읽고 되묻는 질문을 만듭니다.
         실패하거나 느리면(교실 와이파이, 한도 초과, 함수 미배포)
         hypotheses.json 에 칸마다 준비된 rebuttalSeeds 로 되돌아갑니다.
         AI 때문에 수업이 멈추지 않게 하는 것이 이 폴백의 목적입니다. */
      const ai = await fetchRebuttals({
        event: {
          studentLabel: ev.studentLabel,
          studentEra: ev.studentEra,
          distinctiveFeature: ev.distinctiveFeature,
        },
        hypothesis: { name: h.name, mechanism: h.mechanism },
        cards: cell.cards.map((c) => ({ claim: c.claim })),
        criteria: criteria.map((c) => ({ id: c.id, label: c.label })),
        scores: cur.scores || {},
        reasons: cur.reasons || {},
      });

      const rebuttals =
        ai?.rebuttals?.length
          ? ai.rebuttals
          : (cell.rebuttalSeeds || []).slice(0, 2).map((t) => ({ text: t, source: 'seed' }));

      await savePatch(cell.id, { rebuttals });

      rebutBtn.disabled = false;
      rebutBtn.textContent = '반론 다시 받기';
      if (!ai) flash('준비된 반론으로 진행합니다.');
    });

    counter?.addEventListener('input', () => {
      if (readOnly) return;
      queueSave('counter', { counter: counter.value });
    });

    submitBtn?.addEventListener('click', async () => {
      const cur = store.get('claims').byCell[cell.id] || claim;

      const noScore = CRITERIA.filter((c) => {
        const v = cur.scores?.[c];
        return v === null || v === undefined;   // HOLD(0) 은 정해진 것으로 봅니다
      });
      if (noScore.length) {
        flash(`아직 정하지 않은 기준이 ${noScore.length}개 있습니다. 판단 보류도 하나의 결론입니다.`);
        return;
      }

      const noReason = CRITERIA.filter((c) => !(cur.reasons?.[c] || '').trim());
      if (noReason.length) {
        flash(`근거를 쓰지 않은 기준이 ${noReason.length}개 있습니다.`);
        return;
      }

      const r = await savePatch(cell.id, { status: 'submitted' });
      if (r === 'ok') {
        flash('제출했습니다.');
        renderDetail();     // 제출 후에는 읽기 전용으로 다시 그립니다
      } else {
        flash('제출에 실패했습니다.');
      }
    });
  }

  /* 타이핑이 멈춘 뒤에만 씁니다. 글자마다 쓰면 30명분 쓰기가 폭주합니다. */
  function queueSave(key, partial) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => savePatch(selectedId, partial), SAVE_DELAY));
  }

  /* ── 원격 변경을 화면에 반영 ─────────────────────────────
     지금 입력 중인 칸은 건드리지 않습니다. 같은 모둠원이 다른 기준을
     수정했을 때 내가 쓰던 글이 지워지지 않게 하는 부분입니다. */
  /** 지금 이 칸이 읽기 전용인지 (다른 모둠 칸이거나 이미 제출됨) */
  function readOnlyNow() {
    const { locks, byCell } = store.get('claims');
    const lock = locks[selectedId];
    const claim = byCell[selectedId];
    return !lock || lock.groupId !== store.get('user').groupId || claim?.status === 'submitted';
  }

  function syncDetail() {
    if (!selectedId) return;
    const { locks, byCell } = store.get('claims');
    const lock = locks[selectedId];
    const claim = byCell[selectedId];

    const owner = root.querySelector('#ct-owner');
    if (owner) {
      const my = lock && lock.groupId === store.get('user').groupId;
      owner.textContent = !lock
        ? '아직 맡은 모둠이 없습니다'
        : `${lock.groupId}모둠${my ? ' (우리 모둠)' : ' — 열람만 가능합니다'}` +
          (claim?.updatedBy?.name ? ` · 마지막 수정 ${claim.updatedBy.name}` : '');
    }

    if (!claim) return;

    for (const id of CRITERIA) {
      const slider = root.querySelector(`#sc-${id}`);
      const hold = root.querySelector(`#hold-${id}`);
      const reason = root.querySelector(`#rs-${id}`);
      const out = root.querySelector(`#out-${id}`);
      if (!slider) continue;

      const v = claim.scores?.[id];
      if (document.activeElement !== slider && document.activeElement !== hold) {
        const held = v === HOLD;
        const unset = v === null || v === undefined;
        hold.checked = held;
        slider.value = unset || held ? 3 : v;
        if (!readOnlyNow()) slider.disabled = held;
        out.textContent = held ? '보류' : unset ? '—' : String(v);
      }
      if (document.activeElement !== reason) reason.value = claim.reasons?.[id] ?? '';
    }

    const counter = root.querySelector('#ct-counter');
    if (counter && document.activeElement !== counter) counter.value = claim.counter ?? '';

    const box = root.querySelector('#ct-rebuttals');
    if (box) {
      box.innerHTML = (claim.rebuttals || [])
        .map((r, i) => `<div class="ct__rebut"><b>반론 ${i + 1}</b><p>${esc(r.text)}</p></div>`)
        .join('');
    }

    if (claim.status === 'submitted') showRadar(claim);
  }

  function showRadar(claim) {
    const wrap = root.querySelector('#ct-radarWrap');
    const canvas = root.querySelector('#ct-radar');
    if (!wrap || !canvas) return;
    wrap.hidden = false;
    radar?.destroy();
    radar = createRadar(canvas, criteria, claim.scores || {});
  }

  async function onClaim() {
    const r = await claimCell(selectedId);
    if (r === 'taken') flash('방금 다른 모둠이 먼저 맡았습니다. 다른 칸을 골라 주세요.');
    else if (r === 'error') flash('맡기에 실패했습니다. 네트워크를 확인해 주세요.');
    renderDetail();
  }

  let flashTimer = 0;
  function flash(text) {
    const el = root.querySelector('#ct-msg');
    if (!el) return;
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.textContent = ''), 3200);
  }

  renderMatrix();

  return () => {
    for (const t of timers.values()) clearTimeout(t);
    clearTimeout(flashTimer);
    radar?.destroy();
    unsubStore();
    unsubRemote();
  };
}

function shortHyp(name) {
  return name.replace('설', '').replace('기후 변화', '기후').replace('해양 무산소', '무산소');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
