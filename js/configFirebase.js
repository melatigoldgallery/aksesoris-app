import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-storage.js';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA7JvWu5eDgSYjUyfAH1DuN3b3CTwVz-ps",
  authDomain: "aksesoris-app-7be90.firebaseapp.com",
  projectId: "aksesoris-app-7be90",
  storageBucket: "aksesoris-app-7be90.firebasestorage.app",
  messagingSenderId: "458967126225",
  appId: "1:458967126225:web:10fe8c5724303b7d2cf5f0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);
const storage = getStorage(app);

console.log('Firebase initialized successfully');

// Export Firebase instances
export default app;
export { firestore, storage };

