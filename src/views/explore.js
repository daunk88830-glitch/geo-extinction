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

      <!-- 활동 안내는 그래프보다 위에 둡니다. 무엇을 해야 하는지 모른 채
           그래프를 만지다가 아래까지 내려가야 안내를 만나면 안 됩니다. -->
      <div class="ex__brief wrap">
        <div class="ex__counter">
          <span>곡선에서 <b>크게 줄어든 것처럼 보이는 구간</b> ${MAX_MARKS}곳을 탭해 표시하세요.</span>
          <b class="ex__count mono" id="ex-count">0 / ${MAX_MARKS}</b>
        </div>

        <div class="ex__legend">
          <span><i class="ex__sw ex__sw--mine"></i> 내 표시</span>
          <span><i class="ex__sw ex__sw--class"></i> 학급 전체 (진할수록 많이 선택된 구간)</span>
        </div>
      </div>

      <div id="ex-stack"></div>

      <div class="ex__task wrap">
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
          <!-- 이 설명은 원래 줄글이었는데, 괄호 안 숫자를 눈으로 따라가야 해서
               읽는 사람이 길을 잃었습니다. 숫자를 표로 내리고 문장은 표가
               보여주지 못하는 것만 말하게 바꿨습니다. -->
          <details class="ex__hint">
            <summary>대멸종 2 구간은 오히려 올라가 보이는데요?</summary>
            <p>맞습니다. 회색 띠 앞뒤의 자료를 나란히 놓아 보겠습니다.</p>

            <table class="ex__cmp">
              <thead>
                <tr><th>구간 (백만 년 전)</th><th>속 수</th><th>앞 구간과 비교</th></tr>
              </thead>
              <tbody>
                <tr><td>388 ~ 382</td><td>610</td><td></td></tr>
                <tr><td>382 ~ 372 <em>띠 바로 앞</em></td><td>424</td><td><b>186 감소</b></td></tr>
                <tr class="is-band"><td>372 ~ 359 <em>띠 안</em></td><td>459</td><td>35 증가</td></tr>
                <tr><td>359 ~ 347 <em>띠 바로 뒤</em></td><td>412</td><td>47 감소</td></tr>
              </tbody>
            </table>

            <p>
              <b>가장 큰 감소는 띠에 들어가기 전에 이미 일어났습니다.</b>
              띠 안에서는 오히려 조금 올랐고, 띠를 지난 뒤에 다시 줄었습니다.
            </p>
            <p>
              왜 이렇게 보일까요? 이 부근은 <b>자료 한 칸이 10~13백만 년</b>입니다.
              한 칸 안에서 생물이 줄었다가 다시 늘면, 그 칸에는 둘을 합친 값 하나만 남습니다.
              한 달에 한 번만 몸무게를 재면 그 사이에 오르내린 것이 보이지 않는 것과 같습니다.
              <b>자의 눈금이 사건보다 굵습니다.</b>
            </p>
            <p>
              대멸종 2가 아니라는 뜻이 아닙니다. 이 시기의 위기는 한 번에 끝난 사건이 아니라
              <b>수백만 년에 걸쳐 여러 번 나뉘어</b> 일어났습니다.
              그래서 뾰족한 골이 아니라 완만한 내리막으로 보입니다.
            </p>
          </details>

          <div class="ex__reflectNote">
            <p>화석 기록이 적어지는 이유는 두 가지입니다.</p>
            <ol class="ex__why">
              <li><b>그 시대의 암석이 적게 남아 조사가 덜 되었다</b></li>
              <li><b>정말로 생물이 크게 줄었다</b></li>
            </ol>
            <table class="ex__cmp">
              <thead><tr><th>구간</th><th>속 수</th><th>화석 기록</th><th>이웃 평균</th></tr></thead>
              <tbody>
                <tr><td>약 8,800만 년 전</td><td>318</td><td>3,389</td><td>12,876</td></tr>
                <tr><td>대멸종 1 (약 4억 4,400만 년 전)</td><td>295</td><td>3,798</td><td>18,563</td></tr>
              </tbody>
            </table>
            <p>
              두 구간은 그래프에서 <b>거의 같은 모양</b>입니다. 그런데 앞은 ①이고 뒤는 ②입니다.
              어느 쪽인지는 이 그래프만으로 가릴 수 없습니다. 암석과 지층에서 나온 다른 증거가
              필요합니다 — 다음 활동인 <b>원인 판정</b>이 그 일을 합니다.
            </p>
          </div>
          <a class="btn ex__next" href="#/court">다음 — 원인 판정</a>
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
