/* Netlify Function 호출 래퍼.
 *
 * 이 앱에서 AI 는 "있으면 좋은 것"이지 "없으면 멈추는 것"이 아닙니다.
 * 30명이 한 교실에서 동시에 쓰는 상황에서 함수가 느려지거나 한도에 걸릴 수
 * 있으므로, 호출부는 항상 실패를 정상 경로로 취급해야 합니다.
 *
 *  - 타임아웃을 걸어 무한정 기다리지 않습니다.
 *  - 429/5xx 는 한 번만 다시 시도합니다.
 *  - 같은 입력은 캐시해서 두 번 부르지 않습니다.
 *  - 끝내 실패하면 null 을 돌려주고, 부르는 쪽이 대체 자료를 씁니다.
 */

const TIMEOUT_MS = 12000;
const cache = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, { timeout = TIMEOUT_MS, jitter = 0 } = {}) {
  // 여러 명이 같은 순간에 누를 때를 대비한 아주 짧은 분산.
  if (jitter) await sleep(Math.random() * jitter);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`/.netlify/functions/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(path, body, opts) {
  const key = path + ':' + JSON.stringify(body);
  if (cache.has(key)) return cache.get(key);

  try {
    let out;
    try {
      out = await post(path, body, opts);
    } catch (e) {
      // 한도 초과나 서버 오류만 한 번 더. 400 류는 다시 불러도 같습니다.
      if (e.status === 429 || (e.status >= 500 && e.status < 600)) {
        await sleep(1500 + Math.random() * 1500);
        out = await post(path, body, opts);
      } else {
        throw e;
      }
    }
    cache.set(key, out);
    return out;
  } catch (e) {
    console.warn(`[ai] ${path} 실패 — 대체 자료로 진행합니다:`, e.message);
    return null;
  }
}

/** 반론 2개. 실패하면 null → 호출부가 rebuttalSeeds 를 씁니다. */
export function fetchRebuttals(payload) {
  return callWithRetry('rebut', payload, { jitter: 800 });
}

/** 서술형 피드백. 실패하면 null → 호출부가 "제출 완료"만 표시합니다. */
export function fetchFeedback(payload) {
  return callWithRetry('grade', payload);
}
