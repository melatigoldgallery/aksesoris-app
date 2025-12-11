// Load sidebar dan set active menu
async function initSidebar() {
  const sidebar = document.querySelector(".sidebar");

  try {
    const response = await fetch("components/sidebar.html");
    const html = await response.text();
    sidebar.innerHTML = html;

    // Set active menu berdasarkan halaman saat ini
    setActiveMenu();

    // Filter menu berdasarkan role user
    filterMenuByRole();
  } catch (error) {
    console.error("Error loading sidebar:", error);
  }
}

// Filter menu berdasarkan role user
function filterMenuByRole() {
  const user = JSON.parse(sessionStorage.getItem("currentUser"));
  const maintenanceMenu = document.querySelector('a[href="maintenance.html"]');

  if (!maintenanceMenu) return;

  const maintenanceItem = maintenanceMenu.closest(".nav-item");

  // Sembunyikan menu maintenance untuk semua role kecuali supervisor
  if (!user || user.role !== "supervisor") {
    if (maintenanceItem) {
      maintenanceItem.style.display = "none";
    }
  }
}

// Set active menu berdasarkan current page
function setActiveMenu() {
  const currentPage = window.location.pathname.split("/").pop();
  const navLinks = document.querySelectorAll(".sidebar .nav-link");

  navLinks.forEach((link) => {
    const href = link.getAttribute("href");

    // Remove active dari semua link
    link.classList.remove("active");

    // Tambah active jika href sama dengan current page
    if (href === currentPage) {
      link.classList.add("active");

      // Expand parent collapse jika ada
      const parentCollapse = link.closest(".collapse");
      if (parentCollapse) {
        parentCollapse.classList.add("show");

        // Update parent toggle button
        const collapseId = parentCollapse.id;
        const parentToggle = document.querySelector(`[data-bs-target="#${collapseId}"]`);
        if (parentToggle) {
          parentToggle.classList.remove("collapsed");
          parentToggle.setAttribute("aria-expanded", "true");
        }
      }
    }
  });
}

// Auto init saat DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidebar);
} else {
  initSidebar();
}
