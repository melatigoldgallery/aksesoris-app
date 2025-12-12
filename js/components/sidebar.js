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
    const dropdownToggles = document.querySelectorAll('.sidebar .nav-link[data-bs-toggle="collapse"]');
    
    dropdownToggles.forEach(toggle => {
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        
        newToggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const targetId = this.getAttribute('data-bs-target');
            const target = document.querySelector(targetId);
            
            if (target) {
                if (target.classList.contains('show')) {
                    target.classList.remove('show');
                    this.setAttribute('aria-expanded', 'false');
                    this.classList.add('collapsed');
                } else {
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
    const existingOverlay = document.querySelector('.sidebar-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    
    const appContainer = document.querySelector('.app-container');
    const hamburgerBtn = document.querySelector('.hamburger');
    const sidebar = document.querySelector('.sidebar');
    
    if (hamburgerBtn) {
        const newHamburger = hamburgerBtn.cloneNode(true);
        hamburgerBtn.parentNode.replaceChild(newHamburger, hamburgerBtn);
        
        newHamburger.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            appContainer.classList.toggle('sidebar-active');
            
            document.body.style.overflow = appContainer.classList.contains('sidebar-active') ? 'hidden' : '';
        });
    }
    
    overlay.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        appContainer.classList.remove('sidebar-active');
        document.body.style.overflow = '';
    });
    
    document.addEventListener('click', function(e) {
        if (
            appContainer.classList.contains('sidebar-active') && 
            !sidebar.contains(e.target) && 
            !hamburgerBtn.contains(e.target)
        ) {
            appContainer.classList.remove('sidebar-active');
            document.body.style.overflow = '';
        }
    });
    
    setupSidebarLinks();
    
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            appContainer.classList.remove('sidebar-active');
            document.body.style.overflow = '';
        }
    });
}

/**
 * Setup all sidebar links to be clickable
 */
function setupSidebarLinks() {
    const menuItems = document.querySelectorAll('.sidebar .nav-link:not([data-bs-toggle])');
    
    menuItems.forEach(item => {
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);
        newItem.addEventListener('click', function(e) {
            if (window.innerWidth <= 768) {
                const appContainer = document.querySelector('.app-container');
                setTimeout(() => {
                    appContainer.classList.remove('sidebar-active');
                    document.body.style.overflow = '';
                }, 100);
            }
        });
    });
    
    setupSupervisorSubmenu();
}

/**
 * Setup supervisor submenu khusus
 */
function setupSupervisorSubmenu() {
    const supervisorToggle = document.querySelector('.supervisor-toggle');
    if (!supervisorToggle) return;
    const newToggle = supervisorToggle.cloneNode(true);
    supervisorToggle.parentNode.replaceChild(newToggle, supervisorToggle);
    
    newToggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const targetId = this.getAttribute('data-bs-target');
        const target = document.querySelector(targetId);
        
        if (target) {
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
    
    const supervisorLinks = document.querySelectorAll('#supervisorSubmenu .nav-link');
    supervisorLinks.forEach(link => {
        const newLink = link.cloneNode(true);
        link.parentNode.replaceChild(newLink, link);
        
        newLink.addEventListener('click', function(e) {
            if (window.innerWidth <= 768) {
                const appContainer = document.querySelector('.app-container');
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
    const currentPath = window.location.pathname;
    const filename = currentPath.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.sidebar .nav-link');
    navLinks.forEach(link => {
        link.classList.remove('active');
    });
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === filename || (filename === '' && href === 'index.html')) {
            link.classList.add('active');
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
