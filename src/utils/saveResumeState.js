import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const saveResumeState = async (userId, setId, chapterIndex, puzzleId) => {
  try {
    const userDocRef = doc(db, 'users', userId);
    await setDoc(
      userDocRef,
      { _resume: { setId, chapterIndex, puzzleId } },
      { merge: true }
    );
  } catch (e) {
    console.error('Error saving resume state: ', e);
  }
};

export default saveResumeState;
