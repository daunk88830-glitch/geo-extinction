/* 앱 전체가 공유하는 단 하나의 상태 저장소.
 *
 * 규칙 세 가지만 지키면 됩니다.
 *   1. 상태를 바꿀 때는 반드시 set() 을 쓴다 (직접 state.xxx = 1 금지).
 *   2. 화면은 subscribe() 로 필요한 칸만 구독한다.
 *   3. 1초에 수십 번 바뀌는 값(차트 크로스헤어 등)은 여기 넣지 않는다.
 *      → 구독자 전체가 다시 그려져서 스마트폰에서 버벅입니다.
 *        그런 값은 emit()/on() 을 쓰세요 (아래 참고).
 */

const state = {
  // 로그인한 학생. Firebase 익명 로그인을 붙이면 uid 가 채워집니다.
  user: { uid: null, studentId: '', name: '', groupId: null },

  // 현재 화면 경로 (예: '#/timeline')
  route: '',

  // public/data/*.json 에서 읽어온 정적 데이터. 한 번 읽으면 안 바뀝니다.
  data: { eras: null, hypotheses: null, diversity: null, climate: null },

  // 이후 단계에서 Firestore 실시간 구독으로 채워질 칸들
  marks: { mine: [], classCounts: {} },
  // 원인 찾기 — locks: 사건별 점유 모둠, byEvent: 사건별 판정
  verdicts: { locks: {}, byEvent: {} },

  // 선개념 확인 — all: 반 전체 응답, pre/post: 내 응답
  preconceptions: { all: [], pre: null, post: null },
  quiz: { items: [], answers: {}, feedback: {} },

  ui: { busy: false, error: null },
};

const listeners = new Map(); // key -> Set<fn>

/** 상태 읽기. key 를 주면 그 칸만, 안 주면 전체를 돌려줍니다. */
export function get(key) {
  return key === undefined ? state : state[key];
}

/** 상태의 한 칸을 통째로 바꾸고, 그 칸을 구독한 화면에만 알립니다. */
export function set(key, value) {
  state[key] = value;
  notify(key);
}

/** 상태의 한 칸 안에서 일부 속성만 바꿉니다. (얕은 병합) */
export function patch(key, partial) {
  state[key] = { ...state[key], ...partial };
  notify(key);
}

/** key 칸이 바뀔 때마다 fn 을 실행합니다. 반환값을 호출하면 구독 해제. */
export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

function notify(key) {
  const set_ = listeners.get(key);
  if (!set_) return;
  for (const fn of set_) {
    try {
      fn(state[key]);
    } catch (e) {
      console.error(`[store] "${key}" 구독자에서 오류:`, e);
    }
  }
}

/* ── 고빈도 이벤트용 초경량 버스 ──────────────────────────────
   store 를 거치지 않으므로 화면 전체 리렌더가 일어나지 않습니다.
   Day 2 의 차트 공통 크로스헤어(hoverMa)가 이걸 씁니다.        */
const bus = new Map();

export function on(event, fn) {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event).add(fn);
  return () => bus.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set_ = bus.get(event);
  if (!set_) return;
  for (const fn of set_) fn(payload);
}

/* ── 새로고침해도 로그인이 풀리지 않도록 localStorage 에 보관 ── */
const LS_KEY = 'geo:user';

export function loadUserFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) set('user', { ...state.user, ...JSON.parse(raw) });
  } catch {
    /* 사생활 보호 모드 등에서 localStorage 가 막혀 있어도 앱은 계속 동작 */
  }
}

export function saveUserToStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.user));
  } catch {
    /* 무시 */
  }
}

/** 학번·이름·모둠이 모두 채워졌는지 */
export function isSignedIn() {
  const u = state.user;
  return Boolean(u.studentId && u.name && u.groupId);
}
