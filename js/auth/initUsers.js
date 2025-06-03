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
  const users = {
    'adminmelati': { password: 'admin', role: 'admin' },
    'supervisor': { password: 'svmlt116', role: 'supervisor' }
  };

  const user = users[username];
  
  if (user && user.password === password) {
    return {
      success: true,
      username: username,
      role: user.role
    };
  }
  
  return {
    success: false,
    message: 'Username atau password salah'
  };
}
