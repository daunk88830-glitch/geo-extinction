import { loadDiversity, loadClimate, loadHypotheses } from '../data/loader.js';
import { createChartStack } from '../components/chartStack.js';
import { toggleMark, subscribeMarks, MAX_MARKS } from '../services/marks.js';
import { configured } from '../firebase.js';
import * as store from '../store.js';

/* 데이터 탐구 — 다양성 · 기온 · CO2 를 같은 시간축으로 읽습니다.
 *
 * 활동: 다양성이 급격히 줄어드는 구간 5곳을 찾아 곡선 위에서 탭합니다.
 * 학급 전체의 탭이 히트맵으로 실시간 누적되어, 다른 모둠이 어디를 짚었는지
 * 서로 보이게 됩니다.
 *
 * 대멸종 위치는 처음에 감춰 둡니다. 미리 표시하면 학생이 찾을 것이
 * 없어져 활동 자체가 사라집니다. 5곳을 다 찍은 뒤에만 확인할 수 있습니다.
 */

export default async function explore(outlet) {
  const [diversity, climate, hyp] = await Promise.all([
    loadDiversity(),
    loadClimate(),
    loadHypotheses(),
  ]);

  outlet.innerHTML = `
    <div class="ex">
      <header class="ex__head wrap">
        <p class="ex__eyebrow mono">데이터 탐구</p>
        <h1 class="ex__title">다양성이 무너진 구간을 찾아보세요</h1>
        <p class="ex__lead">
          세 그래프는 <b>같은 시간축</b>을 씁니다. 세로로 같은 위치는 같은 시대입니다.
          화면을 손가락으로 훑으면 세 값을 한 번에 읽을 수 있습니다.
        </p>
      </header>

      <div id="ex-stack"></div>

      <div class="ex__task wrap">
        <div class="ex__counter">
          <span>곡선에서 <b>크게 줄어든 것처럼 보이는 구간</b> ${MAX_MARKS}곳을 탭해 표시하세요.</span>
          <b class="ex__count mono" id="ex-count">0 / ${MAX_MARKS}</b>
        </div>

        <div class="ex__legend">
          <span><i class="ex__sw ex__sw--mine"></i> 내 표시</span>
          <span><i class="ex__sw ex__sw--class"></i> 학급 전체 (진할수록 많이 선택된 구간)</span>
        </div>

        <p class="ex__msg" id="ex-msg" role="status"></p>

        <div class="ex__actions">
          <button class="btn btn--ghost" id="ex-clear" type="button">모두 지우기</button>
          <button class="btn btn--ghost" id="ex-occ" type="button" hidden>화석 기록 수 보기</button>
          <button class="btn" id="ex-reveal" type="button" hidden>대멸종 위치 확인</button>
        </div>

        <div class="ex__reflect" id="ex-reflect" hidden>
          <h3 class="ex__reflectTitle">내 표시와 비교해 보세요</h3>
          <ol class="ex__questions">
            <li>내가 표시한 ${MAX_MARKS}곳 중 실제 대멸종은 몇 곳이었나요?</li>
            <li>대멸종인데 곡선에서 잘 드러나지 않은 것이 있나요? 왜 그럴까요?</li>
            <li>대멸종이 아닌데 크게 줄어 보인 곳은 화석 기록 수가 몇 개였나요?
                양옆 구간과 비교해 보세요.</li>
          </ol>
          <p class="ex__reflectNote">
            화석 기록이 적으면 다양성이 낮게 나옵니다. 그런데 <b>대멸종이 일어나도 화석 기록은 줄어듭니다.</b>
            실제로 대멸종 1이 일어난 구간은 화석 기록 수가 이 데이터 전체에서 가장 적은 축에 듭니다.
            그래서 이 그래프만으로는 "조사가 덜 된 것"과 "정말 생물이 사라진 것"을 가릴 수 없습니다.
            암석과 지층에서 나온 다른 증거가 필요합니다 — 다음 활동인 <b>가설 법정</b>이 그 일을 합니다.
          </p>
        </div>

        ${
          configured
            ? ''
            : `<p class="ex__warn">Firebase 설정 전이라 표시가 이 브라우저에만 남고
               학급 히트맵은 동작하지 않습니다.</p>`
        }
      </div>
    </div>
  `;

  const stack = createChartStack({
    mount: outlet.querySelector('#ex-stack'),
    diversity,
    climate,
    events: hyp.events,
    onTapBin: handleTap,
  });

  const elCount = outlet.querySelector('#ex-count');
  const elMsg = outlet.querySelector('#ex-msg');
  const elClear = outlet.querySelector('#ex-clear');
  const elOcc = outlet.querySelector('#ex-occ');
  const elReveal = outlet.querySelector('#ex-reveal');
  const elReflect = outlet.querySelector('#ex-reflect');

  let revealed = false;
  let occVisible = false;
  let msgTimer = 0;

  function say(text) {
    elMsg.textContent = text;
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(() => (elMsg.textContent = ''), 2600);
  }

  async function handleTap(bin) {
    const r = await toggleMark(bin);
    if (r === 'full') say(`${MAX_MARKS}곳까지만 표시할 수 있습니다. 지우고 다시 선택하세요.`);
    else if (r === 'denied') say('저장 권한이 없습니다. 보안 규칙을 확인해 주세요.');
    else if (r === 'error') say('저장하지 못했습니다. 네트워크를 확인해 주세요.');
  }

  /* store 의 marks 칸이 바뀔 때마다 차트와 카운터를 갱신합니다.
     Firestore 구독이 값을 넣으면 이 함수가 자동으로 불립니다. */
  const unsubStore = store.subscribe('marks', render);

  function render(marks) {
    const n = marks.mine.length;
    elCount.textContent = `${n} / ${MAX_MARKS}`;
    stack.setMarks(marks);

    /* 확인 도구는 5곳을 다 표시한 뒤에만 열립니다.
       미리 열어 두면 학생이 답을 보고 표시하게 되어 활동이 사라집니다. */
    const done = n >= MAX_MARKS;
    elReveal.hidden = !done;
    elOcc.hidden = !done;

    if (!done) {
      if (revealed) {
        revealed = false;
        stack.setEventsVisible(false);
        elReveal.textContent = '대멸종 위치 확인';
      }
      if (occVisible) {
        occVisible = false;
        stack.setOccVisible(false);
        elOcc.textContent = '화석 기록 수 보기';
      }
      elReflect.hidden = true;
    }
  }

  async function onClear() {
    const mine = [...store.get('marks').mine];
    if (!mine.length) return;
    elClear.disabled = true;
    // 하나씩 순서대로 지웁니다. 한꺼번에 보내면 Firebase 미설정 상태에서
    // 로컬 상태가 서로 덮어써져 마지막 하나만 지워집니다.
    for (const id of mine) {
      const bin = diversity.bins.find((b) => b.id === id);
      if (bin) await toggleMark(bin);
    }
    elClear.disabled = false;
    say('표시를 모두 지웠습니다.');
  }

  function onReveal() {
    revealed = !revealed;
    stack.setEventsVisible(revealed);
    elReveal.textContent = revealed ? '대멸종 위치 숨기기' : '대멸종 위치 확인';
    elReflect.hidden = !revealed;
    if (revealed) {
      say('회색 띠가 대멸종이 일어난 기간입니다. 한 순간이 아니라 기간이라는 점에 주목하세요.');
    }
  }

  function onOcc() {
    occVisible = !occVisible;
    stack.setOccVisible(occVisible);
    elOcc.textContent = occVisible ? '화석 기록 수 숨기기' : '화석 기록 수 보기';
    if (occVisible) say('다양성 곡선과 모양을 비교해 보세요.');
  }

  elClear.addEventListener('click', onClear);
  elOcc.addEventListener('click', onOcc);
  elReveal.addEventListener('click', onReveal);

  const unsubMarks = subscribeMarks((e) => {
    say(
      e.code === 'permission-denied'
        ? '학급 데이터를 읽을 권한이 없습니다. 보안 규칙을 확인해 주세요.'
        : '학급 데이터 연결이 끊겼습니다. 표시는 계속 저장됩니다.'
    );
  });

  render(store.get('marks'));

  return () => {
    clearTimeout(msgTimer);
    elClear.removeEventListener('click', onClear);
    elOcc.removeEventListener('click', onOcc);
    elReveal.removeEventListener('click', onReveal);
    unsubStore();
    unsubMarks();
    stack.destroy();
  };
}
