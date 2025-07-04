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
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

/**
 * Cache Manager for Export Operations
 */
class MaintenanceCacheManager {
  constructor() {
    this.prefix = 'maintenance_';
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
      console.warn('Failed to load maintenance cache from storage:', error);
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
      console.warn('Failed to save maintenance cache to storage:', error);
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
      console.warn('Failed to clear cache from storage:', error);
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
    
    keysToRemove.forEach(key => {
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
    this.loadingModal = null;
    this.progressBar = null;
    this.progressLog = null;
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
      
      console.log('Maintenance system initialized successfully');
    } catch (error) {
      console.error('Error initializing maintenance system:', error);
      this.showAlert('Gagal menginisialisasi sistem maintenance', 'error');
    }
  }

  /**
   * Initialize DOM elements
   */
  initializeElements() {
    this.loadingModal = new bootstrap.Modal(document.getElementById('loadingModal'));
    this.progressBar = document.getElementById('maintenanceProgress');
    this.progressLog = document.getElementById('progressLog');
    
    // Input elements
    this.exportMonthInput = document.getElementById('exportMonth');
    this.deleteMonthInput = document.getElementById('deleteMonth');
    
    // Button elements
    this.btnDeleteOldData = document.getElementById('btnDeleteOldData');
    
    // Export buttons
    this.btnExportPenjualan = document.getElementById('btnExportPenjualan');
    this.btnExportStockAdditions = document.getElementById('btnExportStockAdditions');
    this.btnExportStokTransaksi = document.getElementById('btnExportStokTransaksi');
    this.btnExportStokAksesoris = document.getElementById('btnExportStokAksesoris');
    this.btnExportAll = document.getElementById('btnExportAll');
  }

  /**
   * Attach event listeners to buttons
   */
  attachEventListeners() {
    // Delete old data
    this.btnDeleteOldData.addEventListener('click', () => this.handleDeleteOldData());
    
    // Export buttons
    this.btnExportPenjualan.addEventListener('click', () => this.handleExportData('penjualanAksesoris'));
    this.btnExportStockAdditions.addEventListener('click', () => this.handleExportData('stockAdditions'));
    this.btnExportStokTransaksi.addEventListener('click', () => this.handleExportData('stokAksesorisTransaksi'));
    this.btnExportStokAksesoris.addEventListener('click', () => this.handleExportData('stokAksesoris'));
    this.btnExportAll.addEventListener('click', () => this.handleExportAllData());

    // Month selection change listeners
    this.exportMonthInput.addEventListener('change', () => this.onExportMonthChange());
    this.deleteMonthInput.addEventListener('change', () => this.onDeleteMonthChange());
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
  }

  /**
   * Handle export month change
   */
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
      this.btnDeleteOldData.classList.remove('disabled');
    } else {
      this.btnDeleteOldData.classList.add('disabled');
    }
  }

  /**
   * Enhanced loading management
   */
  showLoading(title, subtitle) {
    if (this.isLoading) {
      console.warn('Already loading, skipping duplicate loading modal');
      return;
    }

    this.isLoading = true;
    this.currentOperation = title;
    
    try {
      document.getElementById('loadingText').textContent = title;
      document.getElementById('loadingSubtext').textContent = subtitle;
      this.loadingModal.show();
      
      // Auto-hide after 30 seconds as failsafe
      setTimeout(() => {
        if (this.isLoading && this.currentOperation === title) {
          console.warn('Force hiding loading modal after timeout');
          this.hideLoading();
        }
      }, 30000);
      
    } catch (error) {
      console.error('Error showing loading modal:', error);
      this.isLoading = false;
    }
  }

  /**
   * Enhanced loading hide with proper state management
   */
  hideLoading() {
    try {
      // Force hide modal regardless of current state
      const modalElement = document.getElementById('loadingModal');
      if (modalElement) {
        // Remove any existing modal backdrop
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());
        
        // Force hide modal
        modalElement.style.display = 'none';
        modalElement.classList.remove('show');
        modalElement.setAttribute('aria-hidden', 'true');
        modalElement.removeAttribute('aria-modal');
        
        // Reset body classes
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
      }
      
      // Hide using Bootstrap modal if available
      if (this.loadingModal) {
        try {
          this.loadingModal.hide();
        } catch (modalError) {
          console.warn('Bootstrap modal hide failed:', modalError);
        }
      }
      
      // Reset state
      this.isLoading = false;
      this.currentOperation = null;
      
      // Reset progress
      this.updateProgress(0);
      
      console.log('Loading modal hidden successfully');
      
    } catch (error) {
      console.error('Error hiding loading modal:', error);
      // Force reset state even if hiding fails
      this.isLoading = false;
      this.currentOperation = null;
      
      // Force remove modal elements
      const modalElement = document.getElementById('loadingModal');
      if (modalElement) {
        modalElement.style.display = 'none';
      }
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
    }
  }

  /**
   * Handle export data for specific collection with month filtering
   */
  async handleExportData(collectionName) {
    const selectedMonth = this.exportMonthInput.value;
    if (!selectedMonth) {
      this.showAlert('Pilih bulan yang akan diexport', 'warning');
      return;
    }

    try {
      this.showLoading('Mengexport Data...', `Memproses data ${collectionName} untuk bulan ${selectedMonth}`);
      this.updateProgress(0);
      this.clearProgressLog();

      await this.exportCollectionToExcel(collectionName, selectedMonth);
      
      // Mark month as exported
      this.exportedMonths.add(selectedMonth);
      this.updateDeleteButtonState();
      this.showAlert(`Data ${collectionName} untuk bulan ${selectedMonth} berhasil diexport!`, 'success');
      
    } catch (error) {
      console.error('Error exporting data:', error);
      this.showAlert('Gagal mengexport data: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Handle export all data with month filtering
   */
  async handleExportAllData() {
    const selectedMonth = this.exportMonthInput.value;
    if (!selectedMonth) {
      this.showAlert('Pilih bulan yang akan diexport', 'warning');
      return;
    }

    const collections = ['penjualanAksesoris', 'stockAdditions', 'stokAksesorisTransaksi', 'stokAksesoris'];
    
    try {
      this.showLoading('Mengexport Semua Data...', `Memproses semua data untuk bulan ${selectedMonth}`);
      this.updateProgress(0);
      this.clearProgressLog();

      for (let i = 0; i < collections.length; i++) {
        const collection = collections[i];
        this.logProgress(`Mengexport ${collection}...`);
        
        await this.exportCollectionToExcel(collection, selectedMonth);
        
        const progress = ((i + 1) / collections.length) * 100;
        this.updateProgress(Math.round(progress));
        
        this.logProgress(`${collection} berhasil diexport`);
      }
      
      // Mark month as exported
      this.exportedMonths.add(selectedMonth);
      this.updateDeleteButtonState();
      this.showAlert(`Semua data untuk bulan ${selectedMonth} berhasil diexport!`, 'success');
      
    } catch (error) {
      console.error('Error exporting all data:', error);
      this.showAlert('Gagal mengexport semua data: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Export collection to Excel with month filtering and caching
   */
  async exportCollectionToExcel(collectionName, monthStr) {
    try {
      this.logProgress(`Mengambil data ${collectionName}...`);
      
      const cacheKey = `export_${collectionName}_${monthStr}`;
      let data = this.cache.get(cacheKey);
      
      if (!data) {
        // Prepare date range for month filtering
        const [year, month] = monthStr.split('-');
        const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endDate = new Date(parseInt(year), parseInt(month), 1);
        
        // Query based on collection type
        let querySnapshot;
        if (collectionName === 'stokAksesoris') {
          // For stokAksesoris, get all current stock (no date filtering)
          querySnapshot = await getDocs(collection(this.firestore, collectionName));
        } else {
          // For other collections, filter by month
          const q = query(
            collection(this.firestore, collectionName),
            where('timestamp', '>=', Timestamp.fromDate(startDate)),
            where('timestamp', '<', Timestamp.fromDate(endDate)),
            orderBy('timestamp', 'desc')
          );
          querySnapshot = await getDocs(q);
        }
        
        data = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // Cache for 10 minutes
        this.cache.set(cacheKey, data);
        this.logProgress(`Data diambil dari database: ${data.length} items`);
      } else {
        this.logProgress(`Data diambil dari cache: ${data.length} items`);
      }
      
      this.updateProgress(30);
      
      if (data.length === 0) {
        this.logProgress(`Tidak ada data ${collectionName} untuk bulan ${monthStr}`, 'warning');
        return;
      }
      
      // Transform data for Excel
      const excelData = await this.transformDataForExcel(data, collectionName);
      this.updateProgress(60);
      
      // Create and download Excel file
      const filename = `${collectionName}_${monthStr}.xlsx`;
      await this.createExcelFile(excelData, filename);
      
      this.updateProgress(100);
      this.logProgress(`Export ${collectionName} selesai: ${filename}`, 'success');
      
    } catch (error) {
      this.logProgress(`Error mengexport ${collectionName}: ${error.message}`, 'error');
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
        case 'penjualanAksesoris':
          row = {
            'Tanggal': item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleDateString('id-ID') : '',
            'Waktu': item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString('id-ID') : '',
            'Jenis Penjualan': item.jenisPenjualan || '',
            'Sales': item.sales || '',
            'Customer': item.customer || '',
            'Total Harga': item.totalHarga || 0,
            'Metode Pembayaran': item.metodePembayaran || '',
            'Jumlah Items': item.items ? item.items.length : 0,
            'Keterangan': item.keterangan || ''
          };
          break;
          
        case 'stockAdditions':
          row = {
            'Tanggal': item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleDateString('id-ID') : '',
            'Waktu': item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString('id-ID') : '',
            'Kode': item.kode || '',
            'Nama Barang': item.namaBarang || '',
            'Kategori': item.kategori || '',
            'Jumlah': item.jumlah || 0,
            'Harga Beli': item.hargaBeli || 0,
            'Harga Jual': item.hargaJual || 0,
            'Supplier': item.supplier || '',
            'Keterangan': item.keterangan || ''
          };
          break;
          
        case 'stokAksesorisTransaksi':
          row = {
            'Tanggal': item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleDateString('id-ID') : '',
            'Waktu': item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleTimeString('id-ID') : '',
            'Kode': item.kode || '',
            'Nama Barang': item.namaBarang || '',
            'Jenis Transaksi': item.jenisTransaksi || '',
            'Jumlah': item.jumlah || 0,
            'Stok Sebelum': item.stokSebelum || 0,
            'Stok Sesudah': item.stokSesudah || 0,
            'Keterangan': item.keterangan || ''
          };
          break;
          
        case 'stokAksesoris':
          row = {
            'Kode': item.kode || '',
            'Nama Barang': item.nama || '',
            'Kategori': item.kategori || '',
            'Stok Akhir': item.stokAkhir || 0,
            'Harga Beli': item.hargaBeli || 0,
            'Harga Jual': item.hargaJual || 0,
            'Supplier': item.supplier || '',
            'Tanggal Update': item.lastUpdated ? new Date(item.lastUpdated.seconds * 1000).toLocaleDateString('id-ID') : '',
            'Keterangan': item.keterangan || ''
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
      Object.keys(data[0]).forEach(key => {
        const maxLength = Math.max(
          key.length,
          ...data.map(row => String(row[key] || '').length)
        );
        colWidths.push({ wch: Math.min(maxLength + 2, 50) });
      });
      ws['!cols'] = colWidths;
    }
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    
    // Write file
    XLSX.writeFile(wb, filename);
  }

  /**
   * Handle delete old data
   */
  async handleDeleteOldData() {
    const selectedMonth = this.deleteMonthInput.value;
    if (!selectedMonth) {
      this.showAlert('Pilih bulan yang akan dihapus', 'warning');
      return;
    }

    if (!this.exportedMonths.has(selectedMonth)) {
      this.showAlert('Data harus diexport terlebih dahulu sebelum dihapus', 'warning');
      return;
    }

    const confirmed = await this.showConfirmation(
      `Apakah Anda yakin ingin menghapus semua data bulan ${selectedMonth}? Pastikan data sudah diexport.`,
      'Konfirmasi Hapus Data'
    );

    if (!confirmed) return;

    try {
      this.showLoading('Menghapus Data...', `Menghapus data bulan ${selectedMonth}`);
      this.updateProgress(0);
      this.clearProgressLog();

      await this.deleteDataByMonth(selectedMonth);
      
      this.showAlert(`Data bulan ${selectedMonth} berhasil dihapus!`, 'success');
      
    } catch (error) {
      console.error('Error deleting data:', error);
      this.showAlert('Gagal menghapus data: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Delete data by month
   */
  async deleteDataByMonth(monthStr) {
    try {
      const [year, month] = monthStr.split('-');
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 1);

      const collections = ['penjualanAksesoris', 'stockAdditions', 'stokAksesorisTransaksi'];
      let totalDeleted = 0;

      for (let i = 0; i < collections.length; i++) {
        const collectionName = collections[i];
        
        this.logProgress(`Menghapus data ${collectionName}...`);
        
        // Query data for the specified month
        const q = query(
          collection(this.firestore, collectionName),
          where('timestamp', '>=', Timestamp.fromDate(startDate)),
          where('timestamp', '<', Timestamp.fromDate(endDate))
        );

        const snapshot = await getDocs(q);
        const docs = snapshot.docs;
        
        this.logProgress(`Ditemukan ${docs.length} dokumen di ${collectionName}`);

        if (docs.length > 0) {
          // Delete in batches
          const batchSize = 100;
          const totalBatches = Math.ceil(docs.length / batchSize);
          
          for (let j = 0; j < totalBatches; j++) {
            const batch = writeBatch(this.firestore);
            const startIndex = j * batchSize;
            const endIndex = Math.min(startIndex + batchSize, docs.length);
            const batchDocs = docs.slice(startIndex, endIndex);
            
            batchDocs.forEach(docSnapshot => {
              batch.delete(docSnapshot.ref);
            });
            
            await batch.commit();
            
            const progress = ((i / collections.length) + ((j + 1) / totalBatches / collections.length)) * 100;
            this.updateProgress(Math.round(progress));
            
            this.logProgress(`Batch ${j + 1}/${totalBatches} selesai untuk ${collectionName}`);
            
            // Small delay between batches
            if (j < totalBatches - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
          totalDeleted += docs.length;
        }

        this.logProgress(`Selesai menghapus ${collectionName} (${docs.length} dokumen)`);
      }

      this.updateProgress(100);
      this.logProgress(`Penghapusan selesai! Total ${totalDeleted} dokumen dihapus.`, 'success');
      
      // Clear cache
      this.cache.clear();
      
    } catch (error) {
      this.logProgress(`Error dalam deleteDataByMonth: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Update progress bar
   */
  updateProgress(percentage) {
    if (this.progressBar) {
      this.progressBar.style.width = `${percentage}%`;
      this.progressBar.setAttribute('aria-valuenow', percentage);
      this.progressBar.textContent = `${percentage}%`;
    }
  }

  /**
   * Log progress message
   */
  logProgress(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    const logEntry = `[${timestamp}] ${message}`;
    
    console.log(logEntry);
    
    if (this.progressLog) {
      const logElement = document.createElement('div');
      logElement.className = `log-entry log-${type}`;
      logElement.textContent = logEntry;
      
      this.progressLog.appendChild(logElement);
      this.progressLog.scrollTop = this.progressLog.scrollHeight;
    }
  }

  /**
   * Clear progress log
   */
  clearProgressLog() {
    if (this.progressLog) {
      this.progressLog.innerHTML = '';
    }
  }

  /**
   * Show alert message
   */
  showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Find alerts container or create one
    let alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) {
      alertContainer = document.createElement('div');
      alertContainer.id = 'alertContainer';
      alertContainer.className = 'position-fixed top-0 end-0 p-3';
      alertContainer.style.zIndex = '9999';
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
  showConfirmation(message, title = 'Konfirmasi') {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal fade';
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
      
      modal.querySelector('#confirmButton').addEventListener('click', () => {
        resolve(true);
        bsModal.hide();
      });
      
      modal.addEventListener('hidden.bs.modal', () => {
        resolve(false);
        modal.remove();
      });
      
      bsModal.show();
    });
  }
}

// Initialize the maintenance system when page loads
document.addEventListener('DOMContentLoaded', () => {
  window.maintenanceSystem = new MaintenanceSystem();
});
