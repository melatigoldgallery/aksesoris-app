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
  onSnapshot,
  limit,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

const VERIFICATION_PASSWORD = "smlt116";

// Optimized cache manager - no TTL, real-time updates
const cacheManager = {
  prefix: "melati_sales_",
  cache: new Map(),

  set(key, data) {
    this.cache.set(this.prefix + key, {
      data: data,
      timestamp: Date.now(),
    });
    this.saveToStorage();
  },

  get(key) {
    const item = this.cache.get(this.prefix + key);
    return item ? item.data : null;
  },

  has(key) {
    return this.cache.has(this.prefix + key);
  },

  remove(key) {
    this.cache.delete(this.prefix + key);
    this.saveToStorage();
  },

  clear() {
    this.cache.clear();
    this.clearStorage();
  },

  // Update specific transaction in cache
  updateTransaction(transactionId, updatedData) {
    const salesData = this.get("salesData");
    if (salesData && Array.isArray(salesData)) {
      const index = salesData.findIndex((item) => item.id === transactionId);
      if (index !== -1) {
        // Deep copy untuk nested objects (items array)
        const currentItem = JSON.parse(JSON.stringify(salesData[index]));
        const newData = JSON.parse(JSON.stringify(updatedData));
        delete newData.lastUpdated; // Remove serverTimestamp
        salesData[index] = { ...currentItem, ...newData };
        this.set("salesData", salesData);
        return true;
      }
    }
    return false;
  },

  // Remove specific transaction from cache
  removeTransaction(transactionId) {
    const salesData = this.get("salesData");
    if (salesData && Array.isArray(salesData)) {
      const filtered = salesData.filter((item) => item.id !== transactionId);
      this.set("salesData", filtered);
      return true;
    }
    return false;
  },

  // Add new transaction to cache
  addTransaction(newTransaction) {
    const salesData = this.get("salesData") || [];
    salesData.unshift(newTransaction); // Add to beginning (newest first)
    this.set("salesData", salesData);
  },

  saveToStorage() {
    try {
      const cacheData = {};
      this.cache.forEach((value, key) => {
        cacheData[key] = value;
      });
      localStorage.setItem("optimizedSalesCache", JSON.stringify(cacheData));
    } catch (error) {
      console.warn("Failed to save cache:", error);
    }
  },

  loadFromStorage() {
    try {
      const stored = localStorage.getItem("optimizedSalesCache");
      if (stored) {
        const cacheData = JSON.parse(stored);
        Object.entries(cacheData).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
        console.log(`💾 Loaded cache: ${this.cache.size} entries`);
      }
    } catch (error) {
      console.warn("Failed to load cache:", error);
    }
  },

  clearStorage() {
    localStorage.removeItem("optimizedSalesCache");
  },
};

// Utility functions
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
      let dateObj = null;

      // Handle Firestore Timestamp
      if (date && typeof date.toDate === "function") {
        dateObj = date.toDate();
      }
      // Handle Date object
      else if (date instanceof Date) {
        dateObj = date;
      }
      // Handle timestamp number
      else if (typeof date === "number") {
        dateObj = new Date(date);
      }
      // Handle string
      else if (typeof date === "string") {
        dateObj = new Date(date);
      }
      // Handle object with seconds (Firestore timestamp format)
      else if (date && typeof date === "object" && date.seconds) {
        dateObj = new Date(date.seconds * 1000);
      }

      // Validate the date
      if (!dateObj || isNaN(dateObj.getTime())) {
        console.warn("Invalid date object:", date);
        return "-";
      }

      const day = String(dateObj.getDate()).padStart(2, "0");
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const year = dateObj.getFullYear();

      return `${day}/${month}/${year}`;
    } catch (error) {
      console.error("Error formatting date:", date, error);
      return "-";
    }
  },

  formatTime: (date) => {
    if (!date) return "-";

    try {
      let dateObj = null;

      // Handle Firestore Timestamp
      if (date && typeof date.toDate === "function") {
        dateObj = date.toDate();
      }
      // Handle Date object
      else if (date instanceof Date) {
        dateObj = date;
      }
      // Handle timestamp number
      else if (typeof date === "number") {
        dateObj = new Date(date);
      }
      // Handle string
      else if (typeof date === "string") {
        dateObj = new Date(date);
      }
      // Handle object with seconds (Firestore timestamp format)
      else if (date && typeof date === "object" && date.seconds) {
        dateObj = new Date(date.seconds * 1000);
      }

      // Validate the date
      if (!dateObj || isNaN(dateObj.getTime())) {
        return "-";
      }

      const hours = String(dateObj.getHours()).padStart(2, "0");
      const minutes = String(dateObj.getMinutes()).padStart(2, "0");
      const seconds = String(dateObj.getSeconds()).padStart(2, "0");

      return `${hours}:${minutes}:${seconds}`;
    } catch (error) {
      console.error("Error formatting time:", date, error);
      return "-";
    }
  },

  // ✅ PERBAIKAN: Parse date dengan validasi yang lebih ketat
  parseDate: (dateString) => {
    if (!dateString) return null;

    try {
      // Jika sudah berupa Date object
      if (dateString instanceof Date) {
        return isNaN(dateString.getTime()) ? null : dateString;
      }

      // Handle Firestore Timestamp
      if (dateString && typeof dateString.toDate === "function") {
        try {
          return dateString.toDate();
        } catch (error) {
          console.warn("Error converting Firestore timestamp:", error);
          return null;
        }
      }

      // Handle object with seconds (Firestore timestamp format)
      if (dateString && typeof dateString === "object" && dateString.seconds) {
        return new Date(dateString.seconds * 1000);
      }

      // Handle string dengan format dd/mm/yyyy
      if (typeof dateString === "string") {
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

        // Fallback: coba parse langsung
        const parsedDate = new Date(dateString);
        return isNaN(parsedDate.getTime()) ? null : parsedDate;
      }

      // Handle number (timestamp)
      if (typeof dateString === "number") {
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
      }

      return null;
    } catch (error) {
      console.warn("Error parsing date:", dateString, error);
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

  isSameDate: (date1, date2) => {
    if (!date1 || !date2) return false;
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  },
};

// Main application class
class OptimizedDataPenjualanApp {
  constructor() {
    this.salesData = [];
    this.filteredData = [];
    this.dataTable = null;
    this.currentTransaction = null;
    this.isLoading = false;
    this.realtimeListener = null;
    this.isListeningToday = false;
    this.currentSelectedDate = null;
    this.currentListeningDate = null;
    this.currentDeleteAction = null;

    // ✅ PERBAIKAN: Tambahkan properties untuk inactivity timer
    this.inactivityTimer = null;
    this.isUserActive = true;
    this.INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 menit

    // Bind methods
    this.filterData = utils.debounce(this.filterData.bind(this), 300);

    // ✅ PERBAIKAN: Bind inactivity methods
    this.resetInactivityTimer = this.resetInactivityTimer.bind(this);
    this.handleUserInactivity = this.handleUserInactivity.bind(this);
  }

  // ✅ PERBAIKAN: Tambahkan method untuk handle inactivity
  resetInactivityTimer() {
    // Clear existing timer
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    // Reactivate listener if user becomes active again
    if (!this.isUserActive && this.currentSelectedDate) {
      if (!this.realtimeListener) {
        this.setupDateListener(this.currentSelectedDate);
        this.currentListeningDate = this.currentSelectedDate;
        console.log("📡 Real-time listener reactivated due to user activity");
      }
    }

    this.isUserActive = true;

    // Set new timer
    this.inactivityTimer = setTimeout(this.handleUserInactivity, this.INACTIVITY_TIMEOUT);
  }

  // ✅ PERBAIKAN: Handle user inactivity
  handleUserInactivity() {
    this.isUserActive = false;

    if (this.realtimeListener) {
      this.removeRealtimeListener();
      console.log("🔇 Real-time listener deactivated due to inactivity (5 minutes)");

      // Show subtle notification
      this.showInactivityNotification();
    }
  }

  // ✅ PERBAIKAN: Show inactivity notification
  showInactivityNotification() {
    const existingNotification = document.getElementById("inactivityNotification");
    if (existingNotification) existingNotification.remove();

    const notification = document.createElement("div");
    notification.id = "inactivityNotification";
    notification.className = "alert alert-info alert-dismissible fade show mb-2";
    notification.innerHTML = `
      <i class="fas fa-pause-circle me-2"></i>
      Real-time updates dihentikan sementara untuk menghemat kuota. Klik di mana saja untuk mengaktifkan kembali.
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    const container = document.querySelector(".container-fluid");
    if (container) {
      container.insertBefore(notification, container.firstChild);
    }

    // Auto remove after 10 seconds
    setTimeout(() => {
      if (notification.parentNode) notification.remove();
    }, 10000);
  }

  // ✅ PERBAIKAN: Setup inactivity listeners
  setupInactivityListeners() {
    // List of events that indicate user activity
    const activityEvents = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click", "focus", "blur"];

    // Add event listeners
    activityEvents.forEach((event) => {
      document.addEventListener(event, this.resetInactivityTimer, true);
    });

    // Start the timer
    this.resetInactivityTimer();

    console.log("👁️ Inactivity monitoring started (5 minutes timeout)");
  }

  // ✅ PERBAIKAN: Remove inactivity listeners
  removeInactivityListeners() {
    const activityEvents = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click", "focus", "blur"];

    activityEvents.forEach((event) => {
      document.removeEventListener(event, this.resetInactivityTimer, true);
    });

    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  // Initialize application
  async init() {
    // Load cache first
    cacheManager.loadFromStorage();

    this.setupEventListeners();
    this.initDatePickers();
    this.setDefaultDates();

    // Load initial data
    await this.loadInitialData();

    this.initDataTable();
    this.populateSalesFilter();
    this.loadFilterFromURL();

    // Set default if no URL params
    const params = new URLSearchParams(window.location.search);
    if (!params.get("date")) {
      this.setDefaultDates();
    }

    this.filterData();
    // ✅ PERBAIKAN: Setup inactivity monitoring
    this.setupInactivityListeners();
    console.log("✅ Optimized Data Penjualan initialized");
  }

  // Load initial data with smart caching
  async loadInitialData() {
    try {
      utils.showLoading(true);

      // Check cache first
      const cachedData = cacheManager.get("salesData");
      if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
        console.log("📦 Using cached sales data");
        this.salesData = cachedData;
        return;
      }

      // Load from Firestore if no cache
      console.log("🔄 Loading fresh data from Firestore");
      await this.loadSalesDataFromFirestore();
    } catch (error) {
      console.error("Error loading initial data:", error);
      utils.showAlert("Gagal memuat data: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // Load data from Firestore
  async loadSalesDataFromFirestore() {
    try {
      // Load recent data first (last 30 days for better performance)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentQuery = query(
        collection(firestore, "penjualanAksesoris"),
        where("timestamp", ">=", Timestamp.fromDate(thirtyDaysAgo)),
        orderBy("timestamp", "desc"),
      );

      const recentSnapshot = await getDocs(recentQuery);
      this.salesData = recentSnapshot.docs.map((doc) => {
        const data = doc.data();
        if (data.jenisPenjualan === "gantiLock") {
          data.jenisPenjualan = "manual";
          data.isGantiLock = true;
        }
        return { id: doc.id, ...data };
      });

      // Cache the data
      cacheManager.set("salesData", this.salesData);

      console.log(`✅ Loaded ${this.salesData.length} recent transactions`);
    } catch (error) {
      console.error("Error loading from Firestore:", error);
      throw error;
    }
  }

  // Setup real-time listener for selected date
  setupRealtimeListener(selectedDate) {
    if (!selectedDate || !this.isUserActive) {
      this.removeRealtimeListener();
      return;
    }

    // Jika sudah ada listener untuk tanggal yang sama, skip
    if (this.currentListeningDate && utils.isSameDate(this.currentListeningDate, selectedDate)) {
      return;
    }

    // Remove listener lama & setup yang baru
    this.removeRealtimeListener();
    this.setupDateListener(selectedDate);
    this.currentListeningDate = selectedDate;
  }

  // Setup real-time listener for specific date
  setupDateListener(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dateQuery = query(
      collection(firestore, "penjualanAksesoris"),
      where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
      where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
      orderBy("timestamp", "desc"),
    );

    this.realtimeListener = onSnapshot(
      dateQuery,
      (snapshot) => {
        if (!snapshot.metadata.hasPendingWrites) {
          this.handleRealtimeUpdate(snapshot);
        }
      },
      (error) => {
        console.error("Real-time listener error:", error);
      },
    );

    console.log(`📡 Real-time listener activated for: ${utils.formatDate(date)}`);
  }

  // Remove real-time listener
  removeRealtimeListener() {
    if (this.realtimeListener) {
      this.realtimeListener();
      this.realtimeListener = null;
    }
    this.currentListeningDate = null;
  }

  // Handle real-time updates
  handleRealtimeUpdate(snapshot) {
    let hasChanges = false;

    snapshot.docChanges().forEach((change) => {
      const docData = { id: change.doc.id, ...change.doc.data() };

      // Standardize jenis penjualan
      if (docData.jenisPenjualan === "gantiLock") {
        docData.jenisPenjualan = "manual";
        docData.isGantiLock = true;
      }

      if (change.type === "added") {
        // ✅ PERBAIKAN: Cek duplikasi lebih ketat
        const exists = this.salesData.find((item) => item.id === docData.id);
        if (!exists) {
          // ✅ PERBAIKAN: Cek apakah data sudah ada di filtered data juga
          const existsInFiltered = this.filteredData.find((item) => item.id === docData.id);
          if (!existsInFiltered) {
            this.salesData.unshift(docData);
            cacheManager.addTransaction(docData);
            hasChanges = true;
            console.log("➕ New transaction added:", docData.id);
          }
        }
      } else if (change.type === "modified") {
        const index = this.salesData.findIndex((item) => item.id === docData.id);
        if (index !== -1) {
          this.salesData[index] = docData;
          cacheManager.updateTransaction(docData.id, docData);
          hasChanges = true;
          console.log("✏️ Transaction updated:", docData.id);
        }
      } else if (change.type === "removed") {
        this.salesData = this.salesData.filter((item) => item.id !== docData.id);
        cacheManager.removeTransaction(docData.id);
        hasChanges = true;
        console.log("🗑️ Transaction removed:", docData.id);
      }
    });

    if (hasChanges) {
      // ✅ PERBAIKAN: Hindari double filtering
      this.filterData();
      this.showUpdateIndicator();
    }
  }

  // Show update indicator
  showUpdateIndicator() {
    const existingIndicator = document.getElementById("updateIndicator");
    if (existingIndicator) existingIndicator.remove();

    const indicator = document.createElement("div");
    indicator.id = "updateIndicator";
    indicator.className = "alert alert-success alert-dismissible fade show mb-2";
    indicator.innerHTML = `
      <i class="fas fa-sync-alt me-2"></i>
      Data telah diperbarui secara real-time
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    const container = document.querySelector(".container-fluid");
    if (container) {
      container.insertBefore(indicator, container.firstChild);
    }

    setTimeout(() => {
      if (indicator.parentNode) indicator.remove();
    }, 3000);
  }

  // Setup event listeners
  setupEventListeners() {
    const events = {
      btnTambahTransaksi: () => (window.location.href = "penjualanAksesoris.html"),
      btnRefreshData: () => this.refreshData(),
      btnPrintReceipt: () => this.printDocument("receipt"),
      btnPrintInvoice: () => this.printDocument("invoice"),
      btnSaveEdit: () => this.saveEditTransaction(),
    };

    // Event listener untuk confirm delete
    const btnConfirmDelete = document.getElementById("btnConfirmDelete");
    if (btnConfirmDelete) {
      btnConfirmDelete.addEventListener("click", () => this.confirmDeleteTransaction());
    }

    Object.entries(events).forEach(([id, handler]) => {
      const element = document.getElementById(id);
      if (element) element.addEventListener("click", handler);
    });

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
        }, 300),
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
        }, 300),
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
        }, 300),
      );
  }

  // Setup auto filter functionality
  setupAutoFilter() {
    $("#filterTanggal").on("changeDate", () => {
      this.filterData();
    });

    $("#filterTanggal").on("blur", () => {
      this.filterData();
    });

    $("#filterJenisPenjualan, #filterSales").on("change", () => {
      this.filterData();
    });
  }

  // Initialize date pickers
  initDatePickers() {
    const today = new Date();

    $("#filterTanggal")
      .datepicker({
        format: "dd/mm/yyyy",
        autoclose: true,
        language: "id",
        todayHighlight: true,
        endDate: today,
      })
      .on("changeDate", () => {
        setTimeout(() => this.filterData(), 100);
      });

    $("#filterTanggal").on("blur", (e) => {
      const inputDate = utils.parseDate(e.target.value);
      if (inputDate && inputDate > today) {
        utils.showAlert("Tanggal tidak boleh melebihi hari ini", "Peringatan", "warning");
        e.target.value = utils.formatDate(today);
      }
      this.filterData();
    });
  }

  // Set default dates
  setDefaultDates() {
    const today = new Date();
    const todayFormatted = utils.formatDate(today);
    document.getElementById("filterTanggal").value = todayFormatted;
  }

  // Initialize DataTable
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
        { title: "Jam", width: "75px", className: "text-center" },
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
      lengthMenu: [
        [10, 25, 50, 100],
        [10, 25, 50, 100],
      ],
      scrollX: true,
      scrollCollapse: true,
      fixedColumns: false,
      autoWidth: false,
      columnDefs: [
        { targets: "_all", className: "text-nowrap" },
        { targets: [11], className: "text-wrap" },
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

  // Filter data based on form inputs
  filterData() {
    const filters = {
      selectedDate: utils.parseDate(document.getElementById("filterTanggal").value),
      jenis: document.getElementById("filterJenisPenjualan").value,
      sales: document.getElementById("filterSales").value,
    };

    // Store current selected date for real-time listener
    this.currentSelectedDate = filters.selectedDate;

    // Setup real-time listener based on selected date
    this.setupRealtimeListener(filters.selectedDate);

    // If no date selected, show empty data
    if (!filters.selectedDate) {
      this.filteredData = [];
      this.updateDataTable();
      this.updateSummary();
      return;
    }

    // Set date range for filtering
    const startOfDay = new Date(filters.selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(filters.selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    // ✅ PERBAIKAN: Remove duplicates before filtering
    const uniqueSalesData = this.removeDuplicates(this.salesData);

    this.filteredData = uniqueSalesData.filter((transaction) => {
      // ✅ PERBAIKAN: Handle different timestamp formats dengan error handling
      let transactionDate = null;

      if (transaction.timestamp) {
        // Handle Firestore Timestamp
        if (typeof transaction.timestamp.toDate === "function") {
          try {
            transactionDate = transaction.timestamp.toDate();
          } catch (error) {
            console.warn("Error converting Firestore timestamp:", error);
          }
        }
        // Handle Date object
        else if (transaction.timestamp instanceof Date) {
          transactionDate = transaction.timestamp;
        }
        // Handle object with seconds
        else if (transaction.timestamp && typeof transaction.timestamp === "object" && transaction.timestamp.seconds) {
          transactionDate = new Date(transaction.timestamp.seconds * 1000);
        }
        // Handle number or string
        else {
          transactionDate = new Date(transaction.timestamp);
          if (isNaN(transactionDate.getTime())) {
            transactionDate = null;
          }
        }
      }

      // Fallback to tanggal field
      if (!transactionDate && transaction.tanggal) {
        transactionDate = utils.parseDate(transaction.tanggal);
      }

      // Skip if no valid date
      if (!transactionDate || isNaN(transactionDate.getTime())) {
        console.warn("Skipping transaction with invalid date:", {
          id: transaction.id,
          timestamp: transaction.timestamp,
          tanggal: transaction.tanggal,
        });
        return false;
      }

      // Date filter
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

  // ✅ PERBAIKAN: Tambahkan method untuk remove duplicates
  removeDuplicates(data) {
    const seen = new Set();
    return data.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  }

  // Update URL parameters
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

    const newURL = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, "", newURL);
  }

  // Load filter state from URL
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

  // Update DataTable with filtered data
  updateDataTable() {
    const tableData = this.prepareTableData();
    if (this.dataTable) {
      this.dataTable.clear().rows.add(tableData).draw();
    }
  }

  // Prepare data for DataTable
  prepareTableData() {
    const tableData = [];

    // ✅ PERBAIKAN: Remove duplicates sebelum prepare data
    const uniqueFilteredData = this.removeDuplicates(this.filteredData);

    uniqueFilteredData.forEach((transaction) => {
      // ✅ PERBAIKAN: Handle timestamp dengan lebih robust
      let displayDate = "-";
      let displayTime = "-";

      if (transaction.timestamp) {
        if (typeof transaction.timestamp.toDate === "function") {
          try {
            displayDate = utils.formatDate(transaction.timestamp.toDate());
            displayTime = utils.formatTime(transaction.timestamp.toDate());
          } catch (error) {
            console.warn("Error formatting timestamp:", error);
            displayDate = utils.formatDate(transaction.tanggal) || "-";
          }
        } else if (transaction.timestamp instanceof Date) {
          displayDate = utils.formatDate(transaction.timestamp);
          displayTime = utils.formatTime(transaction.timestamp);
        } else if (
          transaction.timestamp &&
          typeof transaction.timestamp === "object" &&
          transaction.timestamp.seconds
        ) {
          const tempDate = new Date(transaction.timestamp.seconds * 1000);
          displayDate = utils.formatDate(tempDate);
          displayTime = utils.formatTime(tempDate);
        } else {
          const parsedDate = new Date(transaction.timestamp);
          displayDate = isNaN(parsedDate.getTime()) ? "-" : utils.formatDate(parsedDate);
          displayTime = isNaN(parsedDate.getTime()) ? "-" : utils.formatTime(parsedDate);
        }
      } else if (transaction.tanggal) {
        displayDate = utils.formatDate(transaction.tanggal);
      }

      const baseData = {
        date: displayDate,
        time: displayTime,
        sales: transaction.sales || "Admin",
        jenis: this.formatJenisPenjualan(transaction),
        status: this.getStatusBadge(transaction),
        actions: this.getActionButtons(transaction.id),
      };

      if (transaction.items?.length > 0) {
        // ✅ Group items by kode + nama + kadar
        const groupedItems = {};

        transaction.items.forEach((item) => {
          const key = `${item.kodeText || item.barcode || "-"}_${item.nama || "-"}_${item.kadar || "-"}`;

          if (!groupedItems[key]) {
            groupedItems[key] = {
              kode: item.kodeText || item.barcode || "-",
              nama: item.nama || "-",
              kadar: item.kadar || "-",
              jumlah: 0,
              berat: 0,
              totalHarga: 0,
              keterangan: item.keterangan || transaction.keterangan || "-",
            };
          }

          groupedItems[key].jumlah += item.jumlah || 1;
          groupedItems[key].berat += parseFloat(item.berat) || 0;
          groupedItems[key].totalHarga += item.totalHarga || 0;
        });

        // ✅ Push grouped items to table
        Object.values(groupedItems).forEach((groupedItem) => {
          tableData.push([
            baseData.date,
            baseData.time,
            baseData.sales,
            baseData.jenis,
            groupedItem.kode,
            groupedItem.nama,
            groupedItem.jumlah,
            groupedItem.berat > 0 ? `${groupedItem.berat.toFixed(2)} gr` : "-",
            groupedItem.kadar,
            `Rp ${utils.formatRupiah(groupedItem.totalHarga)}`,
            baseData.status,
            groupedItem.keterangan,
            baseData.actions,
          ]);
        });
      } else {
        tableData.push([
          baseData.date,
          baseData.time,
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

  // Format jenis penjualan
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

  // Get status badge HTML
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

  // Get action buttons HTML
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

  // Update summary cards
  updateSummary() {
    const totalTransaksi = this.filteredData.length;
    const totalPendapatan = this.calculateTotalRevenue(this.filteredData);

    document.getElementById("totalTransaksi").textContent = totalTransaksi;
    document.getElementById("totalPendapatan").textContent = `Rp ${utils.formatRupiah(totalPendapatan)}`;
  }

  // Calculate actual revenue
  calculateActualRevenue(transaction) {
    if (transaction.metodeBayar === "free" || transaction.statusPembayaran === "Free") {
      return 0;
    }

    if (
      transaction.jenisPenjualan === "manual" &&
      (transaction.metodeBayar === "dp" || transaction.statusPembayaran === "DP")
    ) {
      return transaction.sisaPembayaran || 0;
    }

    return transaction.totalHarga || 0;
  }

  // Calculate total revenue
  calculateTotalRevenue(transactions) {
    return transactions.reduce((total, transaction) => {
      return total + this.calculateActualRevenue(transaction);
    }, 0);
  }

  // Populate sales filter dropdown
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

  // Handle reprint action
  handleReprint(transactionId) {
    this.currentTransaction = this.salesData.find((t) => t.id === transactionId);
    if (!this.currentTransaction) {
      return utils.showAlert("Transaksi tidak ditemukan", "Error", "error");
    }
    $("#printModal").modal("show");
  }

  // Handle edit action
  handleEdit(transactionId) {
    this.currentTransaction = this.salesData.find((t) => t.id === transactionId);
    if (!this.currentTransaction) {
      return utils.showAlert("Transaksi tidak ditemukan", "Error", "error");
    }
    this.showEditModal();
  }

  // Handle delete action
  handleDelete(transactionId) {
    this.currentTransaction = this.salesData.find((t) => t.id === transactionId);
    if (!this.currentTransaction) {
      return utils.showAlert("Transaksi tidak ditemukan", "Error", "error");
    }
    this.showDeleteModal();
  }

  // Show edit modal
  showEditModal() {
    const transaction = this.currentTransaction;
    const jenisPenjualan = transaction.jenisPenjualan;

    const formHtml = this.generateEditForm(transaction, jenisPenjualan);
    document.getElementById("editModalBody").innerHTML = formHtml;

    this.attachEditFormEvents(transaction);
    $("#editModal").modal("show");
  }

  // Generate edit form HTML
  generateEditForm(transaction, jenisPenjualan) {
    // Format tanggal untuk input date dengan error handling
    let tanggalValue = new Date().toISOString().split("T")[0]; // Default hari ini
    try {
      if (transaction.timestamp) {
        let dateObj = null;
        if (typeof transaction.timestamp.toDate === "function") {
          dateObj = transaction.timestamp.toDate();
        } else if (transaction.timestamp.seconds) {
          dateObj = new Date(transaction.timestamp.seconds * 1000);
        } else if (transaction.timestamp instanceof Date) {
          dateObj = transaction.timestamp;
        } else {
          dateObj = new Date(transaction.timestamp);
        }
        if (dateObj && !isNaN(dateObj.getTime())) {
          tanggalValue = dateObj.toISOString().split("T")[0];
        }
      }
    } catch (e) {
      console.warn("Error parsing date for edit:", e);
    }

    let formHtml = `
      <div class="alert alert-warning mb-3">
        <i class="fas fa-exclamation-triangle me-2"></i>
        <strong>Perhatian:</strong> Kode barang dan jumlah tidak dapat diubah. Untuk mengubah stok, hapus transaksi ini dan buat transaksi baru.
      </div>
      <div class="row mb-3">
        <div class="col-md-6">
          <label for="editTanggal" class="form-label">Tanggal:</label>
          <input type="date" class="form-control" id="editTanggal" value="${tanggalValue}">
        </div>
        <div class="col-md-6">
          <label for="editSales" class="form-label">Sales:</label>
          <input type="text" class="form-control" id="editSales" value="${transaction.sales || ""}">
        </div>
      </div>
    `;

    if (transaction.items && transaction.items.length > 0) {
      formHtml += `<div class="mb-3"><label class="form-label">Detail Barang:</label></div>`;

      transaction.items.forEach((item, index) => {
        if (jenisPenjualan === "manual") {
          // Manual: Barcode, Kode Lock, Nama, Kadar, Berat, Harga, Keterangan
          formHtml += `
            <div class="border p-3 mb-3 rounded">
              <h6>Item ${index + 1}</h6>
              <div class="row">
                <div class="col-md-6">
                  <label for="editBarcode_${index}" class="form-label">Barcode: <span class="badge bg-secondary">Tidak dapat diubah</span></label>
                  <input type="text" class="form-control" id="editBarcode_${index}" value="${
                    item.kodeText || ""
                  }" readonly>
                </div>
                <div class="col-md-6">
                  <label for="editKodeLock_${index}" class="form-label">Kode Lock: <span class="badge bg-secondary">Tidak dapat diubah</span></label>
                  <input type="text" class="form-control" id="editKodeLock_${index}" value="${
                    item.kodeLock || "-"
                  }" readonly>
                </div>
              </div>
              <div class="row mt-2">
                <div class="col-md-6">
                  <label for="editNama_${index}" class="form-label">Nama Barang:</label>
                  <input type="text" class="form-control" id="editNama_${index}" value="${item.nama || ""}">
                </div>
                <div class="col-md-6">
                  <label for="editKadar_${index}" class="form-label">Kadar:</label>
                  <input type="text" class="form-control" id="editKadar_${index}" value="${item.kadar || ""}">
                </div>
              </div>
              <div class="row mt-2">
                <div class="col-md-6">
                  <label for="editBerat_${index}" class="form-label">Berat (gr):</label>
                  <input type="text" class="form-control" id="editBerat_${index}" value="${item.berat || ""}">
                </div>
                <div class="col-md-6">
                  <label for="editHarga_${index}" class="form-label">Harga:</label>
                  <input type="text" class="form-control" id="editHarga_${index}" value="${utils.formatRupiah(
                    item.totalHarga || 0,
                  )}">
                </div>
              </div>
              <div class="row mt-2">
                <div class="col-md-12">
                  <label for="editKeterangan_${index}" class="form-label">Keterangan:</label>
                  <textarea class="form-control" id="editKeterangan_${index}" rows="2">${
                    item.keterangan || ""
                  }</textarea>
                </div>
              </div>
            </div>
          `;
        } else {
          // Aksesoris & Kotak: Kode, Nama, Kadar, Berat, Harga
          formHtml += `
            <div class="border p-3 mb-3 rounded">
              <h6>Item ${index + 1} ${item.jumlah > 1 ? `(${item.jumlah} pcs)` : ""}</h6>
              <div class="row">
                <div class="col-md-6">
                  <label for="editKode_${index}" class="form-label">Kode: <span class="badge bg-secondary">Tidak dapat diubah</span></label>
                  <input type="text" class="form-control" id="editKode_${index}" value="${
                    item.kodeText || item.kode || ""
                  }" readonly>
                </div>
                <div class="col-md-6">
                  <label for="editNama_${index}" class="form-label">Nama Barang:</label>
                  <input type="text" class="form-control" id="editNama_${index}" value="${item.nama || ""}">
                </div>
              </div>
              ${
                jenisPenjualan !== "kotak"
                  ? `
              <div class="row mt-2">
                <div class="col-md-6">
                  <label for="editKadar_${index}" class="form-label">Kadar:</label>
                  <input type="text" class="form-control" id="editKadar_${index}" value="${item.kadar || ""}">
                </div>
                <div class="col-md-6">
                  <label for="editBerat_${index}" class="form-label">Berat (gr):</label>
                  <input type="text" class="form-control" id="editBerat_${index}" value="${item.berat || ""}">
                </div>
              </div>
              `
                  : ""
              }
              <div class="row mt-2">
                <div class="col-md-12">
                  <label for="editHarga_${index}" class="form-label">Harga:</label>
                  <input type="text" class="form-control" id="editHarga_${index}" value="${utils.formatRupiah(
                    item.totalHarga || 0,
                  )}">
                </div>
              </div>
            </div>
          `;
        }
      });
    }

    return formHtml;
  }

  // Attach edit form events
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

  // Save edit transaction
  async saveEditTransaction() {
    try {
      utils.showLoading(true);

      // Get tanggal dari input dan simpan tanggal original untuk perbandingan
      const tanggalInput = document.getElementById("editTanggal")?.value;
      const originalDate = this.getTransactionDate(this.currentTransaction);
      const newDate = tanggalInput ? new Date(tanggalInput) : originalDate;
      const newTimestamp = tanggalInput ? Timestamp.fromDate(newDate) : this.currentTransaction.timestamp;

      // ✅ TAMBAHAN: Detect perubahan tanggal
      const dateChanged = originalDate && newDate && !utils.isSameDate(originalDate, newDate);

      // ✅ TAMBAHAN: Konfirmasi jika tanggal berubah ke tanggal lebih awal
      if (dateChanged && newDate < originalDate) {
        const confirmed = await Swal.fire({
          title: "Perhatian",
          html: `
            <div class="text-start">
              <p>Tanggal akan diubah ke tanggal yang lebih awal:</p>
              <p><strong>Dari:</strong> ${utils.formatDate(originalDate)}</p>
              <p><strong>Ke:</strong> ${utils.formatDate(newDate)}</p>
              <p class="text-warning mt-3">
                <i class="fas fa-exclamation-triangle"></i>
                Transaksi stok akan dipindahkan ke tanggal baru.
              </p>
            </div>
          `,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Ya, Lanjutkan",
          cancelButtonText: "Batal",
          confirmButtonColor: "#0d6efd",
          cancelButtonColor: "#6c757d",
        });

        if (!confirmed.isConfirmed) {
          utils.showLoading(false);
          return;
        }
      }

      const updateData = {
        sales: document.getElementById("editSales").value.trim(),
        timestamp: newTimestamp,
        lastUpdated: serverTimestamp(),
      };

      if (this.currentTransaction.items && this.currentTransaction.items.length > 0) {
        updateData.items = this.currentTransaction.items.map((item, index) => {
          const updatedItem = { ...item };

          // ✅ OPSI B: Kode, kodeLock, jumlah TIDAK dapat diubah
          // Pertahankan nilai original untuk field yang mempengaruhi stok
          updatedItem.kodeText = item.kodeText;
          updatedItem.kode = item.kode || item.kodeText;
          updatedItem.kodeLock = item.kodeLock;
          updatedItem.jumlah = item.jumlah;

          // Allow edit: nama, kadar, berat, harga, keterangan
          updatedItem.nama = document.getElementById(`editNama_${index}`)?.value || item.nama;

          if (this.currentTransaction.jenisPenjualan === "manual") {
            updatedItem.kadar = document.getElementById(`editKadar_${index}`)?.value || item.kadar;
            updatedItem.berat = document.getElementById(`editBerat_${index}`)?.value || item.berat;
            updatedItem.keterangan = document.getElementById(`editKeterangan_${index}`)?.value || item.keterangan;
          } else if (this.currentTransaction.jenisPenjualan !== "kotak") {
            updatedItem.kadar = document.getElementById(`editKadar_${index}`)?.value || item.kadar;
            updatedItem.berat = document.getElementById(`editBerat_${index}`)?.value || item.berat;
          }

          const hargaValue = document.getElementById(`editHarga_${index}`)?.value.replace(/\./g, "") || "0";
          updatedItem.totalHarga = parseInt(hargaValue);

          return updatedItem;
        });

        updateData.totalHarga = updateData.items.reduce((sum, item) => sum + (item.totalHarga || 0), 0);
      }

      // Update in Firestore
      await updateDoc(doc(firestore, "penjualanAksesoris", this.currentTransaction.id), updateData);

      // ✅ TAMBAHAN: Sync timestamp ke stokAksesorisTransaksi jika tanggal berubah
      if (dateChanged) {
        try {
          const updatedCount = await this.updateStockTransactionTimestamp(
            this.currentTransaction,
            originalDate,
            newTimestamp,
          );
          console.log(`📅 Timestamp synced to ${updatedCount} stock transactions`);
        } catch (error) {
          console.warn("⚠️ Failed to sync stock transaction timestamp:", error);
          // Continue with success message, tapi warn user
          await utils.showAlert(
            `Transaksi penjualan berhasil diperbarui, tetapi ada masalah saat sinkronisasi tanggal stok: ${error.message}`,
            "Peringatan",
            "warning",
          );
        }
      }

      // Update local data and cache (real-time listener akan sync ke browser lain)
      this.updateLocalData(this.currentTransaction.id, updateData, dateChanged);

      $("#editModal").modal("hide");
      utils.showAlert("Transaksi berhasil diperbarui", "Sukses", "success");
    } catch (error) {
      console.error("Error updating transaction:", error);
      utils.showAlert("Terjadi kesalahan saat memperbarui transaksi: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // Update local data
  updateLocalData(transactionId, updateData, dateChanged = false) {
    // Deep copy updateData untuk nested objects
    const deepUpdateData = JSON.parse(JSON.stringify(updateData));
    delete deepUpdateData.lastUpdated;

    // Convert timestamp ke format yang bisa di-filter
    if (deepUpdateData.timestamp && deepUpdateData.timestamp.seconds) {
      // Sudah dalam format {seconds, nanoseconds} - OK
    } else if (updateData.timestamp && typeof updateData.timestamp.toDate === "function") {
      // Convert Firestore Timestamp ke object
      const date = updateData.timestamp.toDate();
      deepUpdateData.timestamp = { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 };
    }

    // Update salesData dengan deep copy
    const salesIndex = this.salesData.findIndex((item) => item.id === transactionId);
    if (salesIndex !== -1) {
      const currentData = JSON.parse(JSON.stringify(this.salesData[salesIndex]));
      this.salesData[salesIndex] = { ...currentData, ...deepUpdateData };
    }

    // Update cache
    cacheManager.updateTransaction(transactionId, deepUpdateData);

    // ✅ OPSI B: Simpan cache ke localStorage agar persist
    cacheManager.saveToStorage();

    // Force re-filter untuk refresh tampilan dengan data terbaru
    this.filterData();

    // Jika tanggal berubah, tampilkan notifikasi
    if (dateChanged) {
      console.log("📅 Tanggal transaksi berubah, cache updated tanpa reload Firestore");
    }
  }

  // Show delete modal with restore info
  showDeleteModal() {
    const transaction = this.currentTransaction;
    const date = utils.formatDate(transaction.timestamp || transaction.tanggal);
    const restoreableItems = this.getRestoreableItems(transaction);

    document.getElementById("deleteTransactionInfo").innerHTML = `
      <div class="text-start">
        <p><strong>Tanggal:</strong> ${date}</p>
        <p><strong>Sales:</strong> ${transaction.sales || "Admin"}</p>
        <p><strong>Total Harga:</strong> Rp ${utils.formatRupiah(transaction.totalHarga || 0)}</p>
        ${transaction.items ? `<p><strong>Jumlah Item:</strong> ${transaction.items.length}</p>` : ""}
      </div>
    `;

    // Show restore info
    const restoreInfoDiv = document.getElementById("restoreInfo");
    if (restoreInfoDiv) {
      if (restoreableItems.length > 0) {
        restoreInfoDiv.innerHTML = `
          <div class="alert alert-success">
            <i class="fas fa-check-circle me-2"></i>
            <strong>${restoreableItems.length} item</strong> akan dikembalikan ke stok
          </div>
        `;
      } else {
        restoreInfoDiv.innerHTML = `
          <div class="alert alert-info">
            <i class="fas fa-info-circle me-2"></i>
            Stok tidak dapat dikembalikan (penjualan manual tanpa kode lock)
          </div>
        `;
      }
    }

    // Clear password
    const passwordInput = document.getElementById("deleteVerificationPassword");
    if (passwordInput) passwordInput.value = "";

    $("#deleteModal").modal("show");
  }

  // Get items yang bisa di-restore
  getRestoreableItems(transaction) {
    if (["aksesoris", "kotak", "silver"].includes(transaction.jenisPenjualan)) {
      return transaction.items || [];
    }

    if (transaction.jenisPenjualan === "manual") {
      return (transaction.items || []).filter((item) => item.kodeLock && item.kodeLock !== "-");
    }

    return [];
  }

  // Confirm delete with password verification
  async confirmDeleteTransaction() {
    const password = document.getElementById("deleteVerificationPassword").value;

    if (!password) {
      return utils.showAlert("Masukkan kata sandi verifikasi terlebih dahulu", "Peringatan", "warning");
    }

    if (password !== VERIFICATION_PASSWORD) {
      return utils.showAlert("Kata sandi verifikasi salah", "Error", "error");
    }

    await this.deleteTransaction();
  }

  // Smart deletion: auto-restore stock if possible
  async deleteTransaction() {
    try {
      utils.showLoading(true);
      const transaction = this.currentTransaction;

      console.log("🗑️ Deleting transaction:", transaction.id);

      // Step 1: Remove stock transactions & restore stock (if possible)
      let restoredCount = 0;
      if (transaction.items?.length > 0) {
        restoredCount = await this.removeStockTransactions(transaction);
      }

      // Step 2: Delete sales transaction
      await deleteDoc(doc(firestore, "penjualanAksesoris", transaction.id));

      // Step 3: Update local data
      this.salesData = this.salesData.filter((item) => item.id !== transaction.id);
      this.filteredData = this.filteredData.filter((item) => item.id !== transaction.id);
      cacheManager.removeTransaction(transaction.id);

      this.updateDataTable();
      this.updateSummary();
      $("#deleteModal").modal("hide");

      // Show appropriate message
      const message =
        restoredCount > 0
          ? `Penjualan berhasil dihapus dan ${restoredCount} stok dikembalikan`
          : "Penjualan berhasil dihapus (stok tidak dapat dikembalikan)";

      utils.showAlert(message, "Sukses", "success");
    } catch (error) {
      console.error("❌ Error deleting transaction:", error);
      utils.showAlert("Terjadi kesalahan: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // Helper function untuk remove stock transactions & restore stock
  async removeStockTransactions(transaction) {
    try {
      let removedCount = 0;

      let transactionDate = this.getTransactionDate(transaction);
      if (!transactionDate) {
        throw new Error("Invalid transaction date");
      }

      const startOfDay = new Date(transactionDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(transactionDate);
      endOfDay.setHours(23, 59, 59, 999);

      console.log(`🔍 Processing cancellation for: ${transactionDate.toDateString()}`);

      // ✅ Enhanced logging untuk debugging
      console.log(`📊 Transaction Analysis:`, {
        id: transaction.id,
        jenis: transaction.jenisPenjualan,
        isGantiLock: transaction.isGantiLock,
        itemCount: transaction.items.length,
        items: transaction.items.map((item) => ({
          nama: item.nama,
          kodeText: item.kodeText,
          kodeLock: item.kodeLock,
          hasValidLock: !!(item.kodeLock && item.kodeLock !== "-"),
        })),
      });

      // ✅ Deteksi apakah ini penjualan manual
      const isManualSale =
        transaction.jenisPenjualan === "manual" ||
        transaction.isGantiLock ||
        transaction.jenisPenjualan === "gantiLock";

      for (const item of transaction.items) {
        let kodeToSearch, jenisToSearch;

        if (isManualSale) {
          // ✅ Penjualan Manual - cek apakah ada kodeLock

          if (!item.kodeLock || item.kodeLock === "-") {
            // ❌ MANUAL TANPA KODE LOCK - skip (tidak perlu restore)
            console.log(`⏭️ Manual sale without kodeLock, no stock restore needed:`, {
              nama: item.nama,
              kodeText: item.kodeText,
              kodeLock: item.kodeLock,
            });
            continue;
          }

          // ✅ MANUAL DENGAN KODE LOCK - restore stok lock
          kodeToSearch = item.kodeLock;
          jenisToSearch = "gantiLock"; // ✅ CRITICAL FIX: konsisten dengan save (camelCase)
        } else {
          // ✅ PENJUALAN NORMAL (aksesoris/kotak/silver)

          kodeToSearch = item.kodeText || item.barcode;

          if (!kodeToSearch || kodeToSearch === "-") {
            console.warn(`⚠️ No valid kode for normal sale, skipping:`, item);
            continue;
          }

          jenisToSearch =
            transaction.statusPembayaran === "Free" || transaction.metodeBayar === "free" ? "free" : "laku";
        }

        console.log(`🔄 Processing: ${kodeToSearch} (${jenisToSearch})`);

        try {
          // STEP 1: Cari dan hapus stock transaction
          const stockQuery = query(
            collection(firestore, "stokAksesorisTransaksi"),
            where("kode", "==", kodeToSearch),
            where("jenis", "==", jenisToSearch),
            where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
            where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
            limit(1),
          );

          const stockSnapshot = await getDocs(stockQuery);

          if (stockSnapshot.size > 0) {
            const stockDoc = stockSnapshot.docs[0];

            // Hapus dari stokAksesorisTransaksi
            await deleteDoc(doc(firestore, "stokAksesorisTransaksi", stockDoc.id));

            // ✅ Tidak perlu restore stok ke stokAksesoris
            // Stok dihitung dari stokAksesorisTransaksi (Single Source of Truth)

            removedCount++;
            console.log(`✅ ${jenisToSearch} cancelled: ${kodeToSearch} (stock auto-recalculated)`);
          } else {
            console.warn(`⚠️ No stock transaction found: ${kodeToSearch} (${jenisToSearch})`);
          }
        } catch (error) {
          console.error(`❌ Error processing ${kodeToSearch}:`, error);
        }
      }

      console.log(`✅ Total cancelled: ${removedCount} items with stock restored`);
      return removedCount;
    } catch (error) {
      console.error("❌ Error in removeStockTransactions:", error);
      throw error;
    }
  }

  // ✅ restoreStockQuantity DIHAPUS
  // Stok sekarang dihitung dari stokAksesorisTransaksi (Single Source of Truth)
  // Tidak perlu update manual ke stokAksesoris.stokAkhir

  // ✅ TAMBAHAN: Helper function untuk get transaction date
  getTransactionDate(transaction) {
    try {
      if (transaction.timestamp && typeof transaction.timestamp.toDate === "function") {
        return transaction.timestamp.toDate();
      } else if (transaction.timestamp instanceof Date) {
        return transaction.timestamp;
      } else if (transaction.timestamp && typeof transaction.timestamp === "object" && transaction.timestamp.seconds) {
        return new Date(transaction.timestamp.seconds * 1000);
      } else if (transaction.tanggal) {
        return utils.parseDate(transaction.tanggal);
      }
      return new Date(); // fallback
    } catch (error) {
      console.error("Error parsing transaction date:", error);
      return null;
    }
  }

  // Print document (receipt or invoice)
  printDocument(type) {
    if (!this.currentTransaction) {
      return utils.showAlert("Tidak ada data transaksi untuk dicetak!");
    }

    const transaction = this.currentTransaction;

    // Khusus invoice dengan >1 item: cetak per item satu-satu via iframe (anti duplikat)
    if (type === "invoice" && transaction && Array.isArray(transaction.items) && transaction.items.length > 1) {
      try {
        $("#printModal").modal("hide");
      } catch (_) {}
      return this.printInvoicePerItem(transaction);
    }

    // Fallback: gunakan window.open untuk struk atau invoice biasa (single)
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      return utils.showAlert("Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.", "Error", "error");
    }
    const html = type === "receipt" ? this.generateReceiptHTML(transaction) : this.generateInvoiceHTML(transaction);
    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Generate receipt HTML
  generateReceiptHTML(transaction) {
    const tanggal = utils.formatDate(transaction.timestamp || transaction.tanggal);
    let salesType = transaction.jenisPenjualan || "aksesoris";
    if (salesType === "manual") salesType = "manual";

    let receiptHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Struk Kasir</title>
      <style>
        body { font-family: consolas; font-size: 12px; margin: 0; padding: 0; width: 80mm;}
        .receipt { margin: 0 auto; padding: 5mm; }
        .receipt h3, .receipt h4 { text-align: center; margin: 2mm 0; }
        .receipt hr { border-top: 1px dashed #000; }
        .receipt table { width: 100%; border-collapse: collapse; }
        .receipt th, .receipt td { text-align: left; padding: 1mm 2mm; }
        .info-header { display: flex; justify-content: space-between; margin: 2mm 0; font-size: 11px; padding: 0; }
        .nama-barang { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 2mm 0; margin: 0; }
        .detail-barang { display: flex; justify-content: space-between; font-size: 11px; padding: 1mm 0; margin: 0 0 2mm 0; }
        .item-separator { border-bottom: 1px dotted #888; padding-bottom: 2mm; margin-bottom: 2mm; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .keterangan { font-style: italic; font-size: 14px; margin-top: 2mm; border-top: 1px dotted #000; padding-top: 2mm; }
        .payment-info { margin-top: 2mm; border-top: 1px dotted #000; padding-top: 2mm; }
      </style>
    </head>
    <body>
      <div class="receipt d-flex justify-content-center">
        <h3>MELATI 3</h3>
        <h4>JL. DIPONEGORO NO. 116</h4>
        <h4>NOTA PENJUALAN ${salesType.toUpperCase()}</h4>
        <hr>
        <div class="info-header">
          <span>Tanggal: ${tanggal}</span>
          <span>Sales: ${transaction.sales || "-"}</span>
        </div>
        <hr>
        <div>
  `;

    let hasKeterangan = false;
    let keteranganText = "";

    transaction.items?.forEach((item, index) => {
      const itemHarga = parseInt(item.totalHarga || 0);
      const isLastItem = index === transaction.items.length - 1;
      const separatorClass = !isLastItem ? " item-separator" : "";

      receiptHTML += `
      <div class="${separatorClass}">
        <div class="nama-barang">${item.nama || "-"}</div>
        <div class="detail-barang">
          <span>${item.kodeText || "-"}</span>
          <span>${item.kadar || "-"}</span>
          <span>${item.berat || "-"} gr</span>
          <span>${utils.formatRupiah(itemHarga)}</span>
        </div>
      </div>
    `;

      if (item.keterangan && item.keterangan.trim() !== "") {
        hasKeterangan = true;
        keteranganText += item.keterangan + " ";
      }
    });

    const totalHarga = parseInt(transaction.totalHarga || 0);
    receiptHTML += `
        </div>
        <hr>
        <table style="width: 100%; margin-top: 2mm;">
          <tr style="border-top: 2px solid #000;">
            <td style="text-align: right; padding-right: 2mm;"><strong>Total:</strong></td>
            <td style="text-align: right;"><strong>${utils.formatRupiah(totalHarga)}</strong></td>
          </tr>
        </table>
  `;

    // PERBAIKAN: Add DP information dengan logika yang benar
    if (transaction.metodeBayar === "dp" || transaction.statusPembayaran === "DP") {
      const dpAmount = parseInt(transaction.nominalDP || 0);

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
    `;

      // PERBAIKAN: Logika untuk menampilkan SISA atau KEMBALIAN
      if (dpAmount >= totalHarga) {
        // Jika DP >= total, tampilkan kembalian (jika ada)
        if (dpAmount > totalHarga) {
          const kembalian = dpAmount - totalHarga;
          receiptHTML += `
          <tr>
            <td><strong>KEMBALIAN:</strong></td>
            <td class="text-right"><strong>${utils.formatRupiah(kembalian)}</strong></td>
          </tr>
        `;
        } else {
          // Jika DP = total, tampilkan LUNAS
          receiptHTML += `
          <tr>
            <td colspan="2" class="text-center"><strong>LUNAS</strong></td>
          </tr>
        `;
        }
      } else {
        // Jika DP < total, tampilkan sisa pembayaran
        const remainingAmount = parseInt(transaction.sisaPembayaran || 0);
        receiptHTML += `
        <tr>
          <td><strong>SISA:</strong></td>
          <td class="text-right"><strong>${utils.formatRupiah(remainingAmount)}</strong></td>
        </tr>
      `;
      }

      receiptHTML += `
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

  // Generate invoice HTML
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
        .invoice { width: 100%; position: relative; min-height: 19cm; }
        .header-info { text-align: left; margin-bottom: 0.5cm; margin-left: 14.3cm; margin-top: 0.8cm; }
        .customer-info { text-align: left; margin-bottom: 1.1cm; margin-left: 14.3cm; font-size: 11px; line-height: 1.2; }
        .total-row { position: absolute; top: 6.3cm; right: 3cm; text-align: right; font-weight: bold; }
        .sales { position: absolute; top: 7.2cm; right: 1.6cm; text-align: right; }
        .keterangan { position: absolute; top: 5cm; left: 0.5cm; right: 3cm; font-style: italic; font-size: 10px; padding-top: 2mm; text-align: left; }
        .keterangan-spacer { height: 0; }
        .item-details { display: flex; flex-wrap: wrap; }
        .item-data { display: grid; grid-template-columns: 2cm 2.8cm 4.7cm 1.8cm 1.8cm 2cm; width: 100%; column-gap: 0.2cm; margin-left: 0.5cm; margin-top: 1.1cm; margin-right: 3cm; }
        .item-data span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .item-data span:nth-child(3) { white-space: normal; overflow: visible; text-overflow: clip; word-wrap: break-word; }
      </style>
    </head>
    <body>
      <div class="invoice">
        <div class="header-info">
          <p>${tanggal}</p>
        </div>
        <div class="customer-info">
          <div>${transaction.customerName || "-"}</div>
          <div>${transaction.customerPhone || ""}</div>
        </div>
  `;

    let hasKeterangan = false;
    let keteranganText = "";
    let totalHarga = 0;

    // Loop untuk menampilkan semua item-data
    transaction.items?.forEach((item) => {
      const itemHarga = parseInt(item.totalHarga || 0);
      totalHarga += itemHarga;

      invoiceHTML += `
      <div class="item-details">
        <div class="item-data">
          <span>${item.kodeText || "-"}</span>
          <span>${item.jumlah || " "}pcs</span>
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

    // Tampilkan keterangan atau spacer
    if (hasKeterangan && transaction.jenisPenjualan === "manual") {
      invoiceHTML += `
      <div class="keterangan">
        <strong>Keterangan:</strong><br>
        ${keteranganText.trim()}
      </div>
    `;
    } else {
      invoiceHTML += `<div class="keterangan-spacer"></div>`;
    }

    // Tampilkan total dan sales
    invoiceHTML += `
      <div class="total-row">
        Rp ${utils.formatRupiah(totalHarga)}
      </div>
      <div class="sales">${transaction.sales || "-"}</div>
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

  // Cetak invoice per item (khusus penjualan manual > 1 item)
  printInvoicePerItem(transaction) {
    if (!transaction?.items || transaction.items.length === 0) {
      return utils.showAlert("Tidak ada item untuk dicetak.", "Info", "info");
    }

    // Open single print window
    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      return utils.showAlert("Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.", "Error", "error");
    }

    const tanggal = utils.formatDate(transaction.timestamp || transaction.tanggal);

    // Build combined HTML with all invoices
    let combinedHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice Customer (${transaction.items.length} items)</title>
        <style>
          @page { 
            size: 10cm 20cm; 
            margin: 0; 
          }
          @media print {
            .invoice-page { 
              page-break-after: always;
              page-break-inside: avoid;
              break-after: page;
              break-inside: avoid;
            }
            .invoice-page:last-child { 
              page-break-after: auto;
              break-after: auto;
            }
          }
          body { 
            font-family: Arial, sans-serif; 
            font-size: 12px; 
            margin: 0; 
            padding: 0; 
          }
          .invoice-page { 
            width: 20cm; 
            min-height: 19cm; 
            height: 19cm;
            padding: 5mm; 
            box-sizing: border-box;
            position: relative;
            display: block;
          }
          .invoice { width: 100%; position: relative; min-height: 19cm; }
          .header-info { text-align: left; margin-bottom: 0.5cm; margin-left: 14.3cm; margin-top: 0.8cm; }
          .customer-info { text-align: left; margin-bottom: 1.1cm; margin-left: 14.3cm; font-size: 11px; line-height: 1.2; }
          .total-row { position: absolute; top: 6.3cm; right: 3cm; text-align: right; font-weight: bold; }
          .sales { position: absolute; top: 7.2cm; right: 1.6cm; text-align: right; }
          .item-details { display: flex; flex-wrap: wrap; }
          .item-data { display: grid; grid-template-columns: 2cm 2.8cm 4.7cm 1.8cm 1.8cm 2cm; width: 100%; column-gap: 0.2cm; margin-left: 0.5cm; margin-top: 1.1cm; margin-right: 3cm; }
          .item-data span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .item-data span:nth-child(3) { white-space: normal; overflow: visible; text-overflow: clip; word-wrap: break-word; }
          .keterangan { position: absolute; top: 5cm; left: 0.5cm; right: 3cm; font-style: italic; font-size: 10px; padding-top: 2mm; text-align: left; }
          .keterangan-spacer { height: 0; }
        </style>
      </head>
      <body>
    `;

    // Generate invoice HTML for each item
    transaction.items.forEach((item) => {
      const itemHarga = parseInt(item?.totalHarga || 0);
      const keteranganText =
        transaction.jenisPenjualan === "manual" && item?.keterangan && item.keterangan.trim() !== ""
          ? `<div class="keterangan"><strong>Keterangan:</strong><br>${item.keterangan.trim()}</div>`
          : `<div class="keterangan-spacer"></div>`;

      combinedHTML += `
        <div class="invoice-page">
          <div class="invoice">
            <div class="header-info"><p>${tanggal}</p></div>
            <div class="customer-info">
              <div>${transaction.customerName || "-"}</div>
              <div>${transaction.customerPhone || ""}</div>
            </div>

            <div class="item-details">
              <div class="item-data">
                <span>${item?.kodeText || "-"}</span>
                <span>${item?.jumlah || " "}pcs</span>
                <span>${item?.nama || "-"}</span>
                <span>${item?.kadar || "-"}</span>
                <span>${item?.berat || "-"}gr</span>
                <span>${utils.formatRupiah(itemHarga)}</span>
              </div>
            </div>
            ${keteranganText}
            <div class="total-row">Rp ${utils.formatRupiah(itemHarga)}</div>
            <div class="sales">${transaction.sales || "-"}</div>
          </div>
        </div>
      `;
    });

    // Close HTML and add print script
    combinedHTML += `
        <script>
          window.onload = function() {
            // Wait for all content to fully render before printing
            setTimeout(function() {
              window.print();
              // Close window after print dialog is dismissed (longer delay)
              setTimeout(function() { 
                window.close(); 
              }, 1000);
            }, 300);
          };
          
          // Fallback: close on afterprint event
          window.onafterprint = function() {
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
      </html>
    `;

    // Write to print window
    printWindow.document.write(combinedHTML);
    printWindow.document.close();
  }

  // Refresh data manually
  async refreshData() {
    try {
      utils.showLoading(true);

      // Clear cache and reload from Firestore
      cacheManager.clear();
      await this.loadSalesDataFromFirestore();

      this.populateSalesFilter();
      this.filterData();

      utils.showAlert("Data berhasil diperbarui", "Sukses", "success");
    } catch (error) {
      console.error("Error refreshing data:", error);
      utils.showAlert("Gagal memperbarui data: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // Load older data when needed
  async loadOlderData() {
    try {
      const oldestTransaction = this.salesData[this.salesData.length - 1];
      if (!oldestTransaction) return;

      const olderQuery = query(
        collection(firestore, "penjualanAksesoris"),
        where("timestamp", "<", oldestTransaction.timestamp),
        orderBy("timestamp", "desc"),
        limit(50),
      );

      const olderSnapshot = await getDocs(olderQuery);
      const olderData = olderSnapshot.docs.map((doc) => {
        const data = doc.data();
        if (data.jenisPenjualan === "gantiLock") {
          data.jenisPenjualan = "manual";
          data.isGantiLock = true;
        }
        return { id: doc.id, ...data };
      });

      if (olderData.length > 0) {
        this.salesData.push(...olderData);
        cacheManager.set("salesData", this.salesData);
        console.log(`📥 Loaded ${olderData.length} older transactions`);
      }

      return olderData.length;
    } catch (error) {
      console.error("Error loading older data:", error);
      return 0;
    }
  }

  // Cleanup method
  destroy() {
    console.log("🧹 Destroying Optimized Data Penjualan");

    // Remove real-time listener
    this.removeTodayListener();

    // ✅ PERBAIKAN: Remove inactivity listeners
    this.removeInactivityListeners();

    // Destroy DataTable
    if (this.dataTable) {
      this.dataTable.off();
      this.dataTable.destroy();
      this.dataTable = null;
    }

    // Clear data
    this.salesData = [];
    this.filteredData = [];
    this.currentTransaction = null;
    this.isLoading = false;
    this.isListeningToday = false;
    this.currentSelectedDate = null;

    console.log("✅ Optimized Data Penjualan destroyed");
  }
}

// Initialize application when DOM is ready
$(document).ready(async function () {
  try {
    // Check dependencies
    if (typeof firestore === "undefined") {
      throw new Error("Firebase Firestore not initialized");
    }

    if (typeof $ === "undefined") {
      throw new Error("jQuery not loaded");
    }

    // Initialize the optimized application
    const app = new OptimizedDataPenjualanApp();
    await app.init();

    // Make app globally available for debugging
    window.dataPenjualanApp = app;

    console.log("✅ Optimized Data Penjualan System initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Optimized Data Penjualan System:", error);
    utils.showAlert("Gagal menginisialisasi aplikasi: " + error.message, "Error", "error");
  }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (window.dataPenjualanApp) {
    window.dataPenjualanApp.destroy();
  }
});

// Cross-tab communication for cache synchronization
window.addEventListener("storage", (e) => {
  if (e.key === "optimizedSalesCache" && window.dataPenjualanApp) {
    // Reload cache when updated from another tab
    cacheManager.loadFromStorage();
    window.dataPenjualanApp.salesData = cacheManager.get("salesData") || [];
    window.dataPenjualanApp.filterData();
    console.log("🔄 Cache synchronized from another tab");
  }
});

// Export for potential use in other modules
export default OptimizedDataPenjualanApp;

console.log("📊 Optimized Data Penjualan Module loaded successfully");
