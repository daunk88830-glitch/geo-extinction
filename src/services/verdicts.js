import { collection, doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, configured, getSessionId } from '../firebase.js';
import * as store from '../store.js';

/* 대멸종의 원인 찾기 — 사건 점유와 판정 저장.
 *
 * ── 구조 ───────────────────────────────────────────────────────
 * 한 모둠이 대멸종 사건 하나를 통째로 맡습니다(20칸이 아니라 5칸).
 * 그 사건에 대해 네 가설을 모두 검토하는 것이 활동의 핵심입니다.
 * 사건마다 증거의 강도가 제각각이라(예: 대멸종 3 은 세 가설이 강한데
 * 충돌설만 증거가 없습니다), 네 개를 나란히 놓아야 그 불균등함이 보입니다.
 *
 *   1단계  네 가설을 훑고 3단계로 빠르게 판정 + 한 줄 근거
 *   2단계  가장 잘 설명한다고 본 가설 하나를 골라
 *          기준 4개로 깊이 판정 → 반론 → 재반박 → 제출
 *
 * ── 두 모둠이 같은 사건을 동시에 누르면? ────────────────────────
 * eventLocks/{eventId} 를 "만들기"만 시도합니다. 보안 규칙이 update 를
 * 막고 있어서, 이미 점유된 사건에 쓰면 permission-denied 가 돌아옵니다.
 * 즉 "먼저 누른 모둠이 이긴다"가 서버에서 보장됩니다.
 * 사건이 5개뿐이라 수업 시작 직후 경쟁이 가장 치열합니다.
 *
 * ── 모둠 안에서 여러 명이 동시에 편집하면? ──────────────────────
 * 항상 merge 로 씁니다. 가설별·기준별로 필드가 나뉘어 있어
 * 서로 다른 곳을 만지는 동안에는 충돌이 없습니다.
 */

export const CRITERIA = ['C1', 'C2', 'C3', 'C4'];
export const HYPS = ['H1', 'H2', 'H3', 'H4'];

/* 1단계 판정 3단계. 값이 아니라 뜻으로 저장해 나중에 읽기 쉽게 합니다. */
export const LEVELS = [
  { value: 'well', label: '잘 설명함' },
  { value: 'partly', label: '일부만 설명함' },
  { value: 'no', label: '설명하지 못함' },
];

/* 점수 값의 뜻
 *   null  아직 정하지 않음
 *   0     판단 보류 — 지금 자료로는 정할 수 없다 (정당한 결론입니다)
 *   1~5   판정 점수 */
export const HOLD = 0;

const locksCol = () => collection(db, 'sessions', getSessionId(), 'eventLocks');
const verdictsCol = () => collection(db, 'sessions', getSessionId(), 'verdicts');

export function emptyVerdict(eventId, groupId) {
  return {
    eventId,
    groupId,
    screen: Object.fromEntries(HYPS.map((h) => [h, { level: null, reason: '' }])),
    chosen: null,
    scores: Object.fromEntries(CRITERIA.map((c) => [c, null])),
    reasons: Object.fromEntries(CRITERIA.map((c) => [c, ''])),
    rebuttals: [],
    counter: '',
    status: 'draft',
  };
}

/** 사건을 점유합니다. 이미 다른 모둠이 가져갔으면 'taken'. */
export async function claimEvent(eventId) {
  const u = store.get('user');

  if (!configured || !u.uid) {
    const locks = { ...store.get('verdicts').locks };
    if (locks[eventId] && locks[eventId].groupId !== u.groupId) return 'taken';
    locks[eventId] = { groupId: u.groupId, uid: u.uid, name: u.name };
    const byEvent = { ...store.get('verdicts').byEvent };
    byEvent[eventId] = byEvent[eventId] || emptyVerdict(eventId, u.groupId);
    store.patch('verdicts', { locks, byEvent });
    return 'ok';
  }

  try {
    // 문서가 없으면 create, 있으면 update. 규칙이 update 를 막아 잠금이 됩니다.
    await setDoc(doc(locksCol(), eventId), {
      eventId,
      groupId: u.groupId,
      uid: u.uid,
      name: u.name,
      claimedAt: serverTimestamp(),
    });
  } catch (e) {
    if (e.code === 'permission-denied') return 'taken';
    console.error('[verdicts] 점유 실패:', e);
    return 'error';
  }

  /* 판정 문서의 빈 껍데기를 만들어 둡니다.
     이게 실패하면 이후 부분 저장이 전부 막히므로 조용히 넘기지 않고 알립니다. */
  try {
    await setDoc(doc(verdictsCol(), eventId), {
      ...emptyVerdict(eventId, u.groupId),
      updatedAt: serverTimestamp(),
      updatedBy: { uid: u.uid, name: u.name },
    });
  } catch (e) {
    console.error('[verdicts] 판정 문서 생성 실패:', e);
    return 'no-doc';
  }
  return 'ok';
}

/** 판정 일부를 저장합니다. 항상 merge 라서 남이 쓴 칸을 지우지 않습니다. */
export async function savePatch(eventId, partial) {
  const u = store.get('user');

  if (!configured || !u.uid) {
    const byEvent = { ...store.get('verdicts').byEvent };
    const cur = byEvent[eventId] || emptyVerdict(eventId, u.groupId);
    byEvent[eventId] = {
      ...cur,
      ...partial,
      screen: mergeScreen(cur.screen, partial.screen),
      scores: { ...cur.scores, ...(partial.scores || {}) },
      reasons: { ...cur.reasons, ...(partial.reasons || {}) },
    };
    store.patch('verdicts', { byEvent });
    return 'ok';
  }

  try {
    await setDoc(
      doc(verdictsCol(), eventId),
      {
        eventId,
        groupId: u.groupId,
        ...partial,
        updatedAt: serverTimestamp(),
        updatedBy: { uid: u.uid, name: u.name },
      },
      { merge: true }
    );
    return 'ok';
  } catch (e) {
    console.error('[verdicts] 저장 실패:', e);
    return e.code === 'permission-denied' ? 'denied' : 'error';
  }
}

function mergeScreen(cur = {}, next) {
  if (!next) return cur;
  const out = { ...cur };
  for (const h of Object.keys(next)) out[h] = { ...(cur[h] || {}), ...next[h] };
  return out;
}

/** 점유 현황과 판정을 실시간 구독합니다. */
export function subscribeVerdicts(onError) {
  if (!configured) return () => {};

  const offLocks = onSnapshot(
    locksCol(),
    (snap) => {
      const locks = {};
      snap.forEach((d) => (locks[d.id] = d.data()));
      store.patch('verdicts', { locks });
    },
    (e) => {
      console.error('[verdicts] 점유 구독 실패:', e);
      onError?.(e);
    }
  );

  const offVerdicts = onSnapshot(
    verdictsCol(),
    (snap) => {
      const byEvent = {};
      snap.forEach((d) => (byEvent[d.id] = d.data()));
      store.patch('verdicts', { byEvent });
    },
    (e) => {
      console.error('[verdicts] 판정 구독 실패:', e);
      onError?.(e);
    }
  );

  return () => {
    offLocks();
    offVerdicts();
  };
}
