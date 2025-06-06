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

// Initialize when document is ready
$(document).ready(function () {
  checkLoginStatus();
  setupMenuAccess();
});

// Export global functions
window.handleLogout = handleLogout;