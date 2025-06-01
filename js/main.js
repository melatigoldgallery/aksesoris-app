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
