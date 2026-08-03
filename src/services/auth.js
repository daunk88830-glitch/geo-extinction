import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, configured, getSessionId } from '../firebase.js';
import * as store from '../store.js';

/* 익명 로그인.
 *
 * 익명 로그인은 아이디·비밀번호 없이 브라우저마다 고유한 uid 를 발급받는 방식입니다.
 * 학생은 아무것도 가입하지 않지만, 서버는 "누가 쓴 데이터인지" 구분할 수 있습니다.
 *
 * 이 uid 가 앞으로 모든 문서 이름의 앞부분이 됩니다.
 *   marks/{uid}_{binId}      ← 다른 학생의 탭을 건드릴 수 없음
 *   quizAnswers/{uid}_{qid}  ← 남의 답안을 읽을 수 없음
 * 보안 규칙이 문서 이름의 uid 와 로그인한 uid 를 비교해 막습니다.
 *
 * uid 는 브라우저에 저장되므로 새로고침해도 같은 사람으로 인식됩니다.
 * 단, 시크릿 창을 열거나 다른 기기로 접속하면 새 uid 가 발급됩니다.
 */

/** 학번·이름·모둠을 확정하고 익명 로그인 + 명단 등록까지 마칩니다. */
export async function joinClass({ studentId, name, groupId }) {
  // Firebase 설정 전에도 앱을 볼 수 있도록 로컬 저장만 하고 넘어갑니다.
  if (!configured) {
    store.patch('user', { uid: null, studentId, name, groupId });
    store.saveUserToStorage();
    return null;
  }

  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;

  // sessions/{세션}/students/{uid} — 교사 대시보드가 명단으로 씁니다.
  // merge: true 라서 같은 학생이 다시 들어와도 덮어쓰기만 되고 중복이 안 생깁니다.
  await setDoc(
    doc(db, 'sessions', getSessionId(), 'students', uid),
    {
      uid,
      studentId,
      name,
      groupId,
      joinedAt: serverTimestamp(),
    },
    { merge: true }
  );

  store.patch('user', { uid, studentId, name, groupId });
  store.saveUserToStorage();
  return uid;
}

/* 지금 반의 명단에 내가 올라 있는지 확인하고, 없으면 올립니다.
 *
 * 왜 필요한가: 보안 규칙은 sessions/{반}/students/{uid} 를 읽어 모둠 번호를
 * 확인합니다. 이 문서가 지금 반에 없으면 규칙 검사가 실패해서 표시·판정·평가가
 * 전부 permission-denied 로 막힙니다. 그런데 화면은 브라우저에 저장된 모둠
 * 번호를 믿기 때문에 멀쩡해 보입니다 — 입력은 되는데 저장만 안 되는,
 * 수업 중에 가장 알아채기 어려운 형태의 고장입니다.
 *
 * 이 문서가 없어지는 경우는 생각보다 많습니다.
 *   · 학생이 다른 반을 골랐을 때
 *   · 세션 이름 규칙이 바뀌었을 때(학기 접두사 변경 등)
 *   · 브라우저 저장소는 남아 있는데 그 반에 처음 들어올 때
 * 그래서 로그인 상태가 복구될 때마다 조용히 다시 올려 둡니다. */
export async function ensureEnrolled() {
  if (!configured) return;

  const user = auth.currentUser;
  const u = store.get('user');
  if (!user || user.isAnonymous === false) return;
  if (!u.name || !u.groupId) return;   // 아직 홈에서 입력하지 않은 상태

  try {
    await setDoc(
      doc(db, 'sessions', getSessionId(), 'students', user.uid),
      {
        uid: user.uid,
        studentId: u.studentId ?? '',
        name: u.name,
        groupId: u.groupId,
        joinedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('[auth] 명단 등록 실패:', e.code || e.message);
  }
}

/** 새로고침 후 이미 등록된 학생의 uid 를 조용히 복구합니다.
 *  화면을 막지 않도록 실패해도 그냥 넘어갑니다. */
export function restoreAuth() {
  if (!configured) return;

  onAuthStateChanged(auth, async (user) => {
    /* 교사 계정(이메일 로그인)일 때는 학생 상태를 건드리지 않습니다.
       같은 브라우저를 시연용으로 썼더라도 교사 uid 가 학생 기록에
       섞이지 않게 하는 부분입니다. */
    if (user && !user.isAnonymous) return;

    if (user) {
      store.patch('user', { uid: user.uid });
      store.saveUserToStorage();
      // uid 만 되살리면 지금 반의 명단에는 내가 없을 수 있습니다.
      await ensureEnrolled();
      return;
    }
    // 로컬에는 학생 정보가 있는데 로그인 세션만 끊긴 경우 → 다시 로그인
    if (store.isSignedIn()) {
      try {
        const u = store.get('user');
        await joinClass({ studentId: u.studentId, name: u.name, groupId: u.groupId });
      } catch (e) {
        console.warn('[auth] 자동 재로그인 실패:', e.code || e.message);
      }
    }
  });
}

/** Firebase 오류 코드를 학생이 읽을 수 있는 문장으로 바꿉니다. */
export function authErrorMessage(e) {
  switch (e?.code) {
    case 'auth/operation-not-allowed':
      return '익명 로그인이 아직 켜져 있지 않습니다. (Firebase 콘솔 → Authentication)';
    case 'auth/network-request-failed':
      return '네트워크에 연결할 수 없습니다. 와이파이를 확인하고 다시 시도해 주세요.';
    case 'permission-denied':
      return '서버가 저장을 거부했습니다. 보안 규칙을 확인해 주세요.';
    case 'unavailable':
      return '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    default:
      return `로그인에 실패했습니다. (${e?.code || e?.message || '알 수 없는 오류'})`;
  }
}
