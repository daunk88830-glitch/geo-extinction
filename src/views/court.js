import { loadHypotheses, loadDiversity, loadClimate } from '../data/loader.js';
import {
  claimEvent,
  savePatch,
  subscribeVerdicts,
  emptyVerdict,
  CRITERIA,
  HYPS,
  LEVELS,
  HOLD,
} from '../services/verdicts.js';
import { createRadar } from '../components/radar.js';
import { createChartStack } from '../components/chartStack.js';
import { GROUPS } from '../data/groups.js';
import { fetchRebuttals } from '../services/ai.js';
import { MECHANISM } from '../data/mechanisms.js';
import { eventStrip, evidenceBadge } from '../components/courtArt.js';
import { configured } from '../firebase.js';
import { ensureEnrolled } from '../services/auth.js';
import * as store from '../store.js';

/* 대멸종의 원인을 찾아보자! (가설 검증)
 *
 * 한 모둠이 대멸종 사건 하나를 맡아 네 가설을 모두 검토합니다.
 *
 *   1단계  네 가설의 증거를 읽고 3단계로 빠르게 판정 + 한 줄 근거
 *   2단계  가장 잘 설명한다고 본 가설 하나를 골라
 *          기준 4개로 깊이 판정 → AI 반론 → 재반박 → 제출
 *
 * ── 절대 하지 않는 것 ─────────────────────────────────────────
 * evidenceStrength 를 화면에 노출하지 않습니다. 어느 가설의 증거가 약한지
 * 미리 알려주면 조사할 이유가 사라집니다. 증거가 없는 조합(대멸종 1·3 의
 * 충돌설)도 똑같이 검토 대상으로 두고, "설명하지 못함"이라는 결론에
 * 도달하는 것 자체를 정당한 판정으로 받습니다.
 * criteriaAnswerKey 와 teacherNote 는 학생용 데이터에 아예 없습니다.
 *
 * ── 교육과정 표기 규칙 ────────────────────────────────────────
 * 학생 화면에는 studentLabel / studentEra 만 씁니다.
 * 기(紀) 명칭과 연대는 "심화 보기" 안에만 둡니다.
 */

const SAVE_DELAY = 600;

export default async function court(outlet) {
  const hyp = await loadHypotheses();
  const { events, hypotheses, criteria, cells } = hyp;

  const cellAt = (eventId, hypothesisId) =>
    cells.find((c) => c.eventId === eventId && c.hypothesisId === hypothesisId);
  const hypById = (id) => hypotheses.find((h) => h.id === id);

  let selectedId = null;
  let radar = null;
  let dataStack = null;      // 판정 화면 안에서 다시 펼쳐 보는 그래프 묶음
  let detailGen = 0;         // 화면이 바뀌면 올라갑니다 (뒤늦게 끝난 로딩 버리기)
  const timers = new Map();
  /* 아직 서버에 닿지 않은 편집. 화면 갱신이 이 칸을 덮어쓰지 못하게 막습니다.
     (입력 → 600ms 대기 중에 다른 칸을 건드리면, 그쪽 저장의 응답이 먼저 와서
      아직 저장 안 된 이 칸을 빈 값으로 되돌려 버립니다) */
  const pending = new Set();
  let flashTimer = 0;

  outlet.innerHTML = '<div class="ct" id="ct-root"></div>';
  const root = outlet.querySelector('#ct-root');

  const unsubStore = store.subscribe('verdicts', onRemoteChange);
  const unsubRemote = subscribeVerdicts(() =>
    flash('학급 데이터 연결에 문제가 있습니다. 보안 규칙을 확인해 주세요.')
  );

  function onRemoteChange() {
    if (selectedId) syncDetail();
    else renderList();
  }

  /* ── 사건 목록 ──────────────────────────────────────────── */
  function renderList() {
    const { locks, byEvent } = store.get('verdicts');
    const myGroup = store.get('user').groupId;

    root.innerHTML = `
      <header class="ct__head wrap">
        <p class="ct__eyebrow mono">대멸종의 원인을 찾아보자! (가설 검증)</p>
        <h1 class="ct__title">어떤 원인이 이 멸종을 설명하는가</h1>
        <p class="ct__lead">
          우리 모둠은 대멸종 하나를 맡습니다. 네 가지 원인을 <b>모두</b> 검토한 뒤,
          가장 잘 설명하는 하나를 골라 자세히 판정합니다.
          한 사건은 한 모둠만 맡을 수 있고, 다른 모둠의 사건은 열람만 됩니다.
        </p>
      </header>

      <section class="ct__events wrap">
        ${events.map((ev) => eventCard(ev, locks[ev.id], byEvent[ev.id], myGroup)).join('')}
      </section>

      <div class="ct__groupKey">
        ${GROUPS.map((g) => `<span><i></i>${g}모둠</span>`).join('')}
      </div>

      <section class="ct__guide wrap">
        <h2 class="ct__h2">검토할 네 가지 원인</h2>
        <div class="ct__mechs">${hypotheses.map(mechCard).join('')}</div>
      </section>

      ${boardHtml(byEvent, locks)}

      <p class="ct__msg wrap" id="ct-msg" role="status"></p>

      <div class="wrap"><a class="btn btn--ghost ct__next" href="#/quiz">형성평가로</a></div>

      ${
        configured
          ? ''
          : '<p class="ct__warn wrap">Firebase 설정 전이라 점유·판정이 이 브라우저에만 남습니다.</p>'
      }
    `;

    root.querySelectorAll('[data-event]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedId = btn.dataset.event;
        renderDetail();
      });
    });
  }

  function eventCard(ev, lock, verdict, myGroup) {
    const mine = lock && lock.groupId === myGroup;
    const done = verdict?.status === 'submitted';
    const screened = HYPS.filter((h) => verdict?.screen?.[h]?.level).length;

    let state = '아직 맡은 모둠 없음';
    let cls = 'ct__event ct__event--free';
    if (done) {
      state = `${lock.groupId}모둠 제출 완료 · ${hypById(verdict.chosen)?.name ?? ''}`;
      cls = 'ct__event ct__event--done';
    } else if (lock) {
      state = `${lock.groupId}모둠 진행 중 · 네 가설 중 ${screened}개 검토`;
      cls = `ct__event ${mine ? 'ct__event--mine' : 'ct__event--other'}`;
    }

    return `
      <button class="${cls}" data-event="${ev.id}"${lock ? ` data-group="${lock.groupId}"` : ''} type="button">
        <span class="ct__eventName">
          <b>${esc(ev.studentLabel)}</b>
          <em>${esc(ev.studentEra)}</em>
        </span>
        <span class="ct__eventState">${esc(state)}</span>
        <span class="ct__eventGo">${lock && !mine ? '열람' : mine ? '이어서 하기' : '맡기'} →</span>
      </button>`;
  }

  /* 학급 전체 결과판 — 제출된 사건만 채워집니다. */
  function boardHtml(byEvent, locks) {
    const any = Object.values(byEvent || {}).some((v) => v?.status === 'submitted');
    if (!any) return '';

    return `
      <section class="ct__board wrap">
        <h2 class="ct__h2">학급 전체 판정</h2>
        <div class="ct__boardWrap">
          <table class="ct__matrix">
            <thead>
              <tr><td class="ct__corner"></td>
                ${hypotheses.map((h) => `<th scope="col"><span>${esc(shortHyp(h.name))}</span></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${events
                .map((ev) => {
                  const v = byEvent[ev.id];
                  const g = locks[ev.id]?.groupId;
                  if (v?.status !== 'submitted') {
                    return `<tr><th scope="row"><b>${esc(ev.studentLabel)}</b></th>
                      <td colspan="4" class="ct__pending">아직 제출 전</td></tr>`;
                  }
                  return `<tr${g ? ` data-group="${g}"` : ''}>
                    <th scope="row"><b>${esc(ev.studentLabel)}</b><em>${g}모둠</em></th>
                    ${HYPS.map((h) => {
                      const lv = v.screen?.[h]?.level;
                      const chosen = v.chosen === h;
                      return `<td class="ct__verdict ct__verdict--${lv || 'none'}${
                        chosen ? ' ct__verdict--chosen' : ''
                      }">${lv ? esc(levelLabel(lv)) : '—'}${chosen ? '<i>★</i>' : ''}</td>`;
                    }).join('')}
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <p class="ct__boardNote">★ 는 그 모둠이 최종으로 고른 원인입니다.</p>
      </section>`;
  }

  /* 화면을 갈아 끼우기 전에 캔버스를 붙잡고 있던 것들을 놓아 줍니다.
     innerHTML 로 지우기만 하면 Chart.js 인스턴스가 리스너를 든 채 남습니다. */
  function teardownDetail() {
    radar?.destroy();
    radar = null;
    dataStack?.destroy?.();   // 아직 불러오는 중이면 destroy 가 없습니다
    dataStack = null;
    detailGen++;              // 진행 중인 자료 불러오기를 무효로 만듭니다
  }

  /* ── 사건 상세 ──────────────────────────────────────────── */
  function renderDetail() {
    teardownDetail();
    const ev = events.find((e) => e.id === selectedId);
    const { locks, byEvent } = store.get('verdicts');
    const myGroup = store.get('user').groupId;
    const lock = locks[ev.id];
    const v = byEvent[ev.id] || emptyVerdict(ev.id, myGroup);

    const owned = lock && lock.groupId === myGroup;
    const readOnly = !owned || v.status === 'submitted';

    root.innerHTML = `
      <div class="ct__detail">
        <button class="ct__back" id="ct-back" type="button">← 사건 목록으로</button>

        <header class="ct__dhead wrap">
          <p class="ct__eyebrow mono">${esc(ev.studentEra)}</p>
          <h1 class="ct__dtitle">${esc(ev.studentLabel)}</h1>
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
            <!-- 현생누대 어디쯤인지 + 다른 사건으로 건너뛰는 길.
                 데이터 탐구에서 본 시간축과 방향이 같습니다. -->
            <div class="ct__stripBox">${eventStrip(events, ev.id, locks)}</div>
            <p class="ct__body">${esc(ev.distinctiveFeature)}</p>
          </section>

          <!-- 자료 다시 보기.
               판정과 재반박을 쓰려면 결국 "그때 기온이 어땠는지"를 다시 봐야 하는데,
               데이터 탐구로 나갔다 오면 쓰던 글이 날아갑니다. 그래서 같은 그래프를
               이 화면 안에 접어 둡니다. 펼칠 때 처음 만들기 때문에, 안 펼치면
               차트 4개를 만드는 비용도 들지 않습니다. -->
          <details class="ct__sec ct__data" id="ct-data">
            <summary class="ct__dataSum">
              자료 다시 보기
              <em>생물 다양성 · 화석 기록 수 · 기온 · 이산화 탄소</em>
            </summary>
            <div id="ct-dataMount"></div>
          </details>

          ${lock ? stage1(ev, v, readOnly) : claimPrompt()}
          ${lock ? stage2(ev, v, readOnly) : ''}

          <p class="ct__msg" id="ct-msg" role="status"></p>
        </div>
      </div>
    `;

    root.querySelector('#ct-back').addEventListener('click', () => {
      selectedId = null;
      teardownDetail();
      renderList();
    });

    // 펼칠 때 처음 만듭니다. 접힌 상태로 만들면 캔버스 크기가 0 이라 눈금이 깨집니다.
    root.querySelector('#ct-data')?.addEventListener('toggle', (e) => {
      if (e.target.open) mountData();
    });

    root.querySelector('#ct-toData')?.addEventListener('click', () => {
      const d = root.querySelector('#ct-data');
      if (!d) return;
      d.open = true;
      mountData();
      d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    root.querySelector('#ct-claim')?.addEventListener('click', onClaim);

    // 위치 띠의 번호를 누르면 그 사건으로 바로 이동합니다.
    root.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.goto === selectedId) return;
        selectedId = btn.dataset.goto;
        renderDetail();
        window.scrollTo(0, 0);
      });
    });

    if (lock) wireDetail(ev, v, readOnly);
    syncDetail();
  }

  function claimPrompt() {
    return `
      <section class="ct__sec ct__claimbox">
        <p>이 사건은 아직 아무 모둠도 맡지 않았습니다.</p>
        <button class="btn" id="ct-claim" type="button">우리 모둠이 맡기</button>
      </section>`;
  }

  /* 1단계 — 네 가설 훑기 */
  function stage1(ev, v, readOnly) {
    return `
      <section class="ct__sec">
        <div class="ct__stage"><span class="mono">1단계</span> 네 가지 원인을 모두 검토</div>
        <p class="ct__sub">
          가설마다 증거 카드를 읽고 <b>이 사건을 얼마나 설명하는지</b> 고르세요.
          "설명하지 못함"도 정당한 결론입니다 — 증거가 없다는 것도 발견입니다.
        </p>

        ${hypotheses
          .map((h) => {
            const cell = cellAt(ev.id, h.id);
            const m = MECHANISM[h.id];
            return `
            <article class="ct__hyp" data-hyp="${h.id}">
              <header class="ct__hypHead">
                <span class="ct__mechIcon">${m?.icon ?? ''}</span>
                <b>${esc(h.name)}</b>
                <span class="ct__hypMark mono" id="mk-${h.id}"></span>
              </header>

              <details class="ct__how">
                <summary>이 가설은 어떤 과정으로 멸종에 이르나요?</summary>
                <ol class="ct__chain">${(m?.chain ?? []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
                <p class="ct__mechNote">${esc(h.mechanism)}</p>
              </details>

              <h3 class="ct__h3">증거 카드 <em>${cell?.cards.length ?? 0}장</em></h3>
              ${(cell?.cards ?? [])
                .map(
                  (c) => `
                <div class="ct__card">
                  ${evidenceBadge(c.sourceType)}
                  <p class="ct__claim">${esc(c.claim)}</p>
                  <p class="ct__cdetail">${esc(c.detail)}</p>
                </div>`
                )
                .join('')}

              <div class="ct__levels">
                ${LEVELS.map(
                  (l) => `
                  <label class="ct__level">
                    <input type="radio" name="lv-${h.id}" value="${l.value}" ${readOnly ? 'disabled' : ''} />
                    <span>${l.label}</span>
                  </label>`
                ).join('')}
              </div>

              <textarea class="ct__reason" id="sr-${h.id}" rows="2"
                placeholder="증거 카드의 어느 내용을 근거로 그렇게 보았나요? (한 줄)"
                ${readOnly ? 'disabled' : ''}></textarea>
            </article>`;
          })
          .join('')}
      </section>`;
  }

  /* 2단계 — 하나 골라 깊이 판정 */
  function stage2(ev, v, readOnly) {
    return `
      <section class="ct__sec">
        <div class="ct__stage"><span class="mono">2단계</span> 가장 잘 설명하는 원인 하나 고르기</div>
        <p class="ct__sub" id="ct-chooseHelp">
          네 가설을 모두 검토하면 여기서 하나를 고를 수 있습니다.
        </p>

        <div class="ct__choose" id="ct-choose">
          ${hypotheses
            .map(
              (h) => `
            <label class="ct__pick">
              <input type="radio" name="chosen" value="${h.id}" ${readOnly ? 'disabled' : ''} />
              <span>${esc(shortHyp(h.name))}</span>
            </label>`
            )
            .join('')}
        </div>

        <div id="ct-deep" hidden>
          <h3 class="ct__h3">고른 원인을 네 기준으로 판정</h3>
          <p class="ct__sub">판단할 수 없으면 <b>판단 보류</b>도 정당한 결론입니다.</p>

          ${criteria
            .map(
              (c) => `
            <div class="ct__crit" data-crit="${c.id}">
              <h4 class="ct__critLabel">${esc(c.label)}</h4>
              <p class="ct__tip">${esc(c.tooltip)}</p>
              <div class="ct__scale">
                <input type="range" min="1" max="5" step="1" id="sc-${c.id}" ${readOnly ? 'disabled' : ''} />
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

          <h3 class="ct__h3">반론</h3>
          <p class="ct__sub">네 기준의 근거를 모두 쓰면 반론을 받을 수 있습니다.</p>
          <button class="btn btn--ghost" id="ct-rebut" type="button" ${readOnly ? 'disabled' : ''}>
            반론 받기
          </button>
          <div class="ct__rebuttals" id="ct-rebuttals"></div>

          <div class="ct__counterHead">
            <label class="ct__counterLabel" for="ct-counter">재반박</label>
            <!-- 재반박은 이 화면에서 가장 아래에 있습니다. 여기까지 내려온 학생이
                 그래프를 다시 보려고 맨 위까지 스크롤하지 않도록 길을 놓아 둡니다. -->
            <button class="ct__toData" id="ct-toData" type="button">↑ 자료 다시 보기</button>
          </div>
          <textarea class="ct__reason" id="ct-counter" rows="4"
            placeholder="반론에 대해 어떻게 답하시겠습니까? 판정을 바꿔야 한다면 그것도 결론입니다."
            ${readOnly ? 'disabled' : ''}></textarea>

          <div class="ct__radarWrap" id="ct-radarWrap" hidden><canvas id="ct-radar"></canvas></div>
          <button class="btn ct__submitBtn" id="ct-submitBtn" type="button" ${readOnly ? 'disabled' : ''}>
            ${v.status === 'submitted' ? '제출 완료' : '판정 제출'}
          </button>
        </div>
      </section>`;
  }

  /* ── 입력 연결 ──────────────────────────────────────────── */
  function wireDetail(ev, v0, readOnly) {
    /* 1단계.
     *
     * 판정과 근거를 따로 보내면 안 됩니다. 둘 다 screen.{가설} 아래에 있어서,
     * 두 저장이 겹치면 나중에 도착한 쪽이 앞의 것을 지웁니다.
     * (근거를 치는 중에 판정 버튼을 누르면 근거가 사라지던 원인)
     *
     * 그래서 저장 단위를 "가설 하나"로 잡고, 보낼 때마다 화면에서 판정과 근거를
     * 함께 읽어 통째로 보냅니다. 어느 쪽을 건드리든 payload 가 같은 모양이라
     * 순서가 엇갈려도 서로를 지우지 않습니다.
     * 가설끼리는 여전히 필드가 나뉘어 있어 모둠원이 다른 가설을 맡아도 충돌하지 않습니다.
     */
    for (const h of HYPS) {
      const saveHyp = () => {
        const picked = root.querySelector(`input[name="lv-${h}"]:checked`);
        const sr = root.querySelector(`#sr-${h}`);
        queueSave(`h-${h}`, {
          screen: { [h]: { level: picked?.value ?? null, reason: sr?.value ?? '' } },
        });
      };

      root.querySelectorAll(`input[name="lv-${h}"]`).forEach((r) => {
        r.addEventListener('change', saveHyp);
      });
      root.querySelector(`#sr-${h}`)?.addEventListener('input', saveHyp);
    }

    // 2단계 — 가설 선택
    root.querySelectorAll('input[name="chosen"]').forEach((r) => {
      r.addEventListener('change', () => savePatch(selectedId, { chosen: r.value }));
    });

    // 2단계 — 기준 판정
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
        queueSave(`sc-${id}`, { scores: { [id]: hold.checked ? HOLD : Number(slider.value) } });
      });
      reason.addEventListener('input', () => {
        queueSave(`rs-${id}`, { reasons: { [id]: reason.value } });
      });
    }

    root.querySelector('#ct-counter')?.addEventListener('input', (e) => {
      if (readOnly) return;
      queueSave('counter', { counter: e.target.value });
    });

    root.querySelector('#ct-rebut')?.addEventListener('click', onRebut);
    root.querySelector('#ct-submitBtn')?.addEventListener('click', onSubmit);
  }

  async function onRebut() {
    const ev = events.find((e) => e.id === selectedId);
    const v = store.get('verdicts').byEvent[selectedId];
    const missing = CRITERIA.filter((c) => !(v?.reasons?.[c] || '').trim());
    if (missing.length) return flash(`아직 근거를 쓰지 않은 기준이 ${missing.length}개 있습니다.`);
    if (!v?.chosen) return flash('먼저 원인을 하나 고르세요.');

    const h = hypById(v.chosen);
    const cell = cellAt(ev.id, v.chosen);
    const btn = root.querySelector('#ct-rebut');
    btn.disabled = true;
    btn.textContent = '반론을 준비하는 중…';

    /* AI 가 모둠의 근거를 읽고 되묻습니다. 실패하거나 느리면
       hypotheses.json 에 준비된 rebuttalSeeds 로 되돌아갑니다.
       AI 때문에 수업이 멈추지 않게 하는 것이 이 폴백의 목적입니다. */
    const ai = await fetchRebuttals({
      event: {
        studentLabel: ev.studentLabel,
        studentEra: ev.studentEra,
        distinctiveFeature: ev.distinctiveFeature,
      },
      hypothesis: { name: h.name, mechanism: h.mechanism },
      cards: (cell?.cards ?? []).map((c) => ({ claim: c.claim })),
      criteria: criteria.map((c) => ({ id: c.id, label: c.label })),
      scores: v.scores || {},
      reasons: v.reasons || {},
    });

    const rebuttals = ai?.rebuttals?.length
      ? ai.rebuttals
      : (cell?.rebuttalSeeds ?? []).slice(0, 2).map((t) => ({ text: t, source: 'seed' }));

    await savePatch(selectedId, { rebuttals });
    btn.disabled = false;
    btn.textContent = '반론 다시 받기';
    if (!ai) flash('준비된 반론으로 진행합니다.');
  }

  async function onSubmit() {
    const v = store.get('verdicts').byEvent[selectedId];

    const unscreened = HYPS.filter((h) => !v?.screen?.[h]?.level);
    if (unscreened.length) return flash(`1단계에서 아직 판정하지 않은 가설이 ${unscreened.length}개 있습니다.`);
    if (!v?.chosen) return flash('가장 잘 설명하는 원인을 하나 고르세요.');

    const noScore = CRITERIA.filter((c) => v.scores?.[c] === null || v.scores?.[c] === undefined);
    if (noScore.length) {
      return flash(`아직 정하지 않은 기준이 ${noScore.length}개 있습니다. 판단 보류도 하나의 결론입니다.`);
    }
    const noReason = CRITERIA.filter((c) => !(v.reasons?.[c] || '').trim());
    if (noReason.length) return flash(`근거를 쓰지 않은 기준이 ${noReason.length}개 있습니다.`);

    const r = await savePatch(selectedId, { status: 'submitted' });
    if (r === 'ok') {
      flash('제출했습니다.');
      renderDetail();
    } else flash('제출에 실패했습니다.');
  }

  /* 타이핑이 멈춘 뒤에만 씁니다. 글자마다 쓰면 쓰기가 폭주합니다.
     저장이 실패하면 반드시 알립니다 — 조용히 실패하면 학생은 저장된 줄 알고
     계속 진행하다가 다음 단계가 안 열리는 이유를 알 수 없습니다. */
  function queueSave(key, partial) {
    clearTimeout(timers.get(key));
    pending.add(key);
    timers.set(
      key,
      setTimeout(async () => {
        let r = await savePatch(selectedId, partial);

        /* 거부됐을 때 흔한 원인은 "이 반 명단에 내가 없는 것"입니다.
           (다른 반을 골랐거나, 세션 이름이 바뀌었거나)
           명단에 다시 올리고 한 번만 재시도합니다. 학생이 무엇을 잘못한 게
           아니므로 오류를 보여주기 전에 앱이 스스로 고쳐 봅니다. */
        if (r === 'denied') {
          await ensureEnrolled();
          r = await savePatch(selectedId, partial);
        }

        // 서버에 닿은 뒤에야 잠금을 풉니다. 그전까지 이 칸은 화면 갱신에서 빠집니다.
        pending.delete(key);
        if (r === 'denied') {
          flash('저장할 권한이 없습니다. 홈으로 가서 반과 모둠을 다시 확인해 주세요.');
        } else if (r === 'error') {
          flash('저장하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
        }
      }, SAVE_DELAY)
    );
  }

  /* 이 칸을 지금 건드리면 안 되는가?
     ① 사용자가 그 칸에 커서를 두고 있거나 ② 저장이 아직 끝나지 않았거나 */
  function busy(el, key) {
    return document.activeElement === el || pending.has(key);
  }

  /* ── 원격 변경 반영 ─────────────────────────────────────
     지금 입력 중인 칸은 건드리지 않습니다. 같은 모둠원이 다른 곳을
     고쳤을 때 내가 쓰던 글이 지워지지 않게 하는 부분입니다. */
  function syncDetail() {
    if (!selectedId) return;
    const { locks, byEvent } = store.get('verdicts');
    const lock = locks[selectedId];
    const v = byEvent[selectedId];
    const myGroup = store.get('user').groupId;
    const readOnly = !lock || lock.groupId !== myGroup || v?.status === 'submitted';

    const owner = root.querySelector('#ct-owner');
    if (owner) {
      owner.textContent = !lock
        ? '아직 맡은 모둠이 없습니다'
        : `${lock.groupId}모둠${lock.groupId === myGroup ? ' (우리 모둠)' : ' — 열람만 가능합니다'}` +
          (v?.updatedBy?.name ? ` · 마지막 수정 ${v.updatedBy.name}` : '');
    }
    if (!v) return;

    // 1단계
    const unscreened = [];
    for (const h of HYPS) {
      const s = v.screen?.[h] || {};

      /* 저장이 아직 서버에 닿지 않았으면 화면의 값이 서버 값보다 최신입니다.
         그때는 화면을 서버로 되돌리지 않고, 진행 상황도 화면 기준으로 셉니다.
         (안 그러면 방금 고른 판정이 잠깐 「미검토」로 되돌아가 보입니다) */
      const waiting = pending.has(`h-${h}`);
      const level = waiting
        ? (root.querySelector(`input[name="lv-${h}"]:checked`)?.value ?? null)
        : (s.level ?? null);

      if (!level) unscreened.push(hypById(h)?.name ?? h);

      const mark = root.querySelector(`#mk-${h}`);
      if (mark) {
        mark.textContent = level ? levelLabel(level) : '미검토';
        mark.dataset.level = level || 'none';
      }

      if (waiting) continue;

      const picked = root.querySelector(`input[name="lv-${h}"][value="${s.level}"]`);
      if (picked && document.activeElement?.name !== `lv-${h}`) picked.checked = true;

      const sr = root.querySelector(`#sr-${h}`);
      if (sr && document.activeElement !== sr) sr.value = s.reason ?? '';
    }
    const screened = HYPS.length - unscreened.length;

    // 2단계는 네 가설을 모두 검토한 뒤에 열립니다.
    const ready = screened === HYPS.length;
    const choose = root.querySelector('#ct-choose');
    const help = root.querySelector('#ct-chooseHelp');
    if (choose) {
      choose.classList.toggle('is-locked', !ready);
      choose.querySelectorAll('input').forEach((i) => (i.disabled = readOnly || !ready));
    }
    if (help) {
      /* 숫자만 보여주면 "무엇이 남았는지"를 학생이 위로 올라가 찾아야 합니다.
         남은 가설 이름을 그대로 적어 줍니다. */
      help.textContent = ready
        ? '네 가설을 모두 검토했습니다. 가장 잘 설명하는 하나를 고르세요.'
        : `아직 판정하지 않은 가설이 있습니다 — ${unscreened.join(', ')} (${screened} / ${HYPS.length})`;
    }

    const chosenInput = root.querySelector(`input[name="chosen"][value="${v.chosen}"]`);
    if (chosenInput) chosenInput.checked = true;

    const deep = root.querySelector('#ct-deep');
    if (deep) deep.hidden = !v.chosen;

    for (const id of CRITERIA) {
      const slider = root.querySelector(`#sc-${id}`);
      const hold = root.querySelector(`#hold-${id}`);
      const reason = root.querySelector(`#rs-${id}`);
      const out = root.querySelector(`#out-${id}`);
      if (!slider) continue;

      const val = v.scores?.[id];
      if (!busy(slider, `sc-${id}`) && document.activeElement !== hold) {
        const held = val === HOLD;
        const unset = val === null || val === undefined;
        hold.checked = held;
        slider.value = unset || held ? 3 : val;
        if (!readOnly) slider.disabled = held;
        out.textContent = held ? '보류' : unset ? '—' : String(val);
      }
      if (!busy(reason, `rs-${id}`)) reason.value = v.reasons?.[id] ?? '';
    }

    const counter = root.querySelector('#ct-counter');
    if (counter && !busy(counter, 'counter')) counter.value = v.counter ?? '';

    const box = root.querySelector('#ct-rebuttals');
    if (box) {
      box.innerHTML = (v.rebuttals || [])
        .map((r, i) => `<div class="ct__rebut"><b>반론 ${i + 1}</b><p>${esc(r.text)}</p></div>`)
        .join('');
    }

    if (v.status === 'submitted') showRadar(v);
  }

  /* 그래프를 이 화면 안에 만듭니다. 두 번 눌러도 한 번만 만듭니다.
     데이터 탐구와 같은 JSON 을 쓰는데 loader 가 캐시하므로 다시 받지 않습니다. */
  async function mountData() {
    if (dataStack) return;
    const mount = root.querySelector('#ct-dataMount');
    if (!mount) return;

    const gen = detailGen;
    dataStack = 'loading';   // 불러오는 사이에 또 눌리는 것을 막습니다
    mount.innerHTML = '<p class="ct__dataMsg">자료를 불러오는 중…</p>';

    try {
      const [diversity, climate] = await Promise.all([loadDiversity(), loadClimate()]);
      // 기다리는 사이에 다른 사건으로 넘어갔거나 화면을 떠났을 수 있습니다.
      if (gen !== detailGen) return;
      dataStack = createChartStack({ mount, diversity, climate, events });
      /* 여기서는 대멸종 위치와 화석 기록 수를 처음부터 켭니다.
         데이터 탐구에서는 학생이 스스로 찾아야 해서 숨기지만,
         이 화면에 온 학생은 이미 다섯 사건을 알고 판정하는 중입니다. */
      dataStack.setEventsVisible(true);
      dataStack.setOccVisible(true);
    } catch (e) {
      console.error('[court] 자료를 불러오지 못했습니다:', e);
      if (gen !== detailGen) return;
      dataStack = null;      // 다시 펴면 재시도됩니다
      mount.innerHTML =
        '<p class="ct__dataMsg">자료를 불러오지 못했습니다. 접었다 다시 펴 보세요.</p>';
    }
  }

  function showRadar(v) {
    const wrap = root.querySelector('#ct-radarWrap');
    const canvas = root.querySelector('#ct-radar');
    if (!wrap || !canvas) return;
    wrap.hidden = false;
    radar?.destroy();
    radar = createRadar(canvas, criteria, v.scores || {});
  }

  async function onClaim() {
    const r = await claimEvent(selectedId);
    if (r === 'taken') flash('방금 다른 모둠이 먼저 맡았습니다. 다른 사건을 골라 주세요.');
    else if (r === 'error') flash('맡기에 실패했습니다. 네트워크를 확인해 주세요.');
    else if (r === 'no-doc') flash('사건은 맡았지만 판정 문서를 만들지 못했습니다. 새로고침해 주세요.');
    renderDetail();
  }

  function flash(text) {
    const el = root.querySelector('#ct-msg');
    if (!el) return;
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.textContent = ''), 3400);
  }

  renderList();

  return () => {
    for (const t of timers.values()) clearTimeout(t);
    clearTimeout(flashTimer);
    teardownDetail();
    unsubStore();
    unsubRemote();
  };
}

/* 가설 하나를 과정 카드로. 줄글 대신 단계 사슬로 보여 줍니다. */
function mechCard(h) {
  const m = MECHANISM[h.id];
  if (!m) return '';
  return `
    <article class="ct__mech" data-hyp="${h.id}">
      <header class="ct__mechHead">
        <span class="ct__mechIcon">${m.icon}</span>
        <b>${esc(h.name)}</b>
      </header>
      <ol class="ct__chain">${m.chain.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="ct__mechNote">${esc(m.note)}</p>
      ${h.evidenceType ? `<p class="ct__mechEv"><b>찾아볼 증거</b> ${esc(h.evidenceType)}</p>` : ''}
    </article>`;
}

function levelLabel(v) {
  return LEVELS.find((l) => l.value === v)?.label ?? '미검토';
}

function shortHyp(name) {
  return name.replace('설', '').replace('기후 변화', '기후').replace('해양 무산소', '무산소');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
