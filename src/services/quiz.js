import { doc, collection, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db, configured, getSessionId } from '../firebase.js';
import * as store from '../store.js';

/* 형성평가 문항 불러오기 + 답안 저장.
 *
 * 문항은 Google Sheets 에서 읽습니다. 교사가 수업 직전에도 시트만 고치면
 * 배포 없이 문항이 바뀝니다.
 *
 * 시트를 아직 만들지 않았거나 불러오기에 실패하면
 * public/data/quiz-sample.json 으로 되돌아갑니다. 형성평가가 통째로
 * 사라지는 것보다 대체 문항으로라도 진행되는 편이 낫습니다.
 */

const SHEET_ID = import.meta.env.VITE_QUIZ_SHEET_ID;
const SHEET_NAME = import.meta.env.VITE_QUIZ_SHEET_NAME || '문항';

export async function loadQuiz() {
  if (SHEET_ID) {
    try {
      const items = await loadFromSheet(SHEET_ID, SHEET_NAME);
      if (items.length) {
        store.patch('quiz', { items, source: 'sheet' });
        return items;
      }
      console.warn('[quiz] 시트에 사용할 수 있는 행이 없습니다. 대체 문항을 씁니다.');
    } catch (e) {
      console.warn('[quiz] 시트를 불러오지 못했습니다. 대체 문항을 씁니다:', e.message);
    }
  }

  const res = await fetch('/data/quiz-sample.json');
  if (!res.ok) throw new Error('대체 문항도 불러오지 못했습니다');
  const json = await res.json();
  store.patch('quiz', { items: json.items, source: 'sample' });
  return json.items;
}

/* gviz 는 JSON 을 함수 호출로 감싸서 돌려줍니다.
   /*O_o* /\ngoogle.visualization.Query.setResponse({...});
   괄호 안쪽만 잘라내야 합니다. */
async function loadFromSheet(id, sheetName) {
  const url =
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq` +
    `?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end < 0) throw new Error('예상과 다른 형식입니다');
  const table = JSON.parse(text.slice(start + 1, end)).table;

  /* 열 순서는 고정입니다. 시트 머리글을 바꿔도 순서는 지켜야 합니다.
     0:id  1:type  2:question  3~6:choice1~4  7:answer  8:section  9:explain */
  return table.rows
    .map((r) => (r.c || []).map((c) => (c && c.v != null ? String(c.v).trim() : '')))
    .filter((v) => v[0] && v[2])
    .map((v) => {
      const isText = (v[1] || 'choice').toLowerCase() === 'text';
      const item = {
        id: v[0],
        type: isText ? 'text' : 'choice',
        question: v[2],
        section: (v[8] || '').toLowerCase(),
        explain: v[9] || '',
      };
      if (!isText) {
        item.choices = [v[3], v[4], v[5], v[6]].filter(Boolean);
        item.answer = Number(v[7]) || 1;
      }
      return item;
    });
}

/** 답안 저장. 문서 이름이 {uid}_{문항id} 라 학생끼리 겹치지 않습니다. */
export async function saveAnswer(item, payload) {
  const u = store.get('user');

  if (!configured || !u.uid) {
    const answers = { ...store.get('quiz').answers, [item.id]: payload };
    store.patch('quiz', { answers });
    return 'ok';
  }

  try {
    await setDoc(
      doc(collection(db, 'sessions', getSessionId(), 'quizAnswers'), `${u.uid}_${item.id}`),
      {
        uid: u.uid,
        groupId: u.groupId,
        studentId: u.studentId,
        name: u.name,
        qid: item.id,
        type: item.type,
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return 'ok';
  } catch (e) {
    console.error('[quiz] 저장 실패:', e);
    return e.code === 'permission-denied' ? 'denied' : 'error';
  }
}

/** 내가 이미 낸 답안을 불러옵니다. 새로고침해도 고른 답과 채점 결과가 다시 보이게 하려고 씁니다.
 *  보안 규칙상 학생은 자기 문서({uid}_{문항id})만 get 할 수 있으므로 문항마다 하나씩 읽습니다.
 *  돌려주는 값: { 문항id: 저장된 답안 } */
export async function loadMyAnswers(items) {
  const u = store.get('user');
  if (!configured || !u.uid) return { ...store.get('quiz').answers };

  const out = {};
  await Promise.all(
    items.map(async (it) => {
      try {
        const snap = await getDoc(
          doc(collection(db, 'sessions', getSessionId(), 'quizAnswers'), `${u.uid}_${it.id}`)
        );
        if (snap.exists()) out[it.id] = snap.data();
      } catch (e) {
        console.warn('[quiz] 지난 답안을 읽지 못했습니다:', it.id, e.code || e.message);
      }
    })
  );
  return out;
}

/** 오답일 때 돌아갈 화면 */
export function sectionLink(section) {
  if (section === 'timeline') return { href: '#/timeline', label: '타임라인 다시 보기' };
  if (section === 'explore') return { href: '#/explore', label: '데이터 탐구 다시 보기' };
  if (section === 'court') return { href: '#/court', label: '원인 판정 다시 보기' };
  return null;
}
