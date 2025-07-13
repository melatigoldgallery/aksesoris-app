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

    // Load cache from sessionStorage on initialization
    this.loadCacheFromStorage();
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
      const today = new Date().toISOString().split("T")[0];
      this.loadStokTransaksiData(today).catch((error) => {
        console.warn("Failed to load initial data:", error);
      });

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
    this.btnExportStockAdditions = document.getElementById("btnExportStockAdditions");

    // Data management elements
    this.filterDateInput = document.getElementById("filterDate");
    this.btnShowData = document.getElementById("btnShowData");
    this.dataTableBody = document.getElementById("dataTableBody");
    this.dataLoading = document.getElementById("dataLoading");
  }

  /**
   * Attach event listeners to buttons
   */
  attachEventListeners() {
    // Delete old data
    this.btnDeleteOldData.addEventListener("click", () => this.handleDeleteOldData());

    // Export buttons
    this.btnExportPenjualan.addEventListener("click", () => this.handleExportData("penjualanAksesoris"));
    this.btnExportStockAdditions.addEventListener("click", () => this.handleExportData("stockAdditions"));

    // Month selection change listeners
    this.exportMonthInput.addEventListener("change", () => this.onExportMonthChange());
    this.deleteMonthInput.addEventListener("change", () => this.onDeleteMonthChange());

    // Data management listeners
    this.btnShowData.addEventListener("click", () => this.handleShowData());
    this.filterDateInput.addEventListener("change", () => this.onFilterDateChange());
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
   * Load stok transaksi data for specific date
   */
  async loadStokTransaksiData(dateStr) {
    try {
      const selectedDate = new Date(dateStr);
      const startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      const endDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);

      const q = query(
        collection(this.firestore, "stokAksesorisTransaksi"),
        where("timestamp", ">=", Timestamp.fromDate(startDate)),
        where("timestamp", "<", Timestamp.fromDate(endDate)),
        orderBy("timestamp", "desc")
      );

      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      this.renderDataTable(data);
    } catch (error) {
      console.error("Error loading stok transaksi data:", error);
      throw error;
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
      // Delete from Firestore
      await deleteDoc(doc(this.firestore, "stokAksesorisTransaksi", docId));

      // Remove from table
      const row = document.querySelector(`tr[data-id="${docId}"]`);
      if (row) {
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
      document.getElementById("loadingText").textContent = title;
      document.getElementById("loadingSubtext").textContent = subtitle;

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
   * Enhanced loading hide with proper state management
   */
  hideLoading() {
    try {
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
        } else {
          // For other collections, filter by month
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
      await this.createExcelFile(excelData, filename);
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
          row = {
            Tanggal: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleDateString("id-ID") : "",
            Waktu: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString("id-ID") : "",
            Kode: item.kodeText || "",
            "Nama Barang": item.nama || "",
            Sales: item.sales || "",
            "Total Harga": item.totalHarga || 0,
            "Jumlah Items": item.items ? item.items.length : 0,
          };
          break;

        case "stockAdditions":
          row = {
            Tanggal: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleDateString("id-ID") : "",
            Waktu: item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString("id-ID") : "",
            Kode: item.kode || "",
            "Nama Barang": item.namaBarang || "",
            Kategori: item.kategori || "",
            Jumlah: item.jumlah || 0,
            "Harga Beli": item.hargaBeli || 0,
            "Harga Jual": item.hargaJual || 0,
            Supplier: item.supplier || "",
            Keterangan: item.keterangan || "",
          };
          break;
      }

      transformedData.push(row);
    }

    return transformedData;
  }

  /**
   * Create Excel file and trigger download
   */
  async createExcelFile(data, filename) {
    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // Create worksheet from data
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

      const collections = ["penjualanAksesoris", "stockAdditions", "stokAksesorisTransaksi"];
      let totalDeleted = 0;

      for (let i = 0; i < collections.length; i++) {
        const collectionName = collections[i];

        // Query data for the specified month
        const q = query(
          collection(this.firestore, collectionName),
          where("timestamp", ">=", Timestamp.fromDate(startDate)),
          where("timestamp", "<", Timestamp.fromDate(endDate))
        );

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
});
