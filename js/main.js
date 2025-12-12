import { sidebarToggle } from "./components/sidebar.js";
import { initializeDateTime } from "./components/header.js";

try {
  console.log("Initializing UI components...");

  sidebarToggle();
  initializeDateTime();

  document.addEventListener("DOMContentLoaded", function () {
    console.log("DOM fully loaded");

    const appContainer = document.querySelector(".app-container");
    const sidebar = document.querySelector(".sidebar");
    const hamburger = document.querySelector(".hamburger");

    if (appContainer && sidebar && hamburger) {
      document.addEventListener("click", function (e) {
        if (
          appContainer.classList.contains("sidebar-active") &&
          !sidebar.contains(e.target) &&
          !hamburger.contains(e.target)
        ) {
          appContainer.classList.remove("sidebar-active");
          document.body.style.overflow = "";
        }
      });
    }
  });

  console.log("UI components initialized successfully");
} catch (error) {
  console.error("Error initializing UI components:", error);
}

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
  if (user && user.role === "admin") {
    const maintenanceMenu = document.querySelector('a[href="maintenance.html"]');
    if (maintenanceMenu) {
      maintenanceMenu.closest(".nav-item").style.display = "none";
    }
  }
}

function setupPasswordVerification() {
  const tambahAksesorisLinks = document.querySelectorAll('a[href="tambahAksesoris.html"]');

  console.log("Found tambahAksesoris links:", tambahAksesorisLinks.length);

  if (tambahAksesorisLinks.length > 0) {
    tambahAksesorisLinks.forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log("Tambah Aksesoris link clicked, showing password modal");
        createPasswordModal();
      });
    });
  }
}

function createPasswordModal() {
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

  const existingModal = document.getElementById("passwordModal");
  if (existingModal) {
    existingModal.remove();
  }

  document.body.insertAdjacentHTML("beforeend", modalHTML);

  const passwordModal = new bootstrap.Modal(document.getElementById("passwordModal"));
  const verificationPassword = document.getElementById("verificationPassword");
  const verifyPasswordBtn = document.getElementById("verifyPasswordBtn");
  const passwordError = document.getElementById("passwordError");

  const verifyPassword = function () {
    const password = verificationPassword.value;
    const correctPassword = "smlt116";

    if (password === correctPassword) {
      passwordModal.hide();
      window.location.href = "tambahAksesoris.html";
    } else {
      verificationPassword.classList.add("is-invalid");
      passwordError.textContent = "Password salah!";
    }
  };

  verifyPasswordBtn.addEventListener("click", verifyPassword);

  verificationPassword.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      verifyPassword();
    }
  });

  document.getElementById("passwordModal").addEventListener("hidden.bs.modal", function () {
    document.getElementById("passwordModal").remove();
  });

  document.getElementById("passwordModal").addEventListener("shown.bs.modal", function () {
    verificationPassword.focus();
  });
  passwordModal.show();
}
$(document).ready(function () {
  checkLoginStatus();
  setupMenuAccess();
  setupPasswordVerification();
});
window.handleLogout = handleLogout;
