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
  serverTimestamp,
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

// Enhanced cache management with localStorage persistence
const cacheManager = {
  // Cache TTL constants
  CACHE_TTL_TODAY: 5 * 60 * 1000,     // 5 menit untuk data hari ini
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
      return (now - lastUpdate) < this.CACHE_TTL_TODAY;
    }
    
    // Untuk data historis, gunakan TTL standar
    return (now - lastUpdate) < this.CACHE_TTL_STANDARD;
  },

  // Set cache data with localStorage persistence
  set(cacheKey, data) {
    try {
      // Simpan data ke localStorage dengan kompresi
      const compressedData = this.compressData(data);
      localStorage.setItem(cacheKey, compressedData);
      
      // Simpan timestamp
      const metaKey = `${cacheKey}_timestamp`;
      localStorage.setItem(metaKey, Date.now().toString());
      
      console.log(`Cache saved for key: ${cacheKey}`);
    } catch (error) {
      console.error("Error saving cache:", error);
      // Jika localStorage penuh, hapus cache lama
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

  // Clear specific cache or all cache
  clear(cacheKey = null) {
    if (cacheKey) {
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(`${cacheKey}_timestamp`);
    } else {
      // Clear all sales cache
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('salesData_') || key.includes('_timestamp')) {
          localStorage.removeItem(key);
        }
      });
    }
  },

  // Clear old cache entries (older than 24 hours)
  clearOldCache() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.endsWith('_timestamp')) {
        const timestamp = parseInt(localStorage.getItem(key));
        if (now - timestamp > maxAge) {
          const dataKey = key.replace('_timestamp', '');
          localStorage.removeItem(key);
          localStorage.removeItem(dataKey);
        }
      }
    });
  },

  // Compress data before storing
  compressData(data) {
  try {
    // Convert Firestore Timestamps to ISO strings before caching
    const processedData = JSON.parse(JSON.stringify(data, (key, value) => {
      // Handle Firestore Timestamp objects
      if (value && typeof value === 'object' && value.seconds && value.nanoseconds) {
        // Convert Firestore Timestamp to ISO string
        return new Date(value.seconds * 1000 + value.nanoseconds / 1000000).toISOString();
      }
      return value;
    }));
    
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
    
    // Restore timestamp fields to Date objects
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (item.timestamp && typeof item.timestamp === 'string') {
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
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // Check if date range includes today
  includesCurrentDay(startDate, endDate) {
    const today = this.getLocalDateString();
    return (startDate <= today && today <= endDate);
  }
};

// Main handler object
const laporanPenjualanHandler = {
  salesData: [],
  filteredSalesData: [],
  dataTable: null,

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

  // ✅ BARU: Refresh hanya data tanggal spesifik
  async refreshSpecificDateData() {
    const startDateStr = document.getElementById("startDate").value;
    const endDateStr = document.getElementById("endDate").value;
    
    if (!startDateStr || !endDateStr) {
      this.showAlert("Pilih rentang tanggal terlebih dahulu", "Peringatan", "warning");
      return;
    }
    
    const startDate = parseDate(startDateStr);
    const endDate = parseDate(endDateStr);
    
    if (!startDate || !endDate) {
      this.showAlert("Format tanggal tidak valid", "Error", "error");
      return;
    }
    
    // Cek apakah rentang tanggal mencakup hari ini
    const today = new Date();
    const todayStr = formatDate(today);
    const isIncludingToday = startDateStr <= todayStr && endDateStr >= todayStr;
    
    if (!isIncludingToday) {
      this.showAlert("Refresh data hanya untuk rentang tanggal yang mencakup hari ini", "Info", "info");
      return;
    }
    
    try {
      this.showLoading(true);
      
      // Clear cache hanya untuk rentang tanggal spesifik
      const cacheKey = `salesData_${startDateStr}_${endDateStr}`;
      cacheManager.clear(cacheKey);
      
      // Load data hanya untuk rentang tanggal
      await this.loadSalesDataByDateRange(startDate, endDate, true);
      
      // Filter dan render ulang
      this.filterSalesData();
      
      this.showAlert(`Data untuk periode ${startDateStr} - ${endDateStr} berhasil diperbarui`, "Berhasil", "success");
      
    } catch (error) {
      console.error("Error refreshing specific date data:", error);
      this.showAlert("Gagal memperbarui data: " + error.message, "Error", "error");
    } finally {
      this.showLoading(false);
    }
  },

  // ✅ BARU: Load data berdasarkan rentang tanggal
  async loadSalesDataByDateRange(startDate, endDate, forceRefresh = false) {
    try {
      const startDateStr = formatDate(startDate);
      const endDateStr = formatDate(endDate);
      const cacheKey = `salesData_${startDateStr}_${endDateStr}`;
      
      // Cek cache dulu
      if (!forceRefresh) {
        const cachedData = cacheManager.get(cacheKey);
        if (cachedData) {
          console.log(`📦 Using cached data for ${startDateStr} - ${endDateStr}`);
          this.salesData = cachedData;
          this.showCacheIndicator(`Menggunakan data cache (${startDateStr} - ${endDateStr})`);
          return;
        }
      }
      
      console.log(`🔄 Loading fresh data for ${startDateStr} - ${endDateStr}`);
      this.hideCacheIndicator();
      
      // Query dengan filter tanggal
      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = Timestamp.fromDate(new Date(endDate.getTime() + 24 * 60 * 60 * 1000)); // +1 hari
      
      const salesQuery = query(
        collection(firestore, "penjualanAksesoris"),
        where("timestamp", ">=", startTimestamp),
        where("timestamp", "<", endTimestamp),
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
      console.log(`✅ Loaded ${salesData.length} sales records for date range`);
      
    } catch (error) {
      console.error("Error loading sales data by date range:", error);
      throw error;
    }
  },

  // Enhanced load data with improved cache management
  async loadSalesData(forceRefresh = false) {
    try {
      // Cek apakah ada filter tanggal aktif
      const startDateStr = document.getElementById("startDate").value;
      const endDateStr = document.getElementById("endDate").value;
      
      if (startDateStr && endDateStr) {
        // Jika ada filter tanggal, gunakan query spesifik
        const startDate = parseDate(startDateStr);
        const endDate = parseDate(endDateStr);
        
        if (startDate && endDate) {
          await this.loadSalesDataByDateRange(startDate, endDate, forceRefresh);
          this.populateSalesPersonFilter();
          return;
        }
      }
      
      // Fallback ke load semua data (hanya jika tidak ada filter)
      const cacheKey = 'salesData_all';
      
      if (!forceRefresh) {
        const cachedData = cacheManager.get(cacheKey);
        if (cachedData) {
          console.log("📦 Using cached all sales data");
          this.showCacheIndicator('Menggunakan data cache (semua data)');
          this.salesData = cachedData;
          this.populateSalesPersonFilter();
          return;
        }
      }

      this.hideCacheIndicator();
      this.showLoading(true);
      console.log("🔄 Loading all sales data from Firestore");

      const salesSnapshot = await getDocs(collection(firestore, "penjualanAksesoris"));
      const salesData = [];

      salesSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.jenisPenjualan === "gantiLock") {
          data.jenisPenjualan = "manual";
          data.isGantiLock = true;
        }
        salesData.push({ id: doc.id, ...data });
      });

      cacheManager.set(cacheKey, salesData);
      this.salesData = salesData;
      this.populateSalesPersonFilter();
      
    } catch (error) {
      console.error("Error loading sales data:", error);
      
      // Try fallback
      const cacheKey = 'salesData_all';
      const cachedData = cacheManager.get(cacheKey);
      
      if (cachedData) {
        console.log("📦 Using cached data as fallback");
        this.showAlert("Terjadi kesalahan saat mengambil data terbaru. Menggunakan data cache.", "Peringatan", "warning");
        this.showCacheIndicator('Menggunakan data cache (fallback)');
        this.salesData = cachedData;
        this.populateSalesPersonFilter();
      } else {
        this.showAlert("Gagal memuat data penjualan: " + error.message, "Error", "error");
      }
    } finally {
      this.showLoading(false);
    }
  },

  // Show cache indicator
  showCacheIndicator(message) {
    let cacheIndicator = document.getElementById('cacheIndicator');
    if (!cacheIndicator) {
      cacheIndicator = document.createElement('small');
      cacheIndicator.id = 'cacheIndicator';
      cacheIndicator.className = 'text-muted ms-2';
      
      // Add to appropriate location (near filter button or table header)
      const filterBtn = document.getElementById('filterSalesBtn');
      if (filterBtn && filterBtn.parentNode) {
        filterBtn.parentNode.appendChild(cacheIndicator);
      }
    }
    
    cacheIndicator.textContent = message;
    cacheIndicator.style.display = 'inline-block';
  },

  // Hide cache indicator
  hideCacheIndicator() {
    const cacheIndicator = document.getElementById('cacheIndicator');
    if (cacheIndicator) {
      cacheIndicator.style.display = 'none';
    }
  },

  // Force refresh data function
  forceRefreshData() {
    const startDateStr = document.getElementById("startDate").value;
    const endDateStr = document.getElementById("endDate").value;
    
    if (!startDateStr || !endDateStr) {
      this.showAlert("Pilih rentang tanggal terlebih dahulu sebelum refresh", "Peringatan", "warning");
      return;
    }
    
    if (confirm("Apakah Anda yakin ingin menyegarkan data untuk periode yang dipilih?")) {
      this.refreshSpecificDateData();
    }
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
        footerCallback: function (row, data, start, end, display) {
          let totalPcs = 0;
          let totalBerat = 0;
          let totalHarga = 0;
          let hasValidBerat = false; // Flag untuk cek apakah ada berat valid

          data.forEach((row) => {
            const jumlah = parseInt(row[4]) || 0;
            const hargaStr = row[7].replace(/[^\d]/g, "") || "0";
            const harga = parseInt(hargaStr) || 0;

            totalPcs += jumlah;
            totalHarga += harga;

            // Cek jika kolom berat bukan "-" dan memiliki nilai
            if (row[5] !== "-") {
              const beratStr = row[5].replace(" gr", "").replace(",", ".") || "0";
              const berat = parseFloat(beratStr) || 0;
              if (berat > 0) {
                totalBerat += berat;
                hasValidBerat = true;
              }
            }
          });

          const api = this.api();
          $(api.column(4).footer()).html(totalPcs);
          // Tampilkan total berat jika ada data dengan berat valid, jika tidak tampilkan "-"
          $(api.column(5).footer()).html(hasValidBerat ? `${totalBerat.toFixed(2)} gr` : "-");
          $(api.column(7).footer()).html(`Rp ${totalHarga.toLocaleString("id-ID")}`);
        },
        dom: "Bfrtip", // Tetap gunakan "B" untuk buttons
        buttons: [
          {
            extend: "excel",
            text: '<i class="fas fa-file-excel"></i> Excel',
            className: "btn btn-success btn-sm",
            title: "Laporan Penjualan Manual / Aksesoris / Kotak \n Melati Atas",
            filename: function () {
              const startDate = document.getElementById("startDate").value || "semua";
              const endDate = document.getElementById("endDate").value || "semua";
              return `Laporan_Penjualan_Atas_${startDate}_${endDate}`;
            },
            exportOptions: {
              columns: ":visible",
            },
            customize: function (xlsx) {
              const sheet = xlsx.xl.worksheets["sheet1.xml"];

              // Ambil nilai footer yang sudah dihitung dari DataTable
              const footerPcs = $(laporanPenjualanHandler.dataTable.column(4).footer()).text() || "0";
              const footerBerat = $(laporanPenjualanHandler.dataTable.column(5).footer()).text() || "-";
                            const footerHarga = $(laporanPenjualanHandler.dataTable.column(7).footer()).text() || "Rp 0";

              // Tambahkan baris footer
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

              // Insert footer sebelum closing sheetData tag
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
            title: "Laporan Penjualan Manual / Aksesoris / Kotak \n Melati Atas",
            filename: function () {
              const startDate = document.getElementById("startDate").value || "semua";
              const endDate = document.getElementById("endDate").value || "semua";
              return `Laporan_Penjualan_Atas_${startDate}_${endDate}`;
            },
            orientation: "potrait",
            pageSize: "A4",
            exportOptions: {
              columns: ":visible",
            },
            customize: function (doc) {
              // Ambil nilai footer yang sudah dihitung dari DataTable
              const footerPcs = $(laporanPenjualanHandler.dataTable.column(4).footer()).text() || "0";
              const footerBerat = $(laporanPenjualanHandler.dataTable.column(5).footer()).text() || "-";
              const footerHarga = $(laporanPenjualanHandler.dataTable.column(7).footer()).text() || "Rp 0";

              // Tambahkan baris footer
              const footerRow = ["TOTAL:", "", "", "", footerPcs, footerBerat, "", footerHarga, "", ""];

              // Tambahkan footer ke table
              if (doc.content[1].table && doc.content[1].table.body) {
                doc.content[1].table.body.push(footerRow);

                // Style untuk footer row
                const footerIndex = doc.content[1].table.body.length - 1;
                doc.content[1].table.body[footerIndex].forEach((cell, index) => {
                  if (typeof cell === "object") {
                    cell.fillColor = "#e3f2fd";
                    cell.bold = true;
                  } else {
                    doc.content[1].table.body[footerIndex][index] = {
                      text: cell,
                      fillColor: "#e3f2fd",
                      bold: true,
                    };
                  }
                });
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

  const summaryMap = new Map();

  this.filteredSalesData.forEach((transaction) => {
    // Enhanced date formatting with better timestamp handling
    let date = "-";
    if (transaction.timestamp) {
      if (typeof transaction.timestamp.toDate === 'function') {
        date = formatDate(transaction.timestamp.toDate());
      } else if (transaction.timestamp instanceof Date) {
        date = formatDate(transaction.timestamp);
      } else if (typeof transaction.timestamp === 'string') {
        date = formatDate(new Date(transaction.timestamp));
      } else if (typeof transaction.timestamp === 'object' && transaction.timestamp.seconds) {
        date = formatDate(new Date(transaction.timestamp.seconds * 1000));
      }
    } else if (transaction.tanggal) {
      date = transaction.tanggal;
    }

    const jenisPenjualan = this.formatJenisPenjualan(transaction);
    const status = this.getStatusBadge(transaction);
    const keterangan = transaction.keterangan || "-";

    if (!transaction.items) return;

    transaction.items.forEach((item) => {
      const key = item.kodeText || item.barcode || "-";
      const name = item.nama || "-";
      const kadar = item.kadar || "-";
      const berat = parseFloat(item.berat) || 0;
      const jumlah = parseInt(item.jumlah) || 1;
      let harga = parseInt(item.totalHarga) || 0;

      if (transaction.metodeBayar === "dp" && transaction.statusPembayaran === "DP") {
        const prop = harga / transaction.totalHarga;
        harga = Math.round(prop * transaction.sisaPembayaran);
      } else if (transaction.metodeBayar === "free") {
        harga = 0;
      }

      if (summaryMap.has(key)) {
        const existing = summaryMap.get(key);
        existing.jumlah += jumlah;
        existing.berat += berat;
        existing.harga += harga;
      } else {
        summaryMap.set(key, {
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
  });

  return Array.from(summaryMap.values()).map((item) => {
    const beratDisplay = item.jenisPenjualan === "kotak" ? "-" : `${item.berat.toFixed(2)} gr`;
    return [
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
    ];
  });
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

  // Enhanced filter data with cache consideration
  filterSalesData() {
  if (!this.salesData || !this.salesData.length) return;

  this.showLoading(true);

  try {
    const startDateStr = document.getElementById("startDate").value;
    const endDateStr = document.getElementById("endDate").value;
    const salesType = document.getElementById("salesType").value;
    const salesPerson = document.getElementById("salesPerson").value;

    const startDate = parseDate(startDateStr);
    const endDate = parseDate(endDateStr);
    if (endDate) endDate.setDate(endDate.getDate() + 1);

    this.filteredSalesData = this.salesData.filter((item) => {
      if (!item) return false;

      // Enhanced timestamp handling
      let transactionDate = null;
      
      if (item.timestamp) {
        // Handle different timestamp formats
        if (typeof item.timestamp.toDate === 'function') {
          // Firestore Timestamp object
          transactionDate = item.timestamp.toDate();
        } else if (item.timestamp instanceof Date) {
          // Already a Date object
          transactionDate = item.timestamp;
        } else if (typeof item.timestamp === 'string') {
          // ISO string from cache
          transactionDate = new Date(item.timestamp);
        } else if (typeof item.timestamp === 'object' && item.timestamp.seconds) {
          // Firestore Timestamp-like object
          transactionDate = new Date(item.timestamp.seconds * 1000);
        }
      } else if (item.tanggal) {
        // Fallback to tanggal field
        transactionDate = parseDate(item.tanggal);
      }

      if (!transactionDate || isNaN(transactionDate.getTime())) {
        console.warn("Invalid transaction date for item:", item);
        return false;
      }

      const dateInRange = (!startDate || transactionDate >= startDate) && (!endDate || transactionDate < endDate);

      let typeMatches = true;
      if (salesType !== "all") {
        if (salesType === "layanan") {
          typeMatches = item.jenisPenjualan === "manual";
        } else {
          typeMatches = item.jenisPenjualan === salesType;
        }
      }

      let salesMatches = true;
      if (salesPerson !== "all") {
        salesMatches = item.sales === salesPerson;
      }

      return dateInRange && typeMatches && salesMatches;
    });

    this.filteredSalesData.sort((a, b) => {
      // Enhanced sorting with better timestamp handling
      const getDate = (item) => {
        if (item.timestamp) {
          if (typeof item.timestamp.toDate === 'function') {
            return item.timestamp.toDate();
          } else if (item.timestamp instanceof Date) {
            return item.timestamp;
          } else if (typeof item.timestamp === 'string') {
            return new Date(item.timestamp);
          } else if (typeof item.timestamp === 'object' && item.timestamp.seconds) {
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

  updateFooterSummary() {
    const totalPcsEl = document.getElementById("totalPcs");
    const totalBeratEl = document.getElementById("totalBerat");
    const totalHargaEl = document.getElementById("totalHarga");

    if (this.isSummaryMode) {
      totalPcsEl.textContent = "-";
      totalBeratEl.textContent = "-";
      totalHargaEl.textContent = "-";
      return;
    }

    let totalPcs = 0;
    let totalBerat = 0;
    let totalHarga = 0;

    this.filteredSalesData.forEach((transaction) => {
      if (transaction.items && transaction.items.length > 0) {
        transaction.items.forEach((item) => {
          const jumlah = parseInt(item.jumlah) || 0;
          const berat = parseFloat(item.berat) || 0;
          let harga = parseInt(item.totalHarga) || 0;

          if (transaction.metodeBayar === "dp" && transaction.statusPembayaran === "DP") {
            const prop = harga / transaction.totalHarga;
            harga = Math.round(prop * transaction.sisaPembayaran);
          } else if (transaction.metodeBayar === "free") {
            harga = 0;
          }

          totalPcs += jumlah;
          totalBerat += berat;
          totalHarga += harga;
        });
      } else {
        const harga = parseInt(transaction.totalHarga) || 0;
        totalHarga += harga;
      }
    });

    totalPcsEl.textContent = totalPcs;
    totalBeratEl.textContent = `${totalBerat.toFixed(2)} gr`;
    totalHargaEl.textContent = `Rp ${totalHarga.toLocaleString("id-ID")}`;
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
    document.querySelectorAll(".datepicker").forEach((input) => {
      input.value = formattedToday;
    });
  },

  // Enhanced attach event listeners with refresh button
 attachEventListeners() {
    document.getElementById("filterSalesBtn")?.addEventListener("click", () => {
      this.loadSalesData().then(() => {
        this.filterSalesData();
      });
    });

    document.getElementById("salesType")?.addEventListener("change", () => {
      if (this.filteredSalesData && this.filteredSalesData.length > 0) {
        this.renderSalesTable();
      }
    });

    // ✅ Update refresh button functionality
    this.addRefreshButton();
  },

  // Add refresh button to UI
   addRefreshButton() {
    if (document.getElementById('refreshSalesData')) return;

    const filterBtn = document.getElementById('filterSalesBtn');
    if (filterBtn && filterBtn.parentNode) {
      const refreshButton = document.createElement('button');
      refreshButton.id = 'refreshSalesData';
      refreshButton.className = 'btn btn-outline-secondary ms-2';
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Data Periode';
      refreshButton.title = 'Refresh data untuk periode yang dipilih';
      refreshButton.addEventListener('click', () => this.forceRefreshData());
      
      filterBtn.parentNode.insertBefore(refreshButton, filterBtn.nextSibling);
    }
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
          <td colspan="12" class="text-center">Silakan pilih filter dan klik tombol "Tampilkan" untuk melihat data</td>
        </tr>
      `;
    }

    // Clear old cache periodically (every 10 minutes)
    setInterval(() => {
      cacheManager.clearOldCache();
    }, 10 * 60 * 1000);

    // Clear cache when page is about to unload (optional)
    window.addEventListener('beforeunload', () => {
      // Only clear today's cache to ensure fresh data on next visit
      const today = cacheManager.getLocalDateString();
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.includes(today) && key.startsWith('salesData_')) {
          localStorage.removeItem(key);
          localStorage.removeItem(`${key}_timestamp`);
        }
      });
    });
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

  laporanPenjualanHandler.init();
});

export default laporanPenjualanHandler;


