import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";
import app from '../configFirebase.js';
const db = getDatabase(app);
const authorizedUsers = {
    'adminyoung': {
      password: 'admin',
      role: 'admin'
    },
    'operator': {
      password: 'operator123',
      role: 'operator'
    }
};

export async function initializeUsers() {
  const db = getDatabase();
  const usersRef = ref(db, 'authorized_users');
  
  // Check if users already exist
  const snapshot = await get(usersRef);
  if (!snapshot.exists()) {
      // Only initialize if no users exist
      await set(usersRef, authorizedUsers);
  }
  return true;
}
export async function loginUser(username, password) {
  try {
    const db = getDatabase();
    const usersRef = ref(db, 'authorized_users');
    const snapshot = await get(usersRef);
    
    if (!snapshot.exists()) {
      // Initialize users if they don't exist
      await initializeUsers();
      // Fetch again after initialization
      const newSnapshot = await get(usersRef);
      const users = newSnapshot.val();
      
      if (users[username] && users[username].password === password) {
        return {
          success: true,
          role: users[username].role,
          username: username
        };
      }
    } else {
      const users = snapshot.val();
      if (users[username] && users[username].password === password) {
        return {
          success: true,
          role: users[username].role,
          username: username
        };
      }
    }
    
    return {
      success: false,
      message: 'Username atau password salah'
    };
    
  } catch (error) {
    console.error('Login error:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat login. Silakan coba lagi.'
    };
  }
}
