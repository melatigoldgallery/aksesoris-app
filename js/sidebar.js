// Fungsi untuk menampilkan atau menyembunyikan sub bagian berdasarkan klik tombol
export function sidebarToggle() {
    // Sembunyikan semua sub bagian pada awal
    const subSections = document.querySelectorAll("aside ul ul");
    subSections.forEach(subSection => subSection.style.display = "none");
  
    // Ambil path URL saat ini
    const currentPath = window.location.pathname;
  
    // Loop melalui setiap tombol toggle
    const buttons = document.querySelectorAll(".inpt-btn, .utlt-btn, .lprn-btn, .sell-btn");
    buttons.forEach(button => {
      const target = button.getAttribute("data-target");
  
      // Bandingkan path URL saat ini dengan data-target
      if (currentPath === "/" + target + ".html") {
        document.getElementById(target).style.display = "block"; // Tampilkan sub bagian yang sesuai
        button.classList.add("active"); // Tandai tombol toggle sebagai aktif
      }
  
      // Tangkap klik tombol toggle
      button.addEventListener("click", () => {
        // Sembunyikan semua sub bagian yang bukan milik tombol yang diklik
        subSections.forEach(subSection => {
          if (subSection.id !== target) {
            subSection.style.display = "none";
          }
        });
  
        // Tampilkan atau sembunyikan sub bagian yang sesuai
        const targetSection = document.getElementById(target);
        targetSection.style.display = targetSection.style.display === "none" ? "block" : "none";
  
        // Hapus kelas "active" dari semua tombol toggle
        buttons.forEach(btn => btn.classList.remove("active"));
  
        // Tambahkan kelas "active" ke tombol yang diklik
        button.classList.add("active");
      });
    });
  }
  