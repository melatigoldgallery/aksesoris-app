import { sidebarToggle } from "./components/sidebar.js";
import { initializeDateTime } from "./components/header.js";

// Panggil fungsi-fungsi ini di awal file
try {
  console.log("Initializing UI components...");
  
  // Inisialisasi komponen UI utama
  sidebarToggle();
  initializeDateTime();
  
  // Tambahkan event listener untuk dokumen setelah DOM loaded
  document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded");
    
    // Tambahkan event listener untuk menutup sidebar ketika mengklik di luar sidebar
    const appContainer = document.querySelector('.app-container');
    const sidebar = document.querySelector('.sidebar');
    const hamburger = document.querySelector('.hamburger');
    
    if (appContainer && sidebar && hamburger) {
      document.addEventListener('click', function(e) {
        // Jika sidebar sedang aktif dan klik bukan pada sidebar atau elemen di dalamnya
        // dan bukan pada tombol hamburger
        if (
          appContainer.classList.contains('sidebar-active') && 
          !sidebar.contains(e.target) && 
          !hamburger.contains(e.target)
        ) {
          appContainer.classList.remove('sidebar-active');
          document.body.style.overflow = '';
        }
      });
    }
  });  
  
  console.log("UI components initialized successfully");
} catch (error) {
  console.error("Error initializing UI components:", error);
}


// Authentication functions
function handleLogout() {
  sessionStorage.removeItem("currentUser");
  window.location.href = "index.html";
}

async function checkLoginStatus() {
  const user = sessionStorage.getItem("currentUser");
  if (!user) {
    window.location.href = "index.html";
  }
}

function setupMenuAccess() {
  const user = JSON.parse(sessionStorage.getItem("currentUser"));
  if (user && user.role === 'admin') {
    // Sembunyikan menu maintenance untuk admin
    const maintenanceMenu = document.querySelector('a[href="maintenance.html"]');
    if (maintenanceMenu) {
      maintenanceMenu.closest('.nav-item').style.display = 'none';
    }
  }
}

// Password verification for Tambah Aksesoris
function setupPasswordVerification() {
  const tambahAksesorisLink = document.querySelector('a[href="tambahAksesoris.html"]');
  
  if (tambahAksesorisLink) {
    tambahAksesorisLink.addEventListener('click', function(e) {
      e.preventDefault();
      createPasswordModal();
    });
  }
}

function createPasswordModal() {
  // Create modal HTML
  const modalHTML = `
    <div class="modal fade" id="passwordModal" tabindex="-1" aria-labelledby="passwordModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="passwordModalLabel">
              <i class="fas fa-lock me-2"></i>Verifikasi Password
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted mb-3">Masukkan password untuk mengakses menu Tambah Aksesoris:</p>
            <div class="mb-3">
              <input type="password" class="form-control" id="verificationPassword" placeholder="Password verifikasi">
              <div class="invalid-feedback" id="passwordError"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Batal</button>
            <button type="button" class="btn btn-primary" id="verifyPasswordBtn">Verifikasi</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Remove existing modal if any
  const existingModal = document.getElementById('passwordModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Initialize modal and event listeners
  const passwordModal = new bootstrap.Modal(document.getElementById('passwordModal'));
  const verificationPassword = document.getElementById('verificationPassword');
  const verifyPasswordBtn = document.getElementById('verifyPasswordBtn');
  const passwordError = document.getElementById('passwordError');
  
  // Verify password event
  verifyPasswordBtn.addEventListener('click', function() {
    const password = verificationPassword.value;
    const correctPassword = 'smlt116'; // Ganti dengan password yang diinginkan
    
    if (password === correctPassword) {
      passwordModal.hide();
      window.location.href = 'tambahAksesoris.html';
    } else {
      verificationPassword.classList.add('is-invalid');
      passwordError.textContent = 'Password salah!';
    }
  });
  
  // Reset form when modal is hidden and remove from DOM
  document.getElementById('passwordModal').addEventListener('hidden.bs.modal', function() {
    document.getElementById('passwordModal').remove();
  });
  
  // Show modal
  passwordModal.show();
}

// Initialize when document is ready
$(document).ready(function () {
  checkLoginStatus();
  setupMenuAccess();
   setupPasswordVerification();
});

// Export global functions
window.handleLogout = handleLogout;