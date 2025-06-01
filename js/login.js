import { initializeUsers } from './auth/initUsers.js';
import { loginUser } from './auth/initUsers.js';

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
      alert('Mohon isi username dan password');
      return;
    }
  
    try {
      // Initialize users first
      await initializeUsers();
      
      const result = await loginUser(username, password);
      if (result.success) {
        sessionStorage.setItem('currentUser', JSON.stringify({
          username: result.username,
          role: result.role
        }));
        
        if (result.role === 'admin') {
          window.location.href = 'admin.html';
        } else {
          window.location.href = 'operator.html';
        }
      } else {
        alert(result.message);
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Gagal login: Silakan periksa koneksi internet dan coba lagi');
    }
  });
  