import { firestore } from '../configFirebase.js';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs 
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

// Gunakan Firestore methods, BUKAN Realtime Database methods
export async function initializeUsers() {
  try {
    const usersRef = collection(firestore, 'users');
    const snapshot = await getDocs(usersRef);
    
    if (snapshot.empty) {
      // Create default users
      await setDoc(doc(firestore, 'users', 'admin'), {
        username: 'adminmelati',
        password: 'admin',
        role: 'admin'
      });
      
      await setDoc(doc(firestore, 'users', 'operator'), {
        username: 'operator',
        password: 'operator123',
        role: 'operator'
      });
      
      console.log('Default users created');
    }
  } catch (error) {
    console.error('Error initializing users:', error);
    throw error;
  }
}

export async function loginUser(username, password) {
  try {
    const usersRef = collection(firestore, 'users');
    const snapshot = await getDocs(usersRef);
    
    let userFound = null;
    snapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.username === username && userData.password === password) {
        userFound = userData;
      }
    });
    
    if (userFound) {
      return {
        success: true,
        username: userFound.username,
        role: userFound.role
      };
    } else {
      return {
        success: false,
        message: 'Username atau password salah'
      };
    }
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}
