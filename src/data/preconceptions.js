/* 선개념 확인 문항.
 *
 * 새로 지어낸 문항이 아니라, 이 수업이 실제로 깨뜨리려는 오개념에서 뽑았습니다.
 * 출처는 모두 프로젝트 데이터 안에 있습니다.
 *
 *   q1 익룡      eras.json  mesozoic.misconceptionNote (교사용 지도서 p.19)
 *   q2 소행성    hypotheses.json E5.distinctiveFeature
 *                "학생들이 '대멸종 = 소행성'이라고 일반화하기 쉽다"
 *   q3 규모      hypotheses.json _meta.pedagogy 가장_교육적인_칸 E3-H4
 *                "규모가 크면 원인도 극적이어야 한다는 직관을 깨는 칸"
 *   q4 회복      hypotheses.json rubric_서술형 2수준
 *                "대멸종 이후 다양성이 증가하는 국면을 다루지 않는다 (대표 오개념)"
 *   q5 화석기록  Day 2 에서 데이터로 확인된 것.
 *                약 88백만 년 전 구간은 조사된 화석이 이웃의 9분의 1이라
 *                다양성이 실제보다 낮게 나온다.
 *
 * 정답은 학생에게 보여주지 않습니다. 스스로 뒤집는 경험이 이 수업의 목적이고,
 * 여기서 답을 알려주면 그 경험이 사라집니다.
 * misconception 필드는 "이 답을 고르면 그 오개념을 갖고 있다"는 표시이며
 * 반 전체 분포를 계산하는 데만 쓰입니다.
 */

export const CHOICES = [
  { value: 'yes', label: '그렇다' },
  { value: 'no', label: '아니다' },
  { value: 'unsure', label: '잘 모르겠다' },
];

export const QUESTIONS = [
  {
    id: 'q1',
    text: '익룡은 공룡의 한 종류다.',
    misconception: 'yes',
    card: {
      title: '익룡은 공룡이 아니다',
      why: '익룡은 공룡이 조류로 진화하기 전에 따로 갈라져 나온 무리입니다.',
      where: '타임라인의 중생대 카드에서 확인합니다.',
      href: '#/timeline',
      action: '타임라인 열기',
    },
  },
  {
    id: 'q2',
    text: '지질시대의 대멸종은 대부분 소행성 충돌 때문에 일어났다.',
    misconception: 'yes',
    card: {
      title: '다섯 번의 원인은 저마다 다르다',
      why: '충돌 증거가 뚜렷한 것은 다섯 중 하나뿐입니다. 사상 최대 멸종에는 충돌 증거가 없습니다.',
      where: '원인 판정에서 사건마다 증거를 직접 확인합니다.',
      href: '#/court',
      action: '원인 판정 열기',
    },
  },
  {
    id: 'q3',
    text: '멸종의 규모가 클수록 그 원인도 더 극적인 사건이었을 것이다.',
    misconception: 'yes',
    card: {
      title: '규모와 원인의 극적임은 별개다',
      why: '가장 큰 멸종의 원인이 가장 극적인 사건이었다는 보장은 없습니다.',
      where: '원인 판정에서 사건별 증거의 강도를 비교합니다.',
      href: '#/court',
      action: '원인 판정 열기',
    },
  },
  {
    id: 'q4',
    text: '대멸종이 일어난 뒤, 생물의 종류는 계속 줄어들기만 했다.',
    misconception: 'yes',
    card: {
      title: '멸종 뒤에는 다양해지는 국면이 온다',
      why: '비어 버린 생태 공간을 살아남은 생물이 채우면서 종류가 다시 늘어납니다.',
      where: '데이터 탐구의 다양성 곡선에서 감소 뒤 회복 구간을 봅니다.',
      href: '#/explore',
      action: '데이터 탐구 열기',
    },
  },
  {
    id: 'q5',
    text: '과거에 살았던 생물은 대부분 화석으로 남아 있다.',
    misconception: 'yes',
    card: {
      title: '화석 기록에는 빈 구간이 있다',
      why: '조사된 화석이 적은 시대는 생물이 적었던 것처럼 보입니다. 기록이 없는 것과 생물이 없었던 것은 다릅니다.',
      where: '데이터 탐구에서 화석 기록 수 그래프를 다양성 곡선과 겹쳐 봅니다.',
      href: '#/explore',
      action: '데이터 탐구 열기',
    },
  },
];

/** 응답 하나가 오개념에 해당하는지 */
export function isMisconception(qid, value) {
  const q = QUESTIONS.find((x) => x.id === qid);
  return Boolean(q && value === q.misconception);
}

/** 반 전체 응답에서 문항별 오개념 비율을 냅니다. */
export function distribution(docs) {
  return QUESTIONS.map((q) => {
    let held = 0;
    let answered = 0;
    for (const d of docs) {
      const v = d.answers?.[q.id];
      if (!v) continue;
      answered++;
      if (v === q.misconception) held++;
    }
    return {
      question: q,
      answered,
      held,
      ratio: answered ? held / answered : 0,
    };
  });
}
