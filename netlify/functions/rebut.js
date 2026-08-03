import Anthropic from '@anthropic-ai/sdk';

/* AI 반론 — 모둠이 쓴 근거를 읽고 되물을 질문 2개를 만듭니다.
 *
 * 이 함수가 없거나 느려도 활동은 계속됩니다. 클라이언트가 실패를 감지하면
 * hypotheses.json 의 rebuttalSeeds 로 되돌아갑니다. 수업이 AI 에 걸려
 * 멈추는 일이 없게 하는 것이 이 설계의 목적입니다.
 *
 * 필요한 환경변수: ANTHROPIC_API_KEY (Netlify 사이트 설정에 등록)
 */

const client = new Anthropic();

const SYSTEM = `너는 고등학교 1학년 통합과학 수업의 "반론 검사" 역할이다.
학생 모둠이 특정 대멸종 사건에 대해 어떤 가설을 판정했고, 그 근거를 적었다.
너의 일은 그 판정을 무너뜨리는 것이 아니라, 학생이 스스로 더 엄밀해지도록 되묻는 것이다.

규칙:
- 반론은 **정확히 2개**를 쓴다.
- 반드시 질문 형태로 쓴다. 정답이나 결론을 알려주지 않는다.
- 각 반론은 2문장, 220자 이내로 짧게 쓴다. 고1이 읽는 말로 쓰고, 전문 용어는 괄호로 풀어준다.
  (수업 중에 읽고 바로 답해야 하므로 길면 읽히지 않는다)
- 학생이 쓴 근거를 직접 인용하거나 짚어서, 그 근거의 어느 부분이 약한지 겨냥한다.
- 기(紀) 명칭(예: 페름기, 백악기)이나 정확한 연대 수치를 쓰지 않는다. 교육과정상 다루지 않는다.
- 학생을 비난하거나 평가하지 않는다. "틀렸다"고 말하지 않는다.

우선순위:
- 첫 번째 반론은 가능하면 "시기가 맞는가"를 겨냥한다. 원인이라면 결과보다 먼저나 동시에
  일어났어야 한다는 점을, 학생들이 조사할 때 가장 자주 빠뜨린다.
- 두 번째 반론은 나머지 기준 중 학생의 근거가 가장 얇은 곳을 겨냥한다.

중요:
- 증거가 부족해서 학생이 "이 가설은 이 사건을 설명하지 못한다"고 판정했다면,
  그 판정을 뒤집으라고 압박하지 마라. 대신 그 기각이 얼마나 단단한지를 묻는다.
  예를 들어 "증거를 찾지 못한 것"과 "그런 일이 없었던 것"을 어떻게 구분할지 묻는다.
  기각도 과학적 결론이며, 잘 정리된 기각은 우수한 판정이다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    /* 길이를 스키마로 제한합니다.
       교실에서 이 응답을 기다리는 시간이 곧 수업 시간이라, 출력이 길어지면
       그만큼 느려집니다. 게다가 반론이 길면 고1이 읽다가 흐름을 놓칩니다.
       각 220자 이내가 화면에서도 읽기 좋은 길이입니다.

       개수는 minItems 로 못박지 않습니다 — 이 API 는 minItems 에 0 이나 1
       외의 값을 받지 않아서, 2 를 넣으면 요청 자체가 400 으로 거부됩니다.
       개수는 위 지시문에서 "정확히 2개"로 요구하고, maxItems 로 상한만 둡니다. */
    rebuttals: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 220 } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  required: ['rebuttals'],
  additionalProperties: false,
};

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 받습니다' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: '잘못된 요청' }, 400);
  }

  const { event, hypothesis, cards = [], criteria = [], scores = {}, reasons = {} } = body;
  if (!event || !hypothesis) return json({ error: '필수 항목 누락' }, 400);

  const scoreText = criteria
    .map((c) => {
      const v = scores[c.id];
      const label = v === 0 ? '판단 보류' : v == null ? '미정' : `${v}점 / 5점`;
      return `[${c.label}] ${label}\n근거: ${reasons[c.id] || '(비어 있음)'}`;
    })
    .join('\n\n');

  const prompt = `## 사건
${event.studentLabel} (${event.studentEra})
${event.distinctiveFeature || ''}

## 모둠이 검토한 가설
${hypothesis.name}
${hypothesis.mechanism || ''}

## 모둠이 읽은 증거 카드
${cards.map((c, i) => `${i + 1}. ${c.claim}`).join('\n') || '(없음)'}

## 모둠의 판정과 근거
${scoreText}

위 근거를 읽고 되물을 질문 2개를 만들어라.`;

  try {
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 900,
      system: SYSTEM,
      // 짧은 산출물이라 낮은 효, 대신 교실에서 기다리는 시간을 줄입니다.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });

    if (res.stop_reason === 'refusal') return json({ error: 'refused' }, 422);

    const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);
    const rebuttals = (parsed.rebuttals || []).slice(0, 2).map((r) => ({
      text: String(r.text || '').trim(),
      source: 'ai',
    }));

    if (!rebuttals.length) return json({ error: 'empty' }, 502);
    return json({ rebuttals });
  } catch (e) {
    console.error('[rebut]', e);
    return json({ error: e.message || 'failed' }, 502);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
