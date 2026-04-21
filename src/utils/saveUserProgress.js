import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

// setId: puzzle set id (e.g. "polgar", "lichess_mating_patterns")
// puzzleId: string puzzle id within the set
const saveUserProgress = async (userId, setId, puzzleId) => {
  try {
    const userDocRef = doc(db, 'users', userId);
    await setDoc(
      userDocRef,
      { [setId]: { [puzzleId]: { solved: true } } },
      { merge: true }
    );
  } catch (e) {
    console.error('Error saving document: ', e);
  }
};

export default saveUserProgress;