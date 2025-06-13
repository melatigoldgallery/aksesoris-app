import { firestore } from "./configFirebase.js";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// Global variables
let activeLockRow = null;
let currentTransactionData = null;

// Enhanced smart cache with real-time sync capabilities
const smartCache = {
    prefix: "melati_sales_v2_",
    
    // TTL configurations
    TTL: {
      stock: 10 * 60 * 1000,      // 10 minutes for stock data
      sales: 2 * 60 * 1000,       // 2 minutes for sales data
      today: 1 * 60 * 1000,       // 1 minute for today's data
      metadata: 5 * 60 * 1000,    // 5 minutes for metadata
    },
  
    // Set cache with automatic TTL
    set(key, data, customTTL = null) {
      try {
        const ttl = customTTL || this.getTTLForKey(key);
        const cacheItem = {
          data,
          timestamp: Date.now(),
          ttl,
          version: this.generateVersion(),
          checksum: this.generateChecksum(data)
        };
        
        localStorage.setItem(this.prefix + key, JSON.stringify(cacheItem));
        console.log(`📦 Cached: ${key} (TTL: ${Math.round(ttl/1000)}s)`);
      } catch (error) {
        console.warn("Cache set failed:", error);
        this.handleStorageError();
      }
    },
  
    // Get cache with validation
    get(key) {
      try {
        const item = localStorage.getItem(this.prefix + key);
        if (!item) return null;
  
        const parsed = JSON.parse(item);
        const age = Date.now() - parsed.timestamp;
  
        // Check if expired
        if (age > parsed.ttl) {
          this.remove(key);
          return null;
        }
  
        // Validate data integrity
        if (parsed.checksum && !this.validateChecksum(parsed.data, parsed.checksum)) {
          console.warn(`Cache corruption detected for ${key}`);
          this.remove(key);
          return null;
        }
  
        return parsed.data;
      } catch (error) {
        console.warn("Cache get failed:", error);
        this.remove(key);
        return null;
      }
    },
  
    // Remove cache entry
    remove(key) {
      try {
        localStorage.removeItem(this.prefix + key);
      } catch (error) {
        console.warn("Cache remove failed:", error);
      }
    },
  
    // Check if cache should be updated
    shouldUpdate(key, maxAge = null) {
      try {
        const item = localStorage.getItem(this.prefix + key);
        if (!item) return true;
  
        const parsed = JSON.parse(item);
        const age = Date.now() - parsed.timestamp;
        const threshold = maxAge || parsed.ttl;
  
        return age >= threshold;
      } catch (error) {
        return true;
      }
    },
  
    // Get TTL based on key pattern
    getTTLForKey(key) {
      if (key.includes('stock')) return this.TTL.stock;
      if (key.includes('today') || key.includes(this.getDateKey())) return this.TTL.today;
      if (key.includes('sales')) return this.TTL.sales;
      if (key.includes('meta')) return this.TTL.metadata;
      return this.TTL.sales; // default
    },
  
    // Generate version for cache invalidation
    generateVersion() {
      return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },
  
    // Generate checksum for data integrity
    generateChecksum(data) {
      try {
        const str = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
      } catch (error) {
        return null;
      }
    },
  
    // Validate checksum
    validateChecksum(data, expectedChecksum) {
      const actualChecksum = this.generateChecksum(data);
      return actualChecksum === expectedChecksum;
    },
  
    // Get date key for today
    getDateKey() {
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    },
  
    // Clear expired entries
    clearExpired() {
      const now = Date.now();
      let cleared = 0;
  
      try {
        Object.keys(localStorage)
          .filter(key => key.startsWith(this.prefix))
          .forEach(key => {
            try {
              const item = JSON.parse(localStorage.getItem(key));
              if (item && (now - item.timestamp) > item.ttl) {
                localStorage.removeItem(key);
                cleared++;
              }
            } catch (error) {
              localStorage.removeItem(key);
              cleared++;
            }
          });
  
        if (cleared > 0) {
          console.log(`🧹 Cleared ${cleared} expired cache entries`);
        }
      } catch (error) {
        console.warn("Clear expired cache failed:", error);
      }
    },
  
    // Handle storage errors (quota exceeded, etc.)
    handleStorageError() {
      console.warn("Storage error detected, clearing old cache");
      this.clearExpired();
      
      // If still having issues, clear all cache
      const usage = this.getStorageUsage();
      if (usage.percentage > 90) {
        console.warn("Storage usage critical, clearing all cache");
        this.clearAll();
      }
    },
  
    // Clear all cache entries
    clearAll() {
      try {
        Object.keys(localStorage)
          .filter(key => key.startsWith(this.prefix))
          .forEach(key => localStorage.removeItem(key));
        console.log("🗑️ All cache cleared");
      } catch (error) {
        console.warn("Clear all cache failed:", error);
      }
    },
  
    // Get storage usage statistics
    getStorageUsage() {
      try {
        const total = JSON.stringify(localStorage).length;
        const ourUsage = Object.keys(localStorage)
          .filter(key => key.startsWith(this.prefix))
          .reduce((sum, key) => sum + localStorage.getItem(key).length, 0);
  
        const maxSize = 5 * 1024 * 1024; // 5MB typical limit
        
        return {
          total,
          ourUsage,
          percentage: (total / maxSize) * 100,
          ourPercentage: (ourUsage / maxSize) * 100
        };
      } catch (error) {
        return { total: 0, ourUsage: 0, percentage: 0, ourPercentage: 0 };
      }
    },
  
    // Get cache statistics
    getStats() {
      const stats = {
        entries: 0,
        totalSize: 0,
        validEntries: 0,
        expiredEntries: 0,
        corruptedEntries: 0,
        byType: {}
      };
  
      try {
        Object.keys(localStorage)
          .filter(key => key.startsWith(this.prefix))
          .forEach(key => {
            try {
              const item = JSON.parse(localStorage.getItem(key));
              const cleanKey = key.replace(this.prefix, '');
              const age = Date.now() - item.timestamp;
              const isValid = age < item.ttl;
              const size = JSON.stringify(item).length;
  
              stats.entries++;
              stats.totalSize += size;
  
              if (isValid) {
                stats.validEntries++;
              } else {
                stats.expiredEntries++;
              }
  
              // Categorize by type
              const type = cleanKey.split('_')[0] || 'other';
              if (!stats.byType[type]) {
                stats.byType[type] = { count: 0, size: 0 };
              }
              stats.byType[type].count++;
              stats.byType[type].size += size;
  
            } catch (error) {
              stats.corruptedEntries++;
              localStorage.removeItem(key);
            }
          });
      } catch (error) {
        console.warn("Get cache stats failed:", error);
      }
  
      return stats;
    }
  };

// Utility functions
const utils = {
  showAlert: (message, title = "Informasi", type = "info") => {
    return Swal.fire({
      title,
      text: message,
      icon: type,
      confirmButtonText: "OK",
      confirmButtonColor: "#0d6efd",
    });
  },

  showConfirm: (message, title = "Konfirmasi") => {
    return Swal.fire({
      title,
      text: message,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Ya",
      cancelButtonText: "Batal",
      confirmButtonColor: "#0d6efd",
      cancelButtonColor: "#6c757d",
    }).then((result) => result.isConfirmed);
  },

  formatDate: (date) => {
    if (!date) return "";
    try {
      const d = date.toDate ? date.toDate() : date instanceof Date ? date : new Date(date);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (error) {
      console.error("Error formatting date:", error);
      return "";
    }
  },

  parseDate: (dateString) => {
    if (!dateString) return null;
    try {
      const parts = dateString.split("/");
      return new Date(parts[2], parts[1] - 1, parts[0]);
    } catch (error) {
      console.error("Error parsing date:", error);
      return null;
    }
  },

  formatRupiah: (angka) => {
    if (!angka && angka !== 0) return "0";
    const number = typeof angka === "string" ? parseInt(angka.replace(/\./g, "")) : angka;
    return new Intl.NumberFormat("id-ID").format(number);
  },

  showLoading: (show) => {
    const loader = document.getElementById("loadingIndicator");
    if (loader) loader.style.display = show ? "flex" : "none";
  },

  isSameDate: (date1, date2) => {
    if (!date1 || !date2) return false;
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    return d1.toDateString() === d2.toDateString();
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
  }
};

// Enhanced reads monitor for Firestore optimization
const readsMonitor = {
    reads: {},
    dailyLimit: 50000,
    
    increment(operation, count = 1) {
      const today = new Date().toDateString();
      if (!this.reads[today]) {
        this.reads[today] = {};
      }
      if (!this.reads[today][operation]) {
        this.reads[today][operation] = 0;
      }
      this.reads[today][operation] += count;
      
      try {
        localStorage.setItem('firestore_reads', JSON.stringify(this.reads));
      } catch (error) {
        console.warn('Failed to store reads data:', error);
      }
      
      this.checkLimits();
    },
    
    getTodayReads() {
      const today = new Date().toDateString();
      const todayReads = this.reads[today] || {};
      return Object.values(todayReads).reduce((sum, count) => sum + count, 0);
    },
    
    // PERBAIKAN: Tambahkan method yang hilang
    getUsagePercent() {
      const todayReads = this.getTodayReads();
      return (todayReads / this.dailyLimit) * 100;
    },
    
    checkLimits() {
      const percentage = this.getUsagePercent();
      
      if (percentage > 80) {
        console.warn(`🔥 Firestore reads at ${percentage.toFixed(1)}% of daily limit`);
      }
      
      if (percentage > 95) {
        console.error('🚨 Firestore reads approaching daily limit!');
      }
    },
    
    getStats() {
      const today = new Date().toDateString();
      const todayReads = this.reads[today] || {};
      const total = this.getTodayReads();
      
      return {
        today: todayReads,
        total,
        percentage: this.getUsagePercent(),
        remaining: this.dailyLimit - total
      };
    },
    
    init() {
      try {
        const stored = localStorage.getItem('firestore_reads');
        if (stored) {
          this.reads = JSON.parse(stored);
        }
      } catch (error) {
        console.warn('Failed to load reads data:', error);
        this.reads = {};
      }
    }
  };

// Main application handler
const penjualanHandler = {
  stockData: [],
  salesData: [],
  stockCache: new Map(),
  
  // Real-time listeners
  stockListener: null,
  salesListener: null,
  
  // User activity tracking
  isUserActive: true,
  lastActivity: Date.now(),
  inactivityTimer: null,
  INACTIVITY_TIMEOUT: 10 * 60 * 1000, // 10 menit

  // Initialize application
  async init() {
    this.setupEventListeners();
    this.initDatePicker();
    this.setDefaultDate();
    this.setupInactivityMonitor();

    // Load initial data
    await this.loadInitialData();
    
    // Setup real-time listeners
    this.setupSmartListeners();
    
    this.updateUIForSalesType("aksesoris");
    $("#sales").focus();

    console.log(`📊 Reads usage: ${readsMonitor.getUsagePercent()}%`);
  },

  // Setup inactivity monitoring
  setupInactivityMonitor() {
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    const resetInactivityTimer = () => {
      this.isUserActive = true;
      this.lastActivity = Date.now();
      
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = setTimeout(() => {
        this.handleUserInactivity();
      }, this.INACTIVITY_TIMEOUT);
    };

    activityEvents.forEach(event => {
      document.addEventListener(event, resetInactivityTimer, { passive: true });
    });

    // Initial timer
    resetInactivityTimer();
  },

  // Handle user inactivity
  handleUserInactivity() {
    this.isUserActive = false;
    console.log('🔇 User inactive - pausing real-time updates');
    
    // Remove listeners to save resources
    this.removeListeners();
    
    // Show notification
    const notification = document.createElement('div');
    notification.id = 'inactivityNotification';
    notification.className = 'alert alert-info position-fixed';
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; cursor: pointer;';
    notification.innerHTML = `
      <i class="fas fa-pause-circle me-2"></i>
      Mode hemat aktif - Klik untuk mengaktifkan kembali
    `;
    
    notification.onclick = () => {
      this.handleUserReactivation();
      notification.remove();
    };
    
    document.body.appendChild(notification);
    
    // Auto remove notification after 30 seconds
    setTimeout(() => {
      if (document.getElementById('inactivityNotification')) {
        notification.remove();
      }
    }, 30000);
  },

  // Handle user reactivation
  handleUserReactivation() {
    this.isUserActive = true;
    this.lastActivity = Date.now();
    console.log('🔊 User reactivated - resuming real-time updates');
    
    // Resume listeners
    this.setupSmartListeners();
    
    // Refresh data if stale
    const staleTime = 5 * 60 * 1000; // 5 menit
    if (Date.now() - this.lastActivity > staleTime) {
      this.refreshStaleData();
    }
  },

  // Load initial data with minimal reads
  async loadInitialData() {
    try {
      utils.showLoading(true);
      
      // Try cache first
      const cachedStock = smartCache.get('stockData');
      const cachedSales = smartCache.get(`salesData_${smartCache.getDateKey()}`);
      
      if (cachedStock && cachedStock.length > 0) {
        console.log('📦 Using cached stock data');
        this.stockData = cachedStock;
        this.buildStockCache();
        this.populateStockTables();
      } else {
        await this.loadStockData();
      }
      
      if (cachedSales && cachedSales.length > 0) {
        console.log('📦 Using cached sales data');
        this.salesData = cachedSales;
      } else {
        await this.loadTodaySales();
      }
      
    } catch (error) {
      console.error('Error loading initial data:', error);
      utils.showAlert('Gagal memuat data awal: ' + error.message, 'Error', 'error');
    } finally {
      utils.showLoading(false);
    }
  },

  // Load stock data (minimal reads)
  async loadStockData() {
    try {
      console.log('🔄 Loading stock data from Firestore');
      
      const stockQuery = query(
        collection(firestore, "stokAksesoris"),
        where("stokAkhir", ">", 0)
      );
      
      const snapshot = await getDocs(stockQuery);
      readsMonitor.increment('Load Stock Data', snapshot.size);
      
      this.stockData = [];
      snapshot.forEach(doc => {
        this.stockData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      // Cache the data
      smartCache.set('stockData', this.stockData);
      this.buildStockCache();
      this.populateStockTables();
      
      console.log(`✅ Loaded ${this.stockData.length} stock items`);
      
    } catch (error) {
      console.error('Error loading stock data:', error);
      throw error;
    }
  },

  // Load today's sales data
  async loadTodaySales() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const salesQuery = query(
        collection(firestore, "penjualanAksesoris"),
        where("timestamp", ">=", Timestamp.fromDate(today)),
        where("timestamp", "<", Timestamp.fromDate(tomorrow)),
        orderBy("timestamp", "desc")
      );

      const snapshot = await getDocs(salesQuery);
      readsMonitor.increment('Load Today Sales', snapshot.size);

      this.salesData = [];
      snapshot.forEach(doc => {
        this.salesData.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Cache the data
      smartCache.set(`salesData_${smartCache.getDateKey()}`, this.salesData);
      
      console.log(`✅ Loaded ${this.salesData.length} sales records`);
      
    } catch (error) {
      console.error('Error loading sales data:', error);
      throw error;
    }
  },

  // Setup smart real-time listeners
  setupSmartListeners() {
    if (!this.isUserActive) return;
    
    // Remove existing listeners
    this.removeListeners();
    
    // Only listen to today's data to minimize reads
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Stock listener - only for recent changes
    const recentTime = new Date(Date.now() - 30 * 60 * 1000); // Last 30 minutes
    const stockQuery = query(
      collection(firestore, "stokAksesoris"),
      where("lastUpdate", ">=", Timestamp.fromDate(recentTime))
    );
    
    this.stockListener = onSnapshot(stockQuery, 
      (snapshot) => {
        if (!snapshot.metadata.hasPendingWrites && snapshot.docChanges().length > 0) {
          console.log('📦 Stock updates received');
          this.handleStockUpdates(snapshot.docChanges());
        }
      },
      (error) => {
        console.error('Stock listener error:', error);
        this.stockListener = null;
      }
    );
    
    // Sales listener - only for today
    const salesQuery = query(
      collection(firestore, "penjualanAksesoris"),
      where("timestamp", ">=", Timestamp.fromDate(today)),
      orderBy("timestamp", "desc")
    );
    
    this.salesListener = onSnapshot(salesQuery,
      (snapshot) => {
        if (!snapshot.metadata.hasPendingWrites && snapshot.docChanges().length > 0) {
            console.log('💰 Sales updates received');
            this.handleSalesUpdates(snapshot.docChanges());
          }
        },
        (error) => {
          console.error('Sales listener error:', error);
          this.salesListener = null;
        }
      );
      
      console.log('🔊 Real-time listeners activated');
    },
  
    // Remove all listeners
    removeListeners() {
      if (this.stockListener) {
        this.stockListener();
        this.stockListener = null;
      }
      if (this.salesListener) {
        this.salesListener();
        this.salesListener = null;
      }
    },
  
    // Handle stock updates from real-time listener
    handleStockUpdates(changes) {
      let hasChanges = false;
      
      changes.forEach(change => {
        const data = { id: change.doc.id, ...change.doc.data() };
        
        if (change.type === 'added' || change.type === 'modified') {
          const index = this.stockData.findIndex(item => item.id === data.id);
          if (index !== -1) {
            this.stockData[index] = data;
          } else {
            this.stockData.push(data);
          }
          
          // Update cache
          this.stockCache.set(data.kode, data.stokAkhir || 0);
          hasChanges = true;
        } else if (change.type === 'removed') {
          this.stockData = this.stockData.filter(item => item.id !== data.id);
          this.stockCache.delete(data.kode);
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        // Update cache
        smartCache.set('stockData', this.stockData);
        this.populateStockTables();
        console.log('✅ Stock data updated from real-time listener');
      }
    },
  
    // Handle sales updates from real-time listener
    handleSalesUpdates(changes) {
      let hasChanges = false;
      
      changes.forEach(change => {
        const data = { id: change.doc.id, ...change.doc.data() };
        
        if (change.type === 'added') {
          // Add new sale to beginning of array
          this.salesData.unshift(data);
          hasChanges = true;
        } else if (change.type === 'modified') {
          const index = this.salesData.findIndex(item => item.id === data.id);
          if (index !== -1) {
            this.salesData[index] = data;
            hasChanges = true;
          }
        } else if (change.type === 'removed') {
          this.salesData = this.salesData.filter(item => item.id !== data.id);
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        // Update cache
        smartCache.set(`salesData_${smartCache.getDateKey()}`, this.salesData);
        console.log('✅ Sales data updated from real-time listener');
      }
    },
  
    // Refresh stale data when user becomes active
    async refreshStaleData() {
      try {
        console.log('🔄 Refreshing stale data');
        
        // Only refresh if we haven't refreshed recently
        const lastRefresh = localStorage.getItem('lastDataRefresh');
        const now = Date.now();
        
        if (!lastRefresh || (now - parseInt(lastRefresh)) > 5 * 60 * 1000) {
          await Promise.all([
            this.loadStockData(),
            this.loadTodaySales()
          ]);
          
          localStorage.setItem('lastDataRefresh', now.toString());
          console.log('✅ Data refreshed successfully');
        }
      } catch (error) {
        console.error('Error refreshing stale data:', error);
      }
    },
  
    // Build stock cache for quick lookups
    buildStockCache() {
      this.stockCache.clear();
      this.stockData.forEach(item => {
        this.stockCache.set(item.kode, item.stokAkhir || 0);
      });
    },
  
    // Get stock for item (from cache first)
    getStockForItem(kode) {
      return this.stockCache.get(kode) || 0;
    },
  
    // Setup all event listeners
    setupEventListeners() {
      // Sales type change
      $("#jenisPenjualan").on("change", (e) => {
        this.updateUIForSalesType(e.target.value);
      });
  
      // Payment method change
      $("#metodeBayar").on("change", (e) => {
        this.handlePaymentMethodChange(e.target.value);
      });
  
      // Button events
      $("#btnTambah").on("click", () => this.showStockModal());
      $("#btnTambahBaris").on("click", () => this.addNewRow("manual"));
      $("#btnSimpanPenjualan").on("click", () => this.saveTransaction());
      $("#btnBatal").on("click", () => this.resetForm());
      $("#btnPrintReceipt").on("click", (e) => {
        e.preventDefault();
        this.printDocument("receipt");
      });
      $("#btnPrintInvoice").on("click", (e) => {
        e.preventDefault();
        this.printDocument("invoice");
      });
  
      // Input events with debouncing
      $("#jumlahBayar").on("input", utils.debounce(() => this.calculateKembalian(), 300));
      $("#nominalDP").on("input", utils.debounce(() => this.calculateSisaPembayaran(), 300));
  
      $("#jumlahBayar, #nominalDP").on("blur", function () {
        const value = $(this).val().replace(/\./g, "");
        $(this).val(utils.formatRupiah(parseInt(value || 0)));
      });
  
      // Search events
      $("#searchAksesoris, #searchKotak, #searchLock").on("input", utils.debounce((e) => {
        this.searchTable(e.target);
      }, 300));
  
      // Sales validation
      $("#sales").on("blur", () => this.validateSales());
      $("#sales").on("focus", function () {
        $(this).removeClass("is-invalid is-valid");
        $(this).next(".invalid-feedback").remove();
      });
    },
  
    // Initialize date picker
    initDatePicker() {
      $("#tanggal").datepicker({
        format: "dd/mm/yyyy",
        autoclose: true,
        language: "id",
        todayHighlight: true,
      });
  
      $("#calendarIcon").on("click", () => $("#tanggal").datepicker("show"));
    },
  
    // Set default date
    setDefaultDate() {
      const today = new Date();
      $("#tanggal").val(utils.formatDate(today));
    },
  
    // Populate stock tables
    populateStockTables() {
      const categories = {
        aksesoris: "#tableAksesoris",
        kotak: "#tableKotak",
      };
  
      Object.entries(categories).forEach(([category, selector]) => {
        const tbody = $(`${selector} tbody`);
        tbody.empty();
  
        const items = this.stockData.filter((item) => item.kategori === category);
  
        if (items.length === 0) {
          tbody.append(`<tr><td colspan="2" class="text-center">Tidak ada data ${category}</td></tr>`);
        } else {
          items.forEach((item) => {
            const row = `
            <tr data-kode="${item.kode}" data-nama="${item.nama}" data-harga="${item.hargaJual || 0}">
              <td>${item.kode || "-"}</td>
              <td>${item.nama || "-"}</td>
            </tr>
          `;
            tbody.append(row);
          });
        }
      });
  
      // Populate lock table (using aksesoris data)
      const lockTable = $("#tableLock tbody");
      lockTable.empty();
  
      const lockItems = this.stockData.filter((item) => item.kategori === "aksesoris");
  
      if (lockItems.length === 0) {
        lockTable.append('<tr><td colspan="2" class="text-center">Tidak ada data lock</td></tr>');
      } else {
        lockItems.forEach((item) => {
          const row = `
          <tr data-kode="${item.kode}" data-nama="${item.nama}" data-harga="${item.hargaJual || 0}">
            <td>${item.kode || "-"}</td>
            <td>${item.nama || "-"}</td>
          </tr>
        `;
          lockTable.append(row);
        });
      }
  
      // Attach click handlers
      this.attachTableRowClickHandlers();
    },
  
    // Attach table row click handlers
    attachTableRowClickHandlers() {
      // Remove existing handlers to prevent duplicates
      $("#tableAksesoris tbody tr, #tableKotak tbody tr, #tableLock tbody tr").off("click");
  
      // Aksesoris table
      $("#tableAksesoris tbody tr").on("click", function () {
        if ($(this).data("kode")) {
          const data = {
            kode: $(this).data("kode"),
            nama: $(this).data("nama"),
            harga: $(this).data("harga"),
          };
          penjualanHandler.addAksesorisToTable(data);
          $("#modalPilihAksesoris").modal("hide");
        }
      });
  
      // Kotak table
      $("#tableKotak tbody tr").on("click", function () {
        if ($(this).data("kode")) {
          const data = {
            kode: $(this).data("kode"),
            nama: $(this).data("nama"),
            harga: $(this).data("harga"),
          };
          penjualanHandler.addKotakToTable(data);
          $("#modalPilihKotak").modal("hide");
        }
      });
  
      // Lock table
      $("#tableLock tbody tr").on("click", function () {
        if ($(this).data("kode") && activeLockRow) {
          const kode = $(this).data("kode");
  
          if (activeLockRow.hasClass("input-row")) {
            $("#manualInputKodeLock").val(kode);
          } else {
            activeLockRow.find(".kode-lock-input").val(kode);
          }
  
          activeLockRow = null;
          $("#modalPilihLock").modal("hide");
        }
      });
    },
  
    // Show stock modal based on sales type
    showStockModal() {
      const salesType = $("#jenisPenjualan").val();
  
      if (salesType === "aksesoris") {
        $("#modalPilihAksesoris").modal("show");
      } else if (salesType === "kotak") {
        $("#modalPilihKotak").modal("show");
      }
    },
  
    // Add aksesoris to table
    addAksesorisToTable(data) {
      const { kode, nama, harga } = data;
      const newRow = `
      <tr>
        <td>${kode}</td>
        <td>${nama}</td>
        <td>
          <input type="number" class="form-control form-control-sm jumlah-input" value="1" min="1">
        </td>
        <td>
          <input type="text" class="form-control form-control-sm kadar-input" value="" placeholder="Masukkan kadar" required>
        </td>
        <td>
          <input type="text" class="form-control form-control-sm berat-input" value="" placeholder="0.00" required>
        </td>
        <td>
          <input type="text" class="form-control form-control-sm harga-per-gram-input" value="0" readonly>
        </td>
        <td>
          <input type="text" class="form-control form-control-sm total-harga-input" value="" placeholder="Masukkan harga" required>
        </td>
        <td>
          <button class="btn btn-sm btn-danger btn-delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  
      $("#tableAksesorisDetail tbody").append(newRow);
      const $newRow = $("#tableAksesorisDetail tbody tr:last-child");
      $newRow.find(".kadar-input").focus();
      this.attachRowEventHandlers($newRow);
      this.updateGrandTotal("aksesoris");
    },
  
    // Add kotak to table
    addKotakToTable(data) {
      const { kode, nama, harga } = data;
      const jumlah = 1;
      const hargaSatuan = harga;
      const totalHarga = jumlah * hargaSatuan;
  
      const newRow = `
      <tr>
        <td>${kode}</td>
        <td>${nama}</td>
        <td>
          <input type="number" class="form-control form-control-sm jumlah-input" value="${jumlah}" min="1">
        </td>
        <td>
          <input type="text" class="form-control form-control-sm harga-input" value="${utils.formatRupiah(
            hargaSatuan
          )}" placeholder="Masukkan harga" required>
        </td>
        <td class="total-harga">${utils.formatRupiah(totalHarga)}</td>
        <td>
          <button class="btn btn-sm btn-danger btn-delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  
      $("#tableKotakDetail tbody").append(newRow);
      const $newRow = $("#tableKotakDetail tbody tr:last-child");
      $newRow.find(".harga-input").focus().select();
      this.attachRowEventHandlers($newRow);
      this.updateGrandTotal("kotak");
    },
  
    // Attach row event handlers
    attachRowEventHandlers($row) {
      // Remove existing handlers
      $row.find("input, button").off();
  
      if ($row.closest("table").attr("id") === "tableAksesorisDetail") {
        this.attachAksesorisRowHandlers($row);
      } else if ($row.closest("table").attr("id") === "tableKotakDetail") {
        this.attachKotakRowHandlers($row);
      }
  
      // Delete button handler
      $row.find(".btn-delete").on("click", () => {
        const tableId = $row.closest("table").attr("id");
        const salesType =
          tableId === "tableAksesorisDetail" ? "aksesoris" : tableId === "tableKotakDetail" ? "kotak" : "manual";
        $row.remove();
        this.updateGrandTotal(salesType);
      });
    },
  
    // Attach aksesoris row handlers
    attachAksesorisRowHandlers($row) {
      const $beratInput = $row.find(".berat-input");
      const $totalHargaInput = $row.find(".total-harga-input");
      const $hargaPerGramInput = $row.find(".harga-per-gram-input");
      const $kadarInput = $row.find(".kadar-input");
      const $jumlahInput = $row.find(".jumlah-input");
  
      // Calculate harga per gram
      const calculateHargaPerGram = () => {
        const berat = parseFloat($beratInput.val()) || 0;
        let totalHarga = $totalHargaInput.val().replace(/\./g, "");
        totalHarga = parseFloat(totalHarga) || 0;
  
        let hargaPerGram = 0;
        if (berat > 0) {
          hargaPerGram = totalHarga / berat;
        }
  
        $hargaPerGramInput.val(utils.formatRupiah(Math.round(hargaPerGram)));
        this.updateGrandTotal("aksesoris");
      };
  
      $totalHargaInput.add($beratInput).on("input", calculateHargaPerGram);
      $jumlahInput.on("input", () => this.updateGrandTotal("aksesoris"));
  
      // Format total harga
      $totalHargaInput.on("blur", function () {
        const value = $(this).val().replace(/\./g, "");
        $(this).val(utils.formatRupiah(parseInt(value || 0)));
      });
  
      // Enter key navigation untuk aksesoris
      $kadarInput.on("keypress", (e) => {
        if (e.which === 13) {
          e.preventDefault();
          $beratInput.focus();
        }
      });
  
      $beratInput.on("keypress", (e) => {
        if (e.which === 13) {
          e.preventDefault();
          $totalHargaInput.focus().select();
        }
      });
  
      $totalHargaInput.on("keypress", (e) => {
        if (e.which === 13) {
          e.preventDefault();
          const value = $totalHargaInput.val().replace(/\./g, "");
          $totalHargaInput.val(utils.formatRupiah(parseInt(value || 0)));
          calculateHargaPerGram();
          $("#jumlahBayar").focus();
        }
      });
    },
  
    // Attach kotak row handlers
    attachKotakRowHandlers($row) {
      const $jumlahInput = $row.find(".jumlah-input");
      const $hargaInput = $row.find(".harga-input");
      const $totalCell = $row.find(".total-harga");
  
      const calculateTotal = () => {
        const jumlah = parseInt($jumlahInput.val());
        const harga = parseInt($hargaInput.val().replace(/\./g, "")) || 0;
        const total = jumlah * harga;
        $totalCell.text(utils.formatRupiah(total));
        this.updateGrandTotal("kotak");
      };
  
      $jumlahInput.add($hargaInput).on("input", calculateTotal);
  
      // Format harga saat blur
      $hargaInput.on("blur", function () {
        const value = $(this).val().replace(/\./g, "");
        $(this).val(utils.formatRupiah(parseInt(value)));
      });
  
      // Enter key navigation untuk kotak
      $hargaInput.on("keypress", (e) => {
        if (e.which === 13) {
          e.preventDefault();
          const value = $hargaInput.val().replace(/\./g, "");
          $hargaInput.val(utils.formatRupiah(parseInt(value)));
          calculateTotal();
          $("#jumlahBayar").focus();
        }
      });
  
      $jumlahInput.on("keypress", (e) => {
        if (e.which === 13) {
          e.preventDefault();
          $hargaInput.focus().select();
        }
      });
    },
  
    // Update UI for sales type
    updateUIForSalesType(type) {
      // Hide all containers
      $("#aksesorisTableContainer, #kotakTableContainer, #manualTableContainer").hide();
      $("#btnTambah, #btnTambahBaris").hide();
  
      let detailTitle = "Detail Barang";
  
      switch (type) {
        case "aksesoris":
          $("#aksesorisTableContainer").show();
          $("#btnTambah").show();
          detailTitle = "Detail Aksesoris";
          break;
        case "kotak":
          $("#kotakTableContainer").show();
          $("#btnTambah").show();
          detailTitle = "Detail Kotak";
          break;
        case "manual":
          $("#manualTableContainer").show();
          $("#btnTambahBaris").show();
          detailTitle = "Detail Penjualan Manual";
          this.resetTableAndAddInputRow("manual");
          break;
      }
  
      $("#detailTitle").text(detailTitle);
      this.updatePaymentMethodOptions(type);
    },
  
    // Update payment method options
    updatePaymentMethodOptions(salesType) {
      const currentMethod = $("#metodeBayar").val();
      $("#metodeBayar").empty();
  
      $("#metodeBayar").append('<option value="tunai">Tunai</option>');
  
      if (salesType === "manual") {
        $("#metodeBayar").append('<option value="dp">DP</option>');
      }
  
      if (salesType === "kotak" || salesType === "aksesoris") {
        $("#metodeBayar").append('<option value="free">Free</option>');
      }
  
      if ($("#metodeBayar option[value='" + currentMethod + "']").length > 0) {
        $("#metodeBayar").val(currentMethod);
      } else {
        $("#metodeBayar").val("tunai");
      }
  
      $("#metodeBayar").trigger("change");
    },
  
    // Handle payment method change
    handlePaymentMethodChange(method) {
      const salesType = $("#jenisPenjualan").val();
  
      if (method === "free") {
        $(".payment-field, .dp-field").hide();
        $("#totalOngkos").val("0");
      } else if (method === "dp") {
        if (salesType === "manual") {
          $(".payment-field, .dp-field").show();
        } else {
          $("#metodeBayar").val("tunai");
          $(".payment-field").show();
          $(".dp-field").hide();
        }
        this.updateTotal();
      } else {
        $(".payment-field").show();
        $(".dp-field").hide();
        this.updateTotal();
      }
    },
  
    // Reset table and add input row for manual
    resetTableAndAddInputRow(type) {
      $("#tableManualDetail tbody").empty();
  
      const inputRow = `
      <tr class="input-row">
        <td><input type="text" class="form-control form-control-sm" id="manualInputKode" placeholder="Kode"></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputNamaBarang" placeholder="Nama barang"></td>
        <td>
          <div class="input-group input-group-sm">
            <input type="text" class="form-control" id="manualInputKodeLock" placeholder="Pilih kode" readonly>
            <button class="btn btn-outline-secondary" id="manualBtnPilihKodeLock" type="button">
              <i class="fas fa-search"></i>
            </button>
          </div>
        </td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputKadar" placeholder="Kadar" required></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputBerat" placeholder="0.00" required></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputHargaPerGram" placeholder="0" readonly></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputTotalHarga" placeholder="Masukkan harga" required></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputKeterangan" placeholder="Keterangan"></td>
        <td></td>
      </tr>
    `;
  
      $("#tableManualDetail tbody").append(inputRow);
      this.attachManualInputHandlers();
      $("#manualInputKode").focus();
    },
  
    // Attach manual input handlers
    attachManualInputHandlers() {
      // Remove existing handlers
      $("#manualBtnPilihKodeLock").off("click");
      $("#manualInputBerat, #manualInputTotalHarga").off("input");
  
      // Pilih kode lock button
      $("#manualBtnPilihKodeLock").on("click", function () {
        activeLockRow = $(this).closest("tr");
        $("#modalPilihLock").modal("show");
      });
  
      // Calculate harga per gram
      $("#manualInputBerat, #manualInputTotalHarga").on("input", () => {
        this.calculateHargaPerGram("manual");
      });
  
      // Enter key navigation
      const inputs = [
        "#manualInputKode",
        "#manualInputNamaBarang",
        "#manualInputKadar",
        "#manualInputBerat",
        "#manualInputTotalHarga",
        "#manualInputKeterangan",
      ];
  
      inputs.forEach((selector, index) => {
        $(selector)
          .off("keypress")
          .on("keypress", (e) => {
            if (e.which === 13) {
              e.preventDefault();
              if (index < inputs.length - 1) {
                $(inputs[index + 1]).focus();
              } else {
                this.addNewRow("manual");
              }
            }
          });
      });
    },
  
    // Calculate harga per gram for manual
    calculateHargaPerGram(type) {
      const berat = parseFloat($(`#${type}InputBerat`).val()) || 0;
      const totalHarga = parseFloat($(`#${type}InputTotalHarga`).val().replace(/\./g, "")) || 0;
  
      let hargaPerGram = 0;
      if (berat > 0) {
        hargaPerGram = totalHarga / berat;
      }
  
      $(`#${type}InputHargaPerGram`).val(utils.formatRupiah(Math.round(hargaPerGram)));
    },
  
    // Add new row for manual
    addNewRow(type) {
      const kode = $(`#${type}InputKode`).val() || "-";
      const namaBarang = $(`#${type}InputNamaBarang`).val();
      const kodeLock = $(`#${type}InputKodeLock`).val() || "-";
      const kadar = $(`#${type}InputKadar`).val() || "-";
      const berat = $(`#${type}InputBerat`).val() || 0;
      const totalHargaValue = $(`#${type}InputTotalHarga`).val() || "0";
      const totalHarga = parseFloat(totalHargaValue.replace(/\./g, "")) || 0;
      const hargaPerGram = $(`#${type}InputHargaPerGram`).val() || "0";
      const keterangan = $(`#${type}InputKeterangan`).val() || "";
  
      // Validation
      if (!namaBarang) {
        utils.showAlert("Nama barang harus diisi!");
        $(`#${type}InputNamaBarang`).focus();
        return;
      }
      if (!kadar) {
        utils.showAlert("Kadar harus diisi!");
        $(`#${type}InputKadar`).focus();
        return;
      }
      if (berat <= 0) {
        utils.showAlert("Berat harus lebih dari 0!");
        $(`#${type}InputBerat`).focus();
        return;
      }
      if (totalHarga <= 0) {
        utils.showAlert("Total harga harus lebih dari 0!");
        $(`#${type}InputTotalHarga`).focus();
        return;
      }
  
      const newRow = `
        <tr>
          <td>${kode}</td>
          <td>${namaBarang}</td>
          <td>${kodeLock}</td>
          <td>${kadar}</td>
          <td>${berat}</td>
          <td>${hargaPerGram}</td>
          <td class="total-harga">${utils.formatRupiah(totalHarga)}</td>
          <td class="keterangan">${keterangan}</td>
          <td>
            <button class="btn btn-sm btn-danger btn-delete">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
  
      $(`#table${type.charAt(0).toUpperCase() + type.slice(1)}Detail tbody`).append(newRow);
  
      // Clear input row
      $(
        `#${type}InputKode, #${type}InputNamaBarang, #${type}InputKodeLock, #${type}InputKadar, #${type}InputBerat, #${type}InputHargaPerGram, #${type}InputTotalHarga, #${type}InputKeterangan`
      ).val("");
  
      $(`#${type}InputKode`).focus();
      this.updateGrandTotal(type);
    },
  
    // Update grand total
    updateGrandTotal(salesType) {
      let tableSelector, grandTotalId;
  
      switch (salesType) {
        case "aksesoris":
          tableSelector = "#tableAksesorisDetail";
          grandTotalId = "#grand-total-aksesoris";
          break;
        case "kotak":
          tableSelector = "#tableKotakDetail";
          grandTotalId = "#grand-total-kotak";
          break;
        case "manual":
          tableSelector = "#tableManualDetail";
          grandTotalId = "#grand-total-manual";
          break;
      }
  
      let total = 0;
  
      if (salesType === "aksesoris") {
        $(tableSelector + " tbody tr:not(.input-row) .total-harga-input").each(function () {
          const value = $(this).val().replace(/\./g, "");
          total += parseFloat(value) || 0;
        });
      } else if (salesType === "kotak") {
        $(tableSelector + " tbody tr:not(.input-row) .total-harga").each(function () {
          const value = $(this).text().replace(/\./g, "");
          total += parseFloat(value) || 0;
        });
      } else {
        $(tableSelector + " tbody tr:not(.input-row) .total-harga").each(function () {
          const value = $(this).text().replace(/\./g, "");
          total += parseFloat(value) || 0;
        });
      }
  
      $(grandTotalId).text(utils.formatRupiah(total));
      $("#totalOngkos").val(utils.formatRupiah(total));
  
      if ($("#metodeBayar").val() === "dp") {
        this.calculateSisaPembayaran();
      }
    },
  
    // Update total
    updateTotal() {
      const salesType = $("#jenisPenjualan").val();
      const paymentMethod = $("#metodeBayar").val();
  
      if (paymentMethod === "free") {
        $("#totalOngkos").val("0");
        return;
      }
  
      let total = 0;
      const grandTotalSelector =
        salesType === "aksesoris"
          ? "#grand-total-aksesoris"
          : salesType === "kotak"
          ? "#grand-total-kotak"
          : "#grand-total-manual";
  
      total = parseFloat($(grandTotalSelector).text().replace(/\./g, "")) || 0;
      $("#totalOngkos").val(utils.formatRupiah(total));
  
      if (paymentMethod === "dp") {
        this.calculateSisaPembayaran();
      }
    },
  
    // Calculate sisa pembayaran
    calculateSisaPembayaran() {
      const total = parseFloat($("#totalOngkos").val().replace(/\./g, "")) || 0;
      const nominalDP = parseFloat($("#nominalDP").val().replace(/\./g, "")) || 0;
      const sisa = total - nominalDP;
      $("#sisaPembayaran").val(utils.formatRupiah(sisa > 0 ? sisa : 0));
  
      if ($("#jumlahBayar").val()) {
        this.calculateKembalian();
      }
    },
  
    // Calculate kembalian
    calculateKembalian() {
      const paymentMethod = $("#metodeBayar").val();
      const jumlahBayar = parseFloat($("#jumlahBayar").val().replace(/\./g, "")) || 0;
  
      if (paymentMethod === "dp") {
        const sisaPembayaran = parseFloat($("#sisaPembayaran").val().replace(/\./g, "")) || 0;
        const kembalian = jumlahBayar - sisaPembayaran;
        $("#kembalian").val(utils.formatRupiah(kembalian >= 0 ? kembalian : 0));
      } else {
        const total = parseFloat($("#totalOngkos").val().replace(/\./g, "")) || 0;
        const kembalian = jumlahBayar - total;
        $("#kembalian").val(utils.formatRupiah(kembalian >= 0 ? kembalian : 0));
      }
    },
  
    // Search table
    searchTable(input) {
      const searchText = $(input).val().toLowerCase();
      const tableId = $(input).attr("id").replace("search", "table");
  
      $(`#${tableId} tbody tr`).each(function () {
        const kode = $(this).find("td:nth-child(1)").text().toLowerCase();
        const nama = $(this).find("td:nth-child(2)").text().toLowerCase();
  
        if (kode.includes(searchText) || nama.includes(searchText)) {
          $(this).show();
        } else {
          $(this).hide();
        }
      });
    },
  
    // Validate sales
    validateSales() {
      const salesName = $("#sales").val().trim();
      if (!salesName) {
        $("#sales").addClass("is-invalid");
        if (!$("#sales").next(".invalid-feedback").length) {
          $("#sales").after('<div class="invalid-feedback">Nama sales harus diisi!</div>');
        }
      } else {
        $("#sales").removeClass("is-invalid").addClass("is-valid");
        $("#sales").next(".invalid-feedback").remove();
      }
    },
  
    // Save transaction
    async saveTransaction() {
      try {
        // Validasi sales name
        const salesName = $("#sales").val().trim();
        if (!salesName) {
          utils.showAlert("Nama sales harus diisi!");
          $("#sales").focus();
          return;
        }
  
        const salesType = $("#jenisPenjualan").val();
        const tableSelector =
          salesType === "aksesoris"
            ? "#tableAksesorisDetail"
            : salesType === "kotak"
            ? "#tableKotakDetail"
            : "#tableManualDetail";
  
        // Check if table has rows
        if ($(tableSelector + " tbody tr:not(.input-row)").length === 0) {
          utils.showAlert("Tidak ada barang yang ditambahkan!");
          return;
        }
  
        // Validasi pembayaran
        const paymentMethod = $("#metodeBayar").val();
        if (paymentMethod === "dp") {
          const nominalDP = parseFloat($("#nominalDP").val().replace(/\./g, "")) || 0;
          const total = parseFloat($("#totalOngkos").val().replace(/\./g, "")) || 0;
  
          if (nominalDP <= 0 || nominalDP >= total) {
            utils.showAlert(
              nominalDP <= 0 ? "Nominal DP harus diisi!" : "Nominal DP tidak boleh sama dengan atau melebihi total harga!"
            );
            $("#nominalDP").focus();
            return;
          }
        } else if (paymentMethod !== "free") {
          const jumlahBayar = parseFloat($("#jumlahBayar").val().replace(/\./g, "")) || 0;
          const total = parseFloat($("#totalOngkos").val().replace(/\./g, "")) || 0;
  
          if (jumlahBayar < total) {
            utils.showAlert("Jumlah bayar kurang dari total!");
            $("#jumlahBayar").focus();
            return;
          }
        }
  
        utils.showLoading(true);
  
        // Collect items data
        const items = this.collectItemsData(salesType, tableSelector);
  
        // Prepare transaction data
        const transactionData = {
          jenisPenjualan: salesType,
          tanggal: $("#tanggal").val(),
          sales: salesName,
          metodeBayar: paymentMethod,
          totalHarga: parseFloat($("#totalOngkos").val().replace(/\./g, "")) || 0,
          timestamp: serverTimestamp(),
          items: items,
        };
  
        // Mark as ganti lock if applicable
        if (salesType === "manual" && items.some((item) => item.kodeLock)) {
          transactionData.isGantiLock = true;
        }
  
        // Add payment details
        if (paymentMethod === "dp") {
          transactionData.nominalDP = parseFloat($("#nominalDP").val().replace(/\./g, "")) || 0;
          transactionData.sisaPembayaran = parseFloat($("#sisaPembayaran").val().replace(/\./g, "")) || 0;
          transactionData.statusPembayaran = "DP";
        } else if (paymentMethod === "free") {
          transactionData.statusPembayaran = "Free";
        } else {
          transactionData.jumlahBayar = parseFloat($("#jumlahBayar").val().replace(/\./g, "")) || 0;
          transactionData.kembalian = parseFloat($("#kembalian").val().replace(/\./g, "")) || 0;
          transactionData.statusPembayaran = "Lunas";
        }
  
        // Save transaction
        const docRef = await addDoc(collection(firestore, "penjualanAksesoris"), transactionData);
        readsMonitor.increment('Save Transaction', 1);
  
        // Update stock
        await this.updateStock(salesType, items);
  
        // Duplikasi ke mutasiKode jika transaksi manual
        if (transactionData.jenisPenjualan === "manual") {
          await this.duplicateToMutasiKode(transactionData, docRef.id);
        }
  
        // Update local cache
        const newTransaction = { id: docRef.id, ...transactionData };
        this.salesData.unshift(newTransaction);
        smartCache.set(`salesData_${smartCache.getDateKey()}`, this.salesData);
  
        utils.showAlert("Transaksi berhasil disimpan!", "Sukses", "success");
  
        // Store transaction data for printing
        currentTransactionData = {
          id: docRef.id,
          salesType: salesType,
          tanggal: $("#tanggal").val(),
          sales: salesName,
          totalHarga: $("#totalOngkos").val(),
          items: items,
          metodeBayar: paymentMethod,
        };
  
        // Add DP information if applicable
        if (paymentMethod === "dp") {
          currentTransactionData.nominalDP = $("#nominalDP").val();
          currentTransactionData.sisaPembayaran = $("#sisaPembayaran").val();
        }
  
        // Show print modal
        $("#printModal").modal("show");
  
        // Reset form after modal is closed
        $("#printModal").on("hidden.bs.modal", () => {
          this.resetForm();
          $("#sales").focus();
          $("#printModal").off("hidden.bs.modal");
        });
  
      } catch (error) {
        console.error("Error saving transaction:", error);
        utils.showAlert("Terjadi kesalahan saat menyimpan transaksi: " + error.message, "Error", "error");
      } finally {
        utils.showLoading(false);
      }
    },
  
    // Collect items data based on sales type
    collectItemsData(salesType, tableSelector) {
      const items = [];
  
      if (salesType === "aksesoris") {
        $(tableSelector + " tbody tr:not(.input-row)").each(function () {
          const kode = $(this).find("td:nth-child(1)").text();
          const nama = $(this).find("td:nth-child(2)").text();
          const jumlah = parseInt($(this).find(".jumlah-input").val()) || 1;
          const kadar = $(this).find(".kadar-input").val() || "-";
          const berat = parseFloat($(this).find(".berat-input").val()) || 0;
          const hargaPerGram = parseFloat($(this).find(".harga-per-gram-input").val().replace(/\./g, "")) || 0;
          const totalHarga = parseFloat($(this).find(".total-harga-input").val().replace(/\./g, "")) || 0;
  
          items.push({
            kodeText: kode,
            nama: nama,
            jumlah: jumlah,
            kadar: kadar,
            berat: berat,
            hargaPerGram: hargaPerGram,
            totalHarga: totalHarga,
          });
        });
      } else if (salesType === "kotak") {
        $(tableSelector + " tbody tr:not(.input-row)").each(function () {
          const kode = $(this).find("td:nth-child(1)").text();
          const nama = $(this).find("td:nth-child(2)").text();
          const jumlah = parseInt($(this).find(".jumlah-input").val()) || 1;
          const hargaSatuan = parseFloat($(this).find(".harga-input").val().replace(/\./g, "")) || 0;
          const totalHarga = parseFloat($(this).find(".total-harga").text().replace(/\./g, "")) || 0;
  
          items.push({
            kodeText: kode,
            nama: nama,
            jumlah: jumlah,
            totalHarga: totalHarga,
            hargaSatuan: hargaSatuan,
          });
        });
      } else {
        // Manual
        $(tableSelector + " tbody tr:not(.input-row)").each(function () {
          const kode = $(this).find("td:nth-child(1)").text();
          const nama = $(this).find("td:nth-child(2)").text();
          const kodeLock = $(this).find("td:nth-child(3)").text();
          const kadar = $(this).find("td:nth-child(4)").text();
          const berat = parseFloat($(this).find("td:nth-child(5)").text()) || 0;
          const hargaPerGram = parseFloat($(this).find("td:nth-child(6)").text().replace(/\./g, "")) || 0;
          const totalHarga = parseFloat($(this).find("td:nth-child(7)").text().replace(/\./g, "")) || 0;
          const keterangan = $(this).find("td:nth-child(8)").text() || "";
  
          items.push({
            kodeText: kode,
            nama: nama,
            kodeLock: kodeLock !== "-" ? kodeLock : null,
            kadar: kadar,
            berat: berat,
            hargaPerGram: hargaPerGram,
            totalHarga: totalHarga,
            keterangan: keterangan,
          });
        });
      }
  
      return items;
    },
  
    // Update stock after sales
    async updateStock(salesType, items) {
      try {
        const updatePromises = [];
  
        for (const item of items) {
          const kode = item.kodeText;
          if (!kode || kode === "-") continue;
  
          if (salesType === "manual") {
            // Untuk penjualan manual
            if (item.kodeLock && item.kodeLock !== "-") {
              // Kode aksesoris yang dipilih - mengurangi stok sebagai ganti lock
              const currentStock = this.getStockForItem(item.kodeLock);
              const jumlah = parseInt(item.jumlah) || 1;
              const newStock = Math.max(0, currentStock - jumlah);
  
              updatePromises.push(
                this.processSingleStockUpdate(item.kodeLock, {
                  item: { ...item, kodeText: item.kodeLock, nama: `Ganti lock untuk ${item.nama}` },
                  currentStock,
                  newStock,
                  jumlah,
                  isGantiLock: true,
                })
              );
            }
          } else {
            // Untuk penjualan aksesoris dan kotak
            const currentStock = this.getStockForItem(kode);
            const jumlah = parseInt(item.jumlah) || 1;
            const newStock = Math.max(0, currentStock - jumlah);
  
            updatePromises.push(
              this.processSingleStockUpdate(kode, {
                item,
                currentStock,
                newStock,
                jumlah,
                isGantiLock: false,
              })
            );
          }
        }
  
        await Promise.all(updatePromises);
  
        // Update local cache
        for (const item of items) {
          const kode = item.kodeText;
          if (kode && kode !== "-") {
            const currentStock = this.getStockForItem(kode);
            const jumlah = parseInt(item.jumlah) || 1;
            const newStock = Math.max(0, currentStock - jumlah);
            
            this.stockCache.set(kode, newStock);
            
            // Update stockData array
            const stockIndex = this.stockData.findIndex((stockItem) => stockItem.kode === kode);
            if (stockIndex !== -1) {
              this.stockData[stockIndex].stokAkhir = newStock;
            }
          }
        }
  
        // Update cache
        smartCache.set('stockData', this.stockData);
  
        return true;
      } catch (error) {
        console.error("Error updating stock:", error);
        throw error;
      }
    },
  
    // Process single stock update
    async processSingleStockUpdate(kode, { item, currentStock, newStock, jumlah, isGantiLock }) {
        const metodeBayar = $("#metodeBayar").val();
        const salesType = $("#jenisPenjualan").val();
    
        let jenisTransaksi, keterangan;
    
        // Tentukan jenis transaksi
        if (isGantiLock) {
          jenisTransaksi = "gantiLock";
          keterangan = `Ganti lock ${kode} oleh ${$("#sales").val()}`;
        } else if (metodeBayar === "free") {
          jenisTransaksi = "free";
          keterangan = `Penjualan ${salesType} gratis oleh ${$("#sales").val()}`;
        } else {
          jenisTransaksi = "laku";
          keterangan = `Penjualan ${salesType} oleh ${$("#sales").val()}`;
        }
    
        try {
          // Update stok document
          const stockQuery = query(collection(firestore, "stokAksesoris"), where("kode", "==", kode));
          const stockSnapshot = await getDocs(stockQuery);
          readsMonitor.increment('Stock Update Query', 1);
    
          if (!stockSnapshot.empty) {
            const stockDoc = stockSnapshot.docs[0];
            await updateDoc(doc(firestore, "stokAksesoris", stockDoc.id), {
              stokAkhir: newStock,
              lastUpdate: serverTimestamp(),
            });
            readsMonitor.increment('Stock Update Write', 1);
          } else {
            // Buat document baru jika tidak ada
            const newStockData = {
              kode,
              nama: item.nama || "",
              kategori: this.determineCategory(kode),
              stokAwal: currentStock,
              stokAkhir: newStock,
              hargaJual: 0,
              lastUpdate: serverTimestamp(),
            };
    
            await addDoc(collection(firestore, "stokAksesoris"), newStockData);
            readsMonitor.increment('Stock Create Write', 1);
          }
    
          // Catat transaksi stok
          await addDoc(collection(firestore, "stokAksesorisTransaksi"), {
            kode,
            nama: item.nama || "",
            kategori: this.determineCategory(kode),
            jenis: jenisTransaksi,
            jumlah,
            stokSebelum: currentStock,
            stokSesudah: newStock,
            stokAkhir: newStock,
            timestamp: serverTimestamp(),
            keterangan,
            isGantiLock: isGantiLock || false,
          });
          readsMonitor.increment('Stock Transaction Write', 1);
    
          console.log(`Updated stock for ${kode}: ${currentStock} → ${newStock} (${jenisTransaksi})`);
        } catch (error) {
          console.error(`Error updating stock for ${kode}:`, error);
          throw error;
        }
      },
    
      // Helper untuk menentukan kategori berdasarkan kode
      determineCategory(kode) {
        if (kode.startsWith("K") || kode.includes("KOTAK")) return "kotak";
        return "aksesoris";
      },
    
      // Fungsi untuk menduplikat transaksi manual ke mutasiKode
      async duplicateToMutasiKode(transactionData, transactionId) {
        try {
          // Hanya proses jika jenis penjualan adalah manual
          if (transactionData.jenisPenjualan !== "manual" || !transactionData.items) {
            return;
          }
    
          const jenisBarang = { 
            C: "Cincin", K: "Kalung", L: "Liontin", 
            A: "Anting", G: "Gelang", S: "Giwang", 
            Z: "HALA", V: "HALA" 
          };
          const duplicatePromises = [];
    
          transactionData.items.forEach((item) => {
            // Skip item tanpa kode atau kode kosong
            if (!item.kodeText || item.kodeText === "-" || !item.kodeText.trim()) {
              return;
            }
    
            const kode = item.kodeText.trim();
            const prefix = kode.charAt(0).toUpperCase();
    
            // Skip jika prefix tidak valid
            if (!jenisBarang[prefix]) {
              return;
            }
    
            // Data untuk mutasiKode
            const mutasiKodeData = {
              kode: kode,
              namaBarang: item.nama || "Tidak ada nama",
              kadar: item.kadar || "-",
              berat: parseFloat(item.berat) || 0,
              keterangan: item.keterangan || "",
              hargaPerGram: parseFloat(item.hargaPerGram) || 0,
              totalHarga: parseFloat(item.totalHarga) || 0,
              tanggalInput: transactionData.tanggal,
              sales: transactionData.sales || "",
              penjualanId: transactionId,
              isMutated: false,
              tanggalMutasi: null,
              mutasiKeterangan: "",
              mutasiHistory: [],
              timestamp: serverTimestamp(),
              lastUpdated: serverTimestamp(),
              jenisPrefix: prefix,
              jenisNama: jenisBarang[prefix]
            };
    
            duplicatePromises.push(
              addDoc(collection(firestore, "mutasiKode"), mutasiKodeData)
            );
          });
    
          if (duplicatePromises.length > 0) {
            await Promise.all(duplicatePromises);
            readsMonitor.increment('Mutasi Kode Write', duplicatePromises.length);
            console.log(`✅ Duplicated ${duplicatePromises.length} items to mutasiKode`);
          }
    
        } catch (error) {
          console.error("❌ Error duplicating to mutasiKode:", error);
          // Jangan throw error agar tidak mengganggu proses utama
        }
      },
    
      // Print receipt
      printReceipt() {
        if (!currentTransactionData) {
          utils.showAlert("Tidak ada data transaksi untuk dicetak!");
          return;
        }
    
        const transaction = currentTransactionData;
        const printWindow = window.open("", "_blank");
    
        if (!printWindow) {
          utils.showAlert("Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.", "Error", "error");
          return;
        }
    
        let receiptHTML = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Struk Kasir</title>
            <style>
              body {
                font-family: consolas;
                font-size: 14px;
                margin: 0;
                padding: 0;
                width: 80mm;
              }
              .receipt {          
                margin: 0 auto;
                padding: 5mm;
              }
              .receipt h3, .receipt h4 {
                text-align: center;
                margin: 2mm 0;
              }
              .receipt hr {
                border-top: 1px dashed #000;
              }
              .receipt table {
                width: 100%;
                border-collapse: collapse;
              }
              .receipt th, .receipt td {
                text-align: left;
                padding: 1mm 2mm;
              }
              .receipt .tanggal {
              margin-left: 10px
              }
              .text-center {
                text-align: center;
              }
              .text-right {
                text-align: right;
              }
              .keterangan {
                font-style: italic;
                font-size: 14px;
                margin-top: 2mm;
                border-top: 1px dotted #000;
                padding-top: 2mm;
              }
              .payment-info {
                margin-top: 2mm;
                border-top: 1px dotted #000;
                padding-top: 2mm;
              }
            </style>
          </head>
          <body>
            <div class="receipt">
              <h3>MELATI 3</h3>
              <h4>JL. DIPONEGORO NO. 116</h4>
              <h4>NOTA PENJUALAN ${transaction.salesType.toUpperCase()}</h4>
              <hr>
              <p class="tanggal">Tanggal: ${transaction.tanggal}<br>Sales: ${transaction.sales}</p>
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
    
        transaction.items.forEach((item) => {
          const itemHarga = parseInt(item.totalHarga) || 0;
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
    
        const totalHarga = parseInt(transaction.totalHarga.replace(/\./g, "")) || 0;
        receiptHTML += `
                <tr>
                  <td colspan="4" class="text-right"><strong>Total:</strong></td>
                  <td class="text-right"><strong>${utils.formatRupiah(totalHarga)}</strong></td>
                </tr>
              </table>
        `;
    
        // Add DP information if applicable
        if (transaction.metodeBayar === "dp") {
          const dpAmount = parseInt(transaction.nominalDP.replace(/\./g, "")) || 0;
          const remainingAmount = parseInt(transaction.sisaPembayaran.replace(/\./g, "")) || 0;
    
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
    
        // Add keterangan if exists and is manual sale
        if (hasKeterangan && transaction.salesType === "manual") {
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
    
        printWindow.document.write(receiptHTML);
        printWindow.document.close();
      },
    
      // Print invoice
      printInvoice() {
        if (!currentTransactionData) {
          utils.showAlert("Tidak ada data transaksi untuk dicetak!");
          return;
        }
    
        const transaction = currentTransactionData;
        const printWindow = window.open("", "_blank");
    
        if (!printWindow) {
          utils.showAlert("Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.", "Error", "error");
          return;
        }
    
        let invoiceHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invoice Customer</title>
          <style>
            @page {
              size: 10cm 20cm;
              margin: 0;
            }
            body {
              font-family: Arial, sans-serif;
              font-size: 12px;
              margin: 0;
              padding: 5mm;
              width: 20cm;
              box-sizing: border-box;
            }
            .invoice {
              width: 100%;
            }
            .header-info {
              text-align: right;
              margin-bottom: 2cm;
              margin-right: 3cm;
              margin-top: 0.8cm;
            }         
            .total-row {
              margin-top: 0.7cm;
              text-align: right;
              font-weight: bold;
              margin-right: 3cm;
            }
            .sales {
              text-align: right;
              margin-top: 0.6cm;
              margin-right: 2cm;
            }
            .keterangan {
              font-style: italic;
              font-size: 10px;
              margin-top: 1cm;
              margin-bottom: 0.5cm;
              padding-top: 2mm;
              text-align: left;
              margin-left: 0.5cm;
              margin-right: 3cm;
            }
            .keterangan-spacer { height: 1.6cm; }
            .item-details {
              display: flex;
              flex-wrap: wrap;
            }
            .item-data {
              display: grid;
              grid-template-columns: 2cm 1.8cm 5cm 2cm 2cm 2cm;
              width: 100%;
              column-gap: 0.2cm;
              margin-left: 0.5cm;
              margin-top: 1cm;
              margin-right: 3cm;
            }
            .item-data span {
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
          </style>
        </head>
        <body>
          <div class="invoice">
            <div class="header-info">
              <p>${transaction.tanggal}</p>
            </div>
            <hr>
      `;
    
        let hasKeterangan = false;
        let keteranganText = "";
        let totalHarga = 0;
    
        // Loop untuk menampilkan semua item-data terlebih dahulu
        transaction.items.forEach((item) => {
          const itemHarga = parseInt(item.totalHarga) || 0;
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
    if (hasKeterangan && transaction.salesType === "manual") {
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

    printWindow.document.write(invoiceHTML);
    printWindow.document.close();
  },

  // Reset form
  resetForm() {
    try {
      // Reset sales type to default
      $("#jenisPenjualan").val("aksesoris").trigger("change");

      // Reset date to current date
      this.setDefaultDate();

      // Reset sales name field
      $("#sales").val("").removeClass("is-valid is-invalid");

      // Clear all tables
      $("#tableAksesorisDetail tbody, #tableKotakDetail tbody, #tableManualDetail tbody").empty();

      // Reset payment fields
      $("#metodeBayar").val("tunai").trigger("change");
      $("#nominalDP, #totalOngkos, #sisaPembayaran, #jumlahBayar, #kembalian").val("");

      // Reset grand totals
      $("#grand-total-aksesoris, #grand-total-kotak, #grand-total-manual").text("0");

      // Clear current transaction data
      currentTransactionData = null;

      // Set focus to sales field
      $("#sales").focus();

      console.log("Form reset successfully");
    } catch (error) {
      console.error("Error resetting form:", error);
    }
  },

  // Print document handler
  printDocument(type) {
    if (type === "receipt") {
      this.printReceipt();
    } else if (type === "invoice") {
      this.printInvoice();
    }
  },

  // Cleanup when page unloads
  cleanup() {
    this.removeListeners();
    smartCache.clearExpired();
  },
};

// Initialize when document is ready
$(document).ready(async function () {
  try {
    // Initialize monitoring
    readsMonitor.init();

    // Initialize the main handler
    await penjualanHandler.init();

    console.log("✅ Penjualan Aksesoris initialized successfully");
    console.log("📊 Cache stats:", smartCache.getStats());
    console.log("🔥 Firestore reads:", readsMonitor.getStats());
  } catch (error) {
    console.error("❌ Error initializing penjualan aksesoris:", error);
    utils.showAlert("Terjadi kesalahan saat memuat halaman: " + error.message, "Error", "error");
  }
});

// Cleanup when page unloads
$(window).on("beforeunload", () => {
  penjualanHandler.cleanup();
});

// Handle visibility change for smart data refresh
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    console.log("👁️ Page became visible, checking for stale data");
    await penjualanHandler.refreshStaleData();
  }
});

// Handle online/offline status
window.addEventListener('online', async () => {
  console.log('🌐 Connection restored');
  try {
    await penjualanHandler.refreshStaleData();
    utils.showAlert('Koneksi pulih, data telah diperbarui', 'Info', 'info');
  } catch (error) {
    console.error('Failed to refresh data after reconnection:', error);
  }
});

window.addEventListener('offline', () => {
  console.log('📡 Connection lost, using cached data');
  utils.showAlert('Koneksi terputus, menggunakan data cache', 'Warning', 'warning');
});

// Performance monitoring and optimization
const performanceMonitor = {
  metrics: {},
  
  start(operation) {
    this.metrics[operation] = {
      startTime: performance.now(),
      memoryStart: this.getMemoryUsage()
    };
  },
  
  end(operation) {
    if (!this.metrics[operation]) return;
    
    const duration = performance.now() - this.metrics[operation].startTime;
    const memoryEnd = this.getMemoryUsage();
    const memoryDelta = memoryEnd - this.metrics[operation].memoryStart;
    
    console.log(`⏱️ ${operation}: ${duration.toFixed(2)}ms (Memory: ${memoryDelta > 0 ? '+' : ''}${memoryDelta.toFixed(2)}MB)`);
    
    // Log slow operations
    if (duration > 1000) {
      console.warn(`🐌 Slow operation: ${operation} took ${duration.toFixed(2)}ms`);
    }
    
    delete this.metrics[operation];
  },
  
  getMemoryUsage() {
    if (performance.memory) {
      return performance.memory.usedJSHeapSize / 1024 / 1024; // MB
    }
    return 0;
  },
  
  wrap(operation, fn) {
    return async (...args) => {
      this.start(operation);
      try {
        const result = await fn(...args);
        this.end(operation);
        return result;
      } catch (error) {
        this.end(operation);
        throw error;
      }
    };
  }
};

// Wrap critical functions with performance monitoring
penjualanHandler.loadStockData = performanceMonitor.wrap(
  'Load Stock Data', 
  penjualanHandler.loadStockData.bind(penjualanHandler)
);

penjualanHandler.saveTransaction = performanceMonitor.wrap(
  'Save Transaction', 
  penjualanHandler.saveTransaction.bind(penjualanHandler)
);

// Auto-maintenance tasks
setInterval(() => {
  // Clean expired cache every 10 minutes
  smartCache.clearExpired();
  
  // Log performance stats every 10 minutes
  const cacheStats = smartCache.getStats();
  const readsStats = readsMonitor.getStats();
  const storageUsage = smartCache.getStorageUsage();
  
  console.log('📊 System Health Check:', {
    cache: `${cacheStats.validEntries}/${cacheStats.entries} entries (${(cacheStats.totalSize/1024).toFixed(1)}KB)`,
    storage: `${storageUsage.percentage.toFixed(1)}% used`,
    reads: `${readsStats.total}/${readsMonitor.dailyLimit} (${readsStats.percentage.toFixed(1)}%)`
  });
  
  // Alert if storage is getting full
  if (storageUsage.percentage > 85) {
    console.warn('⚠️ Storage usage high, consider clearing cache');
    smartCache.clearExpired();
  }
  
}, 10 * 60 * 1000); // Every 10 minutes

// Error boundary for unhandled errors
window.addEventListener('error', (event) => {
  console.error('💥 Unhandled error:', event.error);
  
  // Don't show alert for minor errors
  if (event.error && event.error.message && 
      !event.error.message.includes('Non-Error promise rejection') &&
      !event.error.message.includes('ResizeObserver')) {
    utils.showAlert(
      'Terjadi kesalahan tidak terduga. Silakan refresh halaman jika masalah berlanjut.',
      'Error',
      'error'
    );
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('🚫 Unhandled promise rejection:', event.reason);
  event.preventDefault();
  
  if (event.reason && typeof event.reason === 'object' && event.reason.message) {
    console.error('Promise rejection details:', event.reason.message);
  }
});

// Add refresh stale data method to penjualanHandler
penjualanHandler.refreshStaleData = async function() {
  try {
    const promises = [];
    
    // Check if stock data is stale
    if (smartCache.shouldUpdate('stockData', 5 * 60 * 1000)) { // 5 minutes
      promises.push(this.loadStockData(true));
    }
    
    // Check if today's sales data is stale
    const todayKey = `salesData_${smartCache.getDateKey()}`;
    if (smartCache.shouldUpdate(todayKey, 2 * 60 * 1000)) { // 2 minutes
      promises.push(this.loadTodaySales(true));
    }
    
    if (promises.length > 0) {
      await Promise.all(promises);
      console.log('🔄 Refreshed stale data');
    }
  } catch (error) {
    console.error('Failed to refresh stale data:', error);
  }
};

// Add remove listeners method to penjualanHandler
penjualanHandler.removeListeners = function() {
  // Remove all event listeners to prevent memory leaks
  $(document).off('.penjualan');
  $(window).off('.penjualan');
  
  // Clear intervals
  if (this.refreshInterval) {
    clearInterval(this.refreshInterval);
    this.refreshInterval = null;
  }
};

// Export for potential use in other modules
window.penjualanHandler = penjualanHandler;
window.smartCache = smartCache;
window.readsMonitor = readsMonitor;
window.performanceMonitor = performanceMonitor;

// Utility functions for backward compatibility
function showAlert(message, title = "Informasi", type = "info") {
  return utils.showAlert(message, title, type);
}

function showConfirm(message, title = "Konfirmasi") {
  return utils.showConfirm(message, title);
}

function formatDate(date) {
  return utils.formatDate(date);
}

function printDocument(type) {
  return penjualanHandler.printDocument(type);
}

// Add loading states for better UX
const loadingStates = {
  show(element, text = 'Loading...') {
    const $el = $(element);
    $el.prop('disabled', true);
    const originalText = $el.text();
    $el.data('original-text', originalText);
    $el.html(`<i class="fas fa-spinner fa-spin me-2"></i>${text}`);
  },
  
  hide(element) {
    const $el = $(element);
    $el.prop('disabled', false);
    const originalText = $el.data('original-text');
    if (originalText) {
      $el.text(originalText);
    }
  }
};

// Enhanced error handling with retry mechanism
const errorHandler = {
  retryAttempts: 3,
  retryDelay: 1000,
  
  async withRetry(operation, context = 'Operation') {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(`${context} failed (attempt ${attempt}/${this.retryAttempts}):`, error);
        
        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }
    
    throw lastError;
  },
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  isRetryableError(error) {
    // Network errors, timeout errors, etc.
    return error.code === 'unavailable' || 
           error.code === 'deadline-exceeded' ||
           error.message.includes('network') ||
           error.message.includes('timeout');
  }
};

// Add connection status indicator
const connectionStatus = {
  indicator: null,
  
  init() {
    // Create status indicator
    this.indicator = $(`
      <div id="connection-status" class="position-fixed bottom-0 end-0 m-3" style="z-index: 9999;">
        <div class="badge bg-success">
          <i class="fas fa-wifi me-1"></i>
          Online
        </div>
      </div>
    `);
    
    $('body').append(this.indicator);
    this.updateStatus();
  },
  
  updateStatus() {
    const isOnline = navigator.onLine;
    const badge = this.indicator.find('.badge');
    
    if (isOnline) {
      badge.removeClass('bg-danger').addClass('bg-success');
      badge.html('<i class="fas fa-wifi me-1"></i>Online');
    } else {
      badge.removeClass('bg-success').addClass('bg-danger');
      badge.html('<i class="fas fa-wifi-slash me-1"></i>Offline');
    }
  }
};

// Initialize connection status
$(document).ready(() => {
  connectionStatus.init();
});

window.addEventListener('online', () => connectionStatus.updateStatus());
window.addEventListener('offline', () => connectionStatus.updateStatus());

// Add data validation helpers
const validators = {
  required(value, fieldName) {
    if (!value || value.toString().trim() === '') {
      throw new Error(`${fieldName} harus diisi`);
    }
    return true;
  },
  
  numeric(value, fieldName) {
    if (isNaN(value) || value < 0) {
      throw new Error(`${fieldName} harus berupa angka positif`);
    }
    return true;
  },
  
  minValue(value, min, fieldName) {
    if (parseFloat(value) < min) {
      throw new Error(`${fieldName} minimal ${min}`);
    }
    return true;
  },
  
  maxLength(value, max, fieldName) {
    if (value.toString().length > max) {
      throw new Error(`${fieldName} maksimal ${max} karakter`);
    }
    return true;
  }
};

// Add form validation to save transaction
const originalSaveTransaction = penjualanHandler.saveTransaction;
penjualanHandler.saveTransaction = async function() {
  try {
    // Validate form data
    const salesName = $("#sales").val().trim();
    validators.required(salesName, 'Nama sales');
    validators.maxLength(salesName, 50, 'Nama sales');
    
    const totalHarga = parseFloat($("#totalOngkos").val().replace(/\./g, "")) || 0;
    validators.minValue(totalHarga, 1, 'Total harga');
    
    // Call original function
    return await originalSaveTransaction.call(this);
  } catch (error) {
    if (error.message.includes('harus')) {
      utils.showAlert(error.message, 'Validasi Error', 'warning');
      return;
    }
    throw error;
  }
};

console.log('🚀 Penjualan Aksesoris module loaded successfully with enhanced features');
console.log('📋 Available features:');
console.log('  - Smart caching with integrity checks');
console.log('  - Performance monitoring');
console.log('  - Firestore reads optimization');
console.log('  - Auto-retry mechanism');
console.log('  - Connection status indicator');
console.log('  - Form validation');
console.log('  - Memory leak prevention');
