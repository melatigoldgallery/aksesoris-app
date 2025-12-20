import { firestore } from "./configFirebase.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// Table configurations
const tableConfigs = {
  all: {
    columns: ["Tanggal", "Jenis", "Kode", "Nama Barang", "Pcs", "Gr", "Kadar", "Harga", "Status", "Keterangan"],
    fields: ["tanggal", "jenis", "kode", "nama", "pcs", "gr", "kadar", "harga", "status", "keterangan"],
  },
  aksesoris: {
    columns: ["Tanggal", "Jenis", "Kode", "Nama Barang", "Pcs", "Gr", "Kadar", "Harga", "Status"],
    fields: ["tanggal", "jenis", "kode", "nama", "pcs", "gr", "kadar", "harga", "status"],
  },
  kotak: {
    columns: ["Tanggal", "Jenis", "Nama Barang", "Pcs", "Harga", "Status"],
    fields: ["tanggal", "jenis", "nama", "pcs", "harga", "status"],
  },
  manual: {
    columns: ["Tanggal", "Jenis", "Kode", "Nama Barang", "Pcs", "Gr", "Kadar", "Harga", "Status", "Keterangan"],
    fields: ["tanggal", "jenis", "kode", "nama", "pcs", "gr", "kadar", "harga", "status", "keterangan"],
  },
};

// Smart cache management adapted from laporanStok.js
const cacheManager = {
  // Cache TTL constants
  CACHE_TTL_TODAY: 30 * 60 * 1000, // 30 menit untuk data hari ini
  CACHE_TTL_STANDARD: 60 * 60 * 1000, // 1 jam untuk data historis

  // Check if cache is valid
  isValid(cacheKey) {
    const metaKey = `${cacheKey}_timestamp`;
    const timestamp = localStorage.getItem(metaKey);

    if (!timestamp) return false;

    const now = Date.now();
    const lastUpdate = parseInt(timestamp);

    // Jika cache key mencakup hari ini, gunakan TTL yang lebih pendek
    const today = this.getLocalDateString();
    if (cacheKey.includes(today)) {
      return now - lastUpdate < this.CACHE_TTL_TODAY;
    }

    // Untuk data historis, gunakan TTL standar
    return now - lastUpdate < this.CACHE_TTL_STANDARD;
  },

  // Set cache data with localStorage persistence
  set(cacheKey, data) {
    try {
      const compressedData = this.compressData(data);
      localStorage.setItem(cacheKey, compressedData);

      const metaKey = `${cacheKey}_timestamp`;
      localStorage.setItem(metaKey, Date.now().toString());

      console.log(`Cache saved for key: ${cacheKey}`);
    } catch (error) {
      console.error("Error saving cache:", error);
      this.clearOldCache();
      try {
        const compressedData = this.compressData(data);
        localStorage.setItem(cacheKey, compressedData);
        localStorage.setItem(`${cacheKey}_timestamp`, Date.now().toString());
      } catch (retryError) {
        console.error("Failed to save cache after cleanup:", retryError);
      }
    }
  },

  // Get cache data from localStorage
  get(cacheKey) {
    if (!this.isValid(cacheKey)) {
      this.clear(cacheKey);
      return null;
    }

    try {
      const compressedData = localStorage.getItem(cacheKey);
      if (!compressedData) return null;

      return this.decompressData(compressedData);
    } catch (error) {
      console.error("Error retrieving cache:", error);
      this.clear(cacheKey);
      return null;
    }
  },

  // Clear specific cache
  clear(cacheKey = null) {
    if (cacheKey) {
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(`${cacheKey}_timestamp`);
    } else {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith("salesData_") || key.includes("_timestamp")) {
          localStorage.removeItem(key);
        }
      });
    }
  },

  // Clear old cache entries
  clearOldCache() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.endsWith("_timestamp")) {
        const timestamp = parseInt(localStorage.getItem(key));
        if (now - timestamp > maxAge) {
          const dataKey = key.replace("_timestamp", "");
          localStorage.removeItem(key);
          localStorage.removeItem(dataKey);
        }
      }
    });
  },

  // Clear cache for specific date
  clearCacheForDate(date) {
    const dateStr = formatDate(date).replace(/\//g, "-");
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.includes(dateStr) && key.startsWith("salesData_")) {
        localStorage.removeItem(key);
        localStorage.removeItem(`${key}_timestamp`);
      }
    });
    console.log(`🗑️ Cleared cache for ${dateStr}`);
  },

  // Compress data before storing
  compressData(data) {
    try {
      const processedData = JSON.parse(
        JSON.stringify(data, (key, value) => {
          if (value && typeof value === "object" && value.seconds && value.nanoseconds) {
            return new Date(value.seconds * 1000 + value.nanoseconds / 1000000).toISOString();
          }
          return value;
        })
      );

      const jsonString = JSON.stringify(processedData);
      return jsonString.replace(/\s+/g, "");
    } catch (error) {
      console.error("Error compressing data:", error);
      return JSON.stringify(data);
    }
  },

  // Decompress data after retrieving
  decompressData(compressedData) {
    try {
      const parsed = JSON.parse(compressedData);

      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          if (item.timestamp && typeof item.timestamp === "string") {
            item.timestamp = new Date(item.timestamp);
          }
          return item;
        });
      }

      return parsed;
    } catch (error) {
      console.error("Error decompressing data:", error);
      return null;
    }
  },

  // Get local date string in YYYY-MM-DD format
  getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },
};

// Main handler object with smart real-time updates
const laporanPenjualanHandler = {
  salesData: [],
  filteredSalesData: [],
  dataTable: null,

  // Real-time listener management (adapted from laporanStok.js)
  currentListener: null,
  currentSelectedDate: null,
  isListeningToday: false,
  isDataLoaded: false,

  // Utility functions
  showAlert: (message, title = "Informasi", type = "info") => {
    return Swal.fire({
      title: title,
      text: message,
      icon: type,
      confirmButtonText: "OK",
      confirmButtonColor: "#0d6efd",
    });
  },

  showLoading: (show) => {
    const loadingIndicator = document.getElementById("loadingIndicator");
    if (loadingIndicator) {
      loadingIndicator.style.display = show ? "flex" : "none";
    }
  },

  // Smart real-time listener setup (adapted from laporanStok.js)
  setupRealtimeListener(selectedDate) {
    const today = new Date();
    const isToday = this.isSameDate(selectedDate, today);

    // Only setup listener for today's data
    if (isToday && !this.isListeningToday) {
      this.setupTodayListener();
      this.isListeningToday = true;
      console.log("📡 Real-time listener activated for today");
    } else if (!isToday && this.isListeningToday) {
      // Remove listener if not viewing today's data
      this.removeTodayListener();
      this.isListeningToday = false;
      console.log("🔇 Real-time listener deactivated");
    }
  },

  // Setup listener for today's sales data
  setupTodayListener() {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Listen to sales data for today
    const salesQuery = query(
      collection(firestore, "penjualanAksesoris"),
      where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
      where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
      orderBy("timestamp", "desc")
    );

    this.currentListener = onSnapshot(salesQuery, (snapshot) => {
      if (!snapshot.metadata.hasPendingWrites && this.isDataLoaded) {
        console.log("📡 Real-time update detected for sales data");
        this.handleRealtimeUpdate();
      }
    });
  },

  // Remove today's listener
  removeTodayListener() {
    if (this.currentListener) {
      this.currentListener();
      this.currentListener = null;
      console.log("🔇 Removed real-time listener");
    }
  },

  // Handle real-time updates
  async handleRealtimeUpdate() {
    if (!this.currentSelectedDate) return;

    try {
      // Clear cache for current date
      cacheManager.clearCacheForDate(this.currentSelectedDate);

      // Reload data for current date
      await this.loadSalesDataByDate(this.currentSelectedDate, true);

      // Filter and render
      this.filterSalesData();

      // Show update indicator
      this.showUpdateIndicator();
    } catch (error) {
      console.error("Error handling real-time update:", error);
    }
  },

  // Load sales data by specific date
  async loadSalesDataByDate(selectedDate, forceRefresh = false) {
    try {
      const dateStr = formatDate(selectedDate).replace(/\//g, "-");
      const cacheKey = `salesData_${dateStr}`;

      this.currentSelectedDate = selectedDate;

      // Setup real-time listener
      this.setupRealtimeListener(selectedDate);

      // Check cache first (except for forced refresh)
      if (!forceRefresh) {
        const cachedData = cacheManager.get(cacheKey);
        if (cachedData) {
          console.log(`📦 Using cached data for ${dateStr}`);
          this.salesData = cachedData;
          this.showCacheIndicator(`Menggunakan data cache (${formatDate(selectedDate)})`);
          this.populateSalesPersonFilter();
          return;
        }
      }

      console.log(`🔄 Loading fresh data for ${dateStr}`);
      this.hideCacheIndicator();

      // Query for specific date
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const salesQuery = query(
        collection(firestore, "penjualanAksesoris"),
        where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
        where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
        orderBy("timestamp", "desc")
      );

      const salesSnapshot = await getDocs(salesQuery);
      const salesData = [];

      salesSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.jenisPenjualan === "gantiLock") {
          data.jenisPenjualan = "manual";
          data.isGantiLock = true;
        }
        salesData.push({ id: doc.id, ...data });
      });

      // Save to cache
      cacheManager.set(cacheKey, salesData);

      this.salesData = salesData;
      this.populateSalesPersonFilter();
      console.log(`✅ Loaded ${salesData.length} sales records for ${dateStr}`);
    } catch (error) {
      console.error("Error loading sales data by date:", error);

      // Try fallback to cache
      const dateStr = formatDate(selectedDate).replace(/\//g, "-");
      const cacheKey = `salesData_${dateStr}`;
      const cachedData = cacheManager.get(cacheKey);

      if (cachedData) {
        console.log("📦 Using cached data as fallback");
        this.showAlert(
          "Terjadi kesalahan saat mengambil data terbaru. Menggunakan data cache.",
          "Peringatan",
          "warning"
        );
        this.showCacheIndicator("Menggunakan data cache (fallback)");
        this.salesData = cachedData;
        this.populateSalesPersonFilter();
      } else {
        this.showAlert("Gagal memuat data penjualan: " + error.message, "Error", "error");
      }
    }
  },

  // Show cache indicator
  showCacheIndicator(message) {
    let cacheIndicator = document.getElementById("cacheIndicator");
    if (!cacheIndicator) {
      cacheIndicator = document.createElement("small");
      cacheIndicator.id = "cacheIndicator";
      cacheIndicator.className = "text-muted ms-2";

      const filterBtn = document.getElementById("filterSalesBtn");
      if (filterBtn && filterBtn.parentNode) {
        filterBtn.parentNode.appendChild(cacheIndicator);
      }
    }

    cacheIndicator.textContent = message;
    cacheIndicator.style.display = "inline-block";
  },

  // Hide cache indicator
  hideCacheIndicator() {
    const cacheIndicator = document.getElementById("cacheIndicator");
    if (cacheIndicator) {
      cacheIndicator.style.display = "none";
    }
  },

  // Show update indicator
  showUpdateIndicator() {
    // Remove existing indicator
    const existingIndicator = document.getElementById("updateIndicator");
    if (existingIndicator) {
      existingIndicator.remove();
    }

    // Create new indicator
    const indicator = document.createElement("div");
    indicator.id = "updateIndicator";
    indicator.className = "alert alert-success alert-dismissible fade show mb-2";
    indicator.innerHTML = `
      <i class="fas fa-sync-alt me-2"></i>
      Data telah diperbarui secara real-time
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    const tableContainer = document.querySelector("#penjualanTable").parentElement;
    tableContainer.insertBefore(indicator, tableContainer.firstChild);

    // Auto remove after 3 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.remove();
      }
    }, 3000);
  },

  // DataTable management
  destroyDataTable() {
    if (this.dataTable) {
      try {
        this.dataTable.destroy();
        this.dataTable = null;
      } catch (error) {
        console.warn("Error destroying DataTable:", error);
        this.dataTable = null;
      }
    }
  },

  initDataTable(data = []) {
    this.destroyDataTable();

    try {
      this.dataTable = $("#penjualanTable").DataTable({
        data: data,
        destroy: true,
        language: {
          url: "//cdn.datatables.net/plug-ins/1.10.25/i18n/Indonesian.json",
        },
        // PERBAIKAN: footerCallback dengan logika DP yang benar
        footerCallback: function (row, data, start, end, display) {
          let totalPcs = 0;
          let totalBerat = 0;
          let totalHarga = 0;
          let hasValidBerat = false;

          // PERBAIKAN: Akses data asli untuk perhitungan total yang akurat
          laporanPenjualanHandler.filteredSalesData.forEach((transaction) => {
            if (!transaction.items) return;

            transaction.items.forEach((item) => {
              const jumlah = parseInt(item.jumlah) || 1;
              let harga = parseInt(item.totalHarga) || 0;

              // Selalu hitung PCS dan berat
              totalPcs += jumlah;

              const berat = parseFloat(item.berat) || 0;
              if (berat > 0 && transaction.jenisPenjualan !== "kotak") {
                totalBerat += berat;
                hasValidBerat = true;
              }

              // PERBAIKAN: Logika perhitungan harga berdasarkan metode pembayaran
              if (transaction.metodeBayar === "dp") {
                const nominalDP = parseFloat(transaction.nominalDP) || 0;
                const totalHargaTransaksi = parseFloat(transaction.totalHarga) || 0;

                if (nominalDP >= totalHargaTransaksi) {
                  // Jika DP >= total harga, tidak dihitung (harga = 0)
                  harga = 0;
                } else {
                  // Jika DP < total harga, hitung proporsi sisa pembayaran
                  const sisaPembayaran = totalHargaTransaksi - nominalDP;
                  const proporsi = harga / totalHargaTransaksi;
                  harga = Math.round(proporsi * sisaPembayaran);
                }
              } else if (transaction.metodeBayar === "free") {
                harga = 0;
              }
              // Untuk metode tunai, harga tetap normal

              totalHarga += harga;
            });
          });

          const api = this.api();
          $(api.column(4).footer()).html(totalPcs);
          $(api.column(5).footer()).html(hasValidBerat ? `${totalBerat.toFixed(2)} gr` : "-");
          $(api.column(7).footer()).html(`Rp ${totalHarga.toLocaleString("id-ID")}`);
        },

        dom: "Bfrtip",
        buttons: [
          {
            extend: "excel",
            text: '<i class="fas fa-file-excel"></i> Excel',
            className: "btn btn-success btn-sm",
            title: "Laporan Penjualan Manual / Aksesoris / Kotak \n Melati Bawah",
            filename: function () {
              const selectedDate = document.getElementById("startDate").value || "semua";
              return `Laporan_Penjualan_Bawah_${selectedDate.replace(/\//g, "-")}`;
            },
            exportOptions: {
              columns: ":visible",
            },
            customize: function (xlsx) {
              const sheet = xlsx.xl.worksheets["sheet1.xml"];

              const footerPcs = $(laporanPenjualanHandler.dataTable.column(4).footer()).text() || "0";
              const footerBerat = $(laporanPenjualanHandler.dataTable.column(5).footer()).text() || "-";
              const footerHarga = $(laporanPenjualanHandler.dataTable.column(7).footer()).text() || "Rp 0";

              const footerRow = `
        <row>
          <c t="inlineStr"><is><t>TOTAL:</t></is></c>
          <c t="inlineStr"><is><t></t></is></c>
          <c t="inlineStr"><is><t></t></is></c>
          <c t="inlineStr"><is><t></t></is></c>
          <c t="inlineStr"><is><t>${footerPcs}</t></is></c>
          <c t="inlineStr"><is><t>${footerBerat}</t></is></c>
          <c t="inlineStr"><is><t></t></is></c>
          <c t="inlineStr"><is><t>${footerHarga}</t></is></c>
          <c t="inlineStr"><is><t></t></is></c>
          <c t="inlineStr"><is><t></t></is></c>
        </row>
      `;

              const sheetDataEnd = sheet.indexOf("</sheetData>");
              if (sheetDataEnd > -1) {
                const newSheet = sheet.substring(0, sheetDataEnd) + footerRow + sheet.substring(sheetDataEnd);
                xlsx.xl.worksheets["sheet1.xml"] = newSheet;
              }
            },
          },
          {
            extend: "pdf",
            text: '<i class="fas fa-file-pdf"></i> PDF',
            className: "btn btn-danger btn-sm",
            title: "Laporan Penjualan Manual / Aksesoris / Kotak \n Melati Bawah",
            filename: function () {
              const selectedDate = document.getElementById("startDate").value || "semua";
              return `Laporan_Penjualan_Bawah_${selectedDate.replace(/\//g, "-")}`;
            },
            orientation: "landscape",
            pageSize: "A4",
            exportOptions: {
              columns: ":visible",
            },
            customize: function (doc) {
              const footerPcs = $(laporanPenjualanHandler.dataTable.column(4).footer()).text() || "0";
              const footerBerat = $(laporanPenjualanHandler.dataTable.column(5).footer()).text() || "-";
              const footerHarga = $(laporanPenjualanHandler.dataTable.column(7).footer()).text() || "Rp 0";

              const footerRow = ["TOTAL:", "", "", "", footerPcs, footerBerat, "", footerHarga, "", ""];

              // PERBAIKAN: Mengatur ukuran font yang lebih kecil
              doc.defaultStyle.fontSize = 10; // Font default lebih kecil
              doc.styles.tableHeader.fontSize = 11; // Header tabel
              doc.styles.tableBodyEven.fontSize = 10; // Baris genap
              doc.styles.tableBodyOdd.fontSize = 10; // Baris ganjil
              doc.styles.title.fontSize = 13; // Judul dokumen

              // Mengatur margin untuk memberikan lebih banyak ruang
              doc.pageMargins = [20, 60, 20, 40]; // [left, top, right, bottom]

              if (doc.content[1].table && doc.content[1].table.body) {
                doc.content[1].table.body.push(footerRow);

                const footerIndex = doc.content[1].table.body.length - 1;
                doc.content[1].table.body[footerIndex].forEach((cell, index) => {
                  if (typeof cell === "object") {
                    cell.fillColor = "#e3f2fd";
                    cell.bold = true;
                    cell.fontSize = 10; // Font footer
                  } else {
                    doc.content[1].table.body[footerIndex][index] = {
                      text: cell,
                      fillColor: "#e3f2fd",
                      bold: true,
                      fontSize: 10, // Font footer
                    };
                  }
                });
              }

              // Mengatur lebar kolom agar lebih proporsional
              if (doc.content[1].table) {
                doc.content[1].table.widths = ["9%", "8%", "7%", "20%", "5%", "6%", "7%", "12%", "14%", "12%"];
              }
            },
          },
        ],
        order: [[0, "desc"]],
        autoWidth: false,
        scrollX: true,
        columnDefs: [{ targets: "_all", defaultContent: "-" }],
      });

      setTimeout(() => {
        const widths = ["1000px", "80px", "100px", "120px", "200px", "70px", "80px", "80px", "120px", "100px", "150px"];

        $("#penjualanTable thead th").each(function (index) {
          $(this).css("width", widths[index]);
        });

        $("#penjualanTable tbody td").each(function (index) {
          const colIndex = index % widths.length;
          $(this).css("width", widths[colIndex]);
        });

        this.dataTable.columns.adjust();
      }, 100);
    } catch (error) {
      console.error("Error initializing DataTable:", error);
    }
  },

  updateDataTable(data) {
    if (this.dataTable) {
      try {
        this.dataTable.clear().rows.add(data).draw();
      } catch (error) {
        console.error("Error updating DataTable:", error);
        this.initDataTable(data);
      }
    } else {
      this.initDataTable(data);
    }
  },

  // Format jenis penjualan
  formatJenisPenjualan(transaction) {
    if (transaction.isGantiLock || transaction.jenisPenjualan === "gantiLock") {
      let kodeAksesoris = "";
      if (transaction.items && transaction.items.length > 0) {
        const itemWithKode = transaction.items.find((item) => item.kodeLock);
        kodeAksesoris = itemWithKode ? itemWithKode.kodeLock : "";
      }
      return kodeAksesoris ? `Manual<br><small>(${kodeAksesoris})</small>` : "Manual";
    } else if (transaction.jenisPenjualan === "manual") {
      let kodeAksesoris = "";
      if (transaction.items && transaction.items.length > 0) {
        const itemWithKode = transaction.items.find((item) => item.kodeLock);
        if (itemWithKode && itemWithKode.kodeLock) {
          kodeAksesoris = itemWithKode.kodeLock;
          return `Manual<br><small>(${kodeAksesoris})</small>`;
        }
      }
      return "Manual";
    }

    const jenis = transaction.jenisPenjualan || "Tidak diketahui";
    return jenis.charAt(0).toUpperCase() + jenis.slice(1);
  },

  // Update table header
  updateTableHeader() {
    const salesType = document.getElementById("salesType").value;
    let configKey = salesType === "all" ? "manual" : salesType === "layanan" ? "manual" : salesType;

    const config = tableConfigs[configKey];
    if (!config) return;

    const headerRow = document.querySelector("#penjualanTable thead tr");
    if (headerRow) {
      headerRow.innerHTML = config.columns.map((col) => `<th>${col}</th>`).join("");
    }
  },

  // Prepare data for DataTable
  prepareTableData() {
    const salesType = document.getElementById("salesType").value;
    const configKey = "manual";
    const config = tableConfigs[configKey];
    if (!config) return [];

    const tableData = [];

    // PERBAIKAN: Buat summary map global untuk menggabungkan item dengan kode sama
    const globalSummaryMap = new Map();

    this.filteredSalesData.forEach((transaction) => {
      // Enhanced date formatting with better timestamp handling
      let date = "-";
      if (transaction.timestamp) {
        if (typeof transaction.timestamp.toDate === "function") {
          date = formatDate(transaction.timestamp.toDate());
        } else if (transaction.timestamp instanceof Date) {
          date = formatDate(transaction.timestamp);
        } else if (typeof transaction.timestamp === "string") {
          date = formatDate(new Date(transaction.timestamp));
        } else if (typeof transaction.timestamp === "object" && transaction.timestamp.seconds) {
          date = formatDate(new Date(transaction.timestamp.seconds * 1000));
        }
      } else if (transaction.tanggal) {
        date = transaction.tanggal;
      }

      const jenisPenjualan = this.formatJenisPenjualan(transaction);
      const status = this.getStatusBadge(transaction);
      const keterangan = transaction.keterangan || "-";

      if (!transaction.items) return;

      // PERBAIKAN: Cek apakah ini penjualan manual atau bukan
      const isManualSale =
        transaction.jenisPenjualan === "manual" ||
        transaction.isGantiLock ||
        transaction.jenisPenjualan === "gantiLock";

      if (isManualSale) {
        // Untuk penjualan manual: tampilkan detail setiap item dalam setiap transaksi
        transaction.items.forEach((item) => {
          const key = item.kodeText || item.barcode || "-";
          const name = item.nama || "-";
          const kadar = item.kadar || "-";
          const berat = parseFloat(item.berat) || 0;
          const jumlah = parseInt(item.jumlah) || 1;

          let harga = parseInt(item.totalHarga) || 0;
          if (transaction.metodeBayar === "free") {
            harga = 0;
          }

          const beratDisplay = berat > 0 ? `${berat.toFixed(2)} gr` : "-";

          // Tambahkan setiap item sebagai baris terpisah
          tableData.push([
            date,
            jenisPenjualan,
            key,
            name,
            jumlah,
            beratDisplay,
            kadar,
            `Rp ${harga.toLocaleString("id-ID")}`,
            status,
            item.keterangan || keterangan,
          ]);
        });
      } else {
        // PERBAIKAN: Untuk penjualan aksesoris/kotak: gunakan global summary untuk menggabungkan semua item dengan kode sama
        transaction.items.forEach((item) => {
          const key = item.kodeText || item.barcode || "-";
          const name = item.nama || "-";
          const kadar = item.kadar || "-";
          const berat = parseFloat(item.berat) || 0;
          const jumlah = parseInt(item.jumlah) || 1;

          let harga = parseInt(item.totalHarga) || 0;
          if (transaction.metodeBayar === "free") {
            harga = 0;
          }

          // Gunakan kode sebagai key untuk menggabungkan item yang sama
          if (globalSummaryMap.has(key)) {
            const existing = globalSummaryMap.get(key);
            existing.jumlah += jumlah;
            existing.berat += berat;
            existing.harga += harga;
            // Update tanggal ke yang terbaru jika ada
            if (date !== "-") {
              existing.tanggal = date;
            }
          } else {
            globalSummaryMap.set(key, {
              tanggal: date,
              jenis: jenisPenjualan,
              kode: key,
              nama: name,
              jumlah,
              berat,
              kadar,
              harga,
              status,
              keterangan: item.keterangan || keterangan,
              jenisPenjualan: transaction.jenisPenjualan,
            });
          }
        });
      }
    });

    // PERBAIKAN: Tambahkan summary data dari global map ke tableData
    Array.from(globalSummaryMap.values()).forEach((item) => {
      const beratDisplay = item.jenisPenjualan === "kotak" ? "-" : `${item.berat.toFixed(2)} gr`;
      tableData.push([
        item.tanggal,
        item.jenis,
        item.kode,
        item.nama,
        item.jumlah,
        beratDisplay,
        item.kadar,
        `Rp ${item.harga.toLocaleString("id-ID")}`,
        item.status,
        item.keterangan,
      ]);
    });

    return tableData;
  },

  getStatusBadge(transaction) {
    const status = transaction.statusPembayaran || "Lunas";

    if (status === "DP") {
      return `<span class="badge bg-warning">DP: Rp ${formatRupiah(transaction.nominalDP)}</span>
              <br><small>Sisa: Rp ${formatRupiah(transaction.sisaPembayaran)}</small>`;
    } else if (status === "Lunas") {
      return `<span class="badge bg-success">Lunas</span>`;
    } else if (transaction.metodeBayar === "free") {
      return `<span class="badge bg-info">Gratis</span>`;
    }

    return `<span class="badge bg-secondary">${status}</span>`;
  },

  // Render table
  renderSalesTable() {
    try {
      this.updateTableHeader();
      const tableData = this.prepareTableData();
      this.updateDataTable(tableData);
    } catch (error) {
      console.error("Error rendering sales table:", error);
      this.showAlert("Terjadi kesalahan saat menampilkan data", "Error", "error");
    }
  },

  // Filter data for selected date and other criteria
  filterSalesData() {
    if (!this.salesData || !this.salesData.length) return;

    this.showLoading(true);

    try {
      const salesType = document.getElementById("salesType").value;
      const salesPerson = document.getElementById("salesPerson").value;

      this.filteredSalesData = this.salesData.filter((item) => {
        if (!item) return false;

        // Type filter
        let typeMatches = true;
        if (salesType !== "all") {
          if (salesType === "layanan") {
            typeMatches = item.jenisPenjualan === "manual";
          } else {
            typeMatches = item.jenisPenjualan === salesType;
          }
        }

        // Sales person filter
        let salesMatches = true;
        if (salesPerson !== "all") {
          salesMatches = item.sales === salesPerson;
        }

        return typeMatches && salesMatches;
      });

      // Sort by timestamp (newest first)
      this.filteredSalesData.sort((a, b) => {
        const getDate = (item) => {
          if (item.timestamp) {
            if (typeof item.timestamp.toDate === "function") {
              return item.timestamp.toDate();
            } else if (item.timestamp instanceof Date) {
              return item.timestamp;
            } else if (typeof item.timestamp === "string") {
              return new Date(item.timestamp);
            } else if (typeof item.timestamp === "object" && item.timestamp.seconds) {
              return new Date(item.timestamp.seconds * 1000);
            }
          }
          return parseDate(item.tanggal) || new Date(0);
        };

        const dateA = getDate(a);
        const dateB = getDate(b);
        return dateB - dateA;
      });

      this.renderSalesTable();
    } catch (error) {
      console.error("Error filtering sales data:", error);
      this.showAlert("Terjadi kesalahan saat memfilter data", "Error", "error");
    } finally {
      this.showLoading(false);
    }
  },

  // Populate sales person filter
  populateSalesPersonFilter() {
    const salesPersons = [...new Set(this.salesData.map((item) => item.sales).filter(Boolean))];
    const dropdown = document.getElementById("salesPerson");

    if (!dropdown) return;

    while (dropdown.options.length > 1) {
      dropdown.remove(1);
    }

    salesPersons.forEach((person) => {
      const option = document.createElement("option");
      option.value = person;
      option.textContent = person;
      dropdown.appendChild(option);
    });
  },

  // Initialize date pickers
  initDatePickers() {
    $(".datepicker").datepicker({
      format: "dd/mm/yyyy",
      autoclose: true,
      language: "id",
      todayHighlight: true,
    });
  },

  // Set default dates
  setDefaultDates() {
    const today = new Date();
    const formattedToday = formatDate(today);
    document.getElementById("startDate").value = formattedToday;
  },

  // Attach event listeners
  attachEventListeners() {
    // Main filter button
    document.getElementById("filterSalesBtn")?.addEventListener("click", () => {
      const startDateStr = document.getElementById("startDate").value;
      if (!startDateStr) {
        this.showAlert("Silakan pilih tanggal terlebih dahulu", "Peringatan", "warning");
        return;
      }

      const selectedDate = parseDate(startDateStr);
      if (!selectedDate) {
        this.showAlert("Format tanggal tidak valid", "Error", "error");
        return;
      }

      this.showLoading(true);
      this.loadSalesDataByDate(selectedDate)
        .then(() => {
          this.filterSalesData();
          this.isDataLoaded = true;
        })
        .finally(() => {
          this.showLoading(false);
        });
    });

    // Sales type filter change
    document.getElementById("salesType")?.addEventListener("change", () => {
      if (this.filteredSalesData && this.filteredSalesData.length > 0) {
        this.filterSalesData();
      }
    });

    // Sales person filter change
    document.getElementById("salesPerson")?.addEventListener("change", () => {
      if (this.filteredSalesData && this.filteredSalesData.length > 0) {
        this.filterSalesData();
      }
    });

    // Date change handler
    document.getElementById("startDate")?.addEventListener("change", () => {
      // Reset data when date changes
      this.isDataLoaded = false;
      this.salesData = [];
      this.filteredSalesData = [];

      // Clear table
      const tableBody = document.querySelector("#penjualanTable tbody");
      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="10" class="text-center">Klik tombol "Tampilkan" untuk melihat data tanggal yang dipilih</td>
          </tr>
        `;
      }
    });
  },

  // Utility function to check if two dates are the same
  isSameDate(date1, date2) {
    if (!date1 || !date2) return false;
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  },

  // Cleanup method
  destroy() {
    console.log("🧹 Destroying Sales Report Handler");

    // Remove real-time listener
    this.removeTodayListener();

    // Destroy DataTable
    this.destroyDataTable();

    // Clear data
    this.salesData = [];
    this.filteredSalesData = [];
    this.isDataLoaded = false;
    this.currentSelectedDate = null;
    this.isListeningToday = false;

    console.log("✅ Sales Report Handler destroyed");
  },

  // Initialize
  init() {
    this.initDatePickers();
    this.attachEventListeners();
    this.setDefaultDates();

    this.initDataTable([]);

    const tableBody = document.querySelector("#penjualanTable tbody");
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center">Silakan pilih tanggal dan klik tombol "Tampilkan" untuk melihat data</td>
        </tr>
      `;
    }

    // Clear old cache periodically (every 30 minutes)
    setInterval(() => {
      cacheManager.clearOldCache();
    }, 30 * 60 * 1000);

    // Clear today's cache when page is about to unload (to ensure fresh data on next visit)
    window.addEventListener("beforeunload", () => {
      const today = new Date();
      cacheManager.clearCacheForDate(today);
      this.destroy();
    });

    console.log("✅ Sales Report Handler initialized successfully");
  },
};

// Utility functions
const formatRupiah = (angka) => {
  if (!angka && angka !== 0) return "0";
  const number = typeof angka === "string" ? parseInt(angka) : angka;
  return new Intl.NumberFormat("id-ID").format(number);
};

const parseDate = (dateString) => {
  if (!dateString) return null;
  const parts = dateString.split("/");
  return new Date(parts[2], parts[1] - 1, parts[0]);
};

const formatDate = (date) => {
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

// Initialize when document is ready
document.addEventListener("DOMContentLoaded", function () {
  if (typeof XLSX === "undefined") {
    console.warn("SheetJS (XLSX) library is not loaded. Excel export will not work.");
  }

  try {
    // Check dependencies
    if (typeof firestore === "undefined") {
      throw new Error("Firebase Firestore not initialized");
    }

    if (typeof $ === "undefined") {
      throw new Error("jQuery not loaded");
    }

    // Initialize the handler
    laporanPenjualanHandler.init();

    console.log("✅ Sales Report System initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Sales Report System:", error);
    alert("Gagal menginisialisasi sistem laporan penjualan: " + error.message);
  }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (typeof laporanPenjualanHandler !== "undefined") {
    laporanPenjualanHandler.destroy();
  }
});

export default laporanPenjualanHandler;
