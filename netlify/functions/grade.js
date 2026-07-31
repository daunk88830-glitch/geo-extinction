import Anthropic from '@anthropic-ai/sdk';

/* 서술형 루브릭 피드백.
 *
 * hypotheses.json 의 rubric_서술형 이 정한 규칙을 그대로 따릅니다.
 *  - 점수나 수준을 학생에게 보이지 않는다
 *  - 포함된 요소 / 빠진 요소 / 다시 볼 자료 세 항목만 준다
 *  - 빠진 요소는 최대 2개
 * 수준(level)은 응답에 담아 보내되 교사 대시보드에서만 씁니다.
 */

const client = new Anthropic();

const SYSTEM = `너는 고등학교 1학년 통합과학 서술형 답안에 피드백을 주는 역할이다.

성취기준: [10통과2-01-01] 환경 변화가 생물다양성에 미치는 영향을 추론할 수 있다.

채점 기준(학생에게 절대 보이지 않는다):
4수준 — 환경의 급변 → 특정 생물군의 멸종 → 생태 공간의 개방 → 살아남은 생물의 다양화라는
        인과 사슬을 모두 서술하고, 다양성 곡선의 감소 후 회복 패턴이나 기온 데이터를 근거로 인용한다.
3수준 — 인과 사슬은 대체로 서술하지만 데이터 근거를 인용하지 않거나, 회복 국면의 설명이 막연하다.
2수준 — "환경이 변하면 멸종한다" 수준에서 그치고, 대멸종 이후 다양성이 증가하는 국면을 다루지 않는다.
        (교사용 지도서가 지적한 대표 오개념이다)
1수준 — 질문과 관련이 없거나 오개념을 포함한다.

피드백 작성 규칙:
- 점수, 수준, 등급을 학생에게 보이는 문장에 쓰지 않는다. "잘했다/부족하다" 같은 평가어도 쓰지 않는다.
- included: 학생 답안에서 실제로 확인된 요소를 1~3개, 학생의 표현을 인용하며 적는다.
- missing: 빠진 요소를 최대 2개까지만. 3개 이상은 학생을 압도한다. 없으면 빈 배열.
- revisit: 다시 볼 자료를 1~2개. 반드시 "다양성 곡선", "기온 그래프", "이산화 탄소 그래프",
  "화석 기록 수 그래프", "타임라인", "가설 법정의 증거 카드" 중에서 고른다.
- 모든 문장은 고1이 읽는 말로, 한 문장씩 짧게.
- 기(紀) 명칭이나 정확한 연대 수치를 쓰지 않는다.
- level 은 위 기준으로 판단해 숫자만 담는다. 교사만 본다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    level: { type: 'integer', enum: [1, 2, 3, 4] },
    included: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    revisit: { type: 'array', items: { type: 'string' } },
  },
  required: ['level', 'included', 'missing', 'revisit'],
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

  const { question, answer } = body;
  if (!answer || !String(answer).trim()) return json({ error: '답안이 비어 있습니다' }, 400);

  try {
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `## 문항\n${question || '(문항 없음)'}\n\n## 학생 답안\n${String(answer).slice(0, 3000)}`,
        },
      ],
    });

    if (res.stop_reason === 'refusal') return json({ error: 'refused' }, 422);

    const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);

    return json({
      level: parsed.level,
      included: (parsed.included || []).slice(0, 3),
      missing: (parsed.missing || []).slice(0, 2), // 규칙: 최대 2개
      revisit: (parsed.revisit || []).slice(0, 2),
    });
  } catch (e) {
    console.error('[grade]', e);
    return json({ error: e.message || 'failed' }, 502);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
