import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getFirestore, collection, doc, getDocFromServer, getDocsFromServer, query, orderBy, limit, startAfter, writeBatch, serverTimestamp, Bytes} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyCQ6ziNtns-9LdLZZq03XrURXmULbyQdjw',
  authDomain: 'feedback-bb91d.firebaseapp.com',
  projectId: 'feedback-bb91d',
  storageBucket: 'feedback-bb91d.firebasestorage.app',
  messagingSenderId: '39815537274',
  appId: '1:39815537274:web:4ba6462797f2755f60d1c3',
});
const db = getFirestore(app);
const feedback = collection(db, 'madarFeedback');
const images = collection(db, 'madarFeedbackImages');

export async function save(item, image) {
  const batch = writeBatch(db);
  const {id, ...fields} = item;
  batch.set(doc(feedback, id), {...fields, createdAt: serverTimestamp(), hasImage: !!image});
  if (image) batch.set(doc(images, id), {jpeg: Bytes.fromUint8Array(image)});
  await batch.commit();
}
export async function isReviewer() {
  return sessionStorage.getItem('madar-demo-user:' + globalThis.madarPages.base) === 'admin';
}
export async function list(cursor, size) {
  const filters = [orderBy('createdAt', 'desc'), limit(size)];
  if (cursor) filters.push(startAfter(cursor));
  const result = await getDocsFromServer(query(feedback, ...filters));
  return {
    items: result.docs.map(row => {
      const data = row.data();
      return {...data, id: row.id, createdAt: data.createdAt.toDate().toISOString()};
    }),
    cursor: result.docs.length === size ? result.docs.at(-1) : null,
  };
}
export async function picture(id) {
  const snapshot = await getDocFromServer(doc(images, id));
  if (!snapshot.exists()) throw Error('الصورة مش موجودة للملاحظة ' + id);
  return snapshot.data().jpeg.toUint8Array();
}
export async function remove(rows) {
  const batch = writeBatch(db);
  for (const row of rows) {
    batch.delete(doc(feedback, row.id));
    if (row.hasImage) batch.delete(doc(images, row.id));
  }
  await batch.commit();
}

