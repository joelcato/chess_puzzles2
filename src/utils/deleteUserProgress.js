import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';

// puzzleIds: string | string[] — deletes specific puzzles
// omit puzzleIds to delete the entire set field
const deleteUserProgress = async (userId, setId, puzzleIds) => {
  let updates;
  if (puzzleIds == null) {
    updates = { [setId]: deleteField() };
  } else {
    const ids = Array.isArray(puzzleIds) ? puzzleIds : [puzzleIds];
    updates = {};
    for (const id of ids) {
      updates[`${setId}.${id}`] = deleteField();
    }
  }
  try {
    const userDocRef = doc(db, 'users', userId);
    await updateDoc(userDocRef, updates);
  } catch (e) {
    console.error('Error deleting progress: ', e);
  }
};

export default deleteUserProgress;
