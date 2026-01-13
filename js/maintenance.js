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
  returnBarang: {
    name: "returnBarang",
    dateField: "tanggal",
    dateType: "string",
    label: "Return Barang",
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

    // Validate critical elements
    const criticalElements = [
      { name: "deleteMonthInput", element: this.deleteMonthInput },
      { name: "collectionSelect", element: this.collectionSelect },
      { name: "btnDeleteOldData", element: this.btnDeleteOldData },
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
  }

  /**
   * Set default dates for inputs
   */
  setDefaultDates() {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const lastMonthStr = lastMonth.toISOString().slice(0, 7);

    this.deleteMonthInput.value = lastMonthStr;
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
   * Cleanup all active listeners
   */
  cleanupAllListeners() {
    for (const [key, unsubscribe] of this.activeListeners.entries()) {
      unsubscribe();
      this.activeListeners.delete(key);
    }
    this.activeListeners.clear();
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
        where(dateField, "<", Timestamp.fromDate(endDate))
      );
    } else {
      // string date format YYYY-MM-DD
      const startDateStr = `${year}-${month.padStart(2, "0")}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDateStr = `${year}-${month.padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;
      return query(
        collection(this.firestore, name),
        where(dateField, ">=", startDateStr),
        where(dateField, "<=", endDateStr)
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
        "Konfirmasi Hapus Data"
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
