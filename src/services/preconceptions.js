import { collection, doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, configured, getSessionId } from '../firebase.js';
import * as store from '../store.js';

/* 선개념 확인 응답 저장과 반 전체 분포 구독.
 *
 * ── 이름을 저장하지 않습니다 ──────────────────────────────────
 * 반 전체 분포를 학생 화면이 직접 계산해야 하므로, 이 컬렉션은
 * 로그인한 학생 누구나 목록을 읽을 수 있어야 합니다.
 * 그래서 uid 와 모둠번호만 남기고 이름·학번은 넣지 않습니다.
 * 교사는 uid 로 students 컬렉션과 맞춰 보면 됩니다.
 *
 * 문서 이름은 {uid}_{pre|post} 입니다. 사전과 사후가 각각 한 개씩
 * 남고, 학생끼리 겹치지 않으며, 보안 규칙이 문서 이름 앞부분을 검사해
 * 남의 응답을 못 건드리게 합니다.
 */

const colRef = () => collection(db, 'sessions', getSessionId(), 'preconceptions');

export async function saveResponses(phase, answers) {
  const u = store.get('user');

  if (!configured || !u.uid) {
    const pre = { ...store.get('preconceptions') };
    pre[phase] = { answers };
    store.set('preconceptions', pre);
    return 'ok';
  }

  try {
    await setDoc(doc(colRef(), `${u.uid}_${phase}`), {
      uid: u.uid,
      groupId: u.groupId,
      phase,
      answers,
      updatedAt: serverTimestamp(),
    });
    return 'ok';
  } catch (e) {
    console.error('[preconceptions] 저장 실패:', e);
    return e.code === 'permission-denied' ? 'denied' : 'error';
  }
}

/** 반 전체 응답을 실시간 구독합니다. 학생이 늘어날수록 카드 순서가 바뀝니다. */
export function subscribeResponses(onError) {
  if (!configured) return () => {};

  return onSnapshot(
    colRef(),
    (snap) => {
      const uid = store.get('user').uid;
      const all = snap.docs.map((d) => d.data());
      const mine = { pre: null, post: null };

      for (const d of all) {
        if (d.uid === uid && (d.phase === 'pre' || d.phase === 'post')) mine[d.phase] = d;
      }

      store.set('preconceptions', {
        all,
        pre: mine.pre,
        post: mine.post,
      });
    },
    (e) => {
      console.error('[preconceptions] 구독 실패:', e);
      onError?.(e);
    }
  );
}
