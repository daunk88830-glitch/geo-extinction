import Anthropic from '@anthropic-ai/sdk';

/* 서술형 응답 오개념 클러스터링 — 교사 대시보드 전용.
 *
 * 이 함수는 Firebase 에 접근하지 않습니다. 교사 화면이 이미 읽어온
 * 답안 텍스트만 받아서 분류해 돌려줍니다. 그래서 서비스 계정 키가
 * 필요 없고, 이 함수가 뚫려도 새어 나갈 데이터가 없습니다.
 *
 * 이름·학번은 보내지 않습니다. 화면에서 번호만 붙여 보내고,
 * 돌아온 번호를 교사 화면이 다시 학생과 맞춥니다.
 */

const client = new Anthropic();

const SYSTEM = `너는 고등학교 1학년 통합과학 교사를 돕는 분석 도구다.
학생들의 서술형 답안을 읽고, 비슷한 생각끼리 묶어 교사가 다음 수업에서
무엇을 다시 짚어야 할지 알 수 있게 정리한다.

문항: "여러 차례의 대멸종을 겪었는데도 현재 지구에 다양한 생물이 살고 있는 까닭을
오늘 다룬 데이터와 가설을 근거로 설명하시오."

기대하는 사고의 뼈대:
환경의 급변 → 특정 생물군의 멸종 → 생태 공간의 개방 → 살아남은 생물의 다양화

교사용 지도서가 지목한 대표 오개념:
"환경이 변하면 멸종한다"에서 멈추고, 대멸종 이후 다양성이 다시 늘어나는 국면을 다루지 않는 것.

규칙:
- 묶음은 2~5개. 너무 잘게 나누면 교사가 쓰기 어렵다.
- label 은 12자 이내의 짧은 이름.
- description 은 그 묶음의 학생들이 공통으로 어떻게 생각하고 있는지 한두 문장.
- suggestion 은 교사가 다음 시간에 할 수 있는 구체적 행동 한 문장.
  ("다양성 곡선에서 대멸종 직후 구간을 함께 다시 읽는다" 같은 식으로)
- answerIds 에는 그 묶음에 속한 답안 번호를 넣는다. 모든 답안은 정확히 한 묶음에 들어간다.
- 학생을 평가하거나 비난하는 표현을 쓰지 않는다.
- 잘 쓴 답안도 하나의 묶음으로 정리한다. 오개념만 찾는 도구가 아니다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' },
          suggestion: { type: 'string' },
          answerIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'description', 'suggestion', 'answerIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['clusters'],
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

  const answers = (body.answers || []).filter((a) => a && a.id && String(a.text || '').trim());
  if (answers.length < 2) return json({ error: '답안이 2개 이상 필요합니다' }, 400);

  const list = answers
    .slice(0, 60)
    .map((a) => `[${a.id}] ${String(a.text).slice(0, 800)}`)
    .join('\n\n');

  try {
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      system: SYSTEM,
      // 30명분을 한 번에 읽고 묶는 작업이라 반론·피드백보다 여유를 둡니다.
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `## 학생 답안 ${answers.length}개\n\n${list}` }],
    });

    if (res.stop_reason === 'refusal') return json({ error: 'refused' }, 422);

    const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
    return json(JSON.parse(text));
  } catch (e) {
    console.error('[cluster]', e);
    return json({ error: e.message || 'failed' }, 502);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
