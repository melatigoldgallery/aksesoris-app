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

const VERIFICATION_PASSWORD = "smlt116";

// Improved cache management dengan TTL yang lebih efisien
const cacheManager = {
  prefix: "melati_sales_",
  defaultTTL: 60 * 60 * 1000, // 1 jam untuk data historis
  todayTTL: 5 * 60 * 1000,    // 5 menit untuk data hari ini

  set(key, data, ttl = null) {
    // Tentukan TTL berdasarkan apakah data mencakup hari ini
    const actualTTL = ttl || (this.isToday(key) ? this.todayTTL : this.defaultTTL);
    
    const item = {
      data,
      timestamp: Date.now(),
      ttl: actualTTL,
      version: Date.now() // Untuk versioning
    };
    
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(item));
      // Simpan metadata terpisah untuk tracking
      localStorage.setItem(this.prefix + key + "_meta", Date.now().toString());
    } catch (error) {
      console.warn("Cache storage failed, clearing old cache:", error);
      this.clearOldCache();
      try {
        localStorage.setItem(this.prefix + key, JSON.stringify(item));
        localStorage.setItem(this.prefix + key + "_meta", Date.now().toString());
      } catch (retryError) {
        console.error("Cache storage failed after cleanup:", retryError);
      }
    }
  },

  get(key) {
    try {
      const item = JSON.parse(localStorage.getItem(this.prefix + key));
      if (!item) return null;

      const now = Date.now();
      const age = now - item.timestamp;
      
      // Cek apakah cache masih valid
      if (age > item.ttl) {
        this.remove(key);
        return null;
      }

      // Untuk data hari ini, cek juga apakah ada update terbaru
      if (this.isToday(key)) {
        const lastUpdate = localStorage.getItem("lastSalesUpdate");
        if (lastUpdate && parseInt(lastUpdate) > item.timestamp) {
          this.remove(key);
          return null;
        }
      }

      return item.data;
    } catch (error) {
      console.error("Cache get error:", error);
      this.remove(key);
      return null;
    }
  },

  remove(key) {
    localStorage.removeItem(this.prefix + key);
    localStorage.removeItem(this.prefix + key + "_meta");
  },

  clear() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(this.prefix))
      .forEach((key) => localStorage.removeItem(key));
  },

  // Cek apakah key mencakup data hari ini
  isToday(key) {
    const today = new Date().toISOString().split('T')[0];
    return key.includes(today) || key === "salesData";
  },

  // Bersihkan cache lama untuk menghemat storage
  clearOldCache() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 jam
    
    Object.keys(localStorage)
      .filter(key => key.startsWith(this.prefix) && key.endsWith("_meta"))
      .forEach(metaKey => {
        try {
          const timestamp = parseInt(localStorage.getItem(metaKey));
          if (now - timestamp > maxAge) {
            const dataKey = metaKey.replace("_meta", "");
            localStorage.removeItem(dataKey);
            localStorage.removeItem(metaKey);
          }
        } catch (error) {
          localStorage.removeItem(metaKey);
        }
      });
  },

  // Cek apakah cache perlu diupdate
  shouldUpdate(key) {
    const metaKey = this.prefix + key + "_meta";
    const timestamp = localStorage.getItem(metaKey);
    
    if (!timestamp) return true;
    
    const now = Date.now();
    const lastUpdate = parseInt(timestamp);
    const ttl = this.isToday(key) ? this.todayTTL : this.defaultTTL;
    
    return (now - lastUpdate) > ttl;
  },

  // Update timestamp untuk cache invalidation
  updateTimestamp(key) {
    localStorage.setItem(this.prefix + key + "_meta", Date.now().toString());
  }
};

// Utility functions (tetap sama)
const utils = {
  showAlert: (message, title = "Informasi", type = "info") =>
    Swal.fire({ title, text: message, icon: type, confirmButtonText: "OK", confirmButtonColor: "#0d6efd" }),

  showLoading: (show) => {
    const loader = document.getElementById("loadingIndicator");
    if (loader) loader.style.display = show ? "flex" : "none";
  },

  formatDate: (date) => {
    if (!date) return "-";
    try {
      const d = date.toDate ? date.toDate() : date instanceof Date ? date : new Date(date);
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    } catch {
      return "-";
    }
  },

parseDate: (dateString) => {
    if (!dateString) return null;
    
    try {
      // Jika sudah berupa Date object
      if (dateString instanceof Date) {
        return dateString;
      }
      
      // Jika berupa string dengan format dd/mm/yyyy
      if (typeof dateString === 'string') {
        const parts = dateString.split("/");
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
          const year = parseInt(parts[2], 10);
          
          // Validasi komponen tanggal
          if (day >= 1 && day <= 31 && month >= 0 && month <= 11 && year >= 1900) {
            const date = new Date(year, month, day);
            // Pastikan tanggal yang dibuat valid
            if (date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
              return date;
            }
          }
        }
      }
      
      // Jika berupa number (timestamp)
      if (typeof dateString === 'number') {
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
      
      // Fallback: coba parse langsung
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        return date;
      }
      
      return null;
    } catch (error) {
      console.warn('Error parsing date:', dateString, error);
      return null;
    }
  },

  formatRupiah: (angka) => {
    const number = typeof angka === "string" ? parseInt(angka.replace(/\./g, "")) : angka || 0;
    return new Intl.NumberFormat("id-ID").format(number);
  },

  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  throttle: (func, limit) => {
    let inThrottle;
    return function () {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },
};

// Main application class
class DataPenjualanApp {
  constructor() {
    this.salesData = [];
    this.filteredData = [];
    this.dataTable = null;
    this.currentTransaction = null;
    this.isLoading = false;

    // Bind methods
    this.refreshData = utils.debounce(this.refreshData.bind(this), 1000);
    this.filterData = utils.throttle(this.filterData.bind(this), 500);
  }

  // Initialize application
  async init() {
    this.setupEventListeners();
    this.initDatePickers();
    this.setDefaultDates();
    await this.loadSalesData();
    this.initDataTable();
    this.populateSalesFilter();

    // Load filter from URL or set default
    this.loadFilterFromURL();

    // If no URL params, set default date
    const params = new URLSearchParams(window.location.search);
    if (!params.get("date")) {
      this.setDefaultDates();
    }

    // Apply filter
    this.filterData();
  }

  // Setup all event listeners (tetap sama)
  setupEventListeners() {
    const events = {
      btnTambahTransaksi: () => (window.location.href = "penjualanAksesoris.html"),
      btnRefreshData: () => this.refreshData(true),
      btnPrintReceipt: () => this.printDocument("receipt"),
      btnPrintInvoice: () => this.printDocument("invoice"),
      btnSaveEdit: () => this.saveEditTransaction(),
      btnConfirmDelete: () => this.confirmDeleteTransaction(),
    };

    Object.entries(events).forEach(([id, handler]) => {
      const element = document.getElementById(id);
      if (element) element.addEventListener("click", handler);
    });

    // Auto filter when filter inputs change
    this.setupAutoFilter();

    // Table action handlers
    $(document)
      .off("click", ".btn-reprint")
      .on(
        "click",
        ".btn-reprint",
        utils.debounce((e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.target.closest("button").dataset.id;
          if (id) this.handleReprint(id);
        }, 300)
      );

    $(document)
      .off("click", ".btn-edit")
      .on(
        "click",
        ".btn-edit",
        utils.debounce((e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.target.closest("button").dataset.id;
          if (id) this.handleEdit(id);
        }, 300)
      );

    $(document)
      .off("click", ".btn-delete")
      .on(
        "click",
        ".btn-delete",
        utils.debounce((e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.target.closest("button").dataset.id;
          if (id) this.handleDelete(id);
        }, 300)
      );
  }

  // Setup auto filter functionality (tetap sama)
  setupAutoFilter() {
    // Auto filter on date change
    $("#filterTanggal").on("changeDate", () => {
      this.filterData();
    });

    // Auto filter on manual date input
    $("#filterTanggal").on("blur", () => {
      this.filterData();
    });

    // Auto filter on dropdown change
    $("#filterJenisPenjualan, #filterSales").on("change", () => {
      this.filterData();
    });
  }

  // Initialize date pickers (tetap sama)
  initDatePickers() {
    const today = new Date();

    // Initialize single date picker
    $("#filterTanggal")
      .datepicker({
        format: "dd/mm/yyyy",
        autoclose: true,
        language: "id",
        todayHighlight: true,
        endDate: today, // Tidak bisa pilih tanggal masa depan
      })
      .on("changeDate", () => {
        // Trigger filter when date changes
        setTimeout(() => this.filterData(), 100);
      });

    // Manual input validation
    $("#filterTanggal").on("blur", (e) => {
      const inputDate = utils.parseDate(e.target.value);
      if (inputDate && inputDate > today) {
        utils.showAlert("Tanggal tidak boleh melebihi hari ini", "Peringatan", "warning");
        e.target.value = utils.formatDate(today);
      }
      this.filterData();
    });
  }

  // Set default date range (tetap sama)
  setDefaultDates() {
    const today = new Date();
    const todayFormatted = utils.formatDate(today);

    document.getElementById("filterTanggal").value = todayFormatted;
  }

  // PERBAIKAN: Load sales data dengan cache yang lebih efisien
  async loadSalesData(forceRefresh = false) {
    if (this.isLoading) return;

    try {
      this.isLoading = true;
      utils.showLoading(true);

      const cacheKey = "salesData";
      
      // Cek apakah perlu refresh berdasarkan berbagai kondisi
      const needsRefresh = forceRefresh || 
                          cacheManager.shouldUpdate(cacheKey) ||
                          this.checkForDataUpdates();

      // Cek cache terlebih dahulu jika tidak perlu refresh
      if (!needsRefresh) {
        const cachedData = cacheManager.get(cacheKey);
        if (cachedData && Array.isArray(cachedData)) {
          console.log("Using cached sales data");
          this.salesData = cachedData;
          this.filterData();
          return;
        }
      }

      console.log("Fetching fresh sales data from Firestore");
      const salesSnapshot = await getDocs(
        query(collection(firestore, "penjualanAksesoris"), orderBy("timestamp", "desc"))
      );

      this.salesData = salesSnapshot.docs.map((doc) => {
        const data = doc.data();
        // Standardize jenis penjualan
        if (data.jenisPenjualan === "gantiLock") {
          data.jenisPenjualan = "manual";
          data.isGantiLock = true;
        }
        return { id: doc.id, ...data };
      });

      // Simpan ke cache dengan TTL yang sesuai
      cacheManager.set(cacheKey, this.salesData);
      
      // Update timestamp untuk tracking
      localStorage.setItem("lastSalesUpdate", Date.now().toString());

    } catch (error) {
      console.error("Error loading sales data:", error);
      
      // Fallback ke cache jika ada error
      const cachedData = cacheManager.get("salesData");
      if (cachedData && Array.isArray(cachedData)) {
        console.log("Fallback to cached data due to error");
        utils.showAlert("Gagal memuat data terbaru. Menggunakan data cache.", "Peringatan", "warning");
        this.salesData = cachedData;
      } else {
        utils.showAlert("Gagal memuat data penjualan: " + error.message, "Error", "error");
        this.salesData = [];
      }
    } finally {
      this.isLoading = false;
      utils.showLoading(false);
    }
  }

  // TAMBAHAN: Cek apakah ada update data yang memerlukan refresh
  checkForDataUpdates() {
    // Cek apakah ada transaksi baru yang ditambahkan
    const lastTransactionTime = localStorage.getItem("lastTransactionTime");
    const cacheTimestamp = localStorage.getItem(cacheManager.prefix + "salesData_meta");
    
    if (lastTransactionTime && cacheTimestamp) {
      return parseInt(lastTransactionTime) > parseInt(cacheTimestamp);
    }
    
    return false;
  }

  // Initialize DataTable (tetap sama)
  initDataTable() {
    if (this.dataTable) {
      this.dataTable.off();
      this.dataTable.destroy();
      this.dataTable = null;
    }

    $("#dataPenjualanTable").empty();

    this.dataTable = $("#dataPenjualanTable").DataTable({
      data: [],
      columns: [
        { title: "Tanggal", width: "90px", className: "text-center" },
        { title: "Sales", width: "80px", className: "text-center" },
        { title: "Jenis", width: "85px", className: "text-center" },
        { title: "Kode", width: "100px", className: "text-center" },
        { title: "Nama", width: "180px" },
        { title: "Jumlah", width: "60px", className: "text-center" },
        { title: "Berat", width: "70px", className: "text-center" },
        { title: "Kadar", width: "65px", className: "text-center" },
        { title: "Harga", width: "110px", className: "text-end" },
        { title: "Status", width: "90px", className: "text-center" },
        { title: "Keterangan", width: "150px" },
        { title: "Aksi", width: "110px", orderable: false, className: "text-center" },
      ],
      order: [[0, "desc"]],
      pageLength: 25,
      scrollX: true,
      scrollCollapse: true,
      fixedColumns: false,
      autoWidth: false,
      columnDefs: [
        {
          targets: "_all",
          className: "text-nowrap",
        },
        {
          targets: [10], // Kolom keterangan
          className: "text-wrap",
        },
      ],
      language: {
        decimal: "",
        emptyTable: "Tidak ada data yang tersedia pada tabel ini",
        info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ entri",
        infoEmpty: "Menampilkan 0 sampai 0 dari 0 entri",
        infoFiltered: "(disaring dari _MAX_ entri keseluruhan)",
        infoPostFix: "",
        thousands: ".",
        lengthMenu: "Tampilkan _MENU_ entri",
        loadingRecords: "Sedang memuat...",
        processing: "Sedang memproses...",
        search: "Cari:",
        zeroRecords: "Tidak ditemukan data yang sesuai",
        paginate: {
          first: "Pertama",
          last: "Terakhir",
          next: "Selanjutnya",
          previous: "Sebelumnya",
        },
        aria: {
          sortAscending: ": aktifkan untuk mengurutkan kolom naik",
          sortDescending: ": aktifkan untuk mengurutkan kolom turun",
        },
      },
      responsive: false,
      processing: true,
      deferRender: true,
      destroy: true,
    });
  }

  // Filter data based on form inputs (tetap sama)
  filterData() {
    const filters = {
      selectedDate: utils.parseDate(document.getElementById("filterTanggal").value),
      jenis: document.getElementById("filterJenisPenjualan").value,
      sales: document.getElementById("filterSales").value,
    };

    // PERBAIKAN: Jika tidak ada tanggal, tampilkan data kosong
    if (!filters.selectedDate) {
      this.filteredData = [];
      this.updateDataTable();
      this.updateSummary();
      return;
    }

    // Set tanggal ke awal dan akhir hari
    const startOfDay = new Date(filters.selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(filters.selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    this.filteredData = this.salesData.filter((transaction) => {
      // PERBAIKAN: Tangani berbagai format timestamp dengan error handling yang lebih baik
      let transactionDate = null;
      
      if (transaction.timestamp) {
        // Jika timestamp adalah Firestore Timestamp dengan method toDate()
        if (typeof transaction.timestamp.toDate === 'function') {
          try {
            transactionDate = transaction.timestamp.toDate();
          } catch (error) {
            console.warn('Error converting Firestore timestamp:', error);
          }
        }
        // Jika timestamp sudah dalam format Date object
        else if (transaction.timestamp instanceof Date) {
          transactionDate = transaction.timestamp;
        }
        // Jika timestamp adalah string atau number
        else {
          transactionDate = new Date(transaction.timestamp);
          if (isNaN(transactionDate.getTime())) {
            transactionDate = null;
          }
        }
      }
      
      // Fallback ke field tanggal jika timestamp tidak ada atau tidak valid
      if (!transactionDate && transaction.tanggal) {
        transactionDate = utils.parseDate(transaction.tanggal);
      }

      // PERBAIKAN: Jika masih tidak bisa mendapatkan tanggal yang valid, log detail dan skip
      if (!transactionDate || isNaN(transactionDate.getTime())) {
        console.warn('Skipping transaction with invalid date:', {
          id: transaction.id,
          timestamp: transaction.timestamp,
          tanggal: transaction.tanggal,
          parsedDate: transactionDate
        });
        return false;
      }

      // Date filter - hanya untuk hari yang dipilih
      if (transactionDate < startOfDay || transactionDate > endOfDay) return false;

      // Jenis filter
      if (filters.jenis !== "all" && transaction.jenisPenjualan !== filters.jenis) return false;

      // Sales filter
      if (filters.sales !== "all" && transaction.sales !== filters.sales) return false;

      return true;
    });

    this.updateDataTable();
    this.updateSummary();
    this.updateURLParams(filters);
  }

  // Update URL parameters to maintain filter state (tetap sama)
  updateURLParams(filters) {
    const params = new URLSearchParams();

    if (filters.selectedDate) {
      params.set("date", document.getElementById("filterTanggal").value);
    }
    if (filters.jenis !== "all") {
      params.set("jenis", filters.jenis);
    }
    if (filters.sales !== "all") {
      params.set("sales", filters.sales);
    }

    // Update URL without page reload
    const newURL = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, "", newURL);
  }

  // Load filter state from URL parameters (tetap sama)
  loadFilterFromURL() {
    const params = new URLSearchParams(window.location.search);

    if (params.get("date")) {
      document.getElementById("filterTanggal").value = params.get("date");
    }
    if (params.get("jenis")) {
      document.getElementById("filterJenisPenjualan").value = params.get("jenis");
    }
    if (params.get("sales")) {
      document.getElementById("filterSales").value = params.get("sales");
    }
  }

  // Update DataTable with filtered data (tetap sama)
  updateDataTable() {
    const tableData = this.prepareTableData();

    if (this.dataTable) {
      this.dataTable.clear().rows.add(tableData).draw();
    }
  }

  // Prepare data for DataTable (tetap sama)
   prepareTableData() {
    const tableData = [];
    this.filteredData.forEach((transaction) => {
      // PERBAIKAN: Tangani berbagai format timestamp untuk display
      let displayDate = "-";
      if (transaction.timestamp) {
        if (typeof transaction.timestamp.toDate === 'function') {
          displayDate = utils.formatDate(transaction.timestamp.toDate());
        } else if (transaction.timestamp instanceof Date) {
          displayDate = utils.formatDate(transaction.timestamp);
        } else {
          displayDate = utils.formatDate(new Date(transaction.timestamp));
        }
      } else if (transaction.tanggal) {
        displayDate = utils.formatDate(transaction.tanggal);
      }

      const baseData = {
        date: displayDate,
        sales: transaction.sales || "Admin",
        jenis: this.formatJenisPenjualan(transaction),
        status: this.getStatusBadge(transaction),
        actions: this.getActionButtons(transaction.id),
      };

      if (transaction.items?.length > 0) {
        transaction.items.forEach((item) => {
          tableData.push([
            baseData.date,
            baseData.sales,
            baseData.jenis,
            item.kodeText || item.barcode || "-",
            item.nama || "-",
            item.jumlah || 1,
            item.berat ? `${item.berat} gr` : "-",
            item.kadar || "-",
            `Rp ${utils.formatRupiah(item.totalHarga || 0)}`,
            baseData.status,
            item.keterangan || transaction.keterangan || "-",
            baseData.actions,
          ]);
        });
      } else {
        tableData.push([
          baseData.date,
          baseData.sales,
          baseData.jenis,
          "-",
          "-",
          "-",
          "-",
          "-",
          `Rp ${utils.formatRupiah(transaction.totalHarga || 0)}`,
          baseData.status,
          transaction.keterangan || "-",
          baseData.actions,
        ]);
      }
    });
    return tableData;
  }

  // Format jenis penjualan (tetap sama)
  formatJenisPenjualan(transaction) {
    if (transaction.isGantiLock || transaction.jenisPenjualan === "gantiLock") {
      const kodeAksesoris = transaction.items?.find((item) => item.kodeLock)?.kodeLock || "";
      return kodeAksesoris ? `Manual<br><small>(${kodeAksesoris})</small>` : "Manual";
    }

    if (transaction.jenisPenjualan === "manual") {
      const kodeAksesoris = transaction.items?.find((item) => item.kodeLock)?.kodeLock;
      return kodeAksesoris ? `Manual<br><small>(${kodeAksesoris})</small>` : "Manual";
    }

    const jenis = transaction.jenisPenjualan || "Tidak diketahui";
    return jenis.charAt(0).toUpperCase() + jenis.slice(1);
  }

  // Get status badge HTML (tetap sama)
  getStatusBadge(transaction) {
    const status = transaction.statusPembayaran || "Lunas";

    const badges = {
      DP: `<span class="badge bg-warning">DP: Rp ${utils.formatRupiah(transaction.nominalDP)}</span>
             <br><small>Sisa: Rp ${utils.formatRupiah(transaction.sisaPembayaran)}</small>`,
      Lunas: `<span class="badge bg-success">Lunas</span>`,
      Free: `<span class="badge bg-info">Gratis</span>`,
    };
    return badges[status] || `<span class="badge bg-secondary">${status}</span>`;
  }

  // Get action buttons HTML (tetap sama)
  getActionButtons(transactionId) {
    return `
    <div class="action-buttons">
      <button class="btn btn-sm btn-warning btn-reprint" data-id="${transactionId}" title="Cetak Ulang">
        <i class="fas fa-print"></i>
      </button>
      <button class="btn btn-sm btn-primary btn-edit" data-id="${transactionId}" title="Edit">
        <i class="fas fa-edit"></i>
      </button>
      <button class="btn btn-sm btn-danger btn-delete" data-id="${transactionId}" title="Hapus">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
  `;
  }

  // Update summary cards (tetap sama)
  updateSummary() {
    const totalTransaksi = this.filteredData.length;
    const totalPendapatan = this.calculateTotalRevenue(this.filteredData);

    document.getElementById("totalTransaksi").textContent = totalTransaksi;
    document.getElementById("totalPendapatan").textContent = `Rp ${utils.formatRupiah(totalPendapatan)}`;
  }

  // Helper function to calculate actual revenue (tetap sama)
  calculateActualRevenue(transaction) {
    if (transaction.metodeBayar === "free" || transaction.statusPembayaran === "Free") {
      return 0;
    }

    // Untuk transaksi manual dengan DP, hitung sisa pembayaran
    if (
      transaction.jenisPenjualan === "manual" &&
      (transaction.metodeBayar === "dp" || transaction.statusPembayaran === "DP")
    ) {
      return transaction.sisaPembayaran || 0;
    }

    // For completed transactions, return full amount
    return transaction.totalHarga || 0;
  }

  // Calculate total revenue (tetap sama)
  calculateTotalRevenue(transactions) {
    return transactions.reduce((total, transaction) => {
      return total + this.calculateActualRevenue(transaction);
    }, 0);
  }

  // Populate sales filter dropdown (tetap sama)
  populateSalesFilter() {
    const salesPersons = [...new Set(this.salesData.map((item) => item.sales).filter(Boolean))];
    const dropdown = document.getElementById("filterSales");

    // Clear existing options except first one
    while (dropdown.options.length > 1) {
      dropdown.remove(1);
    }

    salesPersons.forEach((person) => {
      const option = new Option(person, person);
      dropdown.add(option);
    });
  }

  // Handle reprint action (tetap sama)
  handleReprint(transactionId) {
    this.currentTransaction = this.salesData.find((t) => t.id === transactionId);
    if (!this.currentTransaction) {
      return utils.showAlert("Transaksi tidak ditemukan", "Error", "error");
    }
    $("#printModal").modal("show");
  }

  // Handle edit action (tetap sama)
  handleEdit(transactionId) {
    this.currentTransaction = this.salesData.find((t) => t.id === transactionId);
    if (!this.currentTransaction) {
      return utils.showAlert("Transaksi tidak ditemukan", "Error", "error");
    }
    this.showEditModal();
  }

  // Handle delete action (tetap sama)
  handleDelete(transactionId) {
    this.currentTransaction = this.salesData.find((t) => t.id === transactionId);
    if (!this.currentTransaction) {
      return utils.showAlert("Transaksi tidak ditemukan", "Error", "error");
    }
    this.showDeleteModal();
  }

  // Show edit modal (tetap sama)
  showEditModal() {
    const transaction = this.currentTransaction;
    const jenisPenjualan = transaction.jenisPenjualan;

    const formHtml = this.generateEditForm(transaction, jenisPenjualan);
    document.getElementById("editModalBody").innerHTML = formHtml;

    // Attach form events
    this.attachEditFormEvents(transaction);

    $("#editModal").modal("show");
  }

  // Generate edit form HTML (tetap sama)
  generateEditForm(transaction, jenisPenjualan) {
    let formHtml = `
      <div class="mb-3">
        <label for="editSales" class="form-label">Sales:</label>
        <input type="text" class="form-control" id="editSales" value="${transaction.sales || ""}">
      </div>
    `;

    if (transaction.items && transaction.items.length > 0) {
      formHtml += `<div class="mb-3"><label class="form-label">Detail Barang:</label></div>`;

      transaction.items.forEach((item, index) => {
        formHtml += `
          <div class="border p-3 mb-3 rounded">
            <h6>Item ${index + 1}</h6>
            <div class="row">
              <div class="col-md-6">
                <label for="editNama_${index}" class="form-label">Nama Barang:</label>
                <input type="text" class="form-control" id="editNama_${index}" value="${item.nama || ""}">
              </div>
              ${
                jenisPenjualan !== "kotak"
                  ? `
                <div class="col-md-6">
                  <label for="editKadar_${index}" class="form-label">Kadar:</label>
                  <input type="text" class="form-control" id="editKadar_${index}" value="${item.kadar || ""}">
                </div>
              `
                  : ""
              }
            </div>
            ${
              jenisPenjualan !== "kotak"
                ? `
              <div class="row mt-2">
                <div class="col-md-6">
                  <label for="editBerat_${index}" class="form-label">Berat (gr):</label>
                  <input type="text" class="form-control" id="editBerat_${index}" value="${item.berat || ""}">
                </div>
                <div class="col-md-6">
                  <label for="editHarga_${index}" class="form-label">Harga:</label>
                  <input type="text" class="form-control" id="editHarga_${index}" value="${utils.formatRupiah(
                    item.totalHarga || 0
                  )}">
                </div>
              </div>
            `
                : `
              <div class="row mt-2">
                <div class="col-md-12">
                  <label for="editHarga_${index}" class="form-label">Harga:</label>
                  <input type="text" class="form-control" id="editHarga_${index}" value="${utils.formatRupiah(
                    item.totalHarga || 0
                  )}">
                </div>
              </div>
            `
            }
            ${
              jenisPenjualan === "manual"
                ? `
              <div class="row mt-2">
                <div class="col-md-12">
                  <label for="editKeterangan_${index}" class="form-label">Keterangan:</label>
                  <textarea class="form-control" id="editKeterangan_${index}" rows="2">${
                    item.keterangan || ""
                  }</textarea>
                </div>
              </div>
            `
                : ""
            }
          </div>
        `;
      });
    }

    return formHtml;
  }

  // Attach edit form events (tetap sama)
  attachEditFormEvents(transaction) {
    if (transaction.items) {
      transaction.items.forEach((item, index) => {
        const hargaInput = document.getElementById(`editHarga_${index}`);
        if (hargaInput) {
          hargaInput.addEventListener("blur", () => {
            const value = hargaInput.value.replace(/\./g, "");
            hargaInput.value = utils.formatRupiah(parseInt(value || 0));
          });
        }
      });
    }
  }

  // PERBAIKAN: Save edit transaction dengan cache invalidation
  async saveEditTransaction() {
    try {
      utils.showLoading(true);

      const updateData = {
        sales: document.getElementById("editSales").value.trim(),
        lastUpdated: serverTimestamp(),
      };

      if (this.currentTransaction.items && this.currentTransaction.items.length > 0) {
        updateData.items = this.currentTransaction.items.map((item, index) => {
          const updatedItem = { ...item };

          updatedItem.nama = document.getElementById(`editNama_${index}`)?.value || item.nama;

          if (this.currentTransaction.jenisPenjualan !== "kotak") {
            updatedItem.kadar = document.getElementById(`editKadar_${index}`)?.value || item.kadar;
            updatedItem.berat = document.getElementById(`editBerat_${index}`)?.value || item.berat;
          }

          if (this.currentTransaction.jenisPenjualan === "manual") {
            updatedItem.keterangan = document.getElementById(`editKeterangan_${index}`)?.value || item.keterangan;
          }

          const hargaValue = document.getElementById(`editHarga_${index}`)?.value.replace(/\./g, "") || "0";
          updatedItem.totalHarga = parseInt(hargaValue);

          return updatedItem;
        });

        updateData.totalHarga = updateData.items.reduce((sum, item) => sum + (item.totalHarga || 0), 0);
      }

      // Update in Firestore
      await updateDoc(doc(firestore, "penjualanAksesoris", this.currentTransaction.id), updateData);

      // Update local data
      this.updateLocalData(this.currentTransaction.id, updateData);

      // PERBAIKAN: Invalidate cache setelah update
      cacheManager.clear();
      localStorage.setItem("lastTransactionTime", Date.now().toString());

      $("#editModal").modal("hide");
      utils.showAlert("Transaksi berhasil diperbarui", "Sukses", "success");
    } catch (error) {
      console.error("Error updating transaction:", error);
      utils.showAlert("Terjadi kesalahan saat memperbarui transaksi: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // Update local data (tetap sama)
  updateLocalData(transactionId, updateData) {
    // Update salesData
    const salesIndex = this.salesData.findIndex((item) => item.id === transactionId);
    if (salesIndex !== -1) {
      this.salesData[salesIndex] = { ...this.salesData[salesIndex], ...updateData };
      delete this.salesData[salesIndex].lastUpdated;
    }

    // Update filteredData
    const filteredIndex = this.filteredData.findIndex((item) => item.id === transactionId);
    if (filteredIndex !== -1) {
      this.filteredData[filteredIndex] = { ...this.filteredData[filteredIndex], ...updateData };
      delete this.filteredData[filteredIndex].lastUpdated;
    }

    // Re-render table
    this.updateDataTable();
    this.updateSummary();
  }

  // Show delete modal (tetap sama)
  showDeleteModal() {
    const transaction = this.currentTransaction;
    const date = utils.formatDate(transaction.timestamp || transaction.tanggal);

    document.getElementById("deleteTransactionInfo").innerHTML = `
    <div class="text-start">
      <p><strong>Tanggal:</strong> ${date}</p>
      <p><strong>Sales:</strong> ${transaction.sales || "Admin"}</p>
      <p><strong>Total Harga:</strong> Rp ${utils.formatRupiah(transaction.totalHarga || 0)}</p>
    </div>
  `;

    // Clear password field
    const passwordInput = document.getElementById("deleteVerificationPassword");
    if (passwordInput) {
      passwordInput.value = "";
    }

    $("#deleteModal").modal("show");
  }

  // PERBAIKAN: Confirm delete transaction dengan cache invalidation
  async confirmDeleteTransaction() {
    const password = document.getElementById("deleteVerificationPassword").value;

    if (!password) {
      return utils.showAlert("Masukkan kata sandi verifikasi terlebih dahulu.", "Peringatan", "warning");
    }

    if (password !== VERIFICATION_PASSWORD) {
      return utils.showAlert("Kata sandi verifikasi salah.", "Error", "error");
    }

    try {
      utils.showLoading(true);

      await deleteDoc(doc(firestore, "penjualanAksesoris", this.currentTransaction.id));

      // Remove from local arrays
      this.salesData = this.salesData.filter((item) => item.id !== this.currentTransaction.id);
      this.filteredData = this.filteredData.filter((item) => item.id !== this.currentTransaction.id);

      // PERBAIKAN: Invalidate cache setelah delete
      cacheManager.clear();
      localStorage.setItem("lastTransactionTime", Date.now().toString());

      this.updateDataTable();
      this.updateSummary();

      $("#deleteModal").modal("hide");
      utils.showAlert("Transaksi berhasil dihapus", "Sukses", "success");
    } catch (error) {
      console.error("Error deleting transaction:", error);
      utils.showAlert("Terjadi kesalahan saat menghapus transaksi: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // Print document (receipt or invoice) (tetap sama)
  printDocument(type) {
    if (!this.currentTransaction) {
      return utils.showAlert("Tidak ada data transaksi untuk dicetak!");
    }

    const transaction = this.currentTransaction;
    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      return utils.showAlert("Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.", "Error", "error");
    }

    const html = type === "receipt" ? this.generateReceiptHTML(transaction) : this.generateInvoiceHTML(transaction);

    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Generate receipt HTML (tetap sama)
  generateReceiptHTML(transaction) {
    const tanggal = utils.formatDate(transaction.timestamp || transaction.tanggal);
    let salesType = transaction.jenisPenjualan || "aksesoris";
    if (salesType === "manual") salesType = "layanan";

    let receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Struk Kasir</title>
        <style>
          body { font-family: Roboto; font-size: 14px; margin: 0; padding: 0; width: 80mm; }
          .receipt { margin: 0 auto; padding: 5mm; }
          .receipt h3, .receipt h4 { text-align: center; margin: 2mm 0; }
          .receipt hr { border-top: 1px dashed #000; }
          .receipt table { width: 100%; border-collapse: collapse; }
          .receipt th, .receipt td { text-align: left; padding: 1mm 2mm; }
          .tanggal {margin-left: 10px}
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .keterangan { font-style: italic; font-size: 10px; margin-top: 2mm; border-top: 1px dotted #000; padding-top: 2mm; }
          .payment-info { margin-top: 2mm; border-top: 1px dotted #000; padding-top: 2mm; }
        </style>
      </head>
      <body>
        <div class="receipt">
          <h3>MELATI 3</h3>
          <h4>JL. DIPONEGORO NO. 116</h4>
          <h4>NOTA PENJUALAN ${salesType.toUpperCase()}</h4>
          <hr>
          <p class="tanggal">Tanggal: ${tanggal}<br>Sales: ${transaction.sales || "-"}</p>
          <hr>
          <table>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Kadar</th>
              <th>Gr</th>
              <th>Harga</th>
            </tr>
    `;

    let hasKeterangan = false;
    let keteranganText = "";

    transaction.items?.forEach((item) => {
      const itemHarga = parseInt(item.totalHarga || 0);
      receiptHTML += `
        <tr>
          <td>${item.kodeText || "-"}</td>
          <td>${item.nama || "-"}</td>
          <td>${item.kadar || "-"}</td>
          <td>${item.berat || "-"}</td>
          <td class="text-right">${utils.formatRupiah(itemHarga)}</td>
        </tr>
      `;

      if (item.keterangan && item.keterangan.trim() !== "") {
        hasKeterangan = true;
        keteranganText += item.keterangan + " ";
      }
    });

    const totalHarga = parseInt(transaction.totalHarga || 0);
    receiptHTML += `
            <tr>
              <td colspan="4" class="text-right"><strong>Total:</strong></td>
              <td class="text-right"><strong>${utils.formatRupiah(totalHarga)}</strong></td>
            </tr>
          </table>
    `;

    // Add DP information if applicable
    if (transaction.metodeBayar === "dp" || transaction.statusPembayaran === "DP") {
      const dpAmount = parseInt(transaction.nominalDP || 0);
      const remainingAmount = parseInt(transaction.sisaPembayaran || 0);

      receiptHTML += `
        <div class="payment-info">
          <table>
            <tr>
              <td>Total Harga:</td>
              <td class="text-right">${utils.formatRupiah(totalHarga)}</td>
            </tr>
            <tr>
              <td>DP:</td>
              <td class="text-right">${utils.formatRupiah(dpAmount)}</td>
            </tr>
            <tr>
              <td><strong>SISA:</strong></td>
              <td class="text-right"><strong>${utils.formatRupiah(remainingAmount)}</strong></td>
            </tr>
          </table>
        </div>
      `;
    }

    if (hasKeterangan && transaction.jenisPenjualan === "manual") {
      receiptHTML += `
        <div class="keterangan">
          <strong>Keterangan:</strong> ${keteranganText.trim()}
        </div>
      `;
    }

    receiptHTML += `
          <hr>
          <p class="text-center">Terima Kasih<br>Atas Kunjungan Anda</p>
        </div>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
      </html>
    `;

    return receiptHTML;
  }

  // Generate invoice HTML (tetap sama)
  generateInvoiceHTML(transaction) {
    const tanggal = utils.formatDate(transaction.timestamp || transaction.tanggal);

    let invoiceHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invoice Customer</title>
      <style>
        @page { size: 10cm 20cm; margin: 0; }
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 5mm; width: 20cm; box-sizing: border-box; }
        .invoice { width: 100%; }
        .header-info { text-align: right; margin-bottom: 2cm; margin-right: 3cm; margin-top: 0.8cm; }
        .total-row { margin-top: 0.7cm; text-align: right; font-weight: bold; margin-right: 3cm; }
        .sales { text-align: right; margin-top: 0.6cm; margin-right: 2cm; }
                .keterangan { font-style: italic; font-size: 10px; margin-top: 1cm; margin-bottom: 0.5cm; padding-top: 2mm; text-align: left; margin-left: 0.5cm; margin-right: 3cm; }
        .keterangan-spacer { height: 1.6cm; }
        .item-details { display: flex; flex-wrap: wrap; }
        .item-data { display: grid; grid-template-columns: 2cm 1.8cm 5cm 2cm 2cm 2cm; width: 100%; column-gap: 0.2cm; margin-left: 0.5cm; margin-top: 1cm; margin-right: 3cm; }
        .item-data span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
    </head>
    <body>
      <div class="invoice">
        <div class="header-info">
          <p>${tanggal}</p>
        </div>
        <hr>
  `;

    let hasKeterangan = false;
    let keteranganText = "";
    let totalHarga = 0;

    // Loop untuk menampilkan semua item-data terlebih dahulu
    transaction.items?.forEach((item) => {
      const itemHarga = parseInt(item.totalHarga || 0);
      totalHarga += itemHarga;

      invoiceHTML += `
      <div class="item-details">
        <div class="item-data">
          <span>${item.kodeText || "-"}</span>
          <span>${item.jumlah || "1"}pcs</span>
          <span>${item.nama || "-"}</span>
          <span>${item.kadar || "-"}</span>
          <span>${item.berat || "-"}gr</span>
          <span>${utils.formatRupiah(itemHarga)}</span>
        </div>
      </div>
    `;

      // Kumpulkan keterangan
      if (item.keterangan && item.keterangan.trim() !== "") {
        hasKeterangan = true;
        keteranganText += `${item.keterangan}; `;
      }
    });

    // Tampilkan keterangan atau spacer untuk menjaga posisi total-row
    if (hasKeterangan && transaction.jenisPenjualan === "manual") {
      invoiceHTML += `
      <div class="keterangan">
        <strong>Keterangan:</strong><br>
        ${keteranganText.trim()}
      </div>
    `;
    } else {
      // Tambahkan spacer jika tidak ada keterangan untuk menjaga posisi total-row
      invoiceHTML += `
      <div class="keterangan-spacer"></div>
    `;
    }

    // Tampilkan total dan sales
    invoiceHTML += `
      <div class="total-row">
        Rp ${utils.formatRupiah(totalHarga)}
      </div>
      <div class="sales">${transaction.sales || "-"}</div>
  `;

    invoiceHTML += `
      </div>
      <script>
        window.onload = function() {
          window.print();
          setTimeout(function() { window.close(); }, 500);
        };
      </script>
    </body>
    </html>
  `;

    return invoiceHTML;
  }

  // PERBAIKAN: Refresh data dengan cache management yang lebih baik
  async refreshData(forceRefresh = false) {
    // Clear cache sebelum refresh untuk memastikan data terbaru
    if (forceRefresh) {
      cacheManager.clear();
    }
    
    await this.loadSalesData(forceRefresh);
    this.populateSalesFilter();
    utils.showAlert("Data berhasil diperbarui", "Sukses", "success");
  }
}

// PERBAIKAN: Initialize application dengan cache cleanup
$(document).ready(async function () {
  // Bersihkan cache lama saat aplikasi dimulai
  cacheManager.clearOldCache();
  
  // Initialize the application
  const app = new DataPenjualanApp();
  await app.init();

  // PERBAIKAN: Auto-refresh yang lebih efisien - hanya jika diperlukan
  setInterval(() => {
    // Hanya refresh jika cache sudah expired atau ada indikasi data baru
    const needsRefresh = cacheManager.shouldUpdate("salesData") || 
                        app.checkForDataUpdates();
    
    if (needsRefresh) {
      app.refreshData();
    }
  }, 5 * 60 * 1000); // Check setiap 5 menit

  // PERBAIKAN: Clear cache yang lebih selektif saat page unload
  window.addEventListener("beforeunload", () => {
    // Hanya clear cache yang sudah expired
    const now = Date.now();
    Object.keys(localStorage)
      .filter(key => key.startsWith(cacheManager.prefix))
      .forEach(key => {
        try {
          const item = JSON.parse(localStorage.getItem(key));
          if (item && item.timestamp && (now - item.timestamp) > item.ttl) {
            localStorage.removeItem(key);
          }
        } catch (error) {
          // Jika ada error parsing, hapus item tersebut
          localStorage.removeItem(key);
        }
      });
  });

  // TAMBAHAN: Event listener untuk mendeteksi perubahan data dari tab lain
  window.addEventListener("storage", (e) => {
    if (e.key === "lastTransactionTime") {
      // Ada transaksi baru dari tab lain, refresh data
      app.refreshData(true);
    }
  });

  console.log("Data Penjualan application initialized with improved cache management");
});

// Export for potential use in other modules
export default DataPenjualanApp;

