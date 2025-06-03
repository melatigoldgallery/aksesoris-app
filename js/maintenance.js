/**
 * Maintenance System for Melati Gold Shop
 * Handles data archiving, snapshots, exports, and cleanup with enhanced caching
 */

import { firestore } from "./configFirebase.js";
import {
  collection,
  getDocs,
  addDoc,
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
 * Enhanced Cache Manager for Maintenance Operations - Optimized like kehadiran.js
 */
class MaintenanceCacheManager {
  constructor() {
    this.prefix = 'maintenance_';
    this.statusTTL = 5 * 60 * 1000; // 5 minutes for status
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
    const ttl = key.includes('status') ? this.statusTTL : this.dataTTL;
    if (Date.now() - timestamp > ttl) {
      this.remove(key);
      return null;
    }
    
    return data;
  }

  /**
   * Check if cache needs refresh
   */
  shouldRefresh(key) {
    const timestamp = this.cacheTimestamps.get(key);
    if (!timestamp) return true;
    
    const ttl = key.includes('status') ? this.statusTTL : this.dataTTL;
    return Date.now() - timestamp > ttl;
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
      const ttl = key.includes('status') ? this.statusTTL : this.dataTTL;
      if (now - timestamp > ttl) {
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

  /**
   * Get cache age
   */
  getAge(key) {
    const timestamp = this.cacheTimestamps.get(key);
    return timestamp ? Date.now() - timestamp : Infinity;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      memoryEntries: this.dataCache.size,
      totalSize: JSON.stringify(Object.fromEntries(this.dataCache)).length
    };
  }
}

/**
 * Main Maintenance Class with Enhanced Caching
 */
class MaintenanceSystem {
  constructor() {
    this.firestore = firestore;
    this.loadingModal = null;
    this.progressBar = null;
    this.progressLog = null;
    this.isArchived = false;
    this.isExported = false;
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
      await this.loadDatabaseStatus();
      
      // Start auto-refresh with cache
      this.startAutoRefresh();
      
      console.log('Maintenance system initialized successfully');
      console.log('Cache stats:', this.cache.getStats());
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
    this.archiveMonthInput = document.getElementById('archiveMonth');
    this.snapshotMonthInput = document.getElementById('snapshotMonth');
    this.deleteMonthInput = document.getElementById('deleteMonth');
    
    // Button elements
    this.btnArchiveData = document.getElementById('btnArchiveData');
    this.btnCreateSnapshot = document.getElementById('btnCreateSnapshot');
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
    // Archive data
    this.btnArchiveData.addEventListener('click', () => this.handleArchiveData());
    
    // Create snapshot
    this.btnCreateSnapshot.addEventListener('click', () => this.handleCreateSnapshot());
    
    // Delete old data
    this.btnDeleteOldData.addEventListener('click', () => this.handleDeleteOldData());
    
    // Export buttons
    this.btnExportPenjualan.addEventListener('click', () => this.handleExportData('penjualanAksesoris'));
    this.btnExportStockAdditions.addEventListener('click', () => this.handleExportData('stockAdditions'));
    this.btnExportStokTransaksi.addEventListener('click', () => this.handleExportData('stokAksesorisTransaksi'));
    this.btnExportStokAksesoris.addEventListener('click', () => this.handleExportData('stokAksesoris'));
    this.btnExportAll.addEventListener('click', () => this.handleExportAllData());

    // Add refresh button for manual cache refresh
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-outline-secondary btn-sm ms-2';
    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    refreshBtn.onclick = () => this.forceRefreshStatus();
    
    const statusContainer = document.querySelector('.maintenance-status')?.parentElement;
    if (statusContainer) {
      statusContainer.appendChild(refreshBtn);
    }
  }

  /**
   * Set default dates for inputs
   */
  setDefaultDates() {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const lastMonthStr = lastMonth.toISOString().slice(0, 7);
    const currentMonthStr = currentMonth.toISOString().slice(0, 7);
    
    this.archiveMonthInput.value = lastMonthStr;
    this.snapshotMonthInput.value = currentMonthStr;
    this.deleteMonthInput.value = lastMonthStr;
  }

  /**
   * Load and display database status with optimized caching
   */
  async loadDatabaseStatus(forceRefresh = false) {
    const cacheKey = 'database_status';
    
    // Check cache first if not forcing refresh
    if (!forceRefresh && !this.cache.shouldRefresh(cacheKey)) {
      const cachedStatus = this.cache.get(cacheKey);
      if (cachedStatus) {
        console.log('Using cached database status');
        this.updateStatusDisplay(cachedStatus);
        this.showCacheIndicator('Menggunakan data cache');
        return;
      }
    }

    try {
      console.log('Fetching fresh database status');
      this.hideCacheIndicator();
      
      const collections = [
        'penjualanAksesoris',
        'stockAdditions', 
        'stokAksesorisTransaksi',
        'stokAksesoris'
      ];

      const statusData = {};
      
      // Use Promise.allSettled to handle individual collection failures
      const promises = collections.map(async (collectionName) => {
        try {
          // Use limit(1) and count aggregation for better performance
          const snapshot = await getDocs(query(collection(this.firestore, collectionName), limit(1000)));
          return { collectionName, count: snapshot.size };
        } catch (error) {
          console.error(`Error loading ${collectionName}:`, error);
          return { collectionName, count: 0 };
        }
      });

      const results = await Promise.allSettled(promises);
      
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { collectionName, count } = result.value;
          statusData[collectionName] = count;
        }
      });

      // Cache the status with shorter TTL
      this.cache.set(cacheKey, statusData, this.cache.statusTTL);
      this.updateStatusDisplay(statusData);

    } catch (error) {
      console.error('Error loading database status:', error);
      
      // Try to use cached data as fallback
      const cachedStatus = this.cache.get(cacheKey);
      if (cachedStatus) {
        console.log('Using cached data as fallback');
        this.updateStatusDisplay(cachedStatus);
        this.showCacheIndicator('Menggunakan data cache (fallback)');
      } else {
        this.logProgress('Error loading database status: ' + error.message, 'error');
      }
    }
  }

  /**
   * Show cache indicator
   */
  showCacheIndicator(text) {
    let indicator = document.getElementById('maintenanceCacheIndicator');
    if (!indicator) {
      indicator = document.createElement('small');
      indicator.id = 'maintenanceCacheIndicator';
      indicator.className = 'text-muted ms-2';
      
      const statusContainer = document.querySelector('.maintenance-status');
      if (statusContainer) {
        statusContainer.appendChild(indicator);
      }
    }
    
    indicator.textContent = text;
    indicator.style.display = 'inline';
  }

  /**
   * Hide cache indicator
   */
  hideCacheIndicator() {
    const indicator = document.getElementById('maintenanceCacheIndicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  /**
   * Update status display
   */
  updateStatusDisplay(statusData) {
    const statusElements = [
      'statusPenjualan',
      'statusStockAdditions',
      'statusStokTransaksi', 
      'statusStokAksesoris'
    ];

    const collections = [
      'penjualanAksesoris',
      'stockAdditions', 
      'stokAksesorisTransaksi',
      'stokAksesoris'
    ];

    collections.forEach((collection, index) => {
      const element = document.getElementById(statusElements[index]);
      if (element) {
        const count = statusData[collection] || 0;
        element.textContent = count.toLocaleString();
      }
    });
  }

  /**
   * Force refresh status (clear cache and reload)
   */
  async forceRefreshStatus() {
    this.cache.remove('database_status');
    await this.loadDatabaseStatus(true);
    this.showAlert('Status database berhasil diperbarui', 'success');
  }

  /**
   * Start auto refresh with intelligent caching
   */
  startAutoRefresh() {
    // Refresh status every 5 minutes, but use cache if available
    setInterval(async () => {
      if (!document.hidden && !this.isLoading) {
        try {          // Only refresh if cache is stale
          if (this.cache.shouldRefresh('database_status')) {
            await this.loadDatabaseStatus();
          }
        } catch (error) {
          console.warn('Auto-refresh failed:', error);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    // Clean cache every 10 minutes
    setInterval(() => {
      this.cache.clearOldCache();
    }, 10 * 60 * 1000);
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
   * Handle create snapshot process with proper loading management
   */
  async handleCreateSnapshot() {
    const selectedMonth = this.snapshotMonthInput.value;
    if (!selectedMonth) {
      this.showAlert('Pilih bulan untuk snapshot', 'warning');
      return;
    }
  
    const confirmed = await this.showConfirmation(
      `Apakah Anda yakin ingin membuat snapshot stok untuk bulan ${selectedMonth}?`,
      'Konfirmasi Snapshot Stok'
    );
  
    if (!confirmed) return;
  
    // Prevent multiple operations
    if (this.isLoading) {
      console.warn('Operation already in progress');
      return;
    }
  
    try {
      this.showLoading('Membuat Snapshot...', 'Memproses data stok');
      this.updateProgress(0);
      this.clearProgressLog();
  
      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation timeout after 5 minutes')), 5 * 60 * 1000);
      });
  
      const snapshotPromise = this.createStockSnapshot(selectedMonth);
      
      await Promise.race([snapshotPromise, timeoutPromise]);
      
      this.updateProgress(100);
      this.showAlert('Snapshot stok berhasil dibuat!', 'success');
      
    } catch (error) {
      console.error('Error creating snapshot:', error);
      this.logProgress(`Error: ${error.message}`, 'error');
      this.showAlert('Gagal membuat snapshot: ' + error.message, 'error');
    } finally {
      // Force hide loading with delay to ensure completion
      setTimeout(() => {
        this.hideLoading();
      }, 500);
    }
  }

  /**
   * Create stock snapshot for specified month with enhanced caching
   */
  async createStockSnapshot(monthStr) {
    let stockData = null;
    
    try {
      this.logProgress('Mengambil data stok aksesoris...');
      
      // Check cache first
      const cacheKey = `stock_data_${monthStr}`;
      stockData = this.cache.get(cacheKey);
      
      if (!stockData) {
        this.logProgress('Mengambil data dari database...');
        const snapshot = await getDocs(collection(this.firestore, 'stokAksesoris'));
        stockData = snapshot.docs;
        
        // Cache for 10 minutes
        this.cache.set(cacheKey, stockData, this.cache.dataTTL);
        this.logProgress(`Data diambil dari database: ${stockData.length} item`);
      } else {
        this.logProgress(`Data diambil dari cache: ${stockData.length} item`);
      }
      
      this.updateProgress(25);
  
      if (stockData.length === 0) {
        this.logProgress('Tidak ada data stok untuk di-snapshot', 'warning');
        this.updateProgress(100);
        return;
      }
  
      // Process in smaller batches with better error handling
      const batchSize = 25; // Reduced batch size
      const totalBatches = Math.ceil(stockData.length / batchSize);
      let processedCount = 0;
      let successfulBatches = 0;
  
      this.logProgress(`Memproses ${stockData.length} item dalam ${totalBatches} batch...`);
  
      for (let i = 0; i < totalBatches; i++) {
        try {
          const startIndex = i * batchSize;
          const endIndex = Math.min(startIndex + batchSize, stockData.length);
          const batchDocs = stockData.slice(startIndex, endIndex);
  
          this.logProgress(`Memproses batch ${i + 1}/${totalBatches} (${batchDocs.length} item)...`);
  
          // Create batch with retry mechanism
          let retryCount = 0;
          const maxRetries = 3;
          
          while (retryCount < maxRetries) {
            try {
              const batch = writeBatch(this.firestore);
  
              batchDocs.forEach((docSnapshot) => {
                const data = docSnapshot.data();
                
                const snapshotItem = {
                  barang_id: docSnapshot.id,
                  kode: data.kode || '',
                  nama: data.nama || '',
                  kategori: data.kategori || '',
                  stok_akhir: data.stokAkhir || 0,
                  harga_jual: data.hargaJual || 0,
                  bulan: monthStr,
                  created_at: serverTimestamp(),
                  original_data: data
                };
  
                const snapshotRef = doc(collection(this.firestore, 'stokSnapshot'));
                batch.set(snapshotRef, snapshotItem);
              });
  
              // Commit batch with timeout
              await Promise.race([
                batch.commit(),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Batch commit timeout')), 30000)
                )
              ]);
              
              processedCount += batchDocs.length;
              successfulBatches++;
              break; // Success, exit retry loop
              
            } catch (batchError) {
              retryCount++;
              this.logProgress(`Batch ${i + 1} gagal (percobaan ${retryCount}/${maxRetries}): ${batchError.message}`, 'warning');
              
              if (retryCount >= maxRetries) {
                throw new Error(`Batch ${i + 1} gagal setelah ${maxRetries} percobaan: ${batchError.message}`);
              }
              
              // Wait before retry with exponential backoff
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
            }
          }
          
          // Update progress
          const progress = 25 + ((i + 1) / totalBatches * 70);
          this.updateProgress(Math.round(progress));
          
          this.logProgress(`Batch ${i + 1} selesai (${processedCount}/${stockData.length} item)`);
  
          // Small delay between batches
          if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
        } catch (batchError) {
          this.logProgress(`Error pada batch ${i + 1}: ${batchError.message}`, 'error');
          // Continue with next batch instead of failing completely
          continue;
        }
      }
  
      this.updateProgress(95);
      
      if (successfulBatches === 0) {
        throw new Error('Semua batch gagal diproses');
      }
      
      if (successfulBatches < totalBatches) {
        this.logProgress(`Peringatan: ${totalBatches - successfulBatches} batch gagal dari ${totalBatches} total batch`, 'warning');
      }
  
      this.updateProgress(100);
      this.logProgress(`Snapshot selesai! ${processedCount} item disimpan untuk bulan ${monthStr}`, 'success');
      
      // Clear related cache
      this.cache.remove(cacheKey);
      
    } catch (error) {
      this.logProgress(`Error dalam createStockSnapshot: ${error.message}`, 'error');
      this.updateProgress(100); // Ensure progress reaches 100% even on error
      throw error;
    }
  }

  /**
   * Handle archive data process with proper loading management
   */
  async handleArchiveData() {
    const selectedMonth = this.archiveMonthInput.value;
    if (!selectedMonth) {
      this.showAlert('Pilih bulan yang akan diarsipkan', 'warning');
      return;
    }

    const confirmed = await this.showConfirmation(
      `Apakah Anda yakin ingin mengarsipkan data bulan ${selectedMonth}?`,
      'Konfirmasi Arsip Data'
    );

    if (!confirmed) return;

    try {
      this.showLoading('Mengarsipkan Data...', 'Memproses data untuk diarsipkan');
      this.updateProgress(0);
      this.clearProgressLog();

      await this.archiveDataByMonth(selectedMonth);
      
      this.isArchived = true;
      this.updateDeleteButtonState();
      this.showAlert('Data berhasil diarsipkan!', 'success');
      
      // Clear status cache to force refresh
      this.cache.remove('database_status');
      
    } catch (error) {
      console.error('Error archiving data:', error);
      this.showAlert('Gagal mengarsipkan data: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Archive data by month to archive collections with caching
   */
  async archiveDataByMonth(monthStr) {
    try {
      const [year, month] = monthStr.split('-');
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 1);

      const collections = [
        { source: 'penjualanAksesoris', archive: 'penjualanAksesoris_arsip' },
        { source: 'stockAdditions', archive: 'stockAdditions_arsip' },
        { source: 'stokAksesorisTransaksi', archive: 'stokAksesorisTransaksi_arsip' }
      ];

      let totalProcessed = 0;
      const totalCollections = collections.length;

      for (let i = 0; i < collections.length; i++) {
        const { source, archive } = collections[i];
        
        this.logProgress(`Memproses koleksi ${source}...`);
        
        // Check cache first
        const cacheKey = `archive_${source}_${monthStr}`;
        let docs = this.cache.get(cacheKey);
        
        if (!docs) {
          // Query data for the specified month
          const q = query(
            collection(this.firestore, source),
            where('timestamp', '>=', Timestamp.fromDate(startDate)),
            where('timestamp', '<', Timestamp.fromDate(endDate)),
            orderBy('timestamp', 'asc')
          );

          const snapshot = await getDocs(q);
          docs = snapshot.docs;
          
          // Cache for 5 minutes
          this.cache.set(cacheKey, docs, 5 * 60 * 1000);
        }
        
        this.logProgress(`Ditemukan ${docs.length} dokumen di ${source}`);

        if (docs.length > 0) {
          // Process in smaller batches
          const batchSize = 50;
          const totalBatches = Math.ceil(docs.length / batchSize);
          
          for (let j = 0; j < totalBatches; j++) {
            const startIndex = j * batchSize;
            const endIndex = Math.min(startIndex + batchSize, docs.length);
            const batchDocs = docs.slice(startIndex, endIndex);
            
            await this.processBatch(batchDocs, source, archive);
            
            const progress = ((i / totalCollections) + ((j + 1) / totalBatches / totalCollections)) * 100;
            this.updateProgress(Math.round(progress));
            
            this.logProgress(`Batch ${j + 1}/${totalBatches} selesai untuk ${source}`);
            
            // Small delay
            if (j < totalBatches - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          // Special handling for penjualanAksesoris
          if (source === 'penjualanAksesoris') {
            await this.copyToMutasiKode(docs);
          }
        }

        totalProcessed++;
        this.logProgress(`Selesai memproses ${source} (${docs.length} dokumen)`);
        
        // Clear cache after processing
        this.cache.remove(cacheKey);
      }

      this.updateProgress(100);
      this.logProgress(`Arsip selesai! Total ${totalProcessed} koleksi diproses.`, 'success');
      
      // Clear status cache to force refresh
      this.cache.remove('database_status');
      
    } catch (error) {
      this.logProgress(`Error dalam archiveDataByMonth: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Process batch of documents for archiving
   */
  async processBatch(docs, sourceCollection, archiveCollection) {
    const batch = writeBatch(this.firestore);
    
    for (const docSnapshot of docs) {
      const data = docSnapshot.data();
      
      // Add to archive collection
      const archiveRef = doc(collection(this.firestore, archiveCollection));
      batch.set(archiveRef, {
        ...data,
        originalId: docSnapshot.id,
        archivedAt: serverTimestamp()
      });
    }

    await batch.commit();
  }

  /**
   * Copy manual sales with barcode to mutasiKode collection
   */
  async copyToMutasiKode(penjualanDocs) {
    this.logProgress('Memproses data untuk mutasi kode...');
    
    const mutasiData = penjualanDocs
      .map(doc => doc.data())
      .filter(data => 
        data.jenisPenjualan === 'manual' && 
        data.items && 
        data.items.some(item => item.kodeText && item.kodeText.trim() !== '' && item.kodeText !== '-')
      );

    if (mutasiData.length > 0) {
      // Process in batches
      const batchSize = 50;
      const totalBatches = Math.ceil(mutasiData.length / batchSize);
      
      for (let i = 0; i < totalBatches; i++) {
        const batch = writeBatch(this.firestore);
        const startIndex = i * batchSize;
        const endIndex = Math.min(startIndex + batchSize, mutasiData.length);
        const batchData = mutasiData.slice(startIndex, endIndex);
        
        batchData.forEach(data => {
          data.items.forEach(item => {
            if (item.kodeText && item.kodeText.trim() !== '' && item.kodeText !== '-') {
              const mutasiRef = doc(collection(this.firestore, 'mutasiKode'));
              batch.set(mutasiRef, {
                kode: item.kodeText,
                namaBarang: item.nama || '',
                kadar: item.kadar || '',
                berat: item.berat || 0,
                hargaPerGram: item.hargaPerGram || 0,
                totalHarga: item.totalHarga || 0,
                keterangan: item.keterangan || '',
                timestamp: data.timestamp,
                penjualanId: data.originalId || '',
                sales: data.sales || '',
                createdAt: serverTimestamp()
              });
            }
          });
        });

        await batch.commit();
        this.logProgress(`Batch mutasi ${i + 1}/${totalBatches} selesai`);
      }

      this.logProgress(`${mutasiData.length} data ditambahkan ke mutasiKode`);
    }
  }

  /**
   * Handle export data for specific collection with caching
   */
  async handleExportData(collectionName) {
    try {
      this.showLoading('Mengexport Data...', `Memproses data ${collectionName}`);
      this.updateProgress(0);
      this.clearProgressLog();

      await this.exportCollectionToExcel(collectionName);
      
      this.isExported = true;
      this.updateDeleteButtonState();
      this.showAlert(`Data ${collectionName} berhasil diexport!`, 'success');
      
    } catch (error) {
      console.error('Error exporting data:', error);
      this.showAlert('Gagal mengexport data: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Handle export all data with proper loading management
   */
  async handleExportAllData() {
    const confirmed = await this.showConfirmation(
      'Apakah Anda yakin ingin mengexport semua data? Proses ini mungkin memakan waktu lama.',
      'Konfirmasi Export Semua Data'
    );

    if (!confirmed) return;

    try {
      this.showLoading('Mengexport Semua Data...', 'Memproses semua koleksi');
      this.updateProgress(0);
      this.clearProgressLog();

      const collections = ['penjualanAksesoris', 'stockAdditions', 'stokAksesorisTransaksi', 'stokAksesoris'];
      
      for (let i = 0; i < collections.length; i++) {
        const collectionName = collections[i];
        this.logProgress(`Mengexport ${collectionName}...`);
        
        await this.exportCollectionToExcel(collectionName, false);
        
        const progress = ((i + 1) / collections.length) * 100;
        this.updateProgress(Math.round(progress));
      }
      
      this.isExported = true;
      this.updateDeleteButtonState();
      this.showAlert('Semua data berhasil diexport!', 'success');
      
    } catch (error) {
      console.error('Error exporting all data:', error);
      this.showAlert('Gagal mengexport semua data: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Export collection to Excel file with optimized caching
   */
  async exportCollectionToExcel(collectionName, autoDownload = true, customTitle = null) {
    try {
      this.logProgress(`Mengambil data dari ${collectionName}...`);
      
      // Check cache first
      const cacheKey = `export_${collectionName}`;
      let docs = this.cache.get(cacheKey);
      
      if (!docs) {
        const snapshot = await getDocs(collection(this.firestore, collectionName));
        docs = snapshot.docs;
        
        // Cache for 5 minutes
        this.cache.set(cacheKey, docs, 5 * 60 * 1000);
        this.logProgress(`Data diambil dari database: ${docs.length} dokumen`);
      } else {
        this.logProgress(`Data diambil dari cache: ${docs.length} dokumen`);
      }
  
      if (docs.length === 0) {
        this.logProgress(`Tidak ada data di ${collectionName}`, 'warning');
        this.hideLoading();
        this.showAlert(`Tidak ada data di koleksi ${collectionName}`, 'warning');
        return;
      }
  
      this.logProgress('Memproses data untuk Excel...');
  
      // Generate title
      const title = customTitle || this.generateExportTitle(collectionName);
      
      // Convert Firestore data to Excel format
      const excelData = docs.map((doc, index) => {
        const data = doc.data();
        
        // Format khusus untuk penjualanAksesoris
        if (collectionName === 'penjualanAksesoris') {
          return {
            tanggal: this.formatDate(data.timestamp?.toDate() || data.tanggal),
            sales: data.sales || '',
            jenisPenjualan: data.jenisPenjualan || '',
            items: this.formatItems(data.items),
            metodeBayar: data.metodeBayar || '',
            totalHarga: data.totalHarga || 0
          };
        }
        
        // Format untuk koleksi lainnya
        const processedData = {};
        
        Object.keys(data).forEach(key => {
          const value = data[key];
          
          if (value && typeof value.toDate === 'function') {
            processedData[key] = this.formatDate(value.toDate());
          } else if (Array.isArray(value)) {
            processedData[key] = JSON.stringify(value);
          } else if (typeof value === 'object' && value !== null) {
            processedData[key] = JSON.stringify(value);
          } else {
            processedData[key] = value;
          }
        });
        
        if (index % 100 === 0) {
          const progress = (index / docs.length) * 50;
          this.updateProgress(Math.round(progress));
        }
        
        return processedData;
      });
  
      this.logProgress('Membuat file Excel...');
      this.updateProgress(75);
  
      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      
      // Create worksheet dengan title
      const worksheet = this.createWorksheetWithTitle(excelData, title);
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, this.getSheetName(collectionName));
  
      this.updateProgress(90);
  
      if (autoDownload) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `${collectionName}_${timestamp}.xlsx`;
        
        XLSX.writeFile(workbook, filename);
        this.logProgress(`File ${filename} berhasil didownload`);
      }
  
      this.updateProgress(100);
      this.logProgress(`Export ${collectionName} selesai (${docs.length} records)`);
  
      setTimeout(() => {
        this.hideLoading();
        this.showAlert(`Export ${collectionName} berhasil! (${docs.length} records)`, 'success');
      }, 500);
  
      return workbook;
      
    } catch (error) {
      this.logProgress(`Error dalam exportCollectionToExcel: ${error.message}`, 'error');
      this.hideLoading();
      this.showAlert(`Gagal export ${collectionName}: ${error.message}`, 'error');
      throw error;
    }
  }
  
  /**
   * Generate title untuk export berdasarkan collection dan bulan
   */
  generateExportTitle(collectionName) {
    const currentDate = new Date();
    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    
    const currentMonth = monthNames[currentDate.getMonth()];
    const currentYear = currentDate.getFullYear();
    
    const titles = {
      'penjualanAksesoris': `Arsip Data Penjualan Bulan ${currentMonth} ${currentYear} - Melati Gold Shop`,
      'stockAdditions': `Arsip Data Penambahan Stok Bulan ${currentMonth} ${currentYear} - Melati Gold Shop`,
      'stokAksesorisTransaksi': `Arsip Data Transaksi Stok Bulan ${currentMonth} ${currentYear} - Melati Gold Shop`,
      'stokAksesoris': `Arsip Data Stok Aksesoris Bulan ${currentMonth} ${currentYear} - Melati Gold Shop`
    };
    
    return titles[collectionName] || `Arsip Data ${collectionName} Bulan ${currentMonth} ${currentYear} - Melati Gold Shop`;
  }
  
  /**
   * Create worksheet dengan title di bagian atas
   */
  createWorksheetWithTitle(data, title) {
    if (data.length === 0) {
      return XLSX.utils.json_to_sheet([]);
    }
    
    // Create worksheet dari data
    const worksheet = XLSX.utils.json_to_sheet(data, { origin: 'A4' });
    
    // Add title di baris pertama
    XLSX.utils.sheet_add_aoa(worksheet, [[title]], { origin: 'A1' });
    
    // Add info export di baris kedua
    const exportInfo = `Diekspor pada: ${this.formatDate(new Date())} | Total Records: ${data.length}`;
    XLSX.utils.sheet_add_aoa(worksheet, [[exportInfo]], { origin: 'A2' });
    
    // Merge cells untuk title
    if (!worksheet['!merges']) worksheet['!merges'] = [];
    
    const headerCols = Object.keys(data[0]).length;
    worksheet['!merges'].push({
      s: { r: 0, c: 0 }, // start
      e: { r: 0, c: headerCols - 1 } // end
    });
    
    worksheet['!merges'].push({
      s: { r: 1, c: 0 },
      e: { r: 1, c: headerCols - 1 }
    });
    
    // Style untuk title
    if (!worksheet['!rows']) worksheet['!rows'] = [];
    worksheet['!rows'][0] = { hpt: 25 }; // height untuk title
    worksheet['!rows'][1] = { hpt: 18 }; // height untuk info
    worksheet['!rows'][2] = { hpt: 5 };  // empty row
    
    // Auto-size columns
    const colWidths = [];
    Object.keys(data[0]).forEach(key => {
      const maxLength = Math.max(
        key.length,
        ...data.map(row => String(row[key] || '').length)
      );
      colWidths.push({ wch: Math.min(maxLength + 2, 50) });
    });
    worksheet['!cols'] = colWidths;
    
    return worksheet;
  }
  
  /**
   * Get sheet name berdasarkan collection
   */
  getSheetName(collectionName) {
    const sheetNames = {
      'penjualanAksesoris': 'Data Penjualan',
      'stockAdditions': 'Penambahan Stok',
      'stokAksesorisTransaksi': 'Transaksi Stok',
      'stokAksesoris': 'Stok Aksesoris'
    };
    
    return sheetNames[collectionName] || collectionName;
  }
  
  /**
   * Format items array untuk display yang readable
   */
  formatItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return 'Tidak ada item';
    }
    
    return items.map(item => {
      const parts = [];
      
      if (item.nama) parts.push(`${item.nama}`);
      if (item.kodeText && item.kodeText !== '-') parts.push(`[${item.kodeText}]`);
      if (item.kadar) parts.push(`${item.kadar}`);
      if (item.berat) parts.push(`${item.berat}g`);
      if (item.totalHarga) parts.push(`Rp${item.totalHarga}`);
      
      return parts.join(' - ');
    }).join(' | ');
  }
  
  /**
   * Format date to readable string
   */
  formatDate(date) {
    if (!date) return '';
    
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return '';
      
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return '';
    }
  }
  
  /**
   * Handle delete old data process with proper loading management
   */
  async handleDeleteOldData() {
    const selectedMonth = this.deleteMonthInput.value;
    if (!selectedMonth) {
      this.showAlert('Pilih bulan yang akan dihapus', 'warning');
      return;
    }

    if (!this.isArchived || !this.isExported) {
      this.showAlert('Data harus diarsipkan dan diexport terlebih dahulu!', 'warning');
      return;
    }

    const confirmed = await this.showConfirmation(
      `PERINGATAN: Apakah Anda yakin ingin menghapus PERMANEN data bulan ${selectedMonth}?\n\nPastikan data sudah diarsipkan dan diexport!`,
      'Konfirmasi Hapus Data'
    );

    if (!confirmed) return;

    // Double confirmation
    const doubleConfirmed = await this.showConfirmation(
      'Konfirmasi sekali lagi: Data yang dihapus TIDAK DAPAT dikembalikan!',
      'Konfirmasi Terakhir'
    );

    if (!doubleConfirmed) return;

    try {
      this.showLoading('Menghapus Data...', 'Menghapus data lama dari database');
      this.updateProgress(0);
      this.clearProgressLog();

      await this.deleteDataByMonth(selectedMonth);
      
      this.showAlert('Data lama berhasil dihapus!', 'success');
      
      // Clear all cache and force refresh status
      this.cache.clear();
      await this.loadDatabaseStatus(true);
      
    } catch (error) {
      console.error('Error deleting data:', error);
      this.showAlert('Gagal menghapus data: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Delete data by month from specified collections
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
        
        this.logProgress(`Menghapus data dari ${collectionName}...`);
        
        // Query data for the specified month
        const q = query(
          collection(this.firestore, collectionName),
          where('timestamp', '>=', Timestamp.fromDate(startDate)),
          where('timestamp', '<', Timestamp.fromDate(endDate))
        );

        const snapshot = await getDocs(q);
        const docs = snapshot.docs;
        
        this.logProgress(`Ditemukan ${docs.length} dokumen untuk dihapus di ${collectionName}`);

        if (docs.length > 0) {
          // Delete in smaller batches
          const batchSize = 50;
          const totalBatches = Math.ceil(docs.length / batchSize);
          
          for (let j = 0; j < totalBatches; j++) {
            const batch = writeBatch(this.firestore);
            const startIndex = j * batchSize;
            const endIndex = Math.min(startIndex + batchSize, docs.length);
            const batchDocs = docs.slice(startIndex, endIndex);
            
            batchDocs.forEach(docSnapshot => {
              batch.delete(doc(this.firestore, collectionName, docSnapshot.id));
            });

            await batch.commit();
            
            const progress = ((i / collections.length) + ((j + 1) / totalBatches / collections.length)) * 100;
            this.updateProgress(Math.round(progress));
            
            this.logProgress(`Batch ${j + 1}/${totalBatches} dihapus dari ${collectionName}`);
            
            // Small delay
            if (j < totalBatches - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          totalDeleted += docs.length;
        }

        this.logProgress(`Selesai menghapus ${docs.length} dokumen dari ${collectionName}`);
      }

      this.updateProgress(100);
      this.logProgress(`Penghapusan selesai! Total ${totalDeleted} dokumen dihapus.`, 'success');
      
    } catch (error) {
      this.logProgress(`Error dalam deleteDataByMonth: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Update delete button state based on archive and export status
   */
  updateDeleteButtonState() {
    const canDelete = this.isArchived && this.isExported;
    this.btnDeleteOldData.disabled = !canDelete;
    
    if (canDelete) {
      this.btnDeleteOldData.classList.remove('btn-secondary');
      this.btnDeleteOldData.classList.add('btn-danger');
    }
  }

  /**
   * Update progress bar
   */
  updateProgress(percentage) {
    if (this.progressBar) {
      this.progressBar.style.width = `${percentage}%`;
      this.progressBar.textContent = `${percentage}%`;
      this.progressBar.setAttribute('aria-valuenow', percentage);
    }
  }

  /**
   * Log progress message
   */
  logProgress(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logClass = type === 'error' ? 'text-danger' : 
                     type === 'success' ? 'text-success' : 
                     type === 'warning' ? 'text-warning' : 'text-dark';
    
    const logEntry = document.createElement('div');
    logEntry.className = `mb-1 ${logClass}`;
    logEntry.innerHTML = `<small>[${timestamp}] ${message}</small>`;
    
    if (this.progressLog) {
      this.progressLog.appendChild(logEntry);
      this.progressLog.scrollTop = this.progressLog.scrollHeight;
    }
    
    console.log(`[Maintenance] ${message}`);
  }

  /**
   * Clear progress log
   */
  clearProgressLog() {
    if (this.progressLog) {
      this.progressLog.innerHTML = '<p class="text-muted mb-0">Memulai proses maintenance...</p>';
    }
  }

  /**
   * Show alert using SweetAlert2
   */
  showAlert(message, type = 'info') {
    const iconMap = {
      'success': 'success',
      'error': 'error',
      'warning': 'warning',
      'info': 'info'
    };

    return Swal.fire({
      title: type === 'error' ? 'Error' : 
             type === 'success' ? 'Berhasil' : 
             type === 'warning' ? 'Peringatan' : 'Informasi',
      text: message,
      icon: iconMap[type] || 'info',
      confirmButtonText: 'OK',
      confirmButtonColor: '#0d6efd'
    });
  }

  /**
   * Show confirmation dialog
   */
  showConfirmation(message, title = 'Konfirmasi') {
    return Swal.fire({
      title: title,
      text: message,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#0d6efd',
      cancelButtonColor: '#6c757d'
    }).then(result => result.isConfirmed);
  }

  /**
   * Cleanup when page unloads
   */
  cleanup() {
    // Force hide loading if still showing
    if (this.isLoading) {
      this.hideLoading();
    }
    
    // Clear cache
    this.cache.clear();
    
    console.log('Maintenance system cleanup completed');
  }
}

/**
 * Shared Cache Manager for cross-module caching
 */
class SharedCacheManager {
  constructor() {
    this.prefix = 'shared_maintenance_';
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes
  }

  setVersioned(key, data, ttl = this.defaultTTL) {
    const item = {
      data,
      timestamp: Date.now(),
      ttl,
      version: Date.now()
    };

    try {
      sessionStorage.setItem(this.prefix + key, JSON.stringify(item));
    } catch (error) {
      console.warn('Shared cache set failed:', error);
      this.clearOldCache();
    }
  }

  getVersioned(key) {
    try {
      const item = JSON.parse(sessionStorage.getItem(this.prefix + key));
      if (!item) return null;

      const age = Date.now() - item.timestamp;
      if (age > item.ttl) {
        this.remove(key);
        return null;
      }

      return { data: item.data, age };
    } catch (error) {
      console.warn('Shared cache get failed:', error);
      this.remove(key);
      return null;
    }
  }

  remove(key) {
    try {
      sessionStorage.removeItem(this.prefix + key);
    } catch (error) {
      console.warn('Shared cache remove failed:', error);
    }
  }

  invalidateRelated(pattern) {
    try {
      Object.keys(sessionStorage)
        .filter(key => key.startsWith(this.prefix) && key.includes(pattern))
        .forEach(key => sessionStorage.removeItem(key));
    } catch (error) {
      console.warn('Shared cache invalidate failed:', error);
    }
  }

  clearOldCache() {
    const now = Date.now();
    try {
      Object.keys(sessionStorage)
        .filter(key => key.startsWith(this.prefix))
        .forEach(key => {
          try {
            const item = JSON.parse(sessionStorage.getItem(key));
            if (item && now - item.timestamp > item.ttl) {
              sessionStorage.removeItem(key);
            }
          } catch (error) {
            sessionStorage.removeItem(key);
          }
        });
    } catch (error) {
      console.warn('Clear old shared cache failed:', error);
    }
  }
}

// Create shared cache instance
const sharedCacheManager = new SharedCacheManager();

/**
 * Utility functions for backward compatibility
 */
const maintenanceUtils = {
  showAlert: (message, type = 'info') => {
    return Swal.fire({
      title: type === 'error' ? 'Error' : type === 'success' ? 'Berhasil' : 'Informasi',
      text: message,
      icon: type,
      confirmButtonText: 'OK'
    });
  },

  showConfirm: (message, title = 'Konfirmasi') => {
    return Swal.fire({
      title: title,
      text: message,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya',
      cancelButtonText: 'Batal'
    }).then(result => result.isConfirmed);
  },

  formatDate: (date) => {
    if (!date) return '';
    try {
      const d = date.toDate ? date.toDate() : date instanceof Date ? date : new Date(date);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return '';
    }
  }
};

/**
 * Performance monitoring for maintenance operations
 */
const MaintenancePerformance = {
  operations: new Map(),

  start: (operationName) => {
    const startTime = performance.now();
    MaintenancePerformance.operations.set(operationName, {
      startTime,
      endTime: null,
      duration: null
    });
    console.log(`Started monitoring: ${operationName}`);
  },

  end: (operationName) => {
    const operation = MaintenancePerformance.operations.get(operationName);
    if (operation) {
      const endTime = performance.now();
      const duration = endTime - operation.startTime;
      
      operation.endTime = endTime;
      operation.duration = duration;
      
      console.log(`Completed: ${operationName} in ${(duration / 1000).toFixed(2)} seconds`);
      
      if (duration > 30000) {
        console.warn(`Slow operation detected: ${operationName} took ${(duration / 1000).toFixed(2)} seconds`);
      }
    }
  },

  getSummary: () => {
    const summary = {};
    MaintenancePerformance.operations.forEach((operation, name) => {
      if (operation.duration !== null) {
        summary[name] = {
          duration: operation.duration,
          durationSeconds: (operation.duration / 1000).toFixed(2)
        };
      }
    });
    return summary;
  },

  clear: () => {
    MaintenancePerformance.operations.clear();
  }
};

/**
 * Enhanced error handling and recovery
 */
const MaintenanceErrorHandler = {
  handleBatchError: async (error, operation, retryCount = 0) => {
    console.error(`Batch operation error in ${operation}:`, error);
    
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000;
    
    if (retryCount < maxRetries && error.code !== 'permission-denied') {
      console.log(`Retrying ${operation} in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return { shouldRetry: true, retryCount: retryCount + 1 };
    }
    
    return { shouldRetry: false, error };
  },

  handleQuotaError: (error) => {
    if (error.code === 'resource-exhausted') {
      return {
        message: 'Kuota Firestore terlampaui. Coba lagi nanti atau hubungi administrator.',
        suggestion: 'Pertimbangkan untuk mengurangi ukuran batch atau menjalankan operasi di luar jam sibuk.'
      };
    }
    return null;
  },

  handleNetworkError: (error) => {
    if (error.code === 'unavailable' || error.message.includes('network')) {
      return {
        message: 'Koneksi jaringan bermasalah. Periksa koneksi internet Anda.',
        suggestion: 'Coba lagi setelah koneksi stabil.'
      };
    }
    return null;
  }
};

/**
 * Additional utility functions for maintenance operations
 */
const MaintenanceHelpers = {
  validateMonthInput: (monthStr) => {
    if (!monthStr) return false;
    const regex = /^\d{4}-\d{2}$/;
    return regex.test(monthStr);
  },

  getMonthRange: (monthStr) => {
    const [year, month] = monthStr.split('-');
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 1);
    return { startDate, endDate };
  },

  estimateStorageSize: (docs) => {
    let totalSize = 0;
    docs.forEach(doc => {
      const dataStr = JSON.stringify(doc.data());
      totalSize += new Blob([dataStr]).size;
    });
    return totalSize;
  },

  formatFileSize: (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  generateBackupFilename: (collectionName, type = 'backup') => {
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
    return `${collectionName}_${type}_${timestamp}`;
  },

  validateFirebaseConnection: async () => {
    try {
      const testQuery = query(
        collection(firestore, 'stokAksesoris'),
        orderBy('__name__'),
        limit(1)
      );
      await getDocs(testQuery);
      return true;
    } catch (error) {
      console.error('Firebase connection test failed:', error);
      return false;
    }
  },

  createMaintenanceLog: (operation, details, status = 'success') => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation: operation,
      details: details,
      status: status,
      user: 'maintenance_system'
    };

    const logKey = `maintenance_log_${Date.now()}`;
    try {
      sessionStorage.setItem(logKey, JSON.stringify(logEntry));
    } catch (error) {
      console.warn('Could not store maintenance log:', error);
    }

    return logEntry;
  },

  getMaintenanceHistory: () => {
    const logs = [];
    try {
      Object.keys(sessionStorage)
        .filter(key => key.startsWith('maintenance_log_'))
        .forEach(key => {
          try {
            const log = JSON.parse(sessionStorage.getItem(key));
            logs.push(log);
          } catch (error) {
            console.warn('Invalid maintenance log entry:', key);
          }
        });
    } catch (error) {
      console.warn('Could not retrieve maintenance history:', error);
    }

    return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  clearOldMaintenanceLogs: () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      Object.keys(sessionStorage)
        .filter(key => key.startsWith('maintenance_log_'))
        .forEach(key => {
          try {
            const log = JSON.parse(sessionStorage.getItem(key));
            const logDate = new Date(log.timestamp);
            if (logDate < thirtyDaysAgo) {
              sessionStorage.removeItem(key);
            }
          } catch (error) {
            sessionStorage.removeItem(key);
          }
        });
    } catch (error) {
      console.warn('Could not clear old maintenance logs:', error);
    }
  }
};

// Initialize maintenance system when document is ready
let maintenanceSystem;

document.addEventListener('DOMContentLoaded', async function() {
  try {
    console.log('Initializing maintenance system...');
    maintenanceSystem = new MaintenanceSystem();
  } catch (error) {
    console.error('Error initializing maintenance system:', error);
    maintenanceUtils.showAlert('Gagal menginisialisasi sistem maintenance: ' + error.message, 'error');
  }
});

// Cleanup when page unloads
window.addEventListener('beforeunload', () => {
  if (maintenanceSystem) {
    maintenanceSystem.cleanup();
  }
});

// Handle visibility change to refresh status when tab becomes active
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && maintenanceSystem) {
    try {
      // Only refresh if cache is stale
      if (maintenanceSystem.cache.shouldRefresh('database_status')) {
        await maintenanceSystem.loadDatabaseStatus();
      }
    } catch (error) {
      console.warn('Failed to refresh database status:', error);
    }
  }
});

// Export for potential use in other modules
window.maintenanceSystem = maintenanceSystem;
window.maintenanceUtils = maintenanceUtils;
window.sharedCacheManager = sharedCacheManager;
window.MaintenanceHelpers = MaintenanceHelpers;
window.MaintenanceErrorHandler = MaintenanceErrorHandler;
window.MaintenancePerformance = MaintenancePerformance;

// Auto-refresh database status every 5 minutes with cache check
setInterval(async () => {
  if (maintenanceSystem && !document.hidden && !maintenanceSystem.isLoading) {
    try {
      // Only refresh if cache is stale
      if (maintenanceSystem.cache.shouldRefresh('database_status')) {
        await maintenanceSystem.loadDatabaseStatus();
        console.log('Auto-refreshed database status');
      }
    } catch (error) {
      console.warn('Auto-refresh database status failed:', error);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Clean cache every 10 minutes
setInterval(() => {
  if (maintenanceSystem) {
    maintenanceSystem.cache.clearOldCache();
    sharedCacheManager.clearOldCache();
    console.log('Performed automatic cache cleanup');
  }
}, 10 * 60 * 1000);

// Clean old maintenance logs on page load
document.addEventListener('DOMContentLoaded', () => {
  MaintenanceHelpers.clearOldMaintenanceLogs();
});

// Monitor sessionStorage usage for maintenance
setInterval(() => {
  try {
    const usage = JSON.stringify(sessionStorage).length;
    const maxSize = 5 * 1024 * 1024; // 5MB typical limit

    if (usage > maxSize * 0.8) { // 80% of limit
      console.warn('sessionStorage usage high:', usage, 'bytes');
      // Clear old cache if storage is full
      if (maintenanceSystem) {
        maintenanceSystem.cache.clearOldCache();
      }
      sharedCacheManager.clearOldCache();
      MaintenanceHelpers.clearOldMaintenanceLogs();
    }
  } catch (error) {
    console.warn('Could not check sessionStorage usage:', error);
  }
}, 10 * 60 * 1000); // Check every 10 minutes

// Add keyboard shortcuts for maintenance operations
document.addEventListener('keydown', (event) => {
  // Only if maintenance system is loaded and not currently loading
  if (!maintenanceSystem || maintenanceSystem.isLoading) return;

  // Ctrl + Shift + A for Archive
  if (event.ctrlKey && event.shiftKey && event.key === 'A') {
    event.preventDefault();
    if (maintenanceSystem.btnArchiveData && !maintenanceSystem.btnArchiveData.disabled) {
      maintenanceSystem.btnArchiveData.click();
    }
  }
  
  // Ctrl + Shift + S for Snapshot
  if (event.ctrlKey && event.shiftKey && event.key === 'S') {
    event.preventDefault();
    if (maintenanceSystem.btnCreateSnapshot && !maintenanceSystem.btnCreateSnapshot.disabled) {
      maintenanceSystem.btnCreateSnapshot.click();
    }
  }
  
  // Ctrl + Shift + E for Export All
  if (event.ctrlKey && event.shiftKey && event.key === 'E') {
    event.preventDefault();
    if (maintenanceSystem.btnExportAll && !maintenanceSystem.btnExportAll.disabled) {
      maintenanceSystem.btnExportAll.click();
    }
  }

  // Ctrl + Shift + R for Refresh Status
  if (event.ctrlKey && event.shiftKey && event.key === 'R') {
    event.preventDefault();
    maintenanceSystem.forceRefreshStatus();
  }
});

// Add connection monitoring
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
  isOnline = true;
  console.log('Connection restored');
  if (maintenanceSystem && !maintenanceSystem.isLoading) {
    // Refresh status when connection is restored
    setTimeout(() => {
      maintenanceSystem.forceRefreshStatus();
    }, 1000);
  }
});

window.addEventListener('offline', () => {
  isOnline = false;
  console.log('Connection lost');
  if (maintenanceSystem) {
    maintenanceSystem.showAlert('Koneksi internet terputus. Beberapa fitur mungkin tidak berfungsi.', 'warning');
  }
});

// Enhanced error boundary for maintenance operations
window.addEventListener('error', (event) => {
  console.error('Global error in maintenance:', event.error);
  
  // If loading modal is stuck, force hide it
  if (maintenanceSystem && maintenanceSystem.isLoading) {
    console.warn('Force hiding loading modal due to error');
    maintenanceSystem.hideLoading();
  }
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in maintenance:', event.reason);
  
  // If loading modal is stuck, force hide it
  if (maintenanceSystem && maintenanceSystem.isLoading) {
    console.warn('Force hiding loading modal due to unhandled rejection');
    maintenanceSystem.hideLoading();
  }
});