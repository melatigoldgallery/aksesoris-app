// sidebar.js - Handles all sidebar functionality

// Definisikan fungsi setupSidebarToggle terlebih dahulu
function setupSidebarToggle() {
    const menuToggle = document.querySelector(".menu-toggle");
    const appContainer = document.querySelector(".app-container");

    if (menuToggle) {
        menuToggle.addEventListener("click", function () {
            // Hanya toggle sidebar-collapsed jika bukan di mobile
            if (window.innerWidth > 768) {
                appContainer.classList.toggle("sidebar-collapsed");
            }
        });
    }
}

// Kemudian definisikan fungsi sidebarToggle yang mengekspor
export function sidebarToggle() {
    setupSidebarToggle();
    setupDropdownToggles();
    setupMobileSidebar();
    highlightActiveMenu();
}

/**
 * Setup dropdown toggles in sidebar
 */
function setupDropdownToggles() {
    console.log("Setting up dropdown toggles");
    const dropdownToggles = document.querySelectorAll('.sidebar .nav-link[data-bs-toggle="collapse"]');
    
    dropdownToggles.forEach(toggle => {
        // Hapus event listener yang mungkin sudah ada
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        
        // Tambahkan event listener baru
        newToggle.addEventListener('click', function(e) {
            // Hentikan propagasi event untuk mencegah konflik
            e.preventDefault();
            e.stopPropagation();
            
            // Get the target dropdown element
            const targetId = this.getAttribute('data-bs-target');
            const target = document.querySelector(targetId);
            
            if (target) {
                // Toggle the 'show' class on the target dropdown
                if (target.classList.contains('show')) {
                    // If it's already open, close it
                    target.classList.remove('show');
                    this.setAttribute('aria-expanded', 'false');
                    this.classList.add('collapsed');
                } else {
                    // If it's closed, open it and close others
                    
                    // First close all other dropdowns (accordion behavior)
                    dropdownToggles.forEach(otherToggle => {
                        if (otherToggle !== this) {
                            const otherId = otherToggle.getAttribute('data-bs-target');
                            const other = document.querySelector(otherId);
                            
                            if (other && other.classList.contains('show')) {
                                other.classList.remove('show');
                                otherToggle.setAttribute('aria-expanded', 'false');
                                otherToggle.classList.add('collapsed');
                            }
                        }
                    });
                    
                    // Then open this dropdown
                    target.classList.add('show');
                    this.setAttribute('aria-expanded', 'true');
                    this.classList.remove('collapsed');
                }
            }
        });
    });
}

/**
 * Setup mobile sidebar functionality
 */
function setupMobileSidebar() {
    // Bersihkan overlay yang mungkin sudah ada
    const existingOverlay = document.querySelector('.sidebar-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }
    
    // Buat overlay baru
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    
    const appContainer = document.querySelector('.app-container');
    const hamburgerBtn = document.querySelector('.hamburger');
    const sidebar = document.querySelector('.sidebar');
    
    // Toggle sidebar on hamburger click
    if (hamburgerBtn) {
        // Hapus event listener yang mungkin sudah ada
        const newHamburger = hamburgerBtn.cloneNode(true);
        hamburgerBtn.parentNode.replaceChild(newHamburger, hamburgerBtn);
        
        // Tambahkan event listener baru
        newHamburger.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            appContainer.classList.toggle('sidebar-active');
            
            // Toggle body overflow
            document.body.style.overflow = appContainer.classList.contains('sidebar-active') ? 'hidden' : '';
        });
    }
    
    // Close sidebar when clicking the overlay
    overlay.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        appContainer.classList.remove('sidebar-active');
        document.body.style.overflow = '';
    });
    
    // PERBAIKAN: Tambahkan event listener untuk menutup sidebar ketika mengklik di luar sidebar
    document.addEventListener('click', function(e) {
        // Jika sidebar sedang aktif dan klik bukan pada sidebar atau elemen di dalamnya
        // dan bukan pada tombol hamburger
        if (
            appContainer.classList.contains('sidebar-active') && 
            !sidebar.contains(e.target) && 
            !hamburgerBtn.contains(e.target)
        ) {
            appContainer.classList.remove('sidebar-active');
            document.body.style.overflow = '';
        }
    });
    
    // Make all sidebar links clickable
    setupSidebarLinks();
    
    // Handle window resize
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            // Reset to desktop view
            appContainer.classList.remove('sidebar-active');
            document.body.style.overflow = '';
        }
    });
}

/**
 * Setup all sidebar links to be clickable
 */
function setupSidebarLinks() {
    // Regular menu items (not dropdowns)
    const menuItems = document.querySelectorAll('.sidebar .nav-link:not([data-bs-toggle])');
    
    menuItems.forEach(item => {
        // Hapus event listener yang mungkin sudah ada
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);
        
        // Tambahkan event listener baru
        newItem.addEventListener('click', function(e) {
            // Jangan hentikan propagasi agar link berfungsi
            
            // Jika di mobile, tutup sidebar setelah klik
            if (window.innerWidth <= 768) {
                const appContainer = document.querySelector('.app-container');
                
                // Delay sedikit untuk memastikan navigasi terjadi
                setTimeout(() => {
                    appContainer.classList.remove('sidebar-active');
                    document.body.style.overflow = '';
                }, 100);
            }
        });
    });
    
    // Setup supervisor submenu khusus
    setupSupervisorSubmenu();
}

/**
 * Setup supervisor submenu khusus
 */
function setupSupervisorSubmenu() {
    const supervisorToggle = document.querySelector('.supervisor-toggle');
    if (!supervisorToggle) return;
    
    // Hapus event listener yang mungkin sudah ada
    const newToggle = supervisorToggle.cloneNode(true);
    supervisorToggle.parentNode.replaceChild(newToggle, supervisorToggle);
    
    // Tambahkan event listener baru
    newToggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const targetId = this.getAttribute('data-bs-target');
        const target = document.querySelector(targetId);
        
        if (target) {
            // Toggle submenu
            if (target.classList.contains('show')) {
                target.classList.remove('show');
                this.setAttribute('aria-expanded', 'false');
                this.classList.add('collapsed');
            } else {
                target.classList.add('show');
                this.setAttribute('aria-expanded', 'true');
                this.classList.remove('collapsed');
            }
        }
    });
    
    // Setup links dalam submenu supervisor
    const supervisorLinks = document.querySelectorAll('#supervisorSubmenu .nav-link');
    supervisorLinks.forEach(link => {
        // Hapus event listener yang mungkin sudah ada
        const newLink = link.cloneNode(true);
        link.parentNode.replaceChild(newLink, link);
        
        // Tambahkan event listener baru
        newLink.addEventListener('click', function(e) {
            // Jangan hentikan propagasi agar link berfungsi
            
            // Jika di mobile, tutup sidebar setelah klik
            if (window.innerWidth <= 768) {
                const appContainer = document.querySelector('.app-container');
                
                // Delay sedikit untuk memastikan navigasi terjadi
                setTimeout(() => {
                    appContainer.classList.remove('sidebar-active');
                    document.body.style.overflow = '';
                }, 100);
            }
        });
    });
}

/**
 * Highlight active menu based on current page
 */
function highlightActiveMenu() {
    // Get current page path
    const currentPath = window.location.pathname;
    const filename = currentPath.split('/').pop() || 'index.html';
    
    // Get all navigation links
    const navLinks = document.querySelectorAll('.sidebar .nav-link');
    
    // Remove active class from all links
    navLinks.forEach(link => {
        link.classList.remove('active');
    });
    
    // Add active class to link matching current page
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === filename || (filename === '' && href === 'index.html')) {
            link.classList.add('active');
            
            // If this is a submenu item, open its parent
            const parentCollapse = link.closest('.collapse');
            if (parentCollapse) {
                parentCollapse.classList.add('show');
                const parentToggle = document.querySelector(`[data-bs-target="#${parentCollapse.id}"]`);
                if (parentToggle) {
                    parentToggle.classList.remove('collapsed');
                    parentToggle.setAttribute('aria-expanded', 'true');
                }
            }
        }
    });
}
