import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, configured, SESSION_ID } from '../firebase.js';

/* 교사 대시보드용 인증과 구독.
 *
 * 서비스 계정 키를 쓰지 않습니다. 교사도 그냥 Firebase 사용자이고,
 * 보안 규칙의 isTeacher() 가 sessions/{세션}/teachers/{uid} 문서 존재를
 * 확인해 권한을 줍니다. 그 문서는 콘솔에서만 만들 수 있습니다.
 *
 * 규칙이 quizAnswers 에 allow write 를 주지 않으므로, 대시보드는
 * 코드가 아니라 서버 규칙 차원에서 읽기 전용입니다.
 */

export function watchTeacherAuth(cb) {
  if (!configured) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    // 익명 사용자는 교사가 아닙니다.
    cb(user && !user.isAnonymous ? user : null);
  });
}

export async function teacherSignIn(email, password) {
  if (!configured) throw new Error('Firebase 설정이 필요합니다');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export function teacherSignOut() {
  return signOut(auth);
}

/** 학생 명단·판정·형성평가 답안을 한꺼번에 구독합니다. */
export function subscribeDashboard(onData, onError) {
  if (!configured) return () => {};

  const state = { students: [], claims: [], answers: [] };
  const emit = () => onData({ ...state });

  const sub = (name, key, map) =>
    onSnapshot(
      collection(db, 'sessions', SESSION_ID, name),
      (snap) => {
        state[key] = snap.docs.map(map);
        emit();
      },
      (e) => {
        console.error(`[teacher] ${name} 구독 실패:`, e);
        onError?.(e, name);
      }
    );

  const offs = [
    sub('students', 'students', (d) => d.data()),
    sub('claims', 'claims', (d) => d.data()),
    sub('quizAnswers', 'answers', (d) => ({ docId: d.id, ...d.data() })),
  ];

  return () => offs.forEach((f) => f());
}

/** 서술형 응답을 AI 로 묶습니다. 실패하면 null. */
export async function clusterAnswers(answers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch('/.netlify/functions/cluster', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 이름·학번은 보내지 않습니다. 번호만 보내고 화면에서 다시 맞춥니다.
      body: JSON.stringify({ answers: answers.map((a) => ({ id: a.docId, text: a.raw })) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.clusters?.length ? json.clusters : null;
  } catch (e) {
    console.warn('[teacher] 클러스터링 실패:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
