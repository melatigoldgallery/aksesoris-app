import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyC9iHJOSuNIpsviiv52X4sfyXtYdZ7LWcE",
  authDomain: "sistem-antrian-young.firebaseapp.com",
  databaseURL: "https://sistem-antrian-young-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sistem-antrian-young",
  storageBucket: "sistem-antrian-young.firebasestorage.app",
  messagingSenderId: "991088221390",
  appId: "1:991088221390:web:cb92ef25e942d547eac49f",
  measurementId: "G-FSBYYXSJXT"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const firestore = getFirestore(app);
console.log('Firebase initialized successfully');
export default app;
export { database, firestore };

// Test Firestore connection
async function testFirestoreConnection() {
  try {
    const snapshot = await getDocs(collection(firestore, "kodeAksesoris", "kategori", "kotak"));
    console.log("Firestore connection successful!");
    snapshot.forEach(doc => {
      console.log(doc.id, " => ", doc.data());
    });
  } catch (error) {
    console.error("Error connecting to Firestore:", error);
  }
}

testFirestoreConnection();

export const authService = {
  getCurrentUser: async () => {
      const user = sessionStorage.getItem('currentUser');
      return user ? JSON.parse(user) : null;
  },
  
  setCurrentUser: (user) => {
      sessionStorage.setItem('currentUser', JSON.stringify(user));
  },
  
  logout: () => {
      sessionStorage.removeItem('currentUser');
  }
};