import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, configured, SESSION_ID } from '../firebase.js';
import * as store from '../store.js';

/* 다양성 곡선 위의 "급감 구간" 표시.
 *
 * ── 30명이 동시에 눌러도 안 깨지는 이유 ─────────────────────────
 * 문서 이름을 {uid}_{binId} 로 정합니다. 학생마다 uid 가 다르므로
 * 30명이 같은 순간에 같은 구간을 눌러도 서로 다른 문서에 씁니다.
 * 한 문서에 여러 명이 몰리는 상황 자체가 생기지 않습니다.
 *
 * 학급 히트맵은 이 컬렉션을 통째로 구독해서 브라우저가 셉니다.
 * "구간별 카운터 문서"를 만들어 증가시키는 방식은 쓰지 않습니다.
 * 그러면 인기 구간 문서 하나에 30명의 쓰기가 몰려서(Firestore 는
 * 문서 하나당 초당 약 1회 쓰기가 한계) 그 지점부터 무너집니다.
 *
 * 같은 구간을 다시 누르면 문서 이름이 같으므로 덮어쓰기/삭제가 되고,
 * 중복 표시가 쌓이지 않습니다.
 */

export const MAX_MARKS = 5;

const colRef = () => collection(db, 'sessions', SESSION_ID, 'marks');
const docId = (uid, binId) => `${uid}_${binId}`;

/** 표시를 켜고 끕니다. 결과 문자열로 UI 가 안내 문구를 정합니다. */
export async function toggleMark(bin) {
  const u = store.get('user');
  const cur = store.get('marks');
  const has = cur.mine.includes(bin.id);

  if (!has && cur.mine.length >= MAX_MARKS) return 'full';

  // Firebase 설정 전에는 화면에서만 동작시킵니다.
  if (!configured || !u.uid) {
    const mine = has ? cur.mine.filter((id) => id !== bin.id) : [...cur.mine, bin.id];
    store.patch('marks', { mine });
    return has ? 'removed' : 'added';
  }

  const ref = doc(colRef(), docId(u.uid, bin.id));

  try {
    if (has) {
      await deleteDoc(ref);
      return 'removed';
    }
    await setDoc(ref, {
      uid: u.uid,
      groupId: u.groupId,
      binId: bin.id,
      midMa: bin.midMa,
      createdAt: serverTimestamp(),
    });
    return 'added';
  } catch (e) {
    console.error('[marks] 저장 실패:', e);
    return e.code === 'permission-denied' ? 'denied' : 'error';
  }
}

/* 마지막으로 받은 문서들을 들고 있다가, 로그인 uid 가 늦게 도착해도
   "내 표시"를 다시 가려낼 수 있게 합니다. 새로고침 직후처럼 익명 로그인
   복구가 구독보다 늦게 끝나는 경우가 실제로 생깁니다. */
let lastDocs = [];

function recompute() {
  const uid = store.get('user').uid;
  const mine = [];
  const classCounts = {};

  for (const m of lastDocs) {
    if (!m.binId) continue;
    classCounts[m.binId] = (classCounts[m.binId] || 0) + 1;
    if (uid && m.uid === uid) mine.push(m.binId);
  }

  store.patch('marks', { mine, classCounts });
}

/** 학급 전체 표시를 실시간 구독합니다. 반환값을 호출하면 구독 해제. */
export function subscribeMarks(onError) {
  if (!configured) return () => {};

  const offUser = store.subscribe('user', recompute);

  const offSnap = onSnapshot(
    colRef(),
    (snap) => {
      lastDocs = snap.docs.map((d) => d.data());
      recompute();
    },
    (e) => {
      console.error('[marks] 구독 실패:', e);
      onError?.(e);
    }
  );

  return () => {
    offUser();
    offSnap();
    lastDocs = [];
  };
}
