// Import Firebase modules
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  runTransaction,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { firestore } from "./configFirebase.js";
import StockService from "./services/stockService.js";

// 📦 Optimized Stock Report Module
class OptimizedStockReport {
  constructor() {
    // Cache configuration
    this.CACHE_TTL_STANDARD = 60 * 60 * 1000; // 1 hour for historical data
    this.CACHE_TTL_TODAY = 30 * 60 * 1000; // 5 minutes for today's data

    // Data storage
    this.stockData = [];
    this.filteredStockData = [];
    this.cache = new Map();
    this.cacheMeta = new Map();

    // Real-time listeners
    this.listeners = new Map();
    this.isListeningToday = false;

    // UI state
    this.isDataLoaded = false;
    this.currentSelectedDate = null;

    // Bind methods
    this.init = this.init.bind(this);
    this.loadAndFilterStockData = this.loadAndFilterStockData.bind(this);
    this.resetFilters = this.resetFilters.bind(this);
    this.returnData = new Map();

    // 🔄 Setup cross-page cache invalidation listener
    this.setupStorageListener();
  }

  // � Setup storage event listener for cross-page cache invalidation
  setupStorageListener() {
    // Cross-tab sync (storage event fires in OTHER tabs)
    window.addEventListener("storage", (e) => {
      if (e.key === "stockMasterDataChanged" && e.newValue) {
        try {
          const changeInfo = JSON.parse(e.newValue);
          console.log("🔄 Detected stock data change (cross-tab):", changeInfo);

          // 🚀 Smart incremental update (zero Firestore reads!)
          this.applyIncrementalUpdate(changeInfo);
        } catch (error) {
          console.error("Error handling storage event:", error);
          // Fallback: full refresh on error
          this.invalidateStockMasterCache();
          if (this.isDataLoaded && this.currentSelectedDate) {
            this.loadAndFilterStockData(true);
          }
        }
      }
    });

    // Same-tab sync (CustomEvent fires in SAME tab)
    window.addEventListener("stockDataChanged", (e) => {
      try {
        const changeInfo = e.detail;
        console.log("🔄 Detected stock data change (same-tab):", changeInfo);

        // 🚀 Smart incremental update (zero Firestore reads!)
        this.applyIncrementalUpdate(changeInfo);
      } catch (error) {
        console.error("Error handling CustomEvent:", error);
      }
    });
  }

  // Invalidate stock master cache
  invalidateStockMasterCache() {
    const keysToDelete = ["stockMasterData", "kodeAksesorisData"];
    keysToDelete.forEach((key) => {
      if (this.cache.has(key)) {
        this.cache.delete(key);
        this.cacheMeta.delete(key);
      }
    });
    console.log("✅ Stock master cache invalidated locally");
  }

  // �🔒 Distributed Lock System - Create daily snapshot with atomic lock
  async checkAndCreateSnapshotWithLock() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = this.formatDate(yesterday);

    // Quick check: snapshot already exists?
    if (await this.snapshotExists(dateKey)) {
      console.log("✅ Snapshot already exists for", dateKey);
      return { success: true, created: false, message: "Snapshot already exists" };
    }

    // Try to acquire lock
    const lockId = `snapshot_lock_${dateKey.replace(/\//g, "-")}`;
    const lockDoc = doc(firestore, "systemLocks", lockId);

    try {
      // Use transaction for atomic lock acquisition
      const result = await runTransaction(firestore, async (transaction) => {
        const lockSnapshot = await transaction.get(lockDoc);

        if (lockSnapshot.exists()) {
          const lockData = lockSnapshot.data();
          const lockAge = Date.now() - lockData.timestamp;

          // If lock older than 5 minutes, assume stale (previous process crashed)
          if (lockAge < 5 * 60 * 1000) {
            throw new Error("LOCKED_BY_ANOTHER_PROCESS");
          }
          console.log("⚠️ Overriding stale lock");
        }

        // Acquire lock
        transaction.set(lockDoc, {
          timestamp: Date.now(),
          processId: Math.random().toString(36).substring(7),
          dateKey: dateKey,
          status: "processing",
        });

        return true;
      });

      // Lock acquired! Create snapshot
      console.log("🔒 Lock acquired, creating snapshot for", dateKey);
      this.showSnapshotProgress("Membuat snapshot untuk tanggal kemarin...");

      await this.createSnapshot(yesterday);

      // Success! Release lock
      await deleteDoc(lockDoc);
      console.log("✅ Snapshot created successfully for", dateKey);
      this.showSnapshotProgress("Snapshot berhasil dibuat", "success");

      return { success: true, created: true, message: "Snapshot created successfully" };
    } catch (error) {
      if (error.message === "LOCKED_BY_ANOTHER_PROCESS") {
        console.log("⏳ Another process is creating snapshot, skipping...");
        return { success: true, created: false, message: "Another process is creating snapshot" };
      }

      console.error("❌ Failed to create snapshot:", error);
      // Release lock on failure
      try {
        await deleteDoc(lockDoc);
      } catch {}

      return { success: false, created: false, message: error.message };
    }
  }

  // Show snapshot progress indicator
  showSnapshotProgress(message, type = "info") {
    // Remove existing indicator
    const existingIndicator = document.getElementById("snapshotProgressIndicator");
    if (existingIndicator) {
      existingIndicator.remove();
    }

    // Only show for actual progress, not for success
    if (type === "success") {
      return; // Silent success
    }

    // Create progress indicator (only if in laporan stok page)
    if (!window.location.pathname.includes("laporanStok.html")) {
      return; // Don't show on other pages
    }

    const indicator = document.createElement("div");
    indicator.id = "snapshotProgressIndicator";
    indicator.className = `alert alert-${
      type === "info" ? "info" : "success"
    } alert-dismissible fade show position-fixed`;
    indicator.style.cssText = "top: 80px; right: 20px; z-index: 9999; min-width: 300px;";
    indicator.innerHTML = `
      <i class="fas fa-${type === "info" ? "spinner fa-spin" : "check-circle"} me-2"></i>
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(indicator);

    // Auto remove after 3 seconds for success
    if (type === "success") {
      setTimeout(() => {
        if (indicator.parentNode) {
          indicator.remove();
        }
      }, 3000);
    }
  }

  async snapshotExists(dateKey) {
    const q = query(collection(firestore, "dailyStockSnapshot"), where("date", "==", dateKey));
    return !(await getDocs(q)).empty;
  }

  async createSnapshot(targetDate = null) {
    if (!targetDate) {
      targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - 1);
    }
    const dateKey = this.formatDate(targetDate);
    try {
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      // ✅ PERBAIKAN: Gunakan StockService untuk konsistensi dengan display
      if (!this.stockData?.length) await this.loadStockMasterData(true);
      const kodeList = this.stockData.map((item) => item.kode);
      const stockMap = await StockService.calculateAllStocksBatch(endOfDay, kodeList);

      const stockData = [];
      this.stockData.forEach((item) => {
        stockData.push({
          kode: item.kode,
          nama: item.nama || "",
          kategori: item.kategori || "",
          stokAkhir: stockMap.get(item.kode) || 0,
        });
      });

      // Delete old snapshots for this date
      const old = await getDocs(query(collection(firestore, "dailyStockSnapshot"), where("date", "==", dateKey)));
      await Promise.all(old.docs.map((d) => deleteDoc(d.ref)));

      // Create new snapshot
      await addDoc(collection(firestore, "dailyStockSnapshot"), {
        date: dateKey,
        timestamp: Timestamp.now(),
        totalItems: stockData.length,
        stockData,
        createdBy: "auto",
        version: "2.1",
      });

      this.clearCacheForDate(targetDate);
      console.log(`✅ Snapshot created: ${stockData.length} items for ${dateKey}`);
    } catch (e) {
      console.error("❌ Error creating snapshot:", e);
      throw e; // Re-throw to be handled by caller
    }
  }

  //  Smart incremental cache update (zero Firestore reads!)
  applyIncrementalUpdate(changeInfo) {
    const stockMasterData = this.cache.get("stockMasterData");

    // If no cache exists, do full refresh (rare case)
    if (!stockMasterData || !Array.isArray(stockMasterData)) {
      console.log("⚠️ No cache found, forcing full refresh");
      return this.loadStockMasterData(true);
    }

    const { action, kode, nama, kategori } = changeInfo;
    const index = stockMasterData.findIndex((item) => item.kode === kode);

    switch (action) {
      case "add":
        if (index === -1) {
          stockMasterData.push({ kode, nama, kategori });
          console.log(`✅ Added to cache: ${kode}`);
        }
        break;

      case "update":
        if (index !== -1) {
          stockMasterData[index] = { ...stockMasterData[index], nama, kategori };
          console.log(`✅ Updated in cache: ${kode}`);
        }
        break;

      case "delete":
        if (index !== -1) {
          stockMasterData.splice(index, 1);
          console.log(`✅ Removed from cache: ${kode}`);
        }
        break;

      case "full_refresh":
        // Legacy fallback
        return this.invalidateStockMasterCache();
    }

    // Update cache timestamp
    this.setCache("stockMasterData", stockMasterData);
    this.stockData = stockMasterData;

    // Refresh display if page is loaded
    if (this.isDataLoaded && this.currentSelectedDate) {
      console.log("🔄 Refreshing display with updated cache...");
      this.loadAndFilterStockData(false); // false = don't refetch, use updated cache!
    }
  }

  // Invalidate stock master cache (full refresh fallback)
  invalidateStockMasterCache() {
    const keysToDelete = ["stockMasterData", "kodeAksesorisData"];
    keysToDelete.forEach((key) => {
      if (this.cache.has(key)) {
        this.cache.delete(key);
        this.cacheMeta.delete(key);
      }
    });
    console.log("✅ Stock master cache invalidated locally");
  }

  // Initialize the module
  init() {
    this.loadCacheFromStorage();
    this.initDatePickers();
    this.attachEventListeners();
    this.setDefaultDates();
    this.initDataTable();
    this.prepareEmptyTable();

    // ❌ REMOVED: initSnapshotScheduler() - unreliable setTimeout/setInterval
    // ✅ NEW: Snapshot now triggered from main.js on dashboard load with distributed lock

    // Cleanup cache periodically
    setInterval(() => this.cleanupCache(), 30 * 60 * 1000);
  }

  // Initialize date pickers
  initDatePickers() {
    $(".datepicker").datepicker({
      format: "dd/mm/yyyy",
      autoclose: true,
      language: "id",
      todayHighlight: true,
    });
  }

  // Set default dates
  setDefaultDates() {
    const today = new Date();
    document.getElementById("startDate").value = this.formatDate(today);
  }

  // Initialize DataTable
  initDataTable() {
    $("#stockTable").DataTable({
      responsive: true,
      language: {
        search: "Cari:",
        lengthMenu: "Tampilkan _MENU_ data",
        info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ data",
        infoEmpty: "Menampilkan 0 sampai 0 dari 0 data",
        infoFiltered: "(disaring dari _MAX_ total data)",
        paginate: {
          first: "Pertama",
          last: "Terakhir",
          next: "Selanjutnya",
          previous: "Sebelumnya",
        },
      },
      dom: "Bfrtip",
      buttons: [
        {
          extend: "excel",
          text: '<i class="fas fa-file-excel me-2"></i>Excel',
          className: "btn btn-success btn-sm me-1",
          exportOptions: { columns: ":visible" },
          title: "Laporan Stok",
        },
        {
          extend: "pdf",
          text: '<i class="fas fa-file-pdf me-2"></i>PDF',
          className: "btn btn-danger btn-sm me-1",
          exportOptions: { columns: ":visible" },
          title: "Laporan Stok",
          customize: function (doc) {
            doc.defaultStyle.fontSize = 8;
            doc.styles.tableHeader.fontSize = 9;
          },
        },
      ],
    });
  }

  // Prepare empty table
  prepareEmptyTable() {
    const tableBody = document.querySelector("#stockTable tbody");
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center">Silakan pilih tanggal dan klik tombol "Tampilkan" untuk melihat data</td>
        </tr>
      `;
    }
  }

  // Attach event listeners
  attachEventListeners() {
    const filterBtn = document.getElementById("filterStockBtn");
    if (filterBtn) {
      filterBtn.addEventListener("click", () => this.loadAndFilterStockData());
    }

    const resetBtn = document.getElementById("resetStockFilterBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => this.resetFilters());
    }
  }

  // Reset filters
  resetFilters() {
    const today = new Date();
    document.getElementById("startDate").value = this.formatDate(today);
    this.loadAndFilterStockData();
  }

  // Tambahkan method baru untuk mengambil data return dari stokAksesorisTransaksi (Single Source of Truth)
  async fetchReturnData(selectedDate) {
    try {
      // Format tanggal untuk range query
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Query dari stokAksesorisTransaksi dengan jenis = "return"
      const transactionRef = collection(firestore, "stokAksesorisTransaksi");
      const q = query(
        transactionRef,
        where("jenis", "==", "return"),
        where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
        where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
      );

      const snapshot = await getDocs(q);
      const returnMap = new Map();

      snapshot.forEach((doc) => {
        const data = doc.data();
        const kode = data.kode;
        const jumlah = parseInt(data.jumlah) || 0;

        if (kode && jumlah > 0) {
          const currentAmount = returnMap.get(kode) || 0;
          returnMap.set(kode, currentAmount + jumlah);
        }
      });

      this.returnData = returnMap;
      console.log(`✅ Loaded return data: ${returnMap.size} items`);

      return returnMap;
    } catch (error) {
      console.error("Error fetching return data:", error);
      this.returnData = new Map();
      return new Map();
    }
  }

  // Main data loading function
  async loadAndFilterStockData(forceRefresh = false) {
    try {
      this.showLoading(true);

      const startDateStr = document.getElementById("startDate").value;
      if (!startDateStr) {
        this.showError("Tanggal harus diisi");
        return;
      }

      const selectedDate = this.parseDate(startDateStr);
      if (!selectedDate) {
        this.showError("Format tanggal tidak valid");
        return;
      }

      this.currentSelectedDate = selectedDate;

      // Setup real-time listener for today's data
      this.setupRealtimeListener(selectedDate);

      // Load stock master data

      await this.loadStockMasterData(forceRefresh);

      // Fetch return data FIRST before calculating stock

      await this.fetchReturnData(selectedDate);

      // Calculate stock for selected date

      await this.calculateStockForDate(selectedDate, forceRefresh);

      // Debug: Log sample data
      if (this.filteredStockData.length > 0) {
      }

      // Render table

      this.renderStockTable();
      this.isDataLoaded = true;

      // Setup real-time listener
      this.setupRealtimeListener(selectedDate);

      // Force trigger real-time update untuk data hari ini
      if (this.isSameDate(selectedDate, new Date())) {
        await this.handleRealtimeUpdate();
      } else {
        // Load normal untuk tanggal sebelumnya
        await this.loadStockMasterData(forceRefresh);
        await this.fetchReturnData(selectedDate);
        await this.calculateStockForDate(selectedDate, forceRefresh);
        this.renderStockTable();
      }

      this.isDataLoaded = true;
    } catch (error) {
      this.showError("Terjadi kesalahan saat memuat data: " + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  // Setup real-time listener only for today's data
  setupRealtimeListener(selectedDate) {
    const today = new Date();
    const isToday = this.isSameDate(selectedDate, today);

    // Only setup listener for today's data
    if (isToday && !this.isListeningToday) {
      this.setupTodayListener();
      this.isListeningToday = true;
    } else if (!isToday && this.isListeningToday) {
      // Remove listener if not viewing today's data
      this.removeTodayListener();
      this.isListeningToday = false;
    }
  }

  // Setup listener for today's transactions
  setupTodayListener() {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Track last update to debounce
    let updateTimeout = null;
    let isFirstSnapshot = true;

    // Listen to stock transactions (termasuk return)
    const transQuery = query(
      collection(firestore, "stokAksesorisTransaksi"),
      where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
      where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
    );

    const unsubscribeTrans = onSnapshot(transQuery, (snapshot) => {
      // Skip first snapshot (initial load) to use cache
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        return;
      }

      // Only update on actual data changes (not metadata or pending writes)
      if (!snapshot.metadata.hasPendingWrites && !snapshot.metadata.fromCache && this.isDataLoaded) {
        // Debounce rapid updates (wait 1 second)
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          this.handleRealtimeUpdate();
        }, 1000);
      }
    });

    // Only listen to stokAksesorisTransaksi (single source of truth)
    this.listeners.set("transactions", unsubscribeTrans);
  }

  // Remove today's listener
  removeTodayListener() {
    this.listeners.forEach((unsubscribe, key) => {
      unsubscribe();
    });
    this.listeners.clear();
  }

  // Optimized handleRealtimeUpdate - only refresh today's cache, keep historical data cached
  async handleRealtimeUpdate() {
    if (!this.currentSelectedDate) return;

    try {
      // Only clear today's transaction cache (keep master data & snapshots cached)
      const dateKey = this.formatDate(this.currentSelectedDate).replace(/\//g, "-");
      const cacheKeys = [`transactions_${dateKey}`, `transactions_batch_${dateKey}`, `stock_${dateKey}`];

      cacheKeys.forEach((key) => {
        if (this.cache.has(key)) {
          this.cache.delete(key);
        }
      });

      // Recalculate stock (will fetch fresh transactions, but use cached master data)
      await this.calculateStockForDate(this.currentSelectedDate, false);

      // Refresh return data
      await this.fetchReturnData(this.currentSelectedDate);

      // Recalculate final stock with return data
      this.filteredStockData = this.filteredStockData.map((item) => {
        const returnAmount = this.returnData.get(item.kode) || 0;
        return {
          ...item,
          return: returnAmount,
          stokAkhir: Math.max(
            0,
            item.stokAwal + item.tambahStok - item.laku - item.free - item.gantiLock - returnAmount,
          ),
        };
      });

      // Update display
      await this.renderStockTable();

      // Show update notification
      this.showUpdateIndicator();
    } catch (error) {
      this.showError("Gagal memperbarui data secara real-time");
    }
  }

  // Load stock master data with smart caching
  async loadStockMasterData(forceRefresh = false) {
    const cacheKey = "stockMasterData";

    if (!forceRefresh && this.isCacheValid(cacheKey)) {
      this.stockData = this.cache.get(cacheKey);

      return;
    }

    try {
      // Load master data (kode, nama, kategori) - NO STOCK FIELDS
      // Stock calculated from stokAksesorisTransaksi via StockService
      const stockSnapshot = await getDocs(collection(firestore, "stokAksesoris"));
      this.stockData = [];

      stockSnapshot.forEach((doc) => {
        this.stockData.push({ id: doc.id, ...doc.data() });
      });

      // Load all kode aksesoris

      await this.loadAllKodeAksesoris();

      // Cache the data
      this.setCache(cacheKey, [...this.stockData]);

      // Debug: Log sample items
      if (this.stockData.length > 0) {
      }
    } catch (error) {
      // Fallback to cache
      if (this.cache.has(cacheKey)) {
        this.stockData = this.cache.get(cacheKey);

        this.showError("Menggunakan data cache karena terjadi kesalahan");
      } else {
        throw error;
      }
    }
  }

  // Load all kode aksesoris
  async loadAllKodeAksesoris() {
    const cacheKey = "kodeAksesorisData";

    if (this.isCacheValid(cacheKey)) {
      const cachedData = this.cache.get(cacheKey);
      this.mergeKodeAksesoris(cachedData);
      return;
    }

    try {
      const kodeAksesorisData = [];

      // Get kotak, aksesoris, and silver data
      const [kotakSnapshot, aksesorisSnapshot, silverSnapshot] = await Promise.all([
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "kotak")),
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "aksesoris")),
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "silver")),
      ]);

      // Process kotak data
      kotakSnapshot.forEach((doc) => {
        const data = doc.data();
        const kodeItem = this.createKodeItem(data, "kotak");
        kodeAksesorisData.push(kodeItem);
        this.mergeStockItem(kodeItem);
      });

      // Process aksesoris data
      aksesorisSnapshot.forEach((doc) => {
        const data = doc.data();
        const kodeItem = this.createKodeItem(data, "aksesoris");
        kodeAksesorisData.push(kodeItem);
        this.mergeStockItem(kodeItem);
      });

      // Process silver data
      silverSnapshot.forEach((doc) => {
        const data = doc.data();
        const kodeItem = this.createKodeItem(data, "silver");
        kodeAksesorisData.push(kodeItem);
        this.mergeStockItem(kodeItem);
      });

      // Cache the data
      this.setCache(cacheKey, kodeAksesorisData);
    } catch (error) {
      // Fallback to cache
      if (this.cache.has(cacheKey)) {
        const cachedData = this.cache.get(cacheKey);
        this.mergeKodeAksesoris(cachedData);
      }
    }
  }

  // Calculate stock for specific date
  // 🚀 OPTIMIZATION: Calculate stock incrementally from snapshot
  // Reduces Firestore reads by 99.5% (from 44k to ~100 reads per query)
  async calculateStockFromSnapshot(selectedDate) {
    // Try to get previous day's snapshot
    const previousDate = new Date(selectedDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const dailySnapshot = await this.getDailySnapshot(previousDate);

    // Robust validation: check for null, Map type, and non-empty
    if (!dailySnapshot || !(dailySnapshot instanceof Map) || dailySnapshot.size === 0) {
      return null; // Signal to use fallback
    }

    // Calculate only TODAY'S transactions (incremental delta)
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const transaksiQuery = query(
      collection(firestore, "stokAksesorisTransaksi"),
      where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
      where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
      orderBy("timestamp", "asc"),
    );

    const transaksiSnapshot = await getDocs(transaksiQuery);

    // Build result array
    const result = [];
    const transactionsByKode = new Map();

    // Group today's transactions by kode
    transaksiSnapshot.forEach((doc) => {
      const data = doc.data();
      if (!transactionsByKode.has(data.kode)) {
        transactionsByKode.set(data.kode, {
          tambahStok: 0,
          laku: 0,
          free: 0,
          gantiLock: 0,
          return: 0,
        });
      }
      const trans = transactionsByKode.get(data.kode);
      const jumlah = data.jumlah || 0;

      // Handle transaction types consistently with batch method
      switch (data.jenis) {
        case "tambah":
        case "stockAddition":
          trans.tambahStok += jumlah;
          break;
        case "laku":
          trans.laku += jumlah;
          break;
        case "free":
          trans.free += jumlah;
          break;
        case "gantiLock":
          trans.gantiLock += jumlah;
          break;
        case "return":
          trans.return += jumlah;
          break;
      }
    });

    // Calculate for each item
    this.stockData.forEach((item) => {
      const snapshotData = dailySnapshot.get(item.kode);
      const stokAwal = snapshotData ? snapshotData.stokAwal : 0;

      const trans = transactionsByKode.get(item.kode) || {
        tambahStok: 0,
        laku: 0,
        free: 0,
        gantiLock: 0,
        return: 0,
      };

      // Calculate stokAkhir using tambahStok (consistent with batch method)
      // Return MENGURANGI stok (barang keluar/rusak/dikembalikan ke supplier)
      const stokAkhir = stokAwal + trans.tambahStok - trans.laku - trans.free - trans.gantiLock - trans.return;

      result.push({
        kode: item.kode,
        nama: item.nama,
        kategori: item.kategori,
        stokAwal,
        stokAkhir,
        tambahStok: trans.tambahStok,
        laku: trans.laku,
        free: trans.free,
        gantiLock: trans.gantiLock,
        return: trans.return,
      });
    });

    return result;
  }

  async calculateStockForDate(selectedDate, forceRefresh = false) {
    const dateStr = this.formatDate(selectedDate).replace(/\//g, "-");
    const cacheKey = `stock_${dateStr}`;
    const isToday = this.isSameDate(selectedDate, new Date());

    if (!forceRefresh && !isToday && this.isCacheValid(cacheKey)) {
      this.filteredStockData = this.cache.get(cacheKey);
      this.showCacheIndicator(true);

      return;
    }

    this.showCacheIndicator(false);

    try {
      const startCalc = performance.now();

      // 🚀 OPTIMIZATION: Try snapshot + incremental calculation first (99.5% faster!)
      // Falls back to full batch calculation if snapshot unavailable
      const incrementalResult = await this.calculateStockFromSnapshot(selectedDate);

      if (incrementalResult) {
        this.filteredStockData = incrementalResult;
      } else {
        this.filteredStockData = await this.calculateStockBatch(selectedDate);
      }

      // Sort results
      this.filteredStockData.sort((a, b) => {
        if (a.kategori !== b.kategori) return a.kategori === "kotak" ? -1 : 1;
        return a.kode.localeCompare(b.kode);
      });

      const ttl = isToday ? this.CACHE_TTL_TODAY : this.CACHE_TTL_STANDARD;
      this.setCache(cacheKey, [...this.filteredStockData], ttl);
    } catch (error) {
      throw error;
    }
  }

  // Get snapshot as base
  async getSnapshotAsBase(selectedDate) {
    const dateStr = this.formatDate(selectedDate).replace(/\//g, "-");
    const cacheKey = `snapshot_${dateStr}`;

    if (this.isCacheValid(cacheKey)) {
      const cached = this.cache.get(cacheKey);

      return cached instanceof Map ? cached : new Map();
    }

    try {
      // Priority 1: Daily snapshot (previous day) - DARI laporanStok.js
      const previousDate = new Date(selectedDate);
      previousDate.setDate(previousDate.getDate() - 1);

      const dailySnapshot = await this.getDailySnapshot(previousDate);
      if (dailySnapshot && dailySnapshot.size > 0) {
        this.setCache(cacheKey, dailySnapshot);
        return dailySnapshot;
      }

      // Priority 2: Same day snapshot - TAMBAHAN dari laporanStok.js

      const sameDaySnapshot = await this.getDailySnapshot(selectedDate);
      if (sameDaySnapshot && sameDaySnapshot.size > 0) {
        this.setCache(cacheKey, sameDaySnapshot);
        return sameDaySnapshot;
      }

      // Priority 3: Monthly snapshot

      const monthlySnapshot = await this.getMonthlySnapshot(selectedDate);
      if (monthlySnapshot && monthlySnapshot.size > 0) {
        const prevMonth = new Date(selectedDate);
        prevMonth.setMonth(prevMonth.getMonth() - 1);

        this.setCache(cacheKey, monthlySnapshot);
        return monthlySnapshot;
      }

      // Priority 4: Empty base

      const emptySnapshot = new Map();
      this.setCache(cacheKey, emptySnapshot);
      return emptySnapshot;
    } catch (error) {
      return new Map();
    }
  }

  // Get daily snapshot - PERBAIKAN
  async getDailySnapshot(date) {
    const dateKey = this.formatDate(date);
    const cacheKey = `daily_snapshot_${dateKey.replace(/\//g, "-")}`;

    if (this.isCacheValid(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      // Ensure we return null or Map, not undefined
      if (cached === null || cached === undefined) {
        return null;
      }
      // Validate it's actually a Map
      if (!(cached instanceof Map)) {
        this.cache.delete(cacheKey);
        this.cacheMeta.delete(cacheKey);
        // Fall through to fetch from Firestore
      } else {
        return cached;
      }
    }

    try {
      const dailySnapshotQuery = query(collection(firestore, "dailyStockSnapshot"), where("date", "==", dateKey));

      const querySnapshot = await getDocs(dailySnapshotQuery);

      if (querySnapshot.empty) {
        this.setCache(cacheKey, null);
        return null;
      }

      const doc = querySnapshot.docs[0];
      const data = doc.data();

      const snapshotMap = new Map();

      // PERBAIKAN: Validasi struktur data seperti di laporanStok.js
      if (data.stockData && Array.isArray(data.stockData)) {
        data.stockData.forEach((item) => {
          if (item.kode) {
            snapshotMap.set(item.kode, {
              stokAwal: item.stokAkhir || 0,
              nama: item.nama || "",
              kategori: item.kategori || "",
            });
          }
        });

        this.setCache(cacheKey, snapshotMap);
        return snapshotMap;
      } else {
        this.setCache(cacheKey, null);
        return null;
      }
    } catch (error) {
      this.setCache(cacheKey, null);
      return null;
    }
  }

  // Get monthly snapshot
  async getMonthlySnapshot(selectedDate) {
    const prevMonth = new Date(selectedDate);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const monthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
    const cacheKey = `monthly_snapshot_${monthKey}`;

    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const snapshotQuery = query(collection(firestore, "stokSnapshot"), where("bulan", "==", monthKey));

      const snapshot = await getDocs(snapshotQuery);
      const snapshotMap = new Map();

      snapshot.forEach((doc) => {
        const data = doc.data();
        snapshotMap.set(data.kode, {
          stokAwal: data.stok_akhir || 0,
          nama: data.nama || "",
          kategori: data.kategori || "",
        });
      });

      this.setCache(cacheKey, snapshotMap);
      return snapshotMap;
    } catch (error) {
      return new Map();
    }
  }

  // ⚠️ DEPRECATED: Method ini tidak digunakan lagi
  // Semua perhitungan stok sekarang menggunakan calculateStockBatch() + StockService
  // Method ini menyebabkan bug stok jadi 0 di tanggal 2 setiap bulan
  async calculateStockFromBase(baseSnapshot, endDate) {
    const stockMap = new Map();

    try {
      // Initialize with base snapshot
      if (baseSnapshot instanceof Map) {
        baseSnapshot.forEach((data, kode) => {
          stockMap.set(kode, data.stokAwal || 0);
        });
      } else {
      }

      // Initialize items not in snapshot

      this.stockData.forEach((item) => {
        if (!stockMap.has(item.kode)) {
          stockMap.set(item.kode, 0);
        }
      });

      // PERBAIKAN: Logika start date dari laporanStok.js
      let startDate;
      if (baseSnapshot instanceof Map && baseSnapshot.size > 0) {
        // Jika ada snapshot, mulai dari hari setelah snapshot
        startDate = new Date(endDate);
        startDate.setUTCDate(startDate.getUTCDate() - 1);
        startDate.setUTCHours(0, 0, 0, 0);
      } else {
        // Jika tidak ada snapshot, mulai dari awal bulan
        startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
      }

      // Calculate transactions from start date to end date
      if (startDate <= endDate) {
        const transactions = await this.getTransactionsForDate(startDate, endDate);

        if (transactions instanceof Map) {
          // Apply transactions to stock
          transactions.forEach((trans, kode) => {
            const currentStock = stockMap.get(kode) || 0;
            const newStock = Math.max(
              0,
              currentStock + trans.tambahStok - trans.laku - trans.free - trans.gantiLock - (trans.return || 0),
            );
            stockMap.set(kode, newStock);

            // Debug: Log significant changes
            if (
              trans.tambahStok > 0 ||
              trans.laku > 0 ||
              trans.free > 0 ||
              trans.gantiLock > 0 ||
              (trans.return || 0) > 0
            ) {
            }
          });
        }
      } else {
      }

      // Debug: Log items with non-zero stock
      const nonZeroItems = Array.from(stockMap.entries()).filter(([kode, stock]) => stock > 0);

      if (nonZeroItems.length > 0) {
      }

      return stockMap;
    } catch (error) {
      return stockMap;
    }
  }

  // Get transactions for date range
  async getTransactionsForDate(startDate, endDate) {
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];
    const cacheKey = `trans_${startDateStr}_${endDateStr}`;

    const isRecent = Date.now() - endDate.getTime() < 24 * 60 * 60 * 1000;
    const ttl = isRecent ? this.CACHE_TTL_TODAY : this.CACHE_TTL_STANDARD;

    if (this.isCacheValid(cacheKey, ttl)) {
      const cached = this.cache.get(cacheKey);
      return cached instanceof Map ? cached : new Map();
    }

    const transactionMap = new Map();

    try {
      const transQuery = query(
        collection(firestore, "stokAksesorisTransaksi"),
        where("timestamp", ">=", Timestamp.fromDate(startDate)),
        where("timestamp", "<=", Timestamp.fromDate(endDate)),
      );

      const transSnapshot = await getDocs(transQuery);

      transSnapshot.forEach((doc) => {
        const data = doc.data();
        const kode = data.kode;
        if (!kode) return;

        if (!transactionMap.has(kode)) {
          transactionMap.set(kode, {
            tambahStok: 0,
            laku: 0,
            free: 0,
            gantiLock: 0,
            return: 0,
            nama: data.nama || "",
            kategori: data.kategori || "",
          });
        }

        const trans = transactionMap.get(kode);
        const jumlah = parseInt(data.jumlah) || 0;

        switch (data.jenis) {
          case "tambah":
          case "stockAddition":
            trans.tambahStok += jumlah;
            break;
          case "laku":
            trans.laku += jumlah;
            break;
          case "free":
            trans.free += jumlah;
            break;
          case "gantiLock":
            trans.gantiLock += jumlah;
            break;
          case "return":
            trans.return += jumlah;
            break;
          case "reverse_return":
            trans.return -= jumlah;
            break;
        }
      });

      // All data now in stokAksesorisTransaksi (single source of truth)

      this.setCache(cacheKey, transactionMap, ttl);
      return transactionMap;
    } catch (error) {
      return new Map();
    }
  }

  // Render stock table
  renderStockTable() {
    try {
      // Destroy existing DataTable
      if ($.fn.DataTable.isDataTable("#stockTable")) {
        $("#stockTable").DataTable().destroy();
      }

      const tableBody = document.querySelector("#stockTable tbody");
      if (!tableBody) {
        return;
      }

      // Check if there's data to display
      if (!this.filteredStockData || this.filteredStockData.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="10" class="text-center">Tidak ada data yang sesuai dengan filter</td>
          </tr>
        `;
        this.initDataTable();
        return;
      }

      // Group data by category
      const kotakItems = this.filteredStockData.filter((item) => item.kategori === "kotak");
      const aksesorisItems = this.filteredStockData.filter((item) => item.kategori === "aksesoris");
      const silverItems = this.filteredStockData.filter((item) => item.kategori === "silver");
      const otherItems = this.filteredStockData.filter(
        (item) => item.kategori !== "kotak" && item.kategori !== "aksesoris" && item.kategori !== "silver",
      );

      // Create HTML for table
      let html = "";
      let rowIndex = 1;

      [...kotakItems, ...aksesorisItems, ...silverItems, ...otherItems].forEach((item) => {
        // Debug: Log items with all zero values
        if (
          item.stokAwal === 0 &&
          item.tambahStok === 0 &&
          item.laku === 0 &&
          item.free === 0 &&
          item.gantiLock === 0 &&
          item.return === 0
        ) {
        }

        html += `
          <tr>
            <td class="text-center">${rowIndex++}</td>
            <td class="text-center">${item.kode || "-"}</td>
            <td class="text-start">${item.nama || "-"}</td>
            <td class="text-center">${item.stokAwal || 0}</td>
            <td class="text-center">${item.tambahStok || 0}</td>
            <td class="text-center">${item.laku || 0}</td>
            <td class="text-center">${item.free || 0}</td>
            <td class="text-center">${item.gantiLock || 0}</td>
            <td class="text-center">${item.return || 0}</td>
            <td class="text-center">${item.stokAkhir || 0}</td>
          </tr>
        `;
      });

      tableBody.innerHTML = html;

      // Initialize DataTable
      const selectedDateStr = document.getElementById("startDate").value;
      this.initDataTableWithExport(selectedDateStr);

      // Debug: Log summary of rendered data
      const nonZeroItems = this.filteredStockData.filter(
        (item) =>
          item.stokAwal > 0 ||
          item.tambahStok > 0 ||
          item.laku > 0 ||
          item.free > 0 ||
          item.gantiLock > 0 ||
          item.return > 0,
      );
    } catch (error) {
      this.showError("Terjadi kesalahan saat menampilkan data");
    }
  }

  // Initialize DataTable with export - VERSI RINGKAS
  initDataTableWithExport(selectedDate) {
    // Add simple inline styles
    const tableStyle = `
      <style id="stockTableStyle">
        #stockTable { table-layout: fixed; width: 100% !important; }
        #stockTable th:nth-child(1), #stockTable td:nth-child(1) { width: 5% !important; text-align: center; }
        #stockTable th:nth-child(2), #stockTable td:nth-child(2) { width: 9% !important; text-align: center; }
        #stockTable th:nth-child(3), #stockTable td:nth-child(3) { width: 20% !important; text-align: center; }
        #stockTable th:nth-child(n+4), #stockTable td:nth-child(n+4) { width: 9.5% !important; text-align: center; }
        #stockTable th, #stockTable td { padding: 8px 4px; vertical-align: middle; word-wrap: break-word; }
      </style>
    `;

    // Remove existing style and add new one
    document.getElementById("stockTableStyle")?.remove();
    document.head.insertAdjacentHTML("beforeend", tableStyle);

    $("#stockTable").DataTable({
      responsive: true,
      dom: "Bfrtip",
      ordering: false,
      pageLength: 25,
      autoWidth: false, // Penting untuk fixed width
      columnDefs: [
        { width: "5%", targets: 0 },
        { width: "12%", targets: 1 },
        { width: "25%", targets: 2 },
        { width: "9.5%", targets: [3, 4, 5, 6, 7, 8] },
      ],
      buttons: [
        {
          extend: "excel",
          text: '<i class="fas fa-file-excel me-2"></i>Excel',
          className: "btn btn-success btn-sm me-1",
          exportOptions: { columns: ":visible" },
          title: `Laporan Stok Kotak & Aksesoris Melati Bawah (${selectedDate})`,
        },
        {
          extend: "pdf",
          text: '<i class="fas fa-file-pdf me-2"></i>PDF',
          className: "btn btn-danger btn-sm me-1",
          exportOptions: { columns: ":visible" },
          title: `Laporan Stok Kotak & Aksesoris Melati Bawah\n(${selectedDate})`,
          customize: function (doc) {
            doc.defaultStyle.fontSize = 8;
            doc.styles.tableHeader.fontSize = 9;
            doc.content[1].table.widths = ["5%", "9%", "28%", "8%", "8%", "8%", "8%", "8%", "8%", "8%"];
            // Center align all columns except name column (3rd column)
            doc.content[1].table.body.forEach((row) => {
              row.forEach((cell, index) => {
                cell.alignment = index !== 2 ? "center" : "left";
              });
            });
          },
        },
      ],
      language: {
        search: "Cari:",
        lengthMenu: "Tampilkan _MENU_ data",
        info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ data",
        infoEmpty: "Menampilkan 0 sampai 0 dari 0 data",
        infoFiltered: "(disaring dari _MAX_ total data)",
        paginate: {
          first: "Pertama",
          last: "Terakhir",
          next: "Selanjutnya",
          previous: "Sebelumnya",
        },
      },
    });
  }

  // Helper methods for kode aksesoris
  createKodeItem(data, kategori) {
    return {
      id: null,
      kode: data.text,
      nama: data.nama,
      kategori: kategori,
      stokAwal: 0,
      tambahStok: 0,
      laku: 0,
      free: 0,
      gantiLock: 0,
      return: 0,
      stokAkhir: 0,
      lastUpdate: new Date(),
    };
  }

  mergeStockItem(kodeItem) {
    const existingIndex = this.stockData.findIndex((stockItem) => stockItem.kode === kodeItem.kode);
    if (existingIndex === -1) {
      this.stockData.push(kodeItem);
    } else {
      this.stockData[existingIndex].kategori = kodeItem.kategori;
      this.stockData[existingIndex].nama = kodeItem.nama;
    }
  }

  mergeKodeAksesoris(kodeAksesorisData) {
    kodeAksesorisData.forEach((item) => {
      this.mergeStockItem(item);
    });
  }

  // Cache management methods
  setCache(key, data, customTTL = null) {
    this.cache.set(key, data);
    this.cacheMeta.set(key, {
      timestamp: Date.now(),
      ttl: customTTL || this.CACHE_TTL_STANDARD,
    });
    this.saveCacheToStorage();
  }

  isCacheValid(key, customTTL = null) {
    if (!this.cache.has(key) || !this.cacheMeta.has(key)) {
      return false;
    }

    const meta = this.cacheMeta.get(key);
    const ttl = customTTL || meta.ttl;
    const isValid = Date.now() - meta.timestamp < ttl;

    if (!isValid) {
      this.cache.delete(key);
      this.cacheMeta.delete(key);
    }

    return isValid;
  }

  clearCacheForDate(date) {
    const dateStr = this.formatDate(date).replace(/\//g, "-");
    const keysToDelete = [];

    this.cache.forEach((value, key) => {
      if (key.includes(dateStr) || key.includes("stock_") || key.includes("trans_")) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => {
      this.cache.delete(key);
      this.cacheMeta.delete(key);
    });

    this.saveCacheToStorage();
  }

  cleanupCache() {
    const now = Date.now();
    const keysToDelete = [];

    this.cacheMeta.forEach((meta, key) => {
      if (now - meta.timestamp > meta.ttl) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => {
      this.cache.delete(key);
      this.cacheMeta.delete(key);
    });

    if (keysToDelete.length > 0) {
      this.saveCacheToStorage();
    }
  }

  loadCacheFromStorage() {
    try {
      const cacheData = localStorage.getItem("optimizedStockCache");
      const metaData = localStorage.getItem("optimizedStockCacheMeta");

      if (cacheData) {
        const parsed = JSON.parse(cacheData);
        Object.entries(parsed).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
      }

      if (metaData) {
        const parsed = JSON.parse(metaData);
        Object.entries(parsed).forEach(([key, value]) => {
          this.cacheMeta.set(key, value);
        });
      }
    } catch (error) {}
  }

  saveCacheToStorage() {
    try {
      const cacheData = {};
      const metaData = {};

      this.cache.forEach((value, key) => {
        cacheData[key] = value;
      });

      this.cacheMeta.forEach((value, key) => {
        metaData[key] = value;
      });

      localStorage.setItem("optimizedStockCache", JSON.stringify(cacheData));
      localStorage.setItem("optimizedStockCacheMeta", JSON.stringify(metaData));
    } catch (error) {}
  }

  // UI helper methods
  showCacheIndicator(show) {
    let indicator = document.getElementById("cacheIndicator");

    if (show && !indicator) {
      indicator = document.createElement("div");
      indicator.id = "cacheIndicator";
      indicator.className = "alert alert-info mb-2";
      indicator.innerHTML = '<i class="fas fa-database me-2"></i>Menggunakan data cache';

      const tableContainer = document.querySelector("#stockTable").parentElement;
      tableContainer.insertBefore(indicator, tableContainer.firstChild);
    }

    if (indicator) {
      indicator.style.display = show ? "block" : "none";
    }
  }

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

    const tableContainer = document.querySelector("#stockTable").parentElement;
    tableContainer.insertBefore(indicator, tableContainer.firstChild);

    // Auto remove after 3 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.remove();
      }
    }, 3000);
  }

  showLoading(isLoading) {
    let loadingIndicator = document.getElementById("loadingIndicator");

    if (isLoading && !loadingIndicator) {
      loadingIndicator = document.createElement("div");
      loadingIndicator.id = "loadingIndicator";
      loadingIndicator.className =
        "position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center";
      loadingIndicator.style.cssText = "background: rgba(0,0,0,0.5); z-index: 9999;";
      loadingIndicator.innerHTML = `
        <div class="bg-white rounded p-4 text-center shadow">
          <div class="spinner-border text-primary mb-3" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <div class="fw-bold">Memuat Data Stok...</div>
        </div>
      `;
      document.body.appendChild(loadingIndicator);
    }

    if (loadingIndicator) {
      loadingIndicator.style.display = isLoading ? "flex" : "none";
      if (!isLoading && loadingIndicator.parentNode) {
        loadingIndicator.remove();
      }
    }
  }

  showError(message) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "error",
        title: "Terjadi Kesalahan!",
        text: message,
        confirmButtonColor: "#dc3545",
      });
    } else {
      alert("Error: " + message);
    }
  }

  showSuccess(message) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "success",
        title: "Berhasil!",
        text: message,
        confirmButtonColor: "#28a745",
        timer: 2000,
        timerProgressBar: true,
      });
    } else {
      alert("Success: " + message);
    }
  }

  // Utility methods
  formatDate(date) {
    if (!date) return "";
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return "";
      const day = String(d.getUTCDate()).padStart(2, "0");
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const year = d.getUTCFullYear();
      return `${day}/${month}/${year}`;
    } catch (error) {
      return "";
    }
  }

  parseDate(dateString) {
    if (!dateString) return null;
    try {
      const parts = dateString.split("/");
      if (parts.length !== 3) return null;

      // Create date in UTC to avoid timezone issues
      const year = parseInt(parts[2]);
      const month = parseInt(parts[1]) - 1; // Month is 0-indexed
      const day = parseInt(parts[0]);

      // Create date using UTC methods to ensure consistent timezone handling
      const date = new Date(Date.UTC(year, month, day));

      return date;
    } catch (error) {
      return null;
    }
  }

  isSameDate(date1, date2) {
    if (!date1 || !date2) return false;
    return (
      date1.getUTCFullYear() === date2.getUTCFullYear() &&
      date1.getUTCMonth() === date2.getUTCMonth() &&
      date1.getUTCDate() === date2.getUTCDate()
    );
  }

  // 🚀 NEW METHOD: Batch calculation (99% faster than loop per kode!)
  async calculateStockBatch(selectedDate) {
    try {
      // Ensure stock master data is loaded
      if (!this.stockData || this.stockData.length === 0) {
        await this.loadStockMasterData(true);
      }

      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);

      // Get previous day's stock for stokAwal
      const previousDay = new Date(selectedDate);
      previousDay.setDate(previousDay.getDate() - 1);
      previousDay.setHours(23, 59, 59, 999);

      // ✅ SINGLE BATCH QUERY for all stock calculations
      const kodeList = this.stockData.map((item) => item.kode);
      const stockMapPrevious = await StockService.calculateAllStocksBatch(previousDay, kodeList);
      const stockMapCurrent = await StockService.calculateAllStocksBatch(endOfDay, kodeList);

      // ✅ Get today's transactions in batch
      const todayTransactionsMap = await this.getTransactionsForDateBatch(startOfDay, endOfDay);

      // ✅ Build results in-memory (fast!)
      const stockResults = this.stockData.map((item) => {
        const kode = item.kode;
        const stokAwal = stockMapPrevious.get(kode) || 0;
        const stokAkhir = stockMapCurrent.get(kode) || 0;
        const todayTrans = todayTransactionsMap.get(kode) || {
          tambahStok: 0,
          laku: 0,
          free: 0,
          gantiLock: 0,
          return: 0,
        };

        return {
          ...item,
          stokAwal,
          tambahStok: todayTrans.tambahStok,
          laku: todayTrans.laku,
          free: todayTrans.free,
          gantiLock: todayTrans.gantiLock,
          return: todayTrans.return,
          stokAkhir,
        };
      });

      return stockResults;
    } catch (error) {
      throw error;
    }
  }

  // Helper: Get ALL transactions for date in one query
  async getTransactionsForDateBatch(startDate, endDate) {
    try {
      const transQuery = query(
        collection(firestore, "stokAksesorisTransaksi"),
        where("timestamp", ">=", Timestamp.fromDate(startDate)),
        where("timestamp", "<=", Timestamp.fromDate(endDate)),
      );

      const snapshot = await getDocs(transQuery);
      const transactionsMap = new Map();

      let stockAdditionCount = 0;
      snapshot.forEach((doc) => {
        const data = doc.data();
        const kode = data.kode;
        const jumlah = data.jumlah || 0;

        if (!transactionsMap.has(kode)) {
          transactionsMap.set(kode, {
            tambahStok: 0,
            laku: 0,
            free: 0,
            gantiLock: 0,
            return: 0,
          });
        }

        const trans = transactionsMap.get(kode);

        switch (data.jenis) {
          case "tambah":
          case "stockAddition":
            trans.tambahStok += jumlah;
            stockAdditionCount++;

            break;
          case "laku":
            trans.laku += jumlah;
            break;
          case "free":
            trans.free += jumlah;
            break;
          case "gantiLock":
            trans.gantiLock += jumlah;
            break;
          case "return":
            trans.return += jumlah;
            break;
        }
      });

      return transactionsMap;
    } catch (error) {
      return new Map();
    }
  }

  // Clear all cache
  clearAllCache() {
    this.cache.clear();
    this.cacheMeta.clear();
  }

  // Cleanup method
  destroy() {
    // Remove listeners
    this.removeTodayListener();

    // Destroy DataTable
    if ($.fn.DataTable.isDataTable("#stockTable")) {
      $("#stockTable").DataTable().destroy();
    }

    // Remove table style - TAMBAHKAN INI
    document.getElementById("stockTableStyle")?.remove();

    // Clear data
    this.stockData = [];
    this.filteredStockData = [];
    this.isDataLoaded = false;
    this.currentSelectedDate = null;
    this.isListeningToday = false;
  }
}

// Create global instance
const optimizedStockReport = new OptimizedStockReport();

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    // Check dependencies
    if (typeof firestore === "undefined") {
      throw new Error("Firebase Firestore not initialized");
    }

    if (typeof $ === "undefined") {
      throw new Error("jQuery not loaded");
    }

    // Initialize the optimized handler
    optimizedStockReport.init();
  } catch (error) {
    // Fallback to original handler if available
    if (typeof laporanStokHandler !== "undefined") {
      laporanStokHandler.init();
    }
  }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  optimizedStockReport.destroy();
});

// Export for potential use in other modules
export { optimizedStockReport as default };

// Export snapshot function for global access (called from main.js)
export async function ensureDailySnapshotExists() {
  // Check if already checked in this session
  if (sessionStorage.getItem("snapshotCheckedToday")) {
    return { success: true, created: false, message: "Already checked in this session" };
  }

  try {
    const result = await optimizedStockReport.checkAndCreateSnapshotWithLock();

    // Mark as checked for this session
    sessionStorage.setItem("snapshotCheckedToday", new Date().toISOString());

    return result;
  } catch (error) {
    console.error("Error ensuring daily snapshot:", error);
    return { success: false, created: false, message: error.message };
  }
}

// Backward compatibility
window.optimizedStockReport = optimizedStockReport;
window.ensureDailySnapshotExists = ensureDailySnapshotExists;
