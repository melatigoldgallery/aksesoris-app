/**
 * Maintenance System for Melati Gold Shop
 * Handles data exports and cleanup with enhanced caching
 */

import { firestore } from "./configFirebase.js";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  writeBatch,
  serverTimestamp,
  updateDoc,
  onSnapshot,
  getDoc,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

/**
 * Collection configurations for maintenance operations
 */
const COLLECTION_CONFIGS = {
  dailyStokSnapshot: {
    name: "dailyStokSnapshot",
    dateField: "date",
    dateType: "string", // YYYY-MM-DD format
    label: "Daily Stok Snapshot",
  },
  daily_stock_logs: {
    name: "daily_stock_logs",
    dateField: "date",
    dateType: "string",
    label: "Daily Stock Logs",
  },
  daily_stock_reports: {
    name: "daily_stock_reports",
    dateField: "date",
    dateType: "string",
    label: "Daily Stock Reports",
  },
  penjualanAksesoris: {
    name: "penjualanAksesoris",
    dateField: "timestamp",
    dateType: "timestamp",
    label: "Penjualan Aksesoris",
  },
  stokAksesorisTransaksi: {
    name: "stokAksesorisTransaksi",
    dateField: "timestamp",
    dateType: "timestamp",
    label: "Stok Transaksi",
  },
};

/**
 * Cache Manager for Export Operations
 */
class MaintenanceCacheManager {
  constructor() {
    this.prefix = "maintenance_";
    this.dataTTL = 10 * 60 * 1000; // 10 minutes for data
    this.dataCache = new Map(); // In-memory cache
    this.cacheTimestamps = new Map(); // Track cache timestamps

    // Data cache per collection per date: Map<collection_date, Map<docId, data>>
    this.collectionDataCache = new Map();
    this.collectionCacheTimestamps = new Map();

    // Load cache from sessionStorage on initialization
    this.loadCacheFromStorage();
  }

  /**
   * Get cache key for collection data
   */
  getCollectionCacheKey(collection, date) {
    return `${collection}_${date}`;
  }

  /**
   * Set collection data cache
   */
  setCollectionData(collection, date, docId, data) {
    const key = this.getCollectionCacheKey(collection, date);

    if (!this.collectionDataCache.has(key)) {
      this.collectionDataCache.set(key, new Map());
      this.collectionCacheTimestamps.set(key, Date.now());
    }

    this.collectionDataCache.get(key).set(docId, data);
  }

  /**
   * Get collection data cache
   */
  getCollectionData(collection, date) {
    const key = this.getCollectionCacheKey(collection, date);
    const timestamp = this.collectionCacheTimestamps.get(key);

    if (!timestamp || Date.now() - timestamp > this.dataTTL) {
      this.collectionDataCache.delete(key);
      this.collectionCacheTimestamps.delete(key);
      return null;
    }

    return this.collectionDataCache.get(key);
  }

  /**
   * Update single document in cache
   */
  updateCollectionDoc(collection, date, docId, data) {
    const key = this.getCollectionCacheKey(collection, date);
    const cache = this.collectionDataCache.get(key);

    if (cache) {
      cache.set(docId, data);
    }
  }

  /**
   * Remove document from cache
   */
  removeCollectionDoc(collection, date, docId) {
    const key = this.getCollectionCacheKey(collection, date);
    const cache = this.collectionDataCache.get(key);

    if (cache) {
      cache.delete(docId);
    }
  }

  /**
   * Clear collection cache
   */
  clearCollectionCache(collection, date = null) {
    if (date) {
      const key = this.getCollectionCacheKey(collection, date);
      this.collectionDataCache.delete(key);
      this.collectionCacheTimestamps.delete(key);
    } else {
      // Clear all cache for collection
      for (const key of this.collectionDataCache.keys()) {
        if (key.startsWith(`${collection}_`)) {
          this.collectionDataCache.delete(key);
          this.collectionCacheTimestamps.delete(key);
        }
      }
    }
  }

  /**
   * Load cache from sessionStorage
   */
  loadCacheFromStorage() {
    try {
      const cacheData = sessionStorage.getItem(`${this.prefix}cache_data`);
      const cacheTimestamps = sessionStorage.getItem(`${this.prefix}cache_timestamps`);

      if (cacheData) {
        const parsedData = JSON.parse(cacheData);
        Object.entries(parsedData).forEach(([key, value]) => {
          this.dataCache.set(key, value);
        });
      }

      if (cacheTimestamps) {
        const parsedTimestamps = JSON.parse(cacheTimestamps);
        Object.entries(parsedTimestamps).forEach(([key, value]) => {
          this.cacheTimestamps.set(key, value);
        });
      }
    } catch (error) {
      console.warn("Failed to load maintenance cache from storage:", error);
    }
  }

  /**
   * Save cache to sessionStorage
   */
  saveCacheToStorage() {
    try {
      const cacheData = Object.fromEntries(this.dataCache);
      const cacheTimestamps = Object.fromEntries(this.cacheTimestamps);

      sessionStorage.setItem(`${this.prefix}cache_data`, JSON.stringify(cacheData));
      sessionStorage.setItem(`${this.prefix}cache_timestamps`, JSON.stringify(cacheTimestamps));
    } catch (error) {
      this.clearOldCache();
    }
  }

  /**
   * Set cache with TTL
   */
  set(key, data, ttl = this.dataTTL) {
    const timestamp = Date.now();

    // Store in memory
    this.dataCache.set(key, data);
    this.cacheTimestamps.set(key, timestamp);

    // Save to sessionStorage
    this.saveCacheToStorage();
  }

  /**
   * Get cache data
   */
  get(key) {
    const data = this.dataCache.get(key);
    const timestamp = this.cacheTimestamps.get(key);

    if (!data || !timestamp) {
      return null;
    }

    // Check if cache is still valid
    if (Date.now() - timestamp > this.dataTTL) {
      this.remove(key);
      return null;
    }

    return data;
  }

  /**
   * Remove cache entry
   */
  remove(key) {
    this.dataCache.delete(key);
    this.cacheTimestamps.delete(key);
    this.saveCacheToStorage();
  }

  /**
   * Clear all cache
   */
  clear() {
    this.dataCache.clear();
    this.cacheTimestamps.clear();
    try {
      sessionStorage.removeItem(`${this.prefix}cache_data`);
      sessionStorage.removeItem(`${this.prefix}cache_timestamps`);
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Clear old cache entries
   */
  clearOldCache() {
    const now = Date.now();
    const keysToRemove = [];

    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.dataTTL) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      this.dataCache.delete(key);
      this.cacheTimestamps.delete(key);
    });

    if (keysToRemove.length > 0) {
      this.saveCacheToStorage();
    }
  }
}

/**
 * Main Maintenance Class
 */
class MaintenanceSystem {
  constructor() {
    this.firestore = firestore;
    this.cache = new MaintenanceCacheManager();
    this.isLoading = false;
    this.currentOperation = null;

    // Realtime listeners management
    this.activeListeners = new Map(); // Map<listenerKey, unsubscribe>
    this.currentDate = null;
    this.currentPenjualanDate = null;
    this.init();
  }

  /**
   * Initialize the maintenance system
   */
  async init() {
    try {
      this.initializeElements();
      this.attachEventListeners();
      this.setDefaultDates();
    } catch (error) {
      console.error("Error initializing maintenance system:", error);
      this.showAlert("Gagal menginisialisasi sistem maintenance", "error");
    }
  }

  /**
   * Initialize DOM elements
   */
  initializeElements() {
    // Input elements
    this.deleteMonthInput = document.getElementById("deleteMonth");
    this.collectionSelect = document.getElementById("collectionSelect");

    // Button elements
    this.btnDeleteOldData = document.getElementById("btnDeleteOldData");

    // Data management elements
    this.filterDateInput = document.getElementById("filterDate");
    this.btnShowData = document.getElementById("btnShowData");
    this.dataTableBody = document.getElementById("dataTableBody");
    this.dataLoading = document.getElementById("dataLoading");

    // Penjualan Aksesoris elements
    this.filterDatePenjualan = document.getElementById("filterDatePenjualan");
    this.btnShowPenjualan = document.getElementById("btnShowPenjualan");
    this.penjualanTableBody = document.getElementById("penjualanTableBody");
    this.penjualanLoading = document.getElementById("penjualanLoading");

    // Validate critical elements
    const criticalElements = [
      { name: "deleteMonthInput", element: this.deleteMonthInput },
      { name: "collectionSelect", element: this.collectionSelect },
      { name: "btnDeleteOldData", element: this.btnDeleteOldData },
      { name: "dataTableBody", element: this.dataTableBody },
    ];

    const missingElements = criticalElements.filter((e) => !e.element).map((e) => e.name);

    if (missingElements.length > 0) {
      throw new Error(`Missing critical DOM elements: ${missingElements.join(", ")}`);
    }
  }

  /**
   * Attach event listeners to buttons
   */
  attachEventListeners() {
    // Delete old data
    if (this.btnDeleteOldData) {
      this.btnDeleteOldData.addEventListener("click", () => this.handleDeleteOldData());
    }

    // Data management listeners
    if (this.btnShowData) {
      this.btnShowData.addEventListener("click", () => this.handleShowData());
    }
    if (this.filterDateInput) {
      this.filterDateInput.addEventListener("change", () => this.onFilterDateChange());
    }

    // Penjualan Aksesoris listeners
    if (this.btnShowPenjualan) {
      this.btnShowPenjualan.addEventListener("click", () => this.handleShowPenjualan());
    }
    if (this.filterDatePenjualan) {
      this.filterDatePenjualan.addEventListener("change", () => {
        if (this.filterDatePenjualan.value) this.handleShowPenjualan();
      });
    }
  }

  /**
   * Set default dates for inputs
   */
  setDefaultDates() {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const lastMonthStr = lastMonth.toISOString().slice(0, 7);

    this.deleteMonthInput.value = lastMonthStr;

    // Set default filter date to today
    const today = new Date().toISOString().split("T")[0];
    this.filterDateInput.value = today;
    this.filterDatePenjualan.value = today;
  }

  /**
   * Handle filter date change
   */
  onFilterDateChange() {
    // Auto load data when date changes
    if (this.filterDateInput.value) {
      this.handleShowData();
    }
  }

  /**
   * Handle show data button click
   */
  async handleShowData() {
    const selectedDate = this.filterDateInput.value;
    if (!selectedDate) {
      this.showAlert("Pilih tanggal terlebih dahulu", "warning");
      return;
    }

    try {
      this.showDataLoading(true);
      await this.loadStokTransaksiData(selectedDate);
    } catch (error) {
      this.showAlert("Gagal memuat data: " + error.message, "error");
    } finally {
      this.showDataLoading(false);
    }
  }

  /**
   * Setup realtime listener for stok transaksi data
   */
  async loadStokTransaksiData(dateStr) {
    try {
      // Detach previous listener if exists
      this.detachListener("stokAksesoris");

      // Check cache first
      const cachedData = this.cache.getCollectionData("stokAksesorisTransaksi", dateStr);
      if (cachedData) {
        const dataArray = Array.from(cachedData.values());
        this.renderDataTable(dataArray);
      }

      this.currentDate = dateStr;
      const selectedDate = new Date(dateStr);
      const startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      const endDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);

      const q = query(
        collection(this.firestore, "stokAksesorisTransaksi"),
        where("timestamp", ">=", Timestamp.fromDate(startDate)),
        where("timestamp", "<", Timestamp.fromDate(endDate)),
        orderBy("timestamp", "desc"),
      );

      // Setup realtime listener
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            const docData = { id: change.doc.id, ...change.doc.data() };

            if (change.type === "added") {
              this.cache.setCollectionData("stokAksesorisTransaksi", dateStr, change.doc.id, docData);
              if (cachedData) {
                this.addRowToTable(docData);
              }
            } else if (change.type === "modified") {
              this.cache.updateCollectionDoc("stokAksesorisTransaksi", dateStr, change.doc.id, docData);
              this.updateRowInTable(docData);
            } else if (change.type === "removed") {
              this.cache.removeCollectionDoc("stokAksesorisTransaksi", dateStr, change.doc.id);
              this.removeRowFromTable(change.doc.id);
            }
          });

          // Initial render if no cache
          if (!cachedData) {
            const allData = [];
            snapshot.forEach((doc) => {
              const docData = { id: doc.id, ...doc.data() };
              this.cache.setCollectionData("stokAksesorisTransaksi", dateStr, doc.id, docData);
              allData.push(docData);
            });
            this.renderDataTable(allData);
          }
        },
        (error) => {
          this.showAlert("Error memuat data realtime: " + error.message, "error");
        },
      );

      this.activeListeners.set("stokAksesoris", unsubscribe);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add new row to table (realtime)
   */
  addRowToTable(item) {
    const existingRow = document.querySelector(`tr[data-id="${item.id}"]`);
    if (existingRow) return; // Already exists

    const date = item.timestamp ? new Date(item.timestamp.seconds * 1000) : null;
    const dateStr = date ? date.toLocaleDateString("id-ID") : "";
    const timeStr =
      item.timestr || (date ? date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "");

    const rowHtml = `
      <tr data-id="${item.id}" style="animation: fadeIn 0.3s;">
        <td class="date-cell">${dateStr}</td>
        <td class="time-cell">${timeStr}</td>
        <td class="sales-cell">${item.keterangan || ""}</td>
        <td class="kode-cell">${item.kode || ""}</td>
        <td class="jumlah-cell">${item.jumlah || 0}</td>
        <td class="action-cell">
          <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editRow('${item.id}')">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deleteRow('${item.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;

    this.dataTableBody.insertAdjacentHTML("afterbegin", rowHtml);
  }

  /**
   * Update existing row in table (realtime)
   */
  updateRowInTable(item) {
    const row = document.querySelector(`tr[data-id="${item.id}"]`);
    if (!row) return;

    const date = item.timestamp ? new Date(item.timestamp.seconds * 1000) : null;
    const dateStr = date ? date.toLocaleDateString("id-ID") : "";
    const timeStr =
      item.timestr || (date ? date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "");

    row.style.animation = "pulse 0.5s";
    row.querySelector(".date-cell").textContent = dateStr;
    row.querySelector(".time-cell").textContent = timeStr;
    row.querySelector(".sales-cell").textContent = item.keterangan || "";
    row.querySelector(".kode-cell").textContent = item.kode || "";
    row.querySelector(".jumlah-cell").textContent = item.jumlah || 0;
  }

  /**
   * Remove row from table (realtime)
   */
  removeRowFromTable(docId) {
    const row = document.querySelector(`tr[data-id="${docId}"]`);
    if (row) {
      row.style.animation = "fadeOut 0.3s";
      setTimeout(() => row.remove(), 300);
    }
  }

  /**
   * Detach listener
   */
  detachListener(key) {
    const unsubscribe = this.activeListeners.get(key);
    if (unsubscribe) {
      unsubscribe();
      this.activeListeners.delete(key);
    }
  }

  /**
   * Render data table
   */
  renderDataTable(data) {
    if (data.length === 0) {
      this.dataTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted">
          Tidak ada data untuk tanggal yang dipilih
        </td>
      </tr>
    `;
      return;
    }

    this.dataTableBody.innerHTML = data
      .map((item) => {
        const date = item.timestamp ? new Date(item.timestamp.seconds * 1000) : null;
        const dateStr = date ? date.toLocaleDateString("id-ID") : "";
        const timeStr =
          item.timestr || (date ? date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "");

        return `
      <tr data-id="${item.id}">
        <td class="date-cell">${dateStr}</td>
        <td class="time-cell">${timeStr}</td>
        <td class="sales-cell">${item.keterangan || ""}</td>
        <td class="kode-cell">${item.kode || ""}</td>
        <td class="jumlah-cell">${item.jumlah || 0}</td>
        <td class="action-cell">
          <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editRow('${item.id}')">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deleteRow('${item.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
      })
      .join("");
  }

  /**
   * Edit row
   */
  editRow(docId) {
    const row = document.querySelector(`tr[data-id="${docId}"]`);
    if (!row) return;

    const dateCell = row.querySelector(".date-cell");
    const timeCell = row.querySelector(".time-cell");
    const kodeCell = row.querySelector(".kode-cell");
    const jumlahCell = row.querySelector(".jumlah-cell");
    const actionCell = row.querySelector(".action-cell");

    // Store original values
    const originalDate = dateCell.textContent;
    const originalTime = timeCell.textContent;
    const originalKode = kodeCell.textContent;
    const originalJumlah = jumlahCell.textContent;

    // Convert to input fields
    const dateValue = originalDate
      ? new Date(originalDate.split("/").reverse().join("-")).toISOString().split("T")[0]
      : "";

    dateCell.innerHTML = `<input type="date" class="form-control form-control-sm" value="${dateValue}">`;
    timeCell.innerHTML = `<input type="time" class="form-control form-control-sm" value="${originalTime}">`;
    kodeCell.innerHTML = `<input type="text" class="form-control form-control-sm" value="${originalKode}">`;
    jumlahCell.innerHTML = `<input type="number" class="form-control form-control-sm" value="${originalJumlah}">`;

    // Change action buttons
    actionCell.innerHTML = `
    <button class="btn btn-sm btn-success me-1" onclick="maintenanceSystem.saveRow('${docId}')">
      <i class="fas fa-save"></i> Simpan
    </button>
    <button class="btn btn-sm btn-secondary" onclick="maintenanceSystem.cancelEdit('${docId}', '${originalDate}', '${originalTime}', '${originalKode}', '${originalJumlah}')">
      <i class="fas fa-times"></i> Batal
    </button>
  `;
  }

  /**
   * Cancel edit
   */
  cancelEdit(docId, originalDate, originalTime, originalKode, originalJumlah) {
    const row = document.querySelector(`tr[data-id="${docId}"]`);
    if (!row) return;

    const dateCell = row.querySelector(".date-cell");
    const timeCell = row.querySelector(".time-cell");
    const kodeCell = row.querySelector(".kode-cell");
    const jumlahCell = row.querySelector(".jumlah-cell");
    const actionCell = row.querySelector(".action-cell");

    // Restore original values
    dateCell.textContent = originalDate;
    timeCell.textContent = originalTime;
    kodeCell.textContent = originalKode;
    jumlahCell.textContent = originalJumlah;

    // Restore action buttons
    actionCell.innerHTML = `
    <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editRow('${docId}')">
      <i class="fas fa-edit"></i> Edit
    </button>
    <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deleteRow('${docId}')">
      <i class="fas fa-trash"></i> Hapus
    </button>
  `;
  }

  /**
   * Save row
   */
  async saveRow(docId) {
    const row = document.querySelector(`tr[data-id="${docId}"]`);
    if (!row) return;

    try {
      const dateInput = row.querySelector(".date-cell input").value;
      const timeInput = row.querySelector(".time-cell input").value;
      const kodeInput = row.querySelector(".kode-cell input").value;
      const jumlahInput = parseInt(row.querySelector(".jumlah-cell input").value) || 0;

      if (!dateInput || !kodeInput) {
        this.showAlert("Tanggal dan Kode harus diisi", "warning");
        return;
      }

      // Update Firestore
      const docRef = doc(this.firestore, "stokAksesorisTransaksi", docId);

      // Get current data to preserve stok direction
      const currentDoc = await getDoc(docRef);
      const currentData = currentDoc.data();
      const wasIncrease = (currentData.stokSesudah || 0) > (currentData.stokSebelum || 0);

      const updateData = {
        timestamp: Timestamp.fromDate(new Date(dateInput)),
        timestr: timeInput,
        kode: kodeInput,
        stokSebelum: wasIncrease ? 0 : jumlahInput,
        stokSesudah: wasIncrease ? jumlahInput : 0,
        lastUpdated: serverTimestamp(),
      };

      await updateDoc(docRef, updateData);

      // Update display
      const dateCell = row.querySelector(".date-cell");
      const timeCell = row.querySelector(".time-cell");
      const kodeCell = row.querySelector(".kode-cell");
      const jumlahCell = row.querySelector(".jumlah-cell");
      const actionCell = row.querySelector(".action-cell");

      dateCell.textContent = new Date(dateInput).toLocaleDateString("id-ID");
      timeCell.textContent = timeInput;
      kodeCell.textContent = kodeInput;
      jumlahCell.textContent = jumlahInput;

      // Restore action buttons
      actionCell.innerHTML = `
      <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editRow('${docId}')">
        <i class="fas fa-edit"></i> Edit
      </button>
      <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deleteRow('${docId}')">
        <i class="fas fa-trash"></i> Hapus
      </button>
    `;

      const docData = await getDoc(docRef);
      if (docData.exists()) {
        this.cache.updateCollectionDoc("stokAksesorisTransaksi", this.currentDate, docId, {
          id: docId,
          ...docData.data(),
        });
      }

      this.showAlert("Data berhasil diupdate", "success");
    } catch (error) {
      this.showAlert("Gagal menyimpan data: " + error.message, "error");
    }
  }

  /**
   * Delete row
   */
  async deleteRow(docId) {
    const confirmed = await this.showConfirmation("Apakah Anda yakin ingin menghapus data ini?", "Konfirmasi Hapus");

    if (!confirmed) return;

    try {
      await deleteDoc(doc(this.firestore, "stokAksesorisTransaksi", docId));

      const remainingRows = this.dataTableBody.querySelectorAll("tr");
      if (remainingRows.length === 0) {
        this.dataTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-muted">
            Tidak ada data untuk tanggal yang dipilih
          </td>
        </tr>
      `;
      }

      this.showAlert("Data berhasil dihapus", "success");
    } catch (error) {
      this.showAlert("Gagal menghapus data: " + error.message, "error");
    }
  }

  /**
   * Show/hide data loading
   */
  showDataLoading(show) {
    if (show) {
      this.dataLoading.style.display = "block";
      this.dataTableBody.innerHTML = "";
    } else {
      this.dataLoading.style.display = "none";
    }
  }

  // ==================== PENJUALAN AKSESORIS METHODS ====================

  async handleShowPenjualan() {
    const selectedDate = this.filterDatePenjualan.value;
    if (!selectedDate) {
      this.showAlert("Pilih tanggal terlebih dahulu", "warning");
      return;
    }
    try {
      this.penjualanLoading.style.display = "block";
      this.penjualanTableBody.innerHTML = "";
      await this.loadPenjualanData(selectedDate);
    } catch (error) {
      this.showAlert("Gagal memuat data: " + error.message, "error");
    } finally {
      this.penjualanLoading.style.display = "none";
    }
  }

  async loadPenjualanData(dateStr) {
    this.detachListener("penjualan");

    const cachedData = this.cache.getCollectionData("penjualanAksesoris", dateStr);
    if (cachedData) {
      const dataArray = this.flattenPenjualanData(Array.from(cachedData.values()));
      this.renderPenjualanTable(dataArray);
    }

    this.currentPenjualanDate = dateStr;
    const selectedDate = new Date(dateStr);
    const startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const endDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);

    const q = query(
      collection(this.firestore, "penjualanAksesoris"),
      where("timestamp", ">=", Timestamp.fromDate(startDate)),
      where("timestamp", "<", Timestamp.fromDate(endDate)),
      orderBy("timestamp", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const docData = { id: change.doc.id, ...change.doc.data() };

          if (change.type === "added") {
            this.cache.setCollectionData("penjualanAksesoris", dateStr, change.doc.id, docData);
            if (cachedData) {
              this.addPenjualanRowsToTable(docData);
            }
          } else if (change.type === "modified") {
            this.cache.updateCollectionDoc("penjualanAksesoris", dateStr, change.doc.id, docData);
            this.updatePenjualanRowsInTable(docData);
          } else if (change.type === "removed") {
            this.cache.removeCollectionDoc("penjualanAksesoris", dateStr, change.doc.id);
            this.removePenjualanRowsFromTable(change.doc.id);
          }
        });

        if (!cachedData) {
          const allData = [];
          snapshot.forEach((doc) => {
            const docData = { id: doc.id, ...doc.data() };
            this.cache.setCollectionData("penjualanAksesoris", dateStr, doc.id, docData);
            allData.push(docData);
          });
          const flatData = this.flattenPenjualanData(allData);
          this.renderPenjualanTable(flatData);
        }
      },
      (error) => {
        console.error("Error in penjualan realtime listener:", error);
        this.showAlert("Error memuat data penjualan realtime: " + error.message, "error");
      },
    );

    this.activeListeners.set("penjualan", unsubscribe);
  }

  /**
   * Flatten penjualan data (doc with items array to flat array)
   */
  flattenPenjualanData(docs) {
    const data = [];
    docs.forEach((doc) => {
      const docData = doc;
      const items = Array.isArray(docData.items) ? docData.items : [];
      items.forEach((item, idx) => {
        data.push({
          docId: doc.id,
          itemIndex: idx,
          timestamp: docData.timestamp,
          sales: docData.sales || "",
          barcode: item.kodeText || item.kode || "",
          kodeLock: item.kodeLock || item.kode || "-",
          nama: item.nama || "",
          kadar: item.kadar || "-",
          berat: item.berat || 0,
          harga: item.harga || item.totalHarga || 0,
        });
      });
    });
    return data;
  }

  /**
   * Add penjualan rows to table (realtime)
   */
  addPenjualanRowsToTable(docData) {
    const items = Array.isArray(docData.items) ? docData.items : [];
    items.forEach((item, idx) => {
      const rowId = `${docData.id}_${idx}`;
      const existingRow = document.querySelector(`tr[data-id="${rowId}"]`);
      if (existingRow) return;

      const date = docData.timestamp ? new Date(docData.timestamp.seconds * 1000) : null;
      const dateStr = date ? date.toLocaleDateString("id-ID") : "";
      const timeStr = date ? date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
      const hargaFormatted = new Intl.NumberFormat("id-ID").format(item.harga || 0);

      const rowHtml = `
        <tr data-id="${rowId}" data-doc-id="${docData.id}" data-item-index="${idx}" style="animation: fadeIn 0.3s;">
          <td class="pj-date-cell">${dateStr}</td>
          <td class="pj-time-cell">${timeStr}</td>
          <td class="pj-sales-cell">${docData.sales || ""}</td>
          <td class="pj-barcode-cell">${item.barcode || ""}</td>
          <td class="pj-kode-lock-cell">${item.kodeLock || ""}</td>
          <td class="pj-nama-cell">${item.nama || ""}</td>
          <td class="pj-kadar-cell">${item.kadar || ""}</td>
          <td class="pj-berat-cell">${item.berat || ""}</td>
          <td class="pj-harga-cell">${hargaFormatted}</td>
          <td class="pj-action-cell">
            <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editPenjualanRow('${rowId}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deletePenjualanRow('${docData.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;

      this.penjualanTableBody.insertAdjacentHTML("afterbegin", rowHtml);
    });
  }

  /**
   * Update penjualan rows in table (realtime)
   */
  updatePenjualanRowsInTable(docData) {
    // Remove old rows for this doc
    document.querySelectorAll(`tr[data-doc-id="${docData.id}"]`).forEach((row) => row.remove());
    // Add updated rows
    this.addPenjualanRowsToTable(docData);
  }

  /**
   * Remove penjualan rows from table (realtime)
   */
  removePenjualanRowsFromTable(docId) {
    document.querySelectorAll(`tr[data-doc-id="${docId}"]`).forEach((row) => {
      row.style.animation = "fadeOut 0.3s";
      setTimeout(() => row.remove(), 300);
    });
  }

  renderPenjualanTable(data) {
    if (data.length === 0) {
      this.penjualanTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Tidak ada data untuk tanggal yang dipilih</td></tr>`;
      return;
    }
    this.penjualanTableBody.innerHTML = data
      .map((item) => {
        const date = item.timestamp ? new Date(item.timestamp.seconds * 1000) : null;
        const dateStr = date ? date.toLocaleDateString("id-ID") : "";
        const timeStr = date ? date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
        const rowId = `${item.docId}_${item.itemIndex}`;
        const hargaFormatted = new Intl.NumberFormat("id-ID").format(item.harga);
        return `
        <tr data-id="${rowId}" data-doc-id="${item.docId}" data-item-index="${item.itemIndex}">
          <td class="pj-date-cell">${dateStr}</td>
          <td class="pj-time-cell">${timeStr}</td>
          <td class="pj-sales-cell">${item.sales}</td>
          <td class="pj-barcode-cell">${item.barcode}</td>
          <td class="pj-kode-lock-cell">${item.kodeLock}</td>
          <td class="pj-nama-cell">${item.nama}</td>
          <td class="pj-kadar-cell">${item.kadar}</td>
          <td class="pj-berat-cell">${item.berat}</td>
          <td class="pj-harga-cell">${hargaFormatted}</td>
          <td class="pj-action-cell">
            <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editPenjualanRow('${rowId}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deletePenjualanRow('${item.docId}')">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>`;
      })
      .join("");
  }

  editPenjualanRow(rowId) {
    const row = document.querySelector(`tr[data-id="${rowId}"]`);
    if (!row) return;
    const dateCell = row.querySelector(".pj-date-cell");
    const kodeCell = row.querySelector(".pj-barcode-cell");
    const namaCell = row.querySelector(".pj-nama-cell");
    const actionCell = row.querySelector(".pj-action-cell");

    const originalDate = dateCell.textContent;
    const originalKode = kodeCell.textContent;
    const originalNama = namaCell.textContent;
    const dateValue = originalDate
      ? new Date(originalDate.split("/").reverse().join("-")).toISOString().split("T")[0]
      : "";

    dateCell.innerHTML = `<input type="date" class="form-control form-control-sm" value="${dateValue}">`;
    kodeCell.innerHTML = `<input type="text" class="form-control form-control-sm" value="${originalKode}">`;
    namaCell.innerHTML = `<input type="text" class="form-control form-control-sm" value="${originalNama}">`;
    actionCell.innerHTML = `
      <button class="btn btn-sm btn-success me-1" onclick="maintenanceSystem.savePenjualanRow('${rowId}')"><i class="fas fa-save"></i></button>
      <button class="btn btn-sm btn-secondary" onclick="maintenanceSystem.cancelPenjualanEdit('${rowId}', '${originalDate}', '${originalKode}', '${originalNama}')"><i class="fas fa-times"></i></button>`;
  }

  cancelPenjualanEdit(rowId, originalDate, originalKode, originalNama) {
    const row = document.querySelector(`tr[data-id="${rowId}"]`);
    if (!row) return;
    row.querySelector(".pj-date-cell").textContent = originalDate;
    row.querySelector(".pj-barcode-cell").textContent = originalKode;
    row.querySelector(".pj-nama-cell").textContent = originalNama;
    row.querySelector(".pj-action-cell").innerHTML = `
      <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editPenjualanRow('${rowId}')"><i class="fas fa-edit"></i></button>
      <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deletePenjualanRow('${row.dataset.docId}')"><i class="fas fa-trash"></i></button>`;
  }

  async savePenjualanRow(rowId) {
    const row = document.querySelector(`tr[data-id="${rowId}"]`);
    if (!row) return;
    const docId = row.dataset.docId;
    const itemIndex = parseInt(row.dataset.itemIndex);
    const dateInput = row.querySelector(".pj-date-cell input").value;
    const kodeInput = row.querySelector(".pj-barcode-cell input").value;
    const namaInput = row.querySelector(".pj-nama-cell input").value;

    if (!dateInput || !kodeInput) {
      this.showAlert("Tanggal dan Kode harus diisi", "warning");
      return;
    }

    try {
      const docRef = doc(this.firestore, "penjualanAksesoris", docId);
      const docSnap = await getDocs(
        query(collection(this.firestore, "penjualanAksesoris"), where("__name__", "==", docId)),
      );
      if (docSnap.empty) throw new Error("Document not found");

      const currentData = docSnap.docs[0].data();
      const items = [...(currentData.items || [])];
      if (items[itemIndex]) {
        items[itemIndex].kodeText = kodeInput;
        items[itemIndex].nama = namaInput;
      }

      await updateDoc(docRef, {
        timestamp: Timestamp.fromDate(new Date(dateInput)),
        items: items,
        lastUpdated: serverTimestamp(),
      });

      row.querySelector(".pj-date-cell").textContent = new Date(dateInput).toLocaleDateString("id-ID");
      row.querySelector(".pj-barcode-cell").textContent = kodeInput;
      row.querySelector(".pj-nama-cell").textContent = namaInput;
      row.querySelector(".pj-action-cell").innerHTML = `
        <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editPenjualanRow('${rowId}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deletePenjualanRow('${docId}')"><i class="fas fa-trash"></i></button>`;
      this.showAlert("Data berhasil diupdate", "success");
    } catch (error) {
      this.showAlert("Gagal menyimpan: " + error.message, "error");
    }
  }

  async deletePenjualanRow(docId) {
    const confirmed = await this.showConfirmation(
      "Apakah Anda yakin ingin menghapus transaksi ini?",
      "Konfirmasi Hapus",
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(this.firestore, "penjualanAksesoris", docId));

      setTimeout(() => {
        if (this.penjualanTableBody.querySelectorAll("tr").length === 0) {
          this.penjualanTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Tidak ada data untuk tanggal yang dipilih</td></tr>`;
        }
      }, 500);

      this.showAlert("Data berhasil dihapus", "success");
    } catch (error) {
      this.showAlert("Gagal menghapus: " + error.message, "error");
    }
  }

  /**
   * Build query for collection and month
   */
  buildDeleteQuery(collectionConfig, monthStr) {
    const [year, month] = monthStr.split("-");
    const { name, dateField, dateType } = collectionConfig;

    if (dateType === "timestamp") {
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 1);
      return query(
        collection(this.firestore, name),
        where(dateField, ">=", Timestamp.fromDate(startDate)),
        where(dateField, "<", Timestamp.fromDate(endDate)),
      );
    } else {
      // string date format YYYY-MM-DD
      const startDateStr = `${year}-${month.padStart(2, "0")}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDateStr = `${year}-${month.padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;
      return query(
        collection(this.firestore, name),
        where(dateField, ">=", startDateStr),
        where(dateField, "<=", endDateStr),
      );
    }
  }

  /**
   * Enhanced loading management
   */
  showLoading(title, subtitle) {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.currentOperation = title;

    try {
      const loadingText = document.getElementById("loadingText");
      const loadingSubtext = document.getElementById("loadingSubtext");

      if (loadingText) loadingText.textContent = title;
      if (loadingSubtext) loadingSubtext.textContent = subtitle;

      setTimeout(() => {
        if (this.isLoading && this.currentOperation === title) {
          this.hideLoading();
        }
      }, 30000);
    } catch (error) {
      this.isLoading = false;
    }
  }

  /**
   * Cleanup all active listeners
   */
  cleanupAllListeners() {
    for (const [key, unsubscribe] of this.activeListeners.entries()) {
      unsubscribe();
    }
    this.activeListeners.clear();
  }

  /**
   * Enhanced loading hide with proper state management
   */
  hideLoading() {
    try {
      const modalElement = document.getElementById("loadingModal");

      if (modalElement) {
        const backdrops = document.querySelectorAll(".modal-backdrop");
        backdrops.forEach((backdrop) => backdrop.remove());

        modalElement.style.display = "none";
        modalElement.classList.remove("show");
        modalElement.setAttribute("aria-hidden", "true");
        modalElement.removeAttribute("aria-modal");

        document.body.classList.remove("modal-open");
        document.body.style.overflow = "";
        document.body.style.paddingRight = "";
      }

      this.isLoading = false;
      this.currentOperation = null;
    } catch (error) {
      this.isLoading = false;
      this.currentOperation = null;
      const modalElement = document.getElementById("loadingModal");
      if (modalElement) {
        modalElement.style.display = "none";
      }
      document.body.classList.remove("modal-open");
      document.body.style.overflow = "";
    }
  }

  /**
   * Handle delete old data - Direct delete with fetch and confirm
   */
  async handleDeleteOldData() {
    const selectedCollection = this.collectionSelect.value;
    const selectedMonth = this.deleteMonthInput.value;

    // Validate input
    if (!selectedCollection) {
      this.showAlert("Pilih koleksi terlebih dahulu", "warning");
      return;
    }

    if (!selectedMonth) {
      this.showAlert("Pilih bulan terlebih dahulu", "warning");
      return;
    }

    try {
      // Show loading while fetching documents
      this.showLoading("Mengambil Data...", "Memuat dokumen untuk dihapus");

      let allDocs = [];
      let collectionSummary = [];

      // Fetch documents based on selection
      if (selectedCollection === "all") {
        // Fetch all collections
        for (const key of Object.keys(COLLECTION_CONFIGS)) {
          const config = COLLECTION_CONFIGS[key];
          const q = this.buildDeleteQuery(config, selectedMonth);
          const snapshot = await getDocs(q);

          if (snapshot.docs.length > 0) {
            allDocs.push(...snapshot.docs);
            collectionSummary.push({
              label: config.label,
              count: snapshot.docs.length,
            });
          }
        }
      } else {
        // Fetch single collection
        const config = COLLECTION_CONFIGS[selectedCollection];
        const q = this.buildDeleteQuery(config, selectedMonth);
        const snapshot = await getDocs(q);
        allDocs = snapshot.docs;

        if (allDocs.length > 0) {
          collectionSummary.push({
            label: config.label,
            count: allDocs.length,
          });
        }
      }

      this.hideLoading();

      // Check if there's data to delete
      if (allDocs.length === 0) {
        this.showAlert("Tidak ada data untuk dihapus pada periode yang dipilih", "info");
        return;
      }

      // Show confirmation with detailed summary
      const collectionLabel =
        selectedCollection === "all" ? "SEMUA KOLEKSI" : COLLECTION_CONFIGS[selectedCollection].label;
      const summaryText = collectionSummary.map((s) => `• ${s.label}: ${s.count} dokumen`).join("\n");

      const confirmed = await this.showConfirmation(
        `HAPUS ${allDocs.length} DOKUMEN?\n\n${summaryText}\n\nBulan: ${selectedMonth}\n\n⚠️ PERINGATAN: Data tidak dapat dikembalikan!`,
        "Konfirmasi Hapus Data",
      );

      if (!confirmed) return;

      // Delete with progress indicator
      this.showLoading("Menghapus Data...", `0/${allDocs.length} dokumen (0%)`);
      await this.deleteBatchWithProgress(allDocs, allDocs.length, 0);

      // Clear cache and show success
      this.cache.clear();
      this.showAlert(`${allDocs.length} dokumen berhasil dihapus!`, "success");
    } catch (error) {
      this.showAlert("Gagal menghapus data: " + error.message, "error");
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Delete documents in batches with progress indicator
   */
  async deleteBatchWithProgress(docs, totalCount, startCount) {
    const batchSize = 100;
    const totalBatches = Math.ceil(docs.length / batchSize);
    let currentCount = startCount;

    for (let j = 0; j < totalBatches; j++) {
      const batch = writeBatch(this.firestore);
      const startIndex = j * batchSize;
      const endIndex = Math.min(startIndex + batchSize, docs.length);

      for (let k = startIndex; k < endIndex; k++) {
        batch.delete(docs[k].ref);
      }

      await batch.commit();

      currentCount += endIndex - startIndex;
      const percentage = Math.round((currentCount / totalCount) * 100);

      const loadingSubtext = document.getElementById("loadingSubtext");
      if (loadingSubtext) {
        loadingSubtext.textContent = `${currentCount}/${totalCount} dokumen (${percentage}%)`;
      }
    }
  }

  /**
   * Show alert message
   */
  showAlert(message, type = "info") {
    const alertDiv = document.createElement("div");
    alertDiv.className = `alert alert-${type === "error" ? "danger" : type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    let alertContainer = document.getElementById("alertContainer");
    if (!alertContainer) {
      alertContainer = document.createElement("div");
      alertContainer.id = "alertContainer";
      alertContainer.className = "position-fixed top-0 end-0 p-3";
      alertContainer.style.zIndex = "9999";
      document.body.appendChild(alertContainer);
    }

    alertContainer.appendChild(alertDiv);

    setTimeout(() => {
      if (alertDiv.parentNode) {
        alertDiv.remove();
      }
    }, 5000);
  }

  /**
   * Show confirmation dialog
   */
  showConfirmation(message, title = "Konfirmasi") {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal fade";
      modal.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${title}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <p>${message}</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Batal</button>
              <button type="button" class="btn btn-danger" id="confirmButton">Ya, Lanjutkan</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      const bsModal = new bootstrap.Modal(modal);

      modal.querySelector("#confirmButton").addEventListener("click", () => {
        resolve(true);
        bsModal.hide();
      });

      modal.addEventListener("hidden.bs.modal", () => {
        resolve(false);
        modal.remove();
      });

      bsModal.show();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.maintenanceSystem = new MaintenanceSystem();

  window.addEventListener("beforeunload", () => {
    if (window.maintenanceSystem) {
      window.maintenanceSystem.cleanupAllListeners();
    }
  });
});
