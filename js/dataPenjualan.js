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
        salesData[index] = { ...salesData[index], ...updatedData };
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
      const today = new Date();
      const isToday = utils.isSameDate(this.currentSelectedDate, today);

      if (isToday && !this.isListeningToday) {
        this.setupTodayListener();
        this.isListeningToday = true;
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

    if (this.realtimeListener && this.isListeningToday) {
      this.removeTodayListener();
      this.isListeningToday = false;
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
        orderBy("timestamp", "desc")
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

  // Setup real-time listener for today's data
  setupRealtimeListener(selectedDate) {
    const today = new Date();
    const isToday = utils.isSameDate(selectedDate, today);

    // ✅ PERBAIKAN: Cek user activity sebelum setup listener
    if (isToday && !this.isListeningToday && this.isUserActive) {
      this.setupTodayListener();
      this.isListeningToday = true;
      console.log("📡 Real-time listener activated for today");
    } else if (!isToday && this.isListeningToday) {
      this.removeTodayListener();
      this.isListeningToday = false;
      console.log("🔇 Real-time listener deactivated");
    }
    // ✅ PERBAIKAN: Jika user tidak aktif tapi tanggal hari ini, tampilkan info
    else if (isToday && !this.isUserActive) {
      console.log("⏸️ Real-time listener not activated due to user inactivity");
    }
  }

  // Setup today's real-time listener
  setupTodayListener() {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const todayQuery = query(
      collection(firestore, "penjualanAksesoris"),
      where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
      where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
      orderBy("timestamp", "desc")
    );

    this.realtimeListener = onSnapshot(
      todayQuery,
      (snapshot) => {
        if (!snapshot.metadata.hasPendingWrites) {
          this.handleRealtimeUpdate(snapshot);
        }
      },
      (error) => {
        console.error("Real-time listener error:", error);
      }
    );
  }

  // Remove today's listener
  removeTodayListener() {
    if (this.realtimeListener) {
      this.realtimeListener();
      this.realtimeListener = null;
    }
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

    // ✅ TAMBAHAN: Event listeners untuk delete options
    const btnHapusPenjualan = document.getElementById("btnHapusPenjualan");
    const btnBatalPenjualan = document.getElementById("btnBatalPenjualan");
    const btnConfirmAction = document.getElementById("btnConfirmAction");
    const btnBackToOptions = document.getElementById("btnBackToOptions");

    if (btnHapusPenjualan) {
      btnHapusPenjualan.addEventListener("click", () => this.showPasswordSection("hapus"));
    }

    if (btnBatalPenjualan) {
      btnBatalPenjualan.addEventListener("click", () => this.showPasswordSection("batal"));
    }

    if (btnConfirmAction) {
      btnConfirmAction.addEventListener("click", () => this.executeDeleteAction());
    }

    if (btnBackToOptions) {
      btnBackToOptions.addEventListener("click", () => this.showDeleteOptions());
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
        { targets: "_all", className: "text-nowrap" },
        { targets: [10], className: "text-wrap" },
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

      if (transaction.timestamp) {
        if (typeof transaction.timestamp.toDate === "function") {
          try {
            displayDate = utils.formatDate(transaction.timestamp.toDate());
          } catch (error) {
            console.warn("Error formatting timestamp:", error);
            displayDate = utils.formatDate(transaction.tanggal) || "-";
          }
        } else if (transaction.timestamp instanceof Date) {
          displayDate = utils.formatDate(transaction.timestamp);
        } else if (
          transaction.timestamp &&
          typeof transaction.timestamp === "object" &&
          transaction.timestamp.seconds
        ) {
          displayDate = utils.formatDate(new Date(transaction.timestamp.seconds * 1000));
        } else {
          const parsedDate = new Date(transaction.timestamp);
          displayDate = isNaN(parsedDate.getTime()) ? "-" : utils.formatDate(parsedDate);
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

      // Update local data and cache
      this.updateLocalData(this.currentTransaction.id, updateData);

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

    // Update cache
    cacheManager.updateTransaction(transactionId, updateData);

    // Re-render table
    this.updateDataTable();
    this.updateSummary();
  }

  // Show delete modal
  showDeleteModal() {
    const transaction = this.currentTransaction;
    const date = utils.formatDate(transaction.timestamp || transaction.tanggal);

    document.getElementById("deleteTransactionInfo").innerHTML = `
      <div class="text-start">
        <p><strong>Tanggal:</strong> ${date}</p>
        <p><strong>Sales:</strong> ${transaction.sales || "Admin"}</p>
        <p><strong>Total Harga:</strong> Rp ${utils.formatRupiah(transaction.totalHarga || 0)}</p>
        ${transaction.items ? `<p><strong>Jumlah Item:</strong> ${transaction.items.length}</p>` : ""}
      </div>
    `;

    // Reset modal state
    this.showDeleteOptions();

    $("#deleteModal").modal("show");
  }

  // ✅ TAMBAHAN: Helper functions untuk manage modal state
  showDeleteOptions() {
    // Show options, hide password section
    document.getElementById("passwordSection").style.display = "none";
    document.getElementById("modalFooter").style.display = "block";

    // Reset password
    const passwordInput = document.getElementById("deleteVerificationPassword");
    if (passwordInput) passwordInput.value = "";

    // Reset action type
    this.currentDeleteAction = null;
  }

  showPasswordSection(actionType) {
    // Hide options, show password section
    document.getElementById("passwordSection").style.display = "block";
    document.getElementById("modalFooter").style.display = "none";

    // Set action type
    this.currentDeleteAction = actionType;

    // Update confirmation button text
    const confirmBtn = document.getElementById("btnConfirmAction");
    if (confirmBtn) {
      if (actionType === "hapus") {
        confirmBtn.innerHTML = '<i class="fas fa-trash me-2"></i> Konfirmasi Hapus Penjualan';
        confirmBtn.className = "btn btn-success";
      } else {
        confirmBtn.innerHTML = '<i class="fas fa-undo me-2"></i>Konfirmasi Batal Penjualan';
        confirmBtn.className = "btn btn-success";
      }
    }

    // Focus on password input
    setTimeout(() => {
      document.getElementById("deleteVerificationPassword").focus();
    }, 100);
  }

  async executeDeleteAction() {
    const password = document.getElementById("deleteVerificationPassword").value;

    if (!password) {
      return utils.showAlert("Masukkan kata sandi verifikasi terlebih dahulu.", "Peringatan", "warning");
    }

    if (password !== VERIFICATION_PASSWORD) {
      return utils.showAlert("Kata sandi verifikasi salah.", "Error", "error");
    }

    if (this.currentDeleteAction === "hapus") {
      await this.deleteTransaction();
    } else if (this.currentDeleteAction === "batal") {
      await this.cancelTransaction();
    }
  }

  // Confirm delete transaction
  async deleteTransaction() {
    try {
      utils.showLoading(true);

      // Hapus dari Firestore (logic existing)
      await deleteDoc(doc(firestore, "penjualanAksesoris", this.currentTransaction.id));

      // Update local data (logic existing)
      this.salesData = this.salesData.filter((item) => item.id !== this.currentTransaction.id);
      this.filteredData = this.filteredData.filter((item) => item.id !== this.currentTransaction.id);

      // Update cache
      cacheManager.removeTransaction(this.currentTransaction.id);

      this.updateDataTable();
      this.updateSummary();

      $("#deleteModal").modal("hide");
      utils.showAlert("Penjualan berhasil dihapus", "Sukses", "success");
    } catch (error) {
      console.error("Error deleting transaction:", error);
      utils.showAlert("Terjadi kesalahan saat menghapus penjualan: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // ✅ GANTI: Function cancelTransaction() yang ada dengan versi sederhana
  async cancelTransaction() {
    try {
      utils.showLoading(true);

      const transaction = this.currentTransaction;
      console.log("🔄 Cancelling transaction:", transaction.id);

      // Step 1: Delete sales transaction
      await deleteDoc(doc(firestore, "penjualanAksesoris", transaction.id));

      // Step 2: Remove stock transactions & restore stock
      let restoredCount = 0;
      if (transaction.items?.length > 0) {
        restoredCount = await this.removeStockTransactions(transaction);
      }

      // Step 3: Update local data
      this.salesData = this.salesData.filter((item) => item.id !== transaction.id);
      this.filteredData = this.filteredData.filter((item) => item.id !== transaction.id);
      cacheManager.removeTransaction(transaction.id);

      this.updateDataTable();
      this.updateSummary();
      $("#deleteModal").modal("hide");

      // ✅ PESAN SUKSES SEDERHANA
      const message =
        restoredCount > 0
          ? `Transaksi berhasil dibatalkan dan ${restoredCount} stok dikembalikan`
          : "Transaksi berhasil dibatalkan";

      utils.showAlert(message, "Sukses", "success");
    } catch (error) {
      console.error("❌ Error canceling transaction:", error);
      utils.showAlert("Gagal membatalkan transaksi: " + error.message, "Error", "error");
    } finally {
      utils.showLoading(false);
    }
  }

  // ✅ TAMBAHAN: Helper function untuk remove stock transactions
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

      const isGantiLock = transaction.isGantiLock || transaction.jenisPenjualan === "gantiLock";

      for (const item of transaction.items) {
        let kodeToSearch, jenisToSearch;

        if (isGantiLock) {
          // ✅ GANTI LOCK: gunakan kode lock yang digunakan
          kodeToSearch = item.kodeLock; // LSG, dll
          jenisToSearch = "ganti lock";
        } else {
          // ✅ PENJUALAN NORMAL: gunakan kode barang
          kodeToSearch = item.kodeText || item.barcode || item.kodeLock;
          jenisToSearch =
            transaction.statusPembayaran === "Free" || transaction.metodeBayar === "free" ? "free" : "laku";
        }

        if (!kodeToSearch) {
          console.warn(`⚠️ No kode found for item:`, item);
          continue;
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
            limit(1)
          );

          const stockSnapshot = await getDocs(stockQuery);

          if (stockSnapshot.size > 0) {
            const stockDoc = stockSnapshot.docs[0];

            // Hapus dari stokAksesorisTransaksi
            await deleteDoc(doc(firestore, "stokAksesorisTransaksi", stockDoc.id));

            // ✅ STEP 2: Restore stok ke stokAksesoris (SEMUA JENIS)
            await this.restoreStockQuantity(kodeToSearch, item.jumlah || 1);

            removedCount++;
            console.log(`✅ ${jenisToSearch} cancelled & stock restored: ${kodeToSearch} +${item.jumlah || 1}`);
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

  // ✅ FINAL: restoreStockQuantity (tidak ada perubahan, sudah optimal)
  async restoreStockQuantity(kode, jumlah) {
    try {
      const stockQuery = query(collection(firestore, "stokAksesoris"), where("kode", "==", kode), limit(1));

      const stockSnapshot = await getDocs(stockQuery);

      if (stockSnapshot.size > 0) {
        const stockDoc = stockSnapshot.docs[0];
        const stockData = stockDoc.data();
        const currentStock = stockData.stokAkhir || 0;
        const newStock = currentStock + jumlah;

        await updateDoc(doc(firestore, "stokAksesoris", stockDoc.id), {
          stokAkhir: newStock,
          lastUpdated: serverTimestamp(),
        });

        console.log(`📦 Stock updated: ${kode} (${currentStock} → ${newStock})`);
      } else {
        console.warn(`⚠️ Stock document not found: ${kode}`);
      }
    } catch (error) {
      console.error(`❌ Error restoring stock ${kode}:`, error);
      throw error;
    }
  }

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
    if (salesType === "manual") salesType = "layanan";

    let receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Struk Kasir</title>
        <style>
          body { font-family: consolas; font-size: 14px; margin: 0; padding: 0; width: 80mm; }
          .receipt { margin: 0 auto; padding: 5mm; }
          .receipt h3, .receipt h4 { text-align: center; margin: 2mm 0; }
          .receipt hr { border-top: 1px dashed #000; }
          .receipt table { width: 100%; border-collapse: collapse; }
          .receipt th, .receipt td { text-align: left; padding: 1mm 2mm; }
          .tanggal {margin-left: 10px}
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .keterangan { font-style: italic; font-size: 14px; margin-top: 2mm; border-top: 1px dotted #000; padding-top: 2mm; }
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

    // Loop untuk menampilkan semua item-data
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
        limit(50)
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
