import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, configured, SESSION_ID } from '../firebase.js';
import * as store from '../store.js';

/* 가설 법정 — 칸 점유와 판정 저장.
 *
 * ── 두 모둠이 같은 칸을 동시에 누르면? ─────────────────────────
 * cellLocks/{cellId} 문서를 "만들기"만 시도합니다. Firestore 에서 create 는
 * 원자적이라 동시에 들어와도 딱 하나만 성공하고, 나머지는 already-exists
 * 오류를 받습니다. 트랜잭션도, 대기열도 필요 없습니다.
 * 보안 규칙이 update/delete 를 막고 있으므로 남의 점유를 빼앗을 수도 없습니다.
 *
 * 1순환 권장 칸이 6개이고 모둠도 6개라, 수업 시작 직후가 충돌 확률이
 * 가장 높은 순간입니다. 바로 그 순간을 이 방식이 정확히 처리합니다.
 *
 * ── 한 모둠 안에서 5~6명이 동시에 편집하면? ────────────────────
 * 항상 merge 로 씁니다. 기준별로 필드가 나뉘어 있어(scores.C1, reasons.C1)
 * 서로 다른 기준을 만지는 동안에는 충돌이 없습니다.
 * 같은 기준을 동시에 고치는 경우만 마지막 저장이 이깁니다. 이건 실시간
 * 반영으로 "지금 누가 뭘 쓰고 있는지" 보이게 해서 사람이 피하도록 합니다.
 */

const CRITERIA = ['C1', 'C2', 'C3', 'C4'];

const locksCol = () => collection(db, 'sessions', SESSION_ID, 'cellLocks');
const claimsCol = () => collection(db, 'sessions', SESSION_ID, 'claims');

/* 점수 값의 뜻
 *   null  아직 정하지 않음
 *   0     판단 보류 — 지금 자료로는 정할 수 없다 (정당한 결론입니다)
 *   1~5   판정 점수
 * 0 과 null 을 구분해야 "보류를 선택했다"와 "아직 안 봤다"를 가릴 수 있습니다. */
export const HOLD = 0;

export function emptyClaim(cellId, groupId) {
  return {
    cellId,
    groupId,
    scores: Object.fromEntries(CRITERIA.map((c) => [c, null])),
    reasons: Object.fromEntries(CRITERIA.map((c) => [c, ''])),
    rebuttals: [],
    counter: '',
    status: 'draft',
  };
}

/** 칸을 점유합니다. 이미 다른 모둠이 가져갔으면 'taken' 을 돌려줍니다. */
export async function claimCell(cellId) {
  const u = store.get('user');

  if (!configured || !u.uid) {
    // Firebase 설정 전 — 화면에서만 점유한 것처럼 동작시킵니다.
    const locks = { ...store.get('claims').locks };
    if (locks[cellId] && locks[cellId].groupId !== u.groupId) return 'taken';
    locks[cellId] = { groupId: u.groupId, uid: u.uid, name: u.name };
    const byCell = { ...store.get('claims').byCell };
    byCell[cellId] = byCell[cellId] || emptyClaim(cellId, u.groupId);
    store.patch('claims', { locks, byCell });
    return 'ok';
  }

  try {
    /* 이 한 줄이 잠금장치입니다.
       문서가 없으면 create, 있으면 update 로 판정되는데 보안 규칙이
       update 를 막고 있으므로, 이미 점유된 칸에 쓰면 permission-denied 가
       돌아옵니다. 즉 "먼저 만든 모둠이 이긴다"가 서버에서 보장됩니다. */
    await setDoc(doc(locksCol(), cellId), {
      cellId,
      groupId: u.groupId,
      uid: u.uid,
      name: u.name,
      claimedAt: serverTimestamp(),
    });
  } catch (e) {
    if (e.code === 'permission-denied') return 'taken';
    console.error('[claims] 점유 실패:', e);
    return 'error';
  }

  // 점유에 성공했으면 판정 문서의 빈 껍데기를 만들어 둡니다.
  // 이후 저장은 모두 merge 라서, 필드가 미리 있어야 규칙 검사가 단순해집니다.
  try {
    await setDoc(doc(claimsCol(), cellId), {
      ...emptyClaim(cellId, u.groupId),
      updatedAt: serverTimestamp(),
      updatedBy: { uid: u.uid, name: u.name },
    });
  } catch (e) {
    console.error('[claims] 판정 문서 생성 실패:', e);
  }
  return 'ok';
}

/** 판정 일부를 저장합니다. 항상 merge 라서 다른 사람이 쓴 칸을 지우지 않습니다. */
export async function savePatch(cellId, partial) {
  const u = store.get('user');

  if (!configured || !u.uid) {
    const byCell = { ...store.get('claims').byCell };
    const cur = byCell[cellId] || emptyClaim(cellId, u.groupId);
    byCell[cellId] = {
      ...cur,
      ...partial,
      scores: { ...cur.scores, ...(partial.scores || {}) },
      reasons: { ...cur.reasons, ...(partial.reasons || {}) },
    };
    store.patch('claims', { byCell });
    return 'ok';
  }

  try {
    await setDoc(
      doc(claimsCol(), cellId),
      {
        cellId,
        groupId: u.groupId,
        ...partial,
        updatedAt: serverTimestamp(),
        updatedBy: { uid: u.uid, name: u.name },
      },
      { merge: true }
    );
    return 'ok';
  } catch (e) {
    console.error('[claims] 저장 실패:', e);
    return e.code === 'permission-denied' ? 'denied' : 'error';
  }
}

/** 점유 현황과 판정을 실시간 구독합니다. */
export function subscribeClaims(onError) {
  if (!configured) return () => {};

  const offLocks = onSnapshot(
    locksCol(),
    (snap) => {
      const locks = {};
      snap.forEach((d) => (locks[d.id] = d.data()));
      store.patch('claims', { locks });
    },
    (e) => {
      console.error('[claims] 점유 구독 실패:', e);
      onError?.(e);
    }
  );

  const offClaims = onSnapshot(
    claimsCol(),
    (snap) => {
      const byCell = {};
      snap.forEach((d) => (byCell[d.id] = d.data()));
      store.patch('claims', { byCell });
    },
    (e) => {
      console.error('[claims] 판정 구독 실패:', e);
      onError?.(e);
    }
  );

  return () => {
    offLocks();
    offClaims();
  };
}

export { CRITERIA };
