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
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

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
      console.warn("Failed to save maintenance cache to storage:", error);
      // Clear old cache if storage is full
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
      console.warn("Failed to clear cache from storage:", error);
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
    this.exportedMonths = new Set(); // Track exported months
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
      this.updateDeleteButtonState();

      console.log("Maintenance system initialized successfully");
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
    this.exportMonthInput = document.getElementById("exportMonth");
    this.deleteMonthInput = document.getElementById("deleteMonth");

    // Button elements
    this.btnDeleteOldData = document.getElementById("btnDeleteOldData");

    // Export buttons
    this.btnExportPenjualan = document.getElementById("btnExportPenjualan");
    this.btnExportStocks = document.getElementById("btnExportStocks");
    this.btnExportRestokBarang = document.getElementById("btnExportRestokBarang");

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
      { name: "exportMonthInput", element: this.exportMonthInput },
      { name: "btnExportPenjualan", element: this.btnExportPenjualan },
      { name: "btnExportStocks", element: this.btnExportStocks },
      { name: "btnExportRestokBarang", element: this.btnExportRestokBarang },
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

    // Export buttons
    if (this.btnExportPenjualan) {
      this.btnExportPenjualan.addEventListener("click", () => this.handleExportData("penjualanAksesoris"));
    }
    if (this.btnExportStocks) {
      this.btnExportStocks.addEventListener("click", () => this.handleExportData("stocks"));
    }
    if (this.btnExportRestokBarang) {
      this.btnExportRestokBarang.addEventListener("click", () => this.handleExportData("restokBarang"));
    }

    // Month selection change listeners
    if (this.exportMonthInput) {
      this.exportMonthInput.addEventListener("change", () => this.onExportMonthChange());
    }
    if (this.deleteMonthInput) {
      this.deleteMonthInput.addEventListener("change", () => this.onDeleteMonthChange());
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

    this.exportMonthInput.value = lastMonthStr;
    this.deleteMonthInput.value = lastMonthStr;

    // Set default filter date to today
    const today = new Date().toISOString().split("T")[0];
    this.filterDateInput.value = today;
    this.filterDatePenjualan.value = today;
  }

  // Handle export month change
  onExportMonthChange() {
    this.updateDeleteButtonState();
  }

  /**
   * Handle delete month change
   */
  onDeleteMonthChange() {
    this.updateDeleteButtonState();
  }

  /**
   * Update delete button state based on exported months
   */
  updateDeleteButtonState() {
    const deleteMonth = this.deleteMonthInput.value;
    const canDelete = deleteMonth && this.exportedMonths.has(deleteMonth);

    this.btnDeleteOldData.disabled = !canDelete;

    if (canDelete) {
      this.btnDeleteOldData.classList.remove("disabled");
    } else {
      this.btnDeleteOldData.classList.add("disabled");
    }
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
      console.error("Error loading data:", error);
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
        orderBy("timestamp", "desc")
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
          console.error("Error in realtime listener:", error);
          this.showAlert("Error memuat data realtime: " + error.message, "error");
        }
      );

      this.activeListeners.set("stokAksesoris", unsubscribe);
    } catch (error) {
      console.error("Error loading stok transaksi data:", error);
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
        <td class="nama-cell">${item.nama || ""}</td>
        <td class="stok-sebelum-cell">${item.stokSebelum || 0}</td>
        <td class="stok-sesudah-cell">${item.stokSesudah || 0}</td>
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
    row.querySelector(".nama-cell").textContent = item.nama || "";
    row.querySelector(".stok-sebelum-cell").textContent = item.stokSebelum || 0;
    row.querySelector(".stok-sesudah-cell").textContent = item.stokSesudah || 0;
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
        <td colspan="8" class="text-center text-muted">
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
        <td class="nama-cell">${item.nama || ""}</td>
        <td class="stok-sebelum-cell">${item.stokSebelum || 0}</td>
        <td class="stok-sesudah-cell">${item.stokSesudah || 0}</td>
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
    const stokSebelumCell = row.querySelector(".stok-sebelum-cell");
    const stokSesudahCell = row.querySelector(".stok-sesudah-cell");
    const actionCell = row.querySelector(".action-cell");

    // Store original values
    const originalDate = dateCell.textContent;
    const originalTime = timeCell.textContent;
    const originalKode = kodeCell.textContent;
    const originalStokSebelum = stokSebelumCell.textContent;
    const originalStokSesudah = stokSesudahCell.textContent;

    // Convert to input fields
    const dateValue = originalDate
      ? new Date(originalDate.split("/").reverse().join("-")).toISOString().split("T")[0]
      : "";

    dateCell.innerHTML = `<input type="date" class="form-control form-control-sm" value="${dateValue}">`;
    timeCell.innerHTML = `<input type="time" class="form-control form-control-sm" value="${originalTime}">`;
    kodeCell.innerHTML = `<input type="text" class="form-control form-control-sm" value="${originalKode}">`;
    stokSebelumCell.innerHTML = `<input type="number" class="form-control form-control-sm" value="${originalStokSebelum}">`;
    stokSesudahCell.innerHTML = `<input type="number" class="form-control form-control-sm" value="${originalStokSesudah}">`;

    // Change action buttons
    actionCell.innerHTML = `
    <button class="btn btn-sm btn-success me-1" onclick="maintenanceSystem.saveRow('${docId}')">
      <i class="fas fa-save"></i> Simpan
    </button>
    <button class="btn btn-sm btn-secondary" onclick="maintenanceSystem.cancelEdit('${docId}', '${originalDate}', '${originalTime}', '${originalKode}', '${originalStokSebelum}', '${originalStokSesudah}')">
      <i class="fas fa-times"></i> Batal
    </button>
  `;
  }

  /**
   * Cancel edit
   */
  cancelEdit(docId, originalDate, originalTime, originalKode, originalStokSebelum, originalStokSesudah) {
    const row = document.querySelector(`tr[data-id="${docId}"]`);
    if (!row) return;

    const dateCell = row.querySelector(".date-cell");
    const timeCell = row.querySelector(".time-cell");
    const kodeCell = row.querySelector(".kode-cell");
    const stokSebelumCell = row.querySelector(".stok-sebelum-cell");
    const stokSesudahCell = row.querySelector(".stok-sesudah-cell");
    const actionCell = row.querySelector(".action-cell");

    // Restore original values
    dateCell.textContent = originalDate;
    timeCell.textContent = originalTime;
    kodeCell.textContent = originalKode;
    stokSebelumCell.textContent = originalStokSebelum;
    stokSesudahCell.textContent = originalStokSesudah;

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
      const stokSebelumInput = parseInt(row.querySelector(".stok-sebelum-cell input").value) || 0;
      const stokSesudahInput = parseInt(row.querySelector(".stok-sesudah-cell input").value) || 0;

      if (!dateInput || !kodeInput) {
        this.showAlert("Tanggal dan Kode harus diisi", "warning");
        return;
      }

      // Update Firestore
      const docRef = doc(this.firestore, "stokAksesorisTransaksi", docId);
      const updateData = {
        timestamp: Timestamp.fromDate(new Date(dateInput)),
        timestr: timeInput,
        kode: kodeInput,
        stokSebelum: stokSebelumInput,
        stokSesudah: stokSesudahInput,
        lastUpdated: serverTimestamp(),
      };

      await updateDoc(docRef, updateData);

      // Update display
      const dateCell = row.querySelector(".date-cell");
      const timeCell = row.querySelector(".time-cell");
      const kodeCell = row.querySelector(".kode-cell");
      const stokSebelumCell = row.querySelector(".stok-sebelum-cell");
      const stokSesudahCell = row.querySelector(".stok-sesudah-cell");
      const actionCell = row.querySelector(".action-cell");

      dateCell.textContent = new Date(dateInput).toLocaleDateString("id-ID");
      timeCell.textContent = timeInput;
      kodeCell.textContent = kodeInput;
      stokSebelumCell.textContent = stokSebelumInput;
      stokSesudahCell.textContent = stokSesudahInput;

      // Restore action buttons
      actionCell.innerHTML = `
      <button class="btn btn-sm btn-warning me-1" onclick="maintenanceSystem.editRow('${docId}')">
        <i class="fas fa-edit"></i> Edit
      </button>
      <button class="btn btn-sm btn-danger" onclick="maintenanceSystem.deleteRow('${docId}')">
        <i class="fas fa-trash"></i> Hapus
      </button>
    `;

      // Update cache
      const docData = await getDoc(docRef);
      if (docData.exists()) {
        this.cache.updateCollectionDoc("stokAksesorisTransaksi", this.currentDate, docId, {
          id: docId,
          ...docData.data(),
        });
      }

      this.showAlert("Data berhasil diupdate", "success");
    } catch (error) {
      console.error("Error saving data:", error);
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
      // Delete from Firestore (listener will handle UI update)
      await deleteDoc(doc(this.firestore, "stokAksesorisTransaksi", docId));

      // Listener will automatically remove from table and cache
      // No manual removal needed
      const row = document.querySelector(`tr[data-id="${docId}"]`);
      if (row && false) {
        row.remove();
      }

      // Check if table is empty
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
      console.error("Error deleting data:", error);
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
      console.error("Error loading penjualan data:", error);
      this.showAlert("Gagal memuat data: " + error.message, "error");
    } finally {
      this.penjualanLoading.style.display = "none";
    }
  }

  async loadPenjualanData(dateStr) {
    // Detach previous listener
    this.detachListener("penjualan");

    // Check cache first
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
      orderBy("timestamp", "desc")
    );

    // Setup realtime listener
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

        // Initial render if no cache
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
      }
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
        query(collection(this.firestore, "penjualanAksesoris"), where("__name__", "==", docId))
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
      console.error("Error saving penjualan:", error);
      this.showAlert("Gagal menyimpan: " + error.message, "error");
    }
  }

  async deletePenjualanRow(docId) {
    const confirmed = await this.showConfirmation(
      "Apakah Anda yakin ingin menghapus transaksi ini?",
      "Konfirmasi Hapus"
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(this.firestore, "penjualanAksesoris", docId));
      // Listener will automatically remove rows and update cache
      // Check if table is empty after listener processes
      setTimeout(() => {
        if (this.penjualanTableBody.querySelectorAll("tr").length === 0) {
          this.penjualanTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Tidak ada data untuk tanggal yang dipilih</td></tr>`;
        }
      }, 500);

      this.showAlert("Data berhasil dihapus", "success");
    } catch (error) {
      console.error("Error deleting penjualan:", error);
      this.showAlert("Gagal menghapus: " + error.message, "error");
    }
  }

  /**
   * Enhanced loading management
   */
  showLoading(title, subtitle) {
    if (this.isLoading) {
      console.warn("Already loading, skipping duplicate loading modal");
      return;
    }

    this.isLoading = true;
    this.currentOperation = title;

    try {
      const loadingText = document.getElementById("loadingText");
      const loadingSubtext = document.getElementById("loadingSubtext");

      if (loadingText) loadingText.textContent = title;
      if (loadingSubtext) loadingSubtext.textContent = subtitle;

      console.log(`Loading: ${title} - ${subtitle}`);

      // Auto-hide after 30 seconds as failsafe
      setTimeout(() => {
        if (this.isLoading && this.currentOperation === title) {
          console.warn("Force hiding loading modal after timeout");
          this.hideLoading();
        }
      }, 30000);
    } catch (error) {
      console.error("Error showing loading modal:", error);
      this.isLoading = false;
    }
  }

  /**
   * Cleanup all active listeners
   */
  cleanupAllListeners() {
    for (const [key, unsubscribe] of this.activeListeners.entries()) {
      unsubscribe();
      console.log(`Cleaned up listener: ${key}`);
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
        // Remove any existing modal backdrop
        const backdrops = document.querySelectorAll(".modal-backdrop");
        backdrops.forEach((backdrop) => backdrop.remove());

        // Force hide modal
        modalElement.style.display = "none";
        modalElement.classList.remove("show");
        modalElement.setAttribute("aria-hidden", "true");
        modalElement.removeAttribute("aria-modal");

        // Reset body classes
        document.body.classList.remove("modal-open");
        document.body.style.overflow = "";
        document.body.style.paddingRight = "";
      }

      // Reset state
      this.isLoading = false;
      this.currentOperation = null;

      console.log("Loading modal hidden successfully");
    } catch (error) {
      console.error("Error hiding loading modal:", error);
      // Force reset state even if hiding fails
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
   * Handle export data for specific collection with month filtering
   */
  async handleExportData(collectionName) {
    const selectedMonth = this.exportMonthInput.value;
    if (!selectedMonth) {
      this.showAlert("Pilih bulan yang akan diexport", "warning");
      return;
    }

    try {
      this.showLoading("Mengexport Data...", `Memproses data ${collectionName} untuk bulan ${selectedMonth}`);

      await this.exportCollectionToExcel(collectionName, selectedMonth);

      // Mark month as exported
      this.exportedMonths.add(selectedMonth);
      this.updateDeleteButtonState();
      this.showAlert(`Data ${collectionName} untuk bulan ${selectedMonth} berhasil diexport!`, "success");
    } catch (error) {
      console.error("Error exporting data:", error);
      this.showAlert("Gagal mengexport data: " + error.message, "error");
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Export collection to Excel with month filtering and caching
   */
  async exportCollectionToExcel(collectionName, monthStr) {
    try {
      const cacheKey = `export_${collectionName}_${monthStr}`;
      let data = this.cache.get(cacheKey);

      if (!data) {
        // Prepare date range for month filtering
        const [year, month] = monthStr.split("-");
        const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endDate = new Date(parseInt(year), parseInt(month), 1);

        // Query based on collection type
        let querySnapshot;
        if (collectionName === "stokAksesoris") {
          // For stokAksesoris, get all current stock (no date filtering)
          querySnapshot = await getDocs(collection(this.firestore, collectionName));
        } else if (collectionName === "stocks") {
          // For stocks detail, query from daily_stock_reports with breakdown
          const startDateStr = `${year}-${month.padStart(2, "0")}-01`;
          const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
          const endDateStr = `${year}-${month.padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;

          const q = query(
            collection(this.firestore, "daily_stock_reports"),
            where("date", ">=", startDateStr),
            where("date", "<=", endDateStr),
            orderBy("date", "desc")
          );
          querySnapshot = await getDocs(q);
        } else if (collectionName === "restokBarang") {
          // For restokBarang, filter by tanggal field (YYYY-MM-DD format)
          const startDateStr = `${year}-${month.padStart(2, "0")}-01`;
          const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
          const endDateStr = `${year}-${month.padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;

          const q = query(
            collection(this.firestore, collectionName),
            where("tanggal", ">=", startDateStr),
            where("tanggal", "<=", endDateStr),
            orderBy("tanggal", "desc")
          );
          querySnapshot = await getDocs(q);
        } else {
          // For other collections (penjualanAksesoris, stokAksesorisTransaksi), filter by timestamp
          const q = query(
            collection(this.firestore, collectionName),
            where("timestamp", ">=", Timestamp.fromDate(startDate)),
            where("timestamp", "<", Timestamp.fromDate(endDate)),
            orderBy("timestamp", "desc")
          );
          querySnapshot = await getDocs(q);
        }

        data = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Cache for 10 minutes
        this.cache.set(cacheKey, data);
      } else {
      }

      if (data.length === 0) {
        return;
      }

      // Transform data for Excel
      const excelData = await this.transformDataForExcel(data, collectionName);

      // Create and download Excel file
      const filename = `${collectionName}_${monthStr}.xlsx`;
      await this.createExcelFile(excelData, filename, collectionName);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Transform data for Excel export
   */
  async transformDataForExcel(data, collectionName) {
    const transformedData = [];

    for (const item of data) {
      let row = {};

      switch (collectionName) {
        case "penjualanAksesoris":
          // Safely extract items[0] for single-item sales
          const firstItem = Array.isArray(item.items) && item.items.length > 0 ? item.items[0] : {};

          row = {
            Tanggal: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleDateString("id-ID") : "",
            Waktu: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString("id-ID") : "",
            Kode: firstItem.kodeText || item.kodeText || "",
            "Nama Barang": firstItem.nama || item.nama || "",
            Keterangan: firstItem.keterangan || item.keterangan || "",
            Sales: item.sales || "",
            "Total Harga": item.totalHarga || 0,
            "Jumlah Items": Array.isArray(item.items) ? item.items.length : 0,
          };
          break;

        case "stocks":
          // Group data by main category for detailed report
          const mainCategories = [
            "KALUNG",
            "LIONTIN",
            "ANTING",
            "CINCIN",
            "HALA",
            "GELANG",
            "GIWANG",
            "KENDARI",
            "BERLIAN",
            "SDW",
            "EMAS_BALI",
          ];
          const summaryCategories = [
            "DP",
            "admin",
            "brankas",
            "barang-display",
            "barang-rusak",
            "batu-lepas",
            "manual",
            "contoh-custom",
            "posting",
          ];

          // Initialize categorized data structure
          if (!transformedData.categorizedData) {
            transformedData.categorizedData = {};
            mainCategories.forEach((cat) => {
              transformedData.categorizedData[cat] = [];
            });
          }

          const date = item.date;
          const breakdown = item.breakdown || {};
          const categoryItems = item.items || {};

          mainCategories.forEach((mainCat) => {
            const categoryBreakdown = breakdown[mainCat] || {};
            const categoryItem = categoryItems[mainCat] || { total: 0, komputer: 0, status: "-" };
            const rowData = { Tanggal: date };
            let total = 0;

            summaryCategories.forEach((docType) => {
              const docData = categoryBreakdown[docType] || {};
              const qty = docData.total || 0;
              rowData[docType] = qty;
              total += qty;
            });

            rowData.TOTAL = total;
            rowData.Komputer = categoryItem.komputer || 0;
            rowData.Status = categoryItem.status || "-";
            transformedData.categorizedData[mainCat].push(rowData);
          });
          break;

        case "restokBarang":
          row = {
            Tanggal: item.tanggal || "",
            Jenis: item.jenis || "",
            "Nama Barang": item.nama || "",
            Kadar: item.kadar || "",
            Berat: item.berat || "",
            Panjang: item.panjang || "",
            Status: item.status || "",
            "Tanggal Restok": item.tanggalRestok || "",
          };
          break;
      }

      // Only push row if it's not from stocks (stocks handles its own push)
      if (collectionName !== "stocks" && Object.keys(row).length > 0) {
        transformedData.push(row);
      }
    }

    // Return categorized data for stocks, regular array for others
    if (collectionName === "stocks" && transformedData.categorizedData) {
      return transformedData.categorizedData;
    }
    return transformedData;
  }

  /**
   * Fetch logs data from daily_stock_logs collection for specific month
   */
  async fetchLogsDataForMonth(monthStr) {
    try {
      const cacheKey = `logs_${monthStr}`;
      let data = this.cache.get(cacheKey);

      if (!data) {
        const [year, month] = monthStr.split("-");
        const startDateStr = `${year}-${month.padStart(2, "0")}-01`;
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const endDateStr = `${year}-${month.padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;

        console.log(`Fetching logs for ${monthStr}: ${startDateStr} to ${endDateStr}`);

        const q = query(
          collection(this.firestore, "daily_stock_logs"),
          where("date", ">=", startDateStr),
          where("date", "<=", endDateStr),
          orderBy("date", "asc")
        );

        const querySnapshot = await getDocs(q);
        data = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        console.log(`Fetched ${data.length} log entries from daily_stock_logs`);
        if (data.length > 0) {
          console.log("Sample log entry:", data[0]);
        }

        // Cache for 10 minutes
        this.cache.set(cacheKey, data);
      } else {
        console.log(`Using cached logs data: ${data.length} entries`);
      }

      return data;
    } catch (error) {
      console.error("Error fetching logs data:", error);
      throw error;
    }
  }

  /**
   * Group logs data by category, date, and location
   */
  groupLogsData(logsData) {
    console.log(`Grouping ${logsData.length} log documents...`);

    // Helper function to format log entry
    const formatLogEntry = (log) => {
      const actionMap = {
        tambah: "menambah",
        kurang: "mengurangi",
        edit: "mengedit",
        update: "mengupdate",
      };

      const before = log.before ?? 0;
      const after = log.after ?? 0;
      const userName = log.userName || "user";
      const action = log.action || "update";
      const keterangan = log.keterangan || "";

      const actionText = actionMap[action] || action;
      const quantity = Math.abs(after - before);

      return `stok awal ${before} ${userName} ${actionText} ${quantity} : ${keterangan}`;
    };

    const mainCategories = [
      "KALUNG",
      "LIONTIN",
      "ANTING",
      "CINCIN",
      "HALA",
      "GELANG",
      "GIWANG",
      "KENDARI",
      "BERLIAN",
      "SDW",
      "EMAS_BALI",
    ];

    const locations = [
      "DP",
      "admin",
      "brankas",
      "barang-display",
      "barang-rusak",
      "batu-lepas",
      "manual",
      "contoh-custom",
      "posting",
    ];

    const grouped = {};

    // Initialize structure
    mainCategories.forEach((cat) => {
      grouped[cat] = [];
    });

    // Group by date
    const dateMap = new Map();

    // Flatten logs array from documents
    let totalLogs = 0;
    logsData.forEach((doc) => {
      const docDate = doc.date;
      const logsArray = Array.isArray(doc.logs) ? doc.logs : [];

      console.log(`Document ${docDate}: ${logsArray.length} log entries`);
      totalLogs += logsArray.length;

      logsArray.forEach((log, logIdx) => {
        // Use correct field names: jenis (not mainCategory), lokasi (not location)
        const mainCategory = log.jenis;
        const location = log.lokasi;
        const after = log.after;
        const keterangan = log.keterangan;

        // Debug: Print first log entry to see structure
        if (logIdx === 0) {
          console.log("Sample log entry:", log);
          console.log(`  jenis: "${mainCategory}" (in list: ${mainCategories.includes(mainCategory)})`);
          console.log(`  lokasi: "${location}" (in list: ${locations.includes(location)})`);
          console.log(`  after: ${after}, keterangan: "${keterangan}"`);
        }

        if (!mainCategory || !mainCategories.includes(mainCategory)) {
          console.warn(`Skipped log: jenis "${mainCategory}" not in list`);
          return;
        }

        if (!location || !locations.includes(location)) {
          console.warn(`Warning: lokasi "${location}" not in locations array`);
          return;
        }

        const key = `${mainCategory}_${docDate}`;
        if (!dateMap.has(key)) {
          dateMap.set(key, { date: docDate, mainCategory, data: {} });
        }

        const entry = dateMap.get(key);
        // Store all log entries for each location (not just last one)
        if (!entry.data[location]) {
          entry.data[location] = {
            after: 0,
            logs: [],
          };
        }

        // Add this log entry to the array with all necessary fields
        entry.data[location].logs.push({
          before: log.before ?? 0,
          after: after || 0,
          action: log.action || "update",
          userName: log.userName || "user",
          keterangan: keterangan || "",
        });

        // Update final after value
        entry.data[location].after = after || 0;
      });
    });

    console.log(`Total flattened logs: ${totalLogs}`);

    // Convert to array format
    dateMap.forEach((entry) => {
      const rowData = { Tanggal: entry.date };
      let total = 0;

      locations.forEach((loc) => {
        const locData = entry.data[loc];
        if (locData) {
          rowData[loc] = locData.after;
          // Format each log entry and join with newline
          rowData[`${loc}_ket`] = locData.logs.map((log) => formatLogEntry(log)).join("\n");
          total += locData.after;
        } else {
          rowData[loc] = 0;
          rowData[`${loc}_ket`] = "";
        }
      });

      rowData.TOTAL = total;
      grouped[entry.mainCategory].push(rowData);
    });

    // Sort by date
    mainCategories.forEach((cat) => {
      grouped[cat].sort((a, b) => a.Tanggal.localeCompare(b.Tanggal));
    });

    // Log summary
    let totalRows = 0;
    mainCategories.forEach((cat) => {
      const count = grouped[cat].length;
      totalRows += count;
      if (count > 0) {
        console.log(`${cat}: ${count} rows`);
      }
    });
    console.log(`Total grouped rows: ${totalRows}`);

    return grouped;
  }

  /**
   * Create logs detail sheet (Sheet 2)
   */
  async createLogsDetailSheet(workbook, groupedLogs, monthYear) {
    console.log("Creating Sheet 2: Laporan Stok Detail Bulanan");

    const mainCategories = [
      "KALUNG",
      "LIONTIN",
      "ANTING",
      "CINCIN",
      "HALA",
      "GELANG",
      "GIWANG",
      "KENDARI",
      "BERLIAN",
      "SDW",
      "EMAS_BALI",
    ];

    const locations = [
      { key: "DP", label: "DP" },
      { key: "admin", label: "Admin" },
      { key: "brankas", label: "Brankas" },
      { key: "barang-display", label: "Display" },
      { key: "barang-rusak", label: "Rusak" },
      { key: "batu-lepas", label: "Batu Lepas" },
      { key: "manual", label: "Manual" },
      { key: "contoh-custom", label: "Custom" },
      { key: "posting", label: "Posting" },
    ];

    const worksheet = workbook.addWorksheet("Laporan Stok Detail Bulanan");
    let currentRow = 1;
    const totalCols = 20; // Tanggal + (9 locations × 2) + TOTAL

    // Main Title
    const titleRow = worksheet.addRow(["LAPORAN STOK DETAIL BULANAN MELATI BAWAH"]);
    worksheet.mergeCells(currentRow, 1, currentRow, totalCols);
    titleRow.height = 35;
    titleRow.getCell(1).style = {
      font: { bold: true, size: 18, color: { argb: "FFFFFFFF" } },
      alignment: { horizontal: "center", vertical: "middle" },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5090" } },
    };
    currentRow++;

    // Month subtitle
    const monthRow = worksheet.addRow([`Bulan: ${monthYear}`]);
    worksheet.mergeCells(currentRow, 1, currentRow, totalCols);
    monthRow.height = 25;
    monthRow.getCell(1).style = {
      font: { bold: true, size: 14 },
      alignment: { horizontal: "center", vertical: "middle" },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } },
    };
    currentRow++;

    // Empty row
    worksheet.addRow([]);
    currentRow++;

    // Loop each category
    mainCategories.forEach((mainCat) => {
      const categoryData = groupedLogs[mainCat] || [];

      if (categoryData.length === 0) return;

      // Category header
      const catHeaderRow = worksheet.addRow([mainCat]);
      worksheet.mergeCells(currentRow, 1, currentRow, totalCols);
      catHeaderRow.height = 30;
      catHeaderRow.getCell(1).style = {
        font: { bold: true, size: 14, color: { argb: "FFFFFFFF" } },
        alignment: { horizontal: "left", vertical: "middle" },
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } },
      };
      currentRow++;

      // Column headers (20 columns)
      const headers = ["Tanggal"];
      locations.forEach((loc) => {
        headers.push(loc.label);
        headers.push("Keterangan");
      });
      headers.push("TOTAL");

      const headerRow = worksheet.addRow(headers);
      headerRow.height = 25;
      headers.forEach((header, idx) => {
        headerRow.getCell(idx + 1).style = {
          font: { bold: true, size: 11, color: { argb: "FFFFFFFF" } },
          alignment: { horizontal: "center", vertical: "middle" },
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B9BD5" } },
          border: {
            top: { style: "thin" },
            bottom: { style: "thin" },
            left: { style: "thin" },
            right: { style: "thin" },
          },
        };
      });
      currentRow++;

      // Data rows
      categoryData.forEach((rowData) => {
        const row = [rowData.Tanggal];
        locations.forEach((loc) => {
          row.push(rowData[loc.key] || 0);
          row.push(rowData[`${loc.key}_ket`] || "");
        });
        row.push(rowData.TOTAL || 0);

        const dataRow = worksheet.addRow(row);

        // Style cells
        dataRow.eachCell((cell, colNum) => {
          const isValueCol = colNum === 1 || colNum === totalCols || (colNum - 1) % 2 === 1;
          const isKetCol = colNum > 1 && colNum < totalCols && (colNum - 1) % 2 === 0;

          cell.style = {
            font: { size: 10, bold: colNum === totalCols },
            alignment: {
              horizontal: colNum === 1 ? "center" : isKetCol ? "left" : "center",
              vertical: "top",
              wrapText: isKetCol, // Enable text wrapping for keterangan columns
            },
            border: {
              top: { style: "thin" },
              bottom: { style: "thin" },
              left: { style: "thin" },
              right: { style: "thin" },
            },
            numFmt: isValueCol && colNum > 1 ? "#,##0" : undefined,
          };

          // Highlight TOTAL column
          if (colNum === totalCols) {
            cell.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
          }
        });
        currentRow++;
      });

      // Empty row after category
      worksheet.addRow([]);
      currentRow++;
    });

    // Set column widths
    worksheet.getColumn(1).width = 12; // Tanggal
    for (let i = 2; i < totalCols; i += 2) {
      worksheet.getColumn(i).width = 10; // Value columns
      worksheet.getColumn(i + 1).width = 40; // Keterangan columns
    }
    worksheet.getColumn(totalCols).width = 12; // TOTAL
  }

  /**
   * Create Excel file and trigger download
   */
  async createExcelFile(data, filename, collectionName = null) {
    // Special handling for stocks detail report with ExcelJS
    if (collectionName === "stocks" || filename.includes("stocks")) {
      await this.createStocksDetailReportWithExcelJS(data, filename);
    } else {
      // Standard Excel creation with XLSX.js for other collections
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-size columns
      const colWidths = [];
      if (data.length > 0) {
        Object.keys(data[0]).forEach((key) => {
          const maxLength = Math.max(key.length, ...data.map((row) => String(row[key] || "").length));
          colWidths.push({ wch: Math.min(maxLength + 2, 50) });
        });
        ws["!cols"] = colWidths;
      }

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, "Data");

      // Write file
      XLSX.writeFile(wb, filename);
    }
  }

  /**
   * Create stocks detail report with breakdown per document
   */
  async createStocksDetailReportWithExcelJS(categorizedData, filename) {
    const mainCategories = [
      "KALUNG",
      "LIONTIN",
      "ANTING",
      "CINCIN",
      "HALA",
      "GELANG",
      "GIWANG",
      "KENDARI",
      "BERLIAN",
      "SDW",
      "EMAS_BALI",
    ];

    const docHeaders = [
      "Tanggal",
      "DP",
      "Admin",
      "Brankas",
      "Display",
      "Rusak",
      "Batu Lepas",
      "Manual",
      "Custom",
      "Posting",
      "TOTAL",
      "Komputer",
      "Status",
    ];
    const docMapping = {
      DP: "DP",
      admin: "Admin",
      brankas: "Brankas",
      "barang-display": "Display",
      "barang-rusak": "Rusak",
      "batu-lepas": "Batu Lepas",
      manual: "Manual",
      "contoh-custom": "Custom",
      posting: "Posting",
    };

    // Extract month from filename
    const monthMatch = filename.match(/(\d{4})-(\d{2})/);
    const monthYear = monthMatch ? this.getMonthName(monthMatch[2], monthMatch[1]) : "";
    const monthStr = monthMatch ? `${monthMatch[1]}-${monthMatch[2]}` : "";

    const workbook = new ExcelJS.Workbook();

    // Fetch and prepare Sheet 2 data (logs detail)
    let groupedLogs = null;
    if (monthStr) {
      try {
        const logsData = await this.fetchLogsDataForMonth(monthStr);
        groupedLogs = this.groupLogsData(logsData);
      } catch (error) {
        console.warn("Could not fetch logs data for Sheet 2:", error);
      }
    }
    const worksheet = workbook.addWorksheet("Stocks Detail");

    let currentRow = 1;
    const totalCols = docHeaders.length;

    // Main Title
    const titleRow = worksheet.addRow(["LAPORAN STOK HARIAN MELATI BAWAH"]);
    worksheet.mergeCells(currentRow, 1, currentRow, totalCols);
    titleRow.height = 35;
    titleRow.getCell(1).style = {
      font: { bold: true, size: 18, color: { argb: "FFFFFFFF" } },
      alignment: { horizontal: "center", vertical: "middle" },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5090" } },
    };
    currentRow++;

    // Month subtitle
    const monthRow = worksheet.addRow([`Bulan: ${monthYear}`]);
    worksheet.mergeCells(currentRow, 1, currentRow, totalCols);
    monthRow.height = 25;
    monthRow.getCell(1).style = {
      font: { bold: true, size: 14 },
      alignment: { horizontal: "center", vertical: "middle" },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } },
    };
    currentRow++;

    // Empty row
    worksheet.addRow([]);
    currentRow++;

    // Loop each category
    mainCategories.forEach((mainCat) => {
      const categoryData = categorizedData[mainCat] || [];

      if (categoryData.length === 0) return;

      // Category header
      const catHeaderRow = worksheet.addRow([mainCat]);
      worksheet.mergeCells(currentRow, 1, currentRow, totalCols);
      catHeaderRow.height = 30;
      catHeaderRow.getCell(1).style = {
        font: { bold: true, size: 14, color: { argb: "FFFFFFFF" } },
        alignment: { horizontal: "center", vertical: "middle" },
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } },
      };
      currentRow++;

      // Column headers
      const headerRow = worksheet.addRow(docHeaders);
      headerRow.height = 25;
      docHeaders.forEach((header, idx) => {
        headerRow.getCell(idx + 1).style = {
          font: { bold: true, size: 11, color: { argb: "FFFFFFFF" } },
          alignment: { horizontal: "center", vertical: "middle" },
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B9BD5" } },
          border: {
            top: { style: "thin" },
            bottom: { style: "thin" },
            left: { style: "thin" },
            right: { style: "thin" },
          },
        };
      });
      currentRow++;

      // Data rows
      categoryData.forEach((rowData) => {
        const total = rowData.TOTAL || 0;
        const komputer = rowData.Komputer || 0;
        const status = rowData.Status || "-";

        const dataRow = worksheet.addRow([
          rowData.Tanggal,
          rowData.DP || 0,
          rowData.admin || 0,
          rowData.brankas || 0,
          rowData["barang-display"] || 0,
          rowData["barang-rusak"] || 0,
          rowData["batu-lepas"] || 0,
          rowData.manual || 0,
          rowData["contoh-custom"] || 0,
          rowData.posting || 0,
          total,
          komputer,
          status,
        ]);

        // Style cells
        dataRow.eachCell((cell, colNum) => {
          cell.style = {
            font: { size: 10 },
            alignment: {
              horizontal: colNum === 1 ? "center" : colNum === totalCols ? "center" : "right",
              vertical: "middle",
            },
            border: {
              top: { style: "thin" },
              bottom: { style: "thin" },
              left: { style: "thin" },
              right: { style: "thin" },
            },
            numFmt: colNum > 1 && colNum < totalCols ? "#,##0" : undefined,
          };

          // Highlight TOTAL column
          if (colNum === totalCols - 2) {
            // TOTAL
            cell.style.font = { bold: true, size: 10 };
            cell.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
          }

          // Highlight Komputer column
          if (colNum === totalCols - 1) {
            // Komputer
            cell.style.font = { bold: true, size: 10 };
            cell.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F3FF" } };
          }

          // Conditional formatting for Status
          if (colNum === totalCols) {
            // Status
            cell.style.font = { bold: true, size: 10 };
            const statusLower = String(status).toLowerCase();

            if (statusLower === "klop" || statusLower.includes("sesuai")) {
              cell.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
              cell.style.font.color = { argb: "FF006100" };
            } else if (statusLower.includes("kurang")) {
              cell.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
              cell.style.font.color = { argb: "FF9C0006" };
            } else if (statusLower.includes("lebih")) {
              cell.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB9C" } };
              cell.style.font.color = { argb: "FF9C6500" };
            }
          }
        });
        currentRow++;
      });

      // Empty row after category
      worksheet.addRow([]);
      currentRow++;
    });

    // Set column widths
    worksheet.getColumn(1).width = 12; // Tanggal
    for (let i = 2; i <= totalCols - 3; i++) {
      worksheet.getColumn(i).width = 10; // Dokumen columns
    }
    worksheet.getColumn(totalCols - 2).width = 12; // TOTAL
    worksheet.getColumn(totalCols - 1).width = 12; // Komputer
    worksheet.getColumn(totalCols).width = 14; // Status

    // Create Sheet 2 if logs data available
    if (groupedLogs) {
      await this.createLogsDetailSheet(workbook, groupedLogs, monthYear);
    }

    // Generate and download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, filename);
  }

  /**
   * Get month name in Indonesian
   */
  getMonthName(month, year) {
    const monthNames = [
      "Januari",
      "Februari",
      "Maret",
      "April",
      "Mei",
      "Juni",
      "Juli",
      "Agustus",
      "September",
      "Oktober",
      "November",
      "Desember",
    ];
    const monthIndex = parseInt(month) - 1;
    return `${monthNames[monthIndex]} ${year}`;
  }

  /**
   * Handle delete old data
   */
  async handleDeleteOldData() {
    const selectedMonth = this.deleteMonthInput.value;
    if (!selectedMonth) {
      this.showAlert("Pilih bulan yang akan dihapus", "warning");
      return;
    }

    if (!this.exportedMonths.has(selectedMonth)) {
      this.showAlert("Data harus diexport terlebih dahulu sebelum dihapus", "warning");
      return;
    }

    const confirmed = await this.showConfirmation(
      `Apakah Anda yakin ingin menghapus semua data bulan ${selectedMonth}? Pastikan data sudah diexport.`,
      "Konfirmasi Hapus Data"
    );

    if (!confirmed) return;

    try {
      this.showLoading("Menghapus Data...", `Menghapus data bulan ${selectedMonth}`);

      await this.deleteDataByMonth(selectedMonth);

      this.showAlert(`Data bulan ${selectedMonth} berhasil dihapus!`, "success");
    } catch (error) {
      console.error("Error deleting data:", error);
      this.showAlert("Gagal menghapus data: " + error.message, "error");
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Delete data by month
   */
  async deleteDataByMonth(monthStr) {
    try {
      const [year, month] = monthStr.split("-");
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 1);

      const collections = [
        "penjualanAksesoris",
        "stokAksesorisTransaksi",
        "daily_stock_reports",
        "daily_stock_logs",
        "stocks",
        "restokBarang",
      ];
      let totalDeleted = 0;

      for (let i = 0; i < collections.length; i++) {
        const collectionName = collections[i];
        let q;

        // Build query based on collection type
        if (collectionName === "stocks") {
          // Skip stocks collection as it doesn't have date field
          continue;
        } else if (collectionName === "daily_stock_reports" || collectionName === "daily_stock_logs") {
          // For daily_stock_reports and daily_stock_logs, filter by date field (YYYY-MM-DD format)
          const startDateStr = `${year}-${month.padStart(2, "0")}-01`;
          const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
          const endDateStr = `${year}-${month.padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;

          q = query(
            collection(this.firestore, collectionName),
            where("date", ">=", startDateStr),
            where("date", "<=", endDateStr)
          );
        } else if (collectionName === "restokBarang") {
          // For restokBarang, filter by tanggal field (YYYY-MM-DD format)
          const startDateStr = `${year}-${month.padStart(2, "0")}-01`;
          const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
          const endDateStr = `${year}-${month.padStart(2, "0")}-${lastDay.toString().padStart(2, "0")}`;

          q = query(
            collection(this.firestore, collectionName),
            where("tanggal", ">=", startDateStr),
            where("tanggal", "<=", endDateStr)
          );
        } else {
          // For collections with timestamp field
          q = query(
            collection(this.firestore, collectionName),
            where("timestamp", ">=", Timestamp.fromDate(startDate)),
            where("timestamp", "<", Timestamp.fromDate(endDate))
          );
        }

        const snapshot = await getDocs(q);
        const docs = snapshot.docs;

        if (docs.length > 0) {
          // Delete in batches
          const batchSize = 100;
          const totalBatches = Math.ceil(docs.length / batchSize);

          for (let j = 0; j < totalBatches; j++) {
            const batch = writeBatch(this.firestore);
            const startIndex = j * batchSize;
            const endIndex = Math.min(startIndex + batchSize, docs.length);
            const batchDocs = docs.slice(startIndex, endIndex);

            batchDocs.forEach((docSnapshot) => {
              batch.delete(docSnapshot.ref);
            });

            await batch.commit();

            const progress = (i / collections.length + (j + 1) / totalBatches / collections.length) * 100;
            // Small delay between batches
            if (j < totalBatches - 1) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          totalDeleted += docs.length;
        }
      }

      // Clear cache
      this.cache.clear();
    } catch (error) {
      throw error;
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

    // Find alerts container or create one
    let alertContainer = document.getElementById("alertContainer");
    if (!alertContainer) {
      alertContainer = document.createElement("div");
      alertContainer.id = "alertContainer";
      alertContainer.className = "position-fixed top-0 end-0 p-3";
      alertContainer.style.zIndex = "9999";
      document.body.appendChild(alertContainer);
    }

    alertContainer.appendChild(alertDiv);

    // Auto-remove after 5 seconds
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

// Initialize the maintenance system when page loads
document.addEventListener("DOMContentLoaded", () => {
  window.maintenanceSystem = new MaintenanceSystem();

  // Cleanup listeners on page unload
  window.addEventListener("beforeunload", () => {
    if (window.maintenanceSystem) {
      window.maintenanceSystem.cleanupAllListeners();
    }
  });
});
