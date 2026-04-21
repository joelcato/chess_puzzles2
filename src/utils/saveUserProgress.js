import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

// setId: puzzle set id (e.g. "polgar", "lichess_mating_patterns")
// puzzleIds: string or string[] — one or more puzzle ids to mark as solved
const saveUserProgress = async (userId, setId, puzzleIds) => {
  try {
    const userDocRef = doc(db, 'users', userId);
    const ids = Array.isArray(puzzleIds) ? puzzleIds : [puzzleIds];
    const updates = {};
    for (const id of ids) updates[id] = { solved: true };
    await setDoc(userDocRef, { [setId]: updates }, { merge: true });
  } catch (e) {
    console.error('Error saving document: ', e);
  }
};

export default saveUserProgress;