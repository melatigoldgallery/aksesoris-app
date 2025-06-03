
// 📦 Caching Logic for Kehadiran Module
const CACHE_KEY_KEHADIRAN = 'cachedKehadiranData';
const CACHE_EXPIRATION_KEHADIRAN = 5 * 60 * 1000; // 5 minutes

function saveKehadiranCache(data) {
  const cache = {
    timestamp: Date.now(),
    data: data
  };
  sessionStorage.setItem(CACHE_KEY_KEHADIRAN, JSON.stringify(cache));
}

function getKehadiranCache() {
  const raw = sessionStorage.getItem(CACHE_KEY_KEHADIRAN);
  if (!raw) return null;

  const cache = JSON.parse(raw);
  const now = Date.now();

  if ((now - cache.timestamp) > CACHE_EXPIRATION_KEHADIRAN) {
    sessionStorage.removeItem(CACHE_KEY_KEHADIRAN);
    return null;
  }

  return cache.data;
}


import { getAttendanceByDateRange, deleteAttendanceByDateRange } from "../services/report-service.js";
// PERBARUI import dengan menambahkan fungsi yang diperlukan
import {
  attendanceCache,
  shouldUpdateCache as shouldUpdateAttendanceCache,
  updateCacheTimestamp as updateAttendanceCacheTimestamp,
  saveAttendanceCacheToStorage,
} from "../services/attendance-service.js";

// Global variables
let currentAttendanceData = [];
let filteredData = [];

// Fungsi untuk menampilkan atau menyembunyikan indikator loading
function showLoading(show) {
  const loadingIndicator = document.getElementById("loadingIndicator");

  // Jika elemen loading indicator belum ada, buat baru
  if (!loadingIndicator && show) {
    // Buat elemen loading indicator
    const indicator = document.createElement("div");
    indicator.id = "loadingIndicator";
    indicator.className = "loading-overlay";
    indicator.innerHTML = `
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <p class="mt-2">Memuat data...</p>
    `;

    // Tambahkan style untuk loading overlay jika belum ada
    if (!document.getElementById("loadingStyles")) {
      const style = document.createElement("style");
      style.id = "loadingStyles";
      style.textContent = `
        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(255, 255, 255, 0.8);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          z-index: 9999;
        }
      `;
      document.head.appendChild(style);
    }

    // Tambahkan ke body
    document.body.appendChild(indicator);
  }
  // Jika elemen sudah ada, tampilkan atau sembunyikan
  else if (loadingIndicator) {
    loadingIndicator.style.display = show ? "flex" : "none";
  }
}

// Tambahkan fungsi untuk mengambil data dalam batch
async function getAttendanceInBatches(startDate, endDate, shift) {
  const batchSize = 7; // 7 hari per batch
  const batches = [];
  
  // Bagi rentang tanggal menjadi batch-batch kecil
  let currentDate = new Date(startDate);
  const endDateObj = new Date(endDate);
  
  while (currentDate <= endDateObj) {
    const batchStart = new Date(currentDate);
    
    // Hitung tanggal akhir batch (maksimal 7 hari atau sampai endDate)
    currentDate.setDate(currentDate.getDate() + batchSize - 1);
    if (currentDate > endDateObj) {
      currentDate = new Date(endDateObj);
    }
    
    const batchEnd = new Date(currentDate);
    
    batches.push({
      start: formatDateForAPI(batchStart),
      end: formatDateForAPI(batchEnd)
    });
    
    // Pindah ke batch berikutnya
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Ambil data untuk setiap batch
  const allData = [];
  for (const batch of batches) {
    const batchData = await getAttendanceByDateRange(batch.start, batch.end);
    if (Array.isArray(batchData)) {
      allData.push(...batchData);
    }
  }
  
  // Filter berdasarkan shift jika diperlukan
  if (shift !== "all") {
    return allData.filter(record => record.shift === shift);
  }
  
  return allData;
}

// Tambahkan konstanta untuk TTL
const CACHE_TTL_STANDARD = 60 * 60 * 1000; // 1 jam
const CACHE_TTL_TODAY = 5 * 60 * 1000;     // 5 menit untuk data hari ini

// Fungsi untuk memeriksa apakah cache masih valid
function isCacheValid(cacheKey) {
  const metaKey = `${cacheKey}_timestamp`;
  const timestamp = localStorage.getItem(metaKey);
  
  if (!timestamp) return false;
  
  const now = Date.now();
  const lastUpdate = parseInt(timestamp);
  
  // Jika cache key mencakup hari ini, gunakan TTL yang lebih pendek
  const today = getLocalDateString();
  if (cacheKey.includes(today)) {
    return (now - lastUpdate) < CACHE_TTL_TODAY;
  }
  
  // Untuk data historis, gunakan TTL standar
  return (now - lastUpdate) < CACHE_TTL_STANDARD;
}


// Fungsi untuk mengompresi data sebelum disimpan ke localStorage
function compressData(data) {
  try {
    // Konversi data ke string JSON
    const jsonString = JSON.stringify(data);

    // Kompresi sederhana dengan menghapus spasi berlebih
    return jsonString.replace(/\s+/g, "");
  } catch (error) {
    console.error("Error compressing data:", error);
    return JSON.stringify(data);
  }
}
// Fungsi untuk mendekompresi data dari localStorage
function decompressData(compressedData) {
  try {
    // Parse string JSON yang telah dikompresi
    return JSON.parse(compressedData);
  } catch (error) {
    console.error("Error decompressing data:", error);
    return null;
  }
}


// Fungsi untuk menampilkan data kehadiran
function displayAttendanceData(data) {
  // Simpan data ke variabel global
  currentAttendanceData = data;
  filteredData = [...data];
  
  // Update summary cards
  updateSummaryCards();
  
  // Tampilkan semua data
  displayAllData();
  
  // Tampilkan elemen laporan jika ada data
  if (data.length > 0) {
    showReportElements();
    
    // Tampilkan tombol aksi
    showActionButtons();
    
    // Sembunyikan pesan "tidak ada data"
    const noDataMessage = document.getElementById("noDataMessage");
    if (noDataMessage) {
      noDataMessage.style.display = "none";
    }
  } else {
    // Sembunyikan elemen laporan jika tidak ada data
    hideReportElements();
    
    // Sembunyikan tombol aksi
    hideActionButtons();
    
    // Tampilkan pesan "tidak ada data"
    const noDataMessage = document.getElementById("noDataMessage");
    if (noDataMessage) {
      noDataMessage.style.display = "block";
    }
  }
}

// Fungsi untuk menampilkan semua data sekaligus
function displayAllData() {
  const tbody = document.getElementById("attendanceReportList");
  if (!tbody) return;
  
  // Clear existing rows
  tbody.innerHTML = "";
  
  // Create document fragment for better performance
  const fragment = document.createDocumentFragment();
  
  // Add all rows
  filteredData.forEach((record, i) => {
    const row = document.createElement("tr");
    
    // Add data attributes for filtering
    row.dataset.shift = record.shift;
    row.dataset.status = record.status.toLowerCase().replace(/\s+/g, "-");
    row.dataset.type = record.type;
    
    // Format times
    const timeIn = record.timeIn ? formatTime(record.timeIn) : "-";
    const timeOut = record.timeOut ? formatTime(record.timeOut) : "-";
    
    // Calculate work duration
    const workDuration = calculateWorkDuration(record.timeIn, record.timeOut);
    
    // Gunakan tanggal dari timeIn jika tersedia
    let displayDate;
    if (record.timeIn) {
      // Gunakan tanggal dari timeIn untuk konsistensi
      displayDate = formatDateForDisplay(record.timeIn);
    } else {
      // Fallback ke field date jika timeIn tidak tersedia
      displayDate = formatDateForDisplay(record.date);
    }
    
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${record.employeeId || "-"}</td>
      <td>${record.name || "-"}</td>
      <td>${displayDate}</td>
      <td>${formatEmployeeType(record.type)}</td>
      <td>${formatShift(record.shift)}</td>
      <td>${timeIn}</td>
      <td>${timeOut}</td>
      <td>${workDuration}</td>
      <td class="status-${record.status.toLowerCase().replace(/\s+/g, "-")}">
        ${record.status}
        ${record.lateMinutes ? `<span class="late-minutes">(${record.lateMinutes} menit)</span>` : ""}
      </td>
    `;
    
    fragment.appendChild(row);
  });
  
  tbody.appendChild(fragment);
  
  // Tambahkan informasi jumlah data
  const dataCountInfo = document.createElement("div");
  dataCountInfo.className = "text-muted mt-2";
  dataCountInfo.textContent = `Menampilkan ${filteredData.length} data`;
  
  const tableContainer = document.querySelector("#tableContainer .card-body");
  if (tableContainer) {
    const existingInfo = tableContainer.querySelector(".text-muted");
    if (existingInfo) existingInfo.remove();
    tableContainer.appendChild(dataCountInfo);
  }
}


// Modifikasi fungsi loadAttendanceData untuk selalu refresh data hari ini
async function loadAttendanceData(forceRefresh = false) {
  try {
    const startDateInput = document.getElementById("startDate");
    const endDateInput = document.getElementById("endDate");
    const shiftFilterEl = document.getElementById("shiftFilter");
    
    if (!startDateInput || !endDateInput || !shiftFilterEl) {
      console.error("Required inputs not found");
      return;
    }
    
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    const selectedShift = shiftFilterEl.value;
    
    if (!startDate || !endDate) {
      showAlert("warning", "Silakan pilih rentang tanggal terlebih dahulu");
      return;
    }
    
    // Validasi shift - harus dipilih
    if (!selectedShift) {
      showAlert("warning", "Mohon pilih shift terlebih dahulu");
      shiftFilterEl.classList.add("is-invalid");
      return;
    } else {
      shiftFilterEl.classList.remove("is-invalid");
    }
    
    // Buat kunci cache dengan shift
    const cacheKey = `range_${startDate}_${endDate}_${selectedShift}`;
    
    // PERBAIKAN: Cek apakah rentang tanggal mencakup hari ini
    const today = getLocalDateString();
    const includesCurrentDay = (startDate <= today && today <= endDate);
    
    // Jika rentang tanggal mencakup hari ini, selalu refresh data
    forceRefresh = forceRefresh || includesCurrentDay;
    
    // Cek apakah data ada di cache dan masih valid
    if (!forceRefresh && attendanceCache.has(cacheKey) && !shouldUpdateAttendanceCache(cacheKey)) {
      console.log(`Using cached attendance data for range ${startDate} to ${endDate}`);
      
      // Tampilkan indikator cache di UI
      const cacheIndicator = document.getElementById('cacheIndicator');
      if (cacheIndicator) {
        cacheIndicator.textContent = 'Menggunakan data cache';
        cacheIndicator.style.display = 'inline-block';
      }
      
      // Ambil data dari cache
      const cachedData = attendanceCache.get(cacheKey);
      
      // Tampilkan data
      displayAttendanceData(cachedData);
      return;
    }
    
    // Tampilkan indikator loading
    showLoading(true);
    
    // Ambil data dari server - tanpa pagination (limit = 0 atau nilai besar)
    // Tambahkan parameter shift
    const result = await getAttendanceByDateRange(startDate, endDate, null, 1000, selectedShift);
    
    // Update data
    currentAttendanceData = result.attendanceRecords || [];
    
    // TAMBAHKAN: Simpan data ke cache
    attendanceCache.set(cacheKey, [...currentAttendanceData]);
    updateAttendanceCacheTimestamp(cacheKey);
    saveAttendanceCacheToStorage();
    
    // Sembunyikan indikator loading
    showLoading(false);
    
    // Sembunyikan indikator cache di UI
    const cacheIndicator = document.getElementById('cacheIndicator');
    if (cacheIndicator) {
      cacheIndicator.style.display = 'none';
    }
    
    // Tampilkan data
    displayAttendanceData(currentAttendanceData);
    
  } catch (error) {
    console.error("Error loading attendance data:", error);
    
    // Coba gunakan cache sebagai fallback jika terjadi error
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const selectedShift = document.getElementById("shiftFilter").value;
    const cacheKey = `range_${startDate}_${endDate}_${selectedShift}`;
    
    if (attendanceCache.has(cacheKey)) {
      console.log(`Fallback to cached data for range ${startDate} to ${endDate} due to error`);
      // Tampilkan pesan error tapi tetap tampilkan data
      showAlert("warning", "Terjadi kesalahan saat mengambil data terbaru. Menampilkan data dari cache.");
      
      // Tampilkan indikator cache di UI
      const cacheIndicator = document.getElementById('cacheIndicator');
      if (cacheIndicator) {
        cacheIndicator.textContent = 'Menggunakan data cache (fallback)';
        cacheIndicator.style.display = 'inline-block';
      }
      
      // Ambil data dari cache
      const cachedData = attendanceCache.get(cacheKey);
      
      // Tampilkan data
      displayAttendanceData(cachedData);
    } else {
      // Tidak ada cache, tampilkan pesan error
      showAlert("danger", "Terjadi kesalahan saat memuat data kehadiran: " + error.message);
      showLoading(false);
    }
  }
}



// Fungsi forceRefreshData - diperbarui untuk validasi shift
function forceRefreshData() {
  // Tampilkan konfirmasi
  if (confirm("Apakah Anda yakin ingin menyegarkan data dari server?")) {
    // Ambil nilai tanggal dan shift
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const selectedShift = document.getElementById("shiftFilter").value;
    
    if (!startDate || !endDate) {
      showAlert("warning", "Silakan pilih rentang tanggal terlebih dahulu");
      return;
    }
    
    // Validasi shift - harus dipilih
    if (!selectedShift) {
      showAlert("warning", "Mohon pilih shift terlebih dahulu");
      document.getElementById("shiftFilter").classList.add("is-invalid");
      return;
    } else {
      document.getElementById("shiftFilter").classList.remove("is-invalid");
    }
    
    // Hapus cache untuk rentang tanggal dan shift ini
    const cacheKey = `range_${startDate}_${endDate}_${selectedShift}`;
    if (attendanceCache.has(cacheKey)) {
      attendanceCache.delete(cacheKey);
      saveAttendanceCacheToStorage();
    }
    
    // Panggil loadAttendanceData dengan forceRefresh=true
    loadAttendanceData(true);
    
    // Tampilkan pesan
    showAlert("info", "Data sedang disegarkan dari server...");
  }
}

// Modifikasi updateReportCacheTimestamp untuk menyimpan ke localStorage
function updateReportCacheTimestamp(cacheKey) {
  attendanceDataCacheMeta.set(cacheKey, Date.now());
  saveReportCacheToStorage();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("generateReportBtn").addEventListener("click", async function() {
    try {
      // Tampilkan loading state
      this.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Memproses...';
      this.disabled = true;
  
     // Ambil nilai filter
     const startDate = document.getElementById("startDate")?.value || "";
     const endDate = document.getElementById("endDate")?.value || "";
     const employeeType = document.getElementById("employeeTypeFilter")?.value || "all";
     const shift = document.getElementById("shiftFilter")?.value || "";
  
      // Validasi tanggal
      if (!startDate || !endDate) {
        showAlert("warning", "Silakan pilih rentang tanggal terlebih dahulu");
        this.innerHTML = '<i class="fas fa-sync-alt me-2"></i> Generate Laporan';
        this.disabled = false;
        return;
      }
  
      // Panggil fungsi generateReport yang sudah ada
      await generateReport();
  
      // Tampilkan tombol export dan hapus data
      document.getElementById("actionButtons").classList.remove("d-none");
  
      // Kembalikan tombol ke state awal
      this.innerHTML = '<i class="fas fa-sync-alt me-2"></i> Generate Laporan';
      this.disabled = false;
    } catch (error) {
      console.error("Error generating report:", error);
      showAlert("danger", "Terjadi kesalahan saat menghasilkan laporan: " + error.message);
    }
  });
  
  // Tambahkan tombol refresh jika belum ada
  const tableHeader = document.querySelector('.card-header .d-flex');
  if (tableHeader && !document.getElementById('refreshData')) {
    const refreshButton = document.createElement('button');
    refreshButton.id = 'refreshData';
    refreshButton.className = 'btn btn-outline-secondary ms-2';
    refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Data';
    refreshButton.addEventListener('click', forceRefreshData);
    
    // Tambahkan ke UI
    tableHeader.appendChild(refreshButton);
  }
  
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  if (deleteConfirmModal) {
    deleteConfirmModal.addEventListener('hidden.bs.modal', function() {
      // Pastikan body sudah dibersihkan dari efek modal
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      
      // Hapus backdrop jika masih ada
      const backdrop = document.querySelector('.modal-backdrop');
      if (backdrop) {
        backdrop.remove();
      }
    });
  }
  
  // Set current date and time
  function updateDateTime() {
    const now = new Date();
    const dateElement = document.getElementById("current-date");
    const timeElement = document.getElementById("current-time");

    if (dateElement) {
      dateElement.textContent = now.toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }

    if (timeElement) {
      timeElement.textContent = now.toLocaleTimeString("id-ID");
    }
  }

  updateDateTime();
  setInterval(updateDateTime, 1000);

  // Initialize date pickers with default values
  initializeDatePickers();

  // Setup event listeners
  setupEventListeners();
  
  // Sembunyikan tombol aksi saat halaman pertama kali dimuat
  hideActionButtons();
  
  // Sembunyikan elemen laporan lainnya
  hideReportElements();
  
  // Tambahkan event listeners untuk tombol filter
  document.getElementById('filterAll')?.addEventListener('click', () => filterAttendanceByStatus('all'));
  document.getElementById('filterOnTime')?.addEventListener('click', () => filterAttendanceByStatus('ontime'));
  document.getElementById('filterLate')?.addEventListener('click', () => filterAttendanceByStatus('late'));
});

// Initialize date pickers with default values
function initializeDatePickers() {
  // Gunakan Date untuk mendapatkan tanggal lokal
  const today = new Date();

  const startDateInput = document.getElementById("startDate");
  const endDateInput = document.getElementById("endDate");

  if (startDateInput) {
    // Format tanggal untuk input date (YYYY-MM-DD)
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const formattedDate = `${year}-${month}-${day}`;
    startDateInput.value = formattedDate;
  }

  if (endDateInput) {
    // Format tanggal untuk input date (YYYY-MM-DD)
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const formattedDate = `${year}-${month}-${day}`;

    endDateInput.value = formattedDate;
  }
}

// Setup event listeners - diperbarui untuk dropdown
function setupEventListeners() {
  // Generate report button
  const generateReportBtn = document.getElementById("generateReportBtn");
  if (generateReportBtn) {
    generateReportBtn.addEventListener("click", generateReport);
  }
  
    // Tambahkan event listener untuk filter izin terlambat
    document.getElementById('filterLatePermission')?.addEventListener('click', () => filterAttendanceByStatus('latepermission'));

    // Export buttons
  const exportExcelBtn = document.getElementById("exportExcelBtn");
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener("click", exportToExcel);
  }
  
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", exportToPDF);
  }
  
  // Delete data button
  const deleteDataBtn = document.getElementById("deleteDataBtn");
  if (deleteDataBtn) {
    deleteDataBtn.addEventListener("click", function() {
      console.log("Delete button clicked");
      showDeleteConfirmation();
    });
  } else {
    console.error("Delete button not found");
  }
  
  // Confirm delete button
  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", function() {
      console.log("Confirm delete button clicked");
      deleteAttendanceData();
    });
  } else {
    console.error("Confirm delete button not found");
  }
  
 // Filter status dropdown
document.querySelectorAll("[data-status-filter]").forEach(item => {
  item.addEventListener("click", function(e) {
    e.preventDefault();
    const status = this.getAttribute("data-status-filter");
    filterAttendanceByStatus(status);
  });
});

// Filter tipe karyawan dropdown
document.querySelectorAll("[data-employee-filter]").forEach(item => {
  item.addEventListener("click", function(e) {
    e.preventDefault();
    const filter = this.getAttribute("data-employee-filter");
    filterAttendanceData("type", filter);
  });
});
  
  // Refresh data button
  document.getElementById("refreshData")?.addEventListener("click", forceRefreshData);
  
  // Tambahkan event listener untuk validasi shift saat berubah
  document.getElementById("shiftFilter")?.addEventListener("change", function() {
    if (this.value) {
      this.classList.remove("is-invalid");
    }
  });
}

// Fungsi untuk menyembunyikan tombol aksi (export dan hapus) - versi yang lebih kuat
function hideActionButtons() {
  try {
    const actionButtons = document.getElementById("actionButtons");
    if (actionButtons) {
      // Gunakan !important untuk memastikan style diterapkan
      actionButtons.setAttribute("style", "display: none !important");
      
      // Log untuk debugging
      console.log("Action buttons hidden");
      
      // Tambahan: sembunyikan juga tombol-tombol individual jika ada
      const exportExcelBtn = document.getElementById("exportExcelBtn");
      const exportPdfBtn = document.getElementById("exportPdfBtn");
      const deleteDataBtn = document.getElementById("deleteDataBtn");
      
      if (exportExcelBtn) exportExcelBtn.style.display = "none";
      if (exportPdfBtn) exportPdfBtn.style.display = "none";
      if (deleteDataBtn) deleteDataBtn.style.display = "none";
    } else {
      console.warn("Action buttons element not found with ID 'actionButtons'");
    }
  } catch (error) {
    console.error("Error hiding action buttons:", error);
  }
}

// Fungsi untuk menampilkan tombol aksi (export dan hapus) - versi yang lebih kuat
function showActionButtons() {
  try {
    const actionButtons = document.getElementById("actionButtons");
    if (actionButtons) {
      // Gunakan !important untuk memastikan style diterapkan
      actionButtons.setAttribute("style", "display: flex !important");
      
      // Log untuk debugging
      console.log("Action buttons shown");
      
      // Tambahan: tampilkan juga tombol-tombol individual jika ada
      const exportExcelBtn = document.getElementById("exportExcelBtn");
      const exportPdfBtn = document.getElementById("exportPdfBtn");
      const deleteDataBtn = document.getElementById("deleteDataBtn");
      
      if (exportExcelBtn) exportExcelBtn.style.display = "inline-block";
      if (exportPdfBtn) exportPdfBtn.style.display = "inline-block";
      if (deleteDataBtn) deleteDataBtn.style.display = "inline-block";
    } else {
      console.warn("Action buttons element not found with ID 'actionButtons'");
    }
  } catch (error) {
    console.error("Error showing action buttons:", error);
  }
}

// Perbaikan pada fungsi deleteAttendanceData
async function deleteAttendanceData() {
  try {
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const selectedShift = document.getElementById("shiftFilter").value;

    // Hapus data
    console.log(`Deleting data from ${startDate} to ${endDate}`);
    const deletedCount = await deleteAttendanceByDateRange(startDate, endDate);

    // PERBAIKAN: Tutup modal dengan benar
    // Metode 1: Gunakan Bootstrap API
    const deleteModal = bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'));
    if (deleteModal) {
      deleteModal.hide();
    } else {
      // Metode 2: Jika Bootstrap API tidak tersedia, gunakan jQuery
      $('#deleteConfirmModal').modal('hide');
    }
    
    // Metode 3: Jika kedua metode di atas gagal, gunakan pendekatan manual
    setTimeout(() => {
      const modalElement = document.getElementById('deleteConfirmModal');
      if (modalElement && modalElement.classList.contains('show')) {
        // Hapus kelas modal
        modalElement.classList.remove('show');
        modalElement.style.display = 'none';
        modalElement.setAttribute('aria-hidden', 'true');
        modalElement.removeAttribute('aria-modal');
        
        // Hapus backdrop
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
          backdrop.remove();
        }
        
        // Reset body
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
      }
    }, 300);

    // Tampilkan pesan sukses
    showAlert("success", `<i class="fas fa-check-circle me-2"></i> Berhasil menghapus ${deletedCount} data kehadiran`);

    // Simpan informasi penghapusan untuk invalidasi cache
    localStorage.setItem("attendanceDataDeletedTime", Date.now().toString());
    localStorage.setItem("attendanceDataDeletedRange", JSON.stringify({
      startDate: startDate,
      endDate: endDate
    }));

    // Hapus cache untuk rentang ini
    const cacheKey = `range_${startDate}_${endDate}_${selectedShift}`;
    attendanceDataCache.delete(cacheKey);
    localStorage.removeItem(`${cacheKey}_timestamp`);

    // Reset UI
    hideReportElements();
    document.getElementById("noDataMessage").style.display = "block";

    // Reset data
    currentAttendanceData = [];
    filteredData = [];
    
    return deletedCount;
  } catch (error) {
    console.error("Error deleting data:", error);
    throw error;
  }
}

// Fungsi untuk menghasilkan laporan kehadiran
async function generateReport(forceRefresh = false) {
  try {
    // Validasi input
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const selectedShift = document.getElementById("shiftFilter").value;

    if (!startDate || !endDate) {
      showAlert("warning", "Pilih rentang tanggal terlebih dahulu");
      return;
    }

    // Validasi rentang tanggal
    if (new Date(startDate) > new Date(endDate)) {
      showAlert("warning", "Tanggal mulai tidak boleh lebih besar dari tanggal akhir");
      return;
    }

    // Create cache key
    const cacheKey = `range_${startDate}_${endDate}_${selectedShift}`;
    
    // Show loading state
    showAlert("info", '<i class="fas fa-spinner fa-spin me-2"></i> Memuat data kehadiran...', false);
    
    // Cek apakah rentang tanggal mencakup hari ini
    const today = getLocalDateString();
    const includesCurrentDay = (startDate <= today && today <= endDate);
    
    // Cek apakah ada update kehadiran sejak terakhir kali cache dibuat
    const lastAttendanceUpdate = localStorage.getItem("lastAttendanceScanTime");
    const cacheTimestamp = localStorage.getItem(`${cacheKey}_timestamp`);
    
    // Tentukan apakah perlu refresh
    // PERUBAHAN: Gunakan attendanceCache alih-alih attendanceDataCache
    let needsRefresh = forceRefresh || !attendanceCache.has(cacheKey);
    
    // Jika mencakup hari ini atau ada update kehadiran baru, refresh data
    if (includesCurrentDay && lastAttendanceUpdate && cacheTimestamp) {
      needsRefresh = needsRefresh || (parseInt(lastAttendanceUpdate) > parseInt(cacheTimestamp));
    }
    
    // Cek juga apakah ada data yang dihapus yang mempengaruhi rentang ini
    const deletedDataTimestamp = localStorage.getItem("attendanceDataDeletedTime");
    const deletedDataRange = localStorage.getItem("attendanceDataDeletedRange");
    
    if (deletedDataTimestamp && cacheTimestamp && deletedDataRange) {
      try {
        const deletedRange = JSON.parse(deletedDataRange);
        // Jika rentang yang dihapus tumpang tindih dengan rentang yang diminta
        if (deletedRange.startDate <= endDate && deletedRange.endDate >= startDate) {
          // Dan penghapusan terjadi setelah cache dibuat
          if (parseInt(deletedDataTimestamp) > parseInt(cacheTimestamp)) {
            needsRefresh = true;
          }
        }
      } catch (e) {
        console.error("Error parsing deleted data range:", e);
      }
    }
    
    // TAMBAHAN: Cek juga apakah cache perlu diperbarui berdasarkan TTL
    if (!needsRefresh && shouldUpdateAttendanceCache(cacheKey)) {
      needsRefresh = true;
    }
    
    let attendanceData = [];
    
    if (needsRefresh) {
      console.log(`Fetching fresh data for range ${startDate} to ${endDate}, shift: ${selectedShift}`);
      
      // Sembunyikan indikator cache di UI
      const cacheIndicator = document.getElementById('cacheIndicator');
      if (cacheIndicator) {
        cacheIndicator.style.display = 'none';
      }
      
      try {
        // Fetch from Firestore
        const result = await getAttendanceByDateRange(startDate, endDate);
        
        // PERBAIKAN: Periksa format hasil yang dikembalikan
        // Jika result adalah objek dengan property attendanceRecords, gunakan itu
        if (result && typeof result === 'object') {
          if (Array.isArray(result)) {
            attendanceData = result;
          } else if (result.attendanceRecords && Array.isArray(result.attendanceRecords)) {
            attendanceData = result.attendanceRecords;
          } else {
            console.error("Unexpected result format:", result);
            attendanceData = [];
          }
        } else if (Array.isArray(result)) {
          attendanceData = result;
        } else {
          console.error("Unexpected result format:", result);
          attendanceData = [];
        }
        
        // Filter berdasarkan shift jika diperlukan
        if (selectedShift !== "all" && Array.isArray(attendanceData)) {
          attendanceData = attendanceData.filter(record => record.shift === selectedShift);
        }
        
        // PERUBAHAN: Gunakan attendanceCache dan fungsi dari attendance-service.js
        attendanceCache.set(cacheKey, [...attendanceData]);
        updateAttendanceCacheTimestamp(cacheKey);
        saveAttendanceCacheToStorage();
        
        // Hide loading message
        hideAlert();
      } catch (error) {
        console.error("Error fetching attendance data:", error);
        
        // Jika gagal dan ada cache, gunakan cache sebagai fallback
        // PERUBAHAN: Gunakan attendanceCache alih-alih attendanceDataCache
        if (attendanceCache.has(cacheKey)) {
          console.log("Using cached data as fallback due to fetch error");
          attendanceData = attendanceCache.get(cacheKey);
          showAlert("warning", "Gagal mengambil data terbaru. Menggunakan data cache sebagai fallback.");
        } else {
          // Jika tidak ada cache, set attendanceData ke array kosong
          attendanceData = [];
          showAlert("danger", `Gagal mengambil data: ${error.message}`);
        }
      }
    } else {
      console.log(`Using cached attendance data for range ${startDate} to ${endDate}, shift: ${selectedShift}`);
      
      // Tampilkan indikator cache di UI jika ada
      const cacheIndicator = document.getElementById('cacheIndicator');
      if (cacheIndicator) {
        const cacheTime = new Date(parseInt(cacheTimestamp));
        const formattedTime = cacheTime.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit'
        });
        cacheIndicator.textContent = `Menggunakan data cache (${formattedTime})`;
        cacheIndicator.style.display = 'inline-block';
      }
      
      // PERUBAHAN: Ambil data dari attendanceCache alih-alih attendanceDataCache
      attendanceData = attendanceCache.get(cacheKey) || [];
      
      // Hide loading message
      hideAlert();
    }
    
    // PERBAIKAN: Pastikan attendanceData adalah array
    if (!Array.isArray(attendanceData)) {
      console.error("attendanceData is not an array:", attendanceData);
      attendanceData = [];
    }
    
    // Update global data
    currentAttendanceData = attendanceData;
    filteredData = [...attendanceData];
    
    // Jika tidak ada data, tampilkan pesan
    if (!attendanceData || attendanceData.length === 0) {
      // PERBAIKAN: Periksa apakah elemen ada sebelum mengubah propertinya
      const noDataMessage = document.getElementById("noDataMessage");
      if (noDataMessage) {
        noDataMessage.style.display = "block";
      } else {
        // Jika elemen tidak ada, buat dan tampilkan pesan
        const reportContainer = document.querySelector(".report-container");
        if (reportContainer) {
          const noDataDiv = document.createElement("div");
          noDataDiv.id = "noDataMessage";
          noDataDiv.className = "text-center my-5";
          noDataDiv.innerHTML = `
            <i class="fas fa-search fa-3x text-muted mb-3"></i>
            <h4 class="text-muted">Tidak ada data kehadiran</h4>
            <p class="text-muted">Tidak ada data kehadiran untuk periode yang dipilih.</p>
          `;
          reportContainer.appendChild(noDataDiv);
        }
      }
      
      // Periksa apakah elemen-elemen ini ada sebelum mencoba mengubah propertinya
      const attendanceTable = document.getElementById("attendanceTable");
      const exportBtn = document.getElementById("exportBtn");
      const printBtn = document.getElementById("printBtn");
      const deleteDataBtn = document.getElementById("deleteDataBtn");
      const reportSummary = document.getElementById("reportSummary");
      const filterContainer = document.getElementById("filterContainer");
      
      if (attendanceTable) attendanceTable.style.display = "none";
      if (exportBtn) exportBtn.style.display = "none";
      if (printBtn) printBtn.style.display = "none";
      if (deleteDataBtn) deleteDataBtn.style.display = "none";
      if (reportSummary) reportSummary.style.display = "none";
      if (filterContainer) filterContainer.style.display = "none";
      
      // PERBAIKAN: Tampilkan alert untuk memberi tahu user
      showAlert("info", '<i class="fas fa-info-circle me-2"></i> Tidak ada data kehadiran untuk periode yang dipilih', true);
      
      return;
    }
    
    // Tampilkan data
    const noDataMessage = document.getElementById("noDataMessage");
    const attendanceTable = document.getElementById("attendanceTable");
    const exportBtn = document.getElementById("exportBtn");
    const printBtn = document.getElementById("printBtn");
    const deleteDataBtn = document.getElementById("deleteDataBtn");
    const reportSummary = document.getElementById("reportSummary");
    const filterContainer = document.getElementById("filterContainer");
    
    if (noDataMessage) noDataMessage.style.display = "none";
    if (attendanceTable) attendanceTable.style.display = "table";
    if (exportBtn) exportBtn.style.display = "inline-block";
    if (printBtn) printBtn.style.display = "inline-block";
    if (deleteDataBtn) deleteDataBtn.style.display = "inline-block";
    if (reportSummary) reportSummary.style.display = "block";
    if (filterContainer) filterContainer.style.display = "block";
    
    // Render tabel
    if (typeof renderAttendanceTable === 'function') {
      renderAttendanceTable(filteredData);
    } else {
      // Fallback jika fungsi renderAttendanceTable tidak tersedia
      displayAttendanceData(filteredData);
    }
    
    // Hitung dan tampilkan statistik
    if (typeof calculateStats === 'function') {
      calculateStats(filteredData);
    } else {
      // Fallback jika fungsi calculateStats tidak tersedia
      updateSummaryCards();
    }
    
    // Tampilkan rentang tanggal yang dipilih
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    const formattedStartDate = startDateObj.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    
    const formattedEndDate = endDateObj.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    
    let dateRangeText;
    if (formattedStartDate === formattedEndDate) {
      dateRangeText = `Tanggal: ${formattedStartDate}`;
    } else {
      dateRangeText = `Periode: ${formattedStartDate} - ${formattedEndDate}`;
    }
    
    const dateRangeInfo = document.getElementById("dateRangeInfo");
    if (dateRangeInfo) dateRangeInfo.textContent = dateRangeText;
    
    // Tampilkan informasi shift
    const shiftText = selectedShift === "all"
      ? "Semua Shift"
      : selectedShift === "morning"
        ? "Shift Pagi"
        : "Shift Sore";
    
    const shiftInfo = document.getElementById("shiftInfo");
    if (shiftInfo) shiftInfo.textContent = `Shift: ${shiftText}`;
    
    // Scroll ke tabel
    if (attendanceTable) attendanceTable.scrollIntoView({ behavior: "smooth" });
    
    // PERBAIKAN: Setup filter listeners
    setupFilterListeners();
    
  } catch (error) {
    console.error("Error generating report:", error);
    showAlert("danger", `<i class="fas fa-exclamation-circle me-2"></i> Terjadi kesalahan: ${error.message}`);
  }
}


// Fungsi untuk setup filter listeners
function setupFilterListeners() {
  // Filter status
  const statusFilterItems = document.querySelectorAll("[data-status-filter]");
  statusFilterItems.forEach(item => {
    item.addEventListener("click", function(e) {
      e.preventDefault();
      const status = this.getAttribute("data-status-filter");
      
      // Update UI untuk menunjukkan filter aktif
      statusFilterItems.forEach(el => el.classList.remove("active"));
      this.classList.add("active");
      
      // Filter data
      if (status === "all") {
        filteredData = [...currentAttendanceData];
      } else if (status === "ontime") {
        filteredData = currentAttendanceData.filter(record => record.status === "Tepat Waktu");
      } else if (status === "late") {
        filteredData = currentAttendanceData.filter(record => record.status === "Terlambat");
      } else if (status === "latepermission") {
        filteredData = currentAttendanceData.filter(record => record.status === "Izin Terlambat");
      }
      
      // Update UI
      updateSummaryCards();
      displayAllData();
      
      // Update dropdown button text
      const statusFilterDropdown = document.getElementById("statusFilterDropdown");
      if (statusFilterDropdown) {
        const statusText = status === "all" ? "Status" : 
                          status === "ontime" ? "Tepat Waktu" : 
                          status === "late" ? "Terlambat" : "Izin Terlambat";
        statusFilterDropdown.innerHTML = `<i class="fas fa-filter"></i> ${statusText}`;
      }
    });
  });
  
  // Filter tipe karyawan
  const employeeFilterItems = document.querySelectorAll("[data-employee-filter]");
  employeeFilterItems.forEach(item => {
    item.addEventListener("click", function(e) {
      e.preventDefault();
      const type = this.getAttribute("data-employee-filter");
      
      // Update UI untuk menunjukkan filter aktif
      employeeFilterItems.forEach(el => el.classList.remove("active"));
      this.classList.add("active");
      
      // Filter data
      if (type === "all") {
        filteredData = [...currentAttendanceData];
      } else {
        filteredData = currentAttendanceData.filter(record => record.type === type);
      }
      
      // Update UI
      displayAllData();
      calculateStats(filteredData);
      
      // Update dropdown button text
      const employeeFilterDropdown = document.getElementById("employeeFilterDropdown");
      if (employeeFilterDropdown) {
        const typeText = type === "all" ? "Tipe Karyawan" : 
                        type === "staff" ? "Staff" : "Office Boy";
        employeeFilterDropdown.innerHTML = `<i class="fas fa-users"></i> ${typeText}`;
      }
    });
  });
}

// Tambahkan fungsi untuk mendapatkan tanggal hari ini dalam format YYYY-MM-DD
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get array of dates in range
function getDatesInRange(startDate, endDate) {
  const dates = [];
  let currentDate = new Date(startDate);
  const endDateObj = new Date(endDate);

  // Set waktu ke 00:00:00 untuk menghindari masalah perbandingan
  currentDate.setHours(0, 0, 0, 0);
  endDateObj.setHours(0, 0, 0, 0);

  while (currentDate <= endDateObj) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

// Fungsi untuk mendapatkan string tanggal lokal dari objek Date
function getLocalDateStringFromDate(date) {
  // Pastikan kita menggunakan tanggal lokal
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Clear attendance data cache
function clearAttendanceDataCache() {
  attendanceDataCache.clear();
  attendanceDataCacheMeta.clear();
  console.log("Attendance data cache cleared");
}

// Show report elements
function showReportElements() {
  const summaryCards = document.getElementById("summaryCards");
  if (summaryCards) summaryCards.style.display = "flex";
  
  // Tombol aksi ditangani oleh fungsi showActionButtons()
  
  const tableContainer = document.getElementById("tableContainer");
  if (tableContainer) tableContainer.style.display = "block";
  
  const noDataMessage = document.getElementById("noDataMessage");
  if (noDataMessage) noDataMessage.style.display = "none";
}


// Hide report elements
function hideReportElements() {
  const summaryCards = document.getElementById("summaryCards");
  if (summaryCards) summaryCards.style.display = "none";
  
  // Tombol aksi ditangani oleh fungsi hideActionButtons()
  hideActionButtons();
  
  const tableContainer = document.getElementById("tableContainer");
  if (tableContainer) tableContainer.style.display = "none";
  
  const noDataMessage = document.getElementById("noDataMessage");
  if (noDataMessage) noDataMessage.style.display = "none";
}


// Update summary cards
function updateSummaryCards() {
  const totalAttendance = filteredData.length;
  const onTimeCount = filteredData.filter((record) => record.status === "Tepat Waktu").length;
  const lateCount = filteredData.filter((record) => record.status === "Terlambat").length;
  // Tambahkan perhitungan untuk izin terlambat
  const latePermissionCount = filteredData.filter((record) => record.status === "Izin Terlambat").length;

  // Update UI with null checks
  const totalAttendanceEl = document.getElementById("totalAttendance");
  if (totalAttendanceEl) totalAttendanceEl.textContent = totalAttendance;

  const onTimeCountEl = document.getElementById("onTimeCount");
  if (onTimeCountEl) onTimeCountEl.textContent = onTimeCount;

  const lateCountEl = document.getElementById("lateCount");
  if (lateCountEl) lateCountEl.textContent = lateCount;
  
  // Update UI untuk izin terlambat
  const latePermissionCountEl = document.getElementById("latePermissionCount");
  if (latePermissionCountEl) latePermissionCountEl.textContent = latePermissionCount;
}

/// Perbaikan fungsi filter tipe karyawan
function filterAttendanceData(filterType, value) {
  if (value === "all") {
    // Reset filter
    filteredData = [...currentAttendanceData];
  } else {
    filteredData = currentAttendanceData.filter(record => {
      if (filterType === "shift") {
        return record.shift === value;
      } else if (filterType === "status") {
        return (value === "ontime" && record.status === "Tepat Waktu") || 
               (value === "late" && record.status === "Terlambat") ||
               (value === "latepermission" && record.status === "Izin Terlambat");
      } else if (filterType === "type") {
        return record.type === value;
      }
      return true;
    });
  }
  
  // Update UI
  updateSummaryCards();
  displayAllData();
  
  // Update dropdown button text
  if (filterType === "type") {
    let buttonText = "Semua Karyawan";
    if (value === "staff") buttonText = "Staff";
    else if (value === "ob") buttonText = "Office Boy";
    
    const employeeFilterDropdown = document.getElementById("employeeFilterDropdown");
    if (employeeFilterDropdown) {
      employeeFilterDropdown.innerHTML = `<i class="fas fa-users"></i> ${buttonText}`;
    }
  } else if (filterType === "status") {
    let statusText = "Status";
    if (value === "ontime") statusText = "Tepat Waktu";
    else if (value === "late") statusText = "Terlambat";
    else if (value === "latepermission") statusText = "Izin Terlambat";
    
    const statusFilterDropdown = document.getElementById("statusFilterDropdown");
    if (statusFilterDropdown) {
      statusFilterDropdown.innerHTML = `<i class="fas fa-filter"></i> ${statusText}`;
    }
  }
}


// Perbaikan fungsi filter status
function filterAttendanceByStatus(status) {
  if (status === 'all') {
    // Reset filter
    filteredData = [...currentAttendanceData];
  } else if (status === 'ontime') {
    // Filter tepat waktu - pastikan case sensitive sesuai dengan data
    filteredData = currentAttendanceData.filter(record => record.status === "Tepat Waktu");
  } else if (status === 'late') {
    // Filter terlambat - pastikan case sensitive sesuai dengan data
    filteredData = currentAttendanceData.filter(record => record.status === "Terlambat");
  } else if (status === 'latepermission') {
    // Filter izin terlambat
    filteredData = currentAttendanceData.filter(record => record.status === "Izin Terlambat");
  }
  
  // Update UI
  updateSummaryCards();
  displayAllData();
  
  // Update dropdown text
  const statusFilterDropdown = document.getElementById('statusFilterDropdown');
  if (statusFilterDropdown) {
    if (status === 'all') {
      statusFilterDropdown.innerHTML = '<i class="fas fa-filter"></i> Semua Status';
    } else if (status === 'ontime') {
      statusFilterDropdown.innerHTML = '<i class="fas fa-filter"></i> Tepat Waktu';
    } else if (status === 'late') {
      statusFilterDropdown.innerHTML = '<i class="fas fa-filter"></i> Terlambat';
    } else if (status === 'latepermission') {
      statusFilterDropdown.innerHTML = '<i class="fas fa-filter"></i> Izin Terlambat';
    }
  }
}



// Show delete confirmation modal
function showDeleteConfirmation() {
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;

  if (!startDate || !endDate) {
    showAlert("warning", "Pilih rentang tanggal terlebih dahulu");
    return;
  }

  // Update modal text
  const deleteStartDateEl = document.getElementById("deleteStartDate");
  const deleteEndDateEl = document.getElementById("deleteEndDate");

  if (deleteStartDateEl) deleteStartDateEl.textContent = formatDateForDisplay(startDate);
  if (deleteEndDateEl) deleteEndDateEl.textContent = formatDateForDisplay(endDate);

  // Show modal
  const deleteConfirmModal = document.getElementById("deleteConfirmModal");
  if (deleteConfirmModal) {
    const modal = new bootstrap.Modal(deleteConfirmModal);
    modal.show();
  } else {
    console.error("Delete confirmation modal not found");
  }
}

// Export to Excel
function exportToExcel() {
  try {
    if (filteredData.length === 0) {
      showAlert("warning", '<i class="fas fa-exclamation-triangle me-2"></i> Tidak ada data untuk diekspor');
      return;
    }

    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Prepare title and information
    const title = "Laporan Kehadiran Karyawan";
    const dateRange = `Periode: ${formatDateForDisplay(startDate)} - ${formatDateForDisplay(endDate)}`;
    const printDate = `Dicetak pada: ${new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    // Create worksheet with headers and data
    const wsData = [
      [title], // Title row
      [dateRange], // Date range row
      [printDate], // Print date row
      [], // Empty row for spacing
      [
        "No",
        "ID Karyawan",
        "Nama",
        "Tanggal",
        "Tipe Karyawan",
        "Shift",
        "Jam Masuk",
        "Jam Keluar",
        "Durasi Kerja",
        "Status",
      ], // Header row
    ];

    // Add data rows
    filteredData.forEach((record, index) => {
      const timeIn = record.timeIn ? formatTime(record.timeIn) : "-";
      const timeOut = record.timeOut ? formatTime(record.timeOut) : "-";
      const workDuration = calculateWorkDuration(record.timeIn, record.timeOut);

      wsData.push([
        index + 1,
        record.employeeId || "-",
        record.name || "-",
        formatDateForDisplay(record.date),
        formatEmployeeType(record.type),
        formatShift(record.shift),
        timeIn,
        timeOut,
        workDuration,
        record.status + (record.lateMinutes ? ` (${record.lateMinutes} menit)` : ""),
      ]);
    });

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    const colWidths = [
      { wch: 5 }, // No
      { wch: 10 }, // ID Karyawan
      { wch: 20 }, // Nama
      { wch: 15 }, // Tanggal
      { wch: 15 }, // Tipe Karyawan
      { wch: 10 }, // Shift
      { wch: 10 }, // Jam Masuk
      { wch: 10 }, // Jam Keluar
      { wch: 15 }, // Durasi Kerja
      { wch: 20 }, // Status
    ];
    ws["!cols"] = colWidths;

    // Merge cells for title and info rows
    ws["!merges"] = [
      // Merge cells for title (A1:J1)
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      // Merge cells for date range (A2:J2)
      { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
      // Merge cells for print date (A3:J3)
      { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } },
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Laporan Kehadiran");

    // Generate filename
    const fileName = `Laporan_Kehadiran_${formatDateForFilename(startDate)}_${formatDateForFilename(endDate)}.xlsx`;

    // Export file
    XLSX.writeFile(wb, fileName);

    showAlert("success", `<i class="fas fa-check-circle me-2"></i> Berhasil mengekspor data ke Excel`);
  } catch (error) {
    console.error("Error exporting to Excel:", error);
    showAlert("danger", `<i class="fas fa-exclamation-circle me-2"></i> Gagal mengekspor data: ${error.message}`);
  }
}

// Export to PDF
function exportToPDF() {
  try {
    if (filteredData.length === 0) {
      showAlert("warning", '<i class="fas fa-exclamation-triangle me-2"></i> Tidak ada data untuk diekspor');
      return;
    }

    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;

    // Create PDF document
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("l", "mm", "a4"); // landscape orientation

    // Add title
    doc.setFontSize(16);
    doc.text(`Laporan Kehadiran Karyawan`, 14, 15);

    // Add subtitle with date range
    doc.setFontSize(12);
    doc.text(`Periode: ${formatDateForDisplay(startDate)} - ${formatDateForDisplay(endDate)}`, 14, 22);

    // Add subtitle with date
    doc.setFontSize(10);
    doc.text(
      `Dicetak pada: ${new Date().toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      14,
      28
    );

    // Prepare table data
    const tableData = filteredData.map((record, index) => {
      const timeIn = record.timeIn ? formatTime(record.timeIn) : "-";
      const timeOut = record.timeOut ? formatTime(record.timeOut) : "-";
      const workDuration = calculateWorkDuration(record.timeIn, record.timeOut);

      return [
        index + 1,
        record.employeeId || "-",
        record.name || "-",
        formatDateForDisplay(record.date),
        formatEmployeeType(record.type),
        formatShift(record.shift),
        timeIn,
        timeOut,
        record.status + (record.lateMinutes ? ` (${record.lateMinutes} menit)` : ""),
      ];
    });

    // Add table
    doc.autoTable({
      startY: 35,
      head: [["No", "ID", "Nama", "Tanggal", "Tipe", "Shift", "Masuk", "Keluar", "Status"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 8 },
        2: { cellWidth: 30 },
      },
    });

    // Generate filename
    const fileName = `Laporan_Kehadiran_${formatDateForFilename(startDate)}_${formatDateForFilename(endDate)}.pdf`;

    // Save PDF
    doc.save(fileName);

    showAlert("success", `<i class="fas fa-check-circle me-2"></i> Berhasil mengekspor data ke PDF`);
  } catch (error) {
    console.error("Error exporting to PDF:", error);
    showAlert("danger", `<i class="fas fa-exclamation-circle me-2"></i> Gagal mengekspor data: ${error.message}`);
  }
}

// Helper function to format time
function formatTime(timestamp) {
  if (!timestamp) return "-";

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Helper function to format date for display
function formatDateForDisplay(dateInput) {
  if (!dateInput) return "-";

  let date;

  // Jika input sudah berupa objek Date
  if (dateInput instanceof Date) {
    date = dateInput;
  }
  // Jika input berupa string dalam format YYYY-MM-DD
  else if (typeof dateInput === "string" && dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Pastikan tanggal diinterpretasikan sebagai tanggal lokal, bukan UTC
    const [year, month, day] = dateInput.split("-");
    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  // Jika format lain
  else {
    date = new Date(dateInput);
  }

  // Gunakan toLocaleDateString untuk memastikan format tanggal lokal yang benar
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Helper function to format date for filename
function formatDateForFilename(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);

  return date
    .toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .replace(/\//g, "-");
}

// Helper function to calculate work duration
function calculateWorkDuration(timeIn, timeOut) {
  if (!timeIn || !timeOut) return "-";

  const inTime = timeIn instanceof Date ? timeIn : new Date(timeIn);
  const outTime = timeOut instanceof Date ? timeOut : new Date(timeOut);

  // Calculate duration in minutes
  const durationMinutes = Math.floor((outTime - inTime) / (1000 * 60));

  // Convert to hours and minutes
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  return `${hours} jam ${minutes} menit`;
}

// Helper function to format employee type
function formatEmployeeType(type) {
  return type === "staff" ? "Staff" : "Office Boy";
}

// Helper function to format shift
function formatShift(shift) {
  return shift === "morning" ? "Pagi" : "Sore";
}

// Show alert message
function showAlert(type, message, autoHide = true) {
  const alertContainer = document.getElementById("alertContainer");
  if (!alertContainer) return;

  alertContainer.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show">
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
  `;

  alertContainer.style.display = "block";

  if (autoHide) {
    setTimeout(() => {
      const alert = alertContainer.querySelector(".alert");
      if (alert) {
        const bsAlert = new bootstrap.Alert(alert);
        bsAlert.close();
      }
    }, 5000);
  }
}

// Hide alert
function hideAlert() {
  const alertContainer = document.getElementById("alertContainer");
  if (alertContainer) {
    alertContainer.innerHTML = "";
    alertContainer.style.display = "none";
  }
}

// Export functions
export { generateReport, exportToExcel, exportToPDF, clearAttendanceDataCache };
