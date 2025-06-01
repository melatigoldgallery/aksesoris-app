import { initializeUsers, loginUser } from './auth/initUsers.js';

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  
  if (!username || !password) {
    alert('Mohon isi username dan password');
    return;
  }

  // Show loading state
  const loginButton = document.querySelector('.login-button');
  const originalText = loginButton.innerHTML;
  loginButton.innerHTML = '<span>Loading...</span><i class="fas fa-spinner fa-spin"></i>';
  loginButton.disabled = true;

  try {
    // Initialize users and attempt login
    await initializeUsers();
    const result = await loginUser(username, password);
    
    if (result.success) {
      sessionStorage.setItem('currentUser', JSON.stringify({
        username: result.username,
        role: result.role
      }));
      
      // Redirect based on role
      window.location.href = result.role === 'admin' ? 'dashboard.html' : 'operator.html';
    } else {
      alert(result.message || 'Username atau password salah');
    }
  } catch (error) {
    console.error('Login error:', error);
    
    const errorMessages = {
      'permission-denied': 'Akses ditolak. Hubungi administrator.',
      'unavailable': 'Layanan tidak tersedia. Coba lagi nanti.',
      'default': 'Gagal login. Periksa koneksi internet dan coba lagi.'
    };
    
    alert(errorMessages[error.code] || errorMessages.default);
  } finally {
    // Restore button state
    loginButton.innerHTML = originalText;
    loginButton.disabled = false;
  }
});
