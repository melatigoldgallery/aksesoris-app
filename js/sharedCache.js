// Buat file baru untuk shared cache management
const sharedCacheManager = {
    prefix: "melati_shared_",
    stockTTL: 15 * 60 * 1000, // 15 menit untuk stok
    salesTTL: 5 * 60 * 1000,  // 5 menit untuk sales
    
    // Cache dengan versioning untuk multi-tab sync
    setVersioned(key, data, ttl = this.stockTTL) {
      try {
        const item = {
          data,
          timestamp: Date.now(),
          ttl,
          version: Date.now(),
          hash: this.generateHash(data) // untuk detect changes
        };
        localStorage.setItem(this.prefix + key, JSON.stringify(item));
        
        // Broadcast ke tabs lain
        this.broadcastCacheUpdate(key, item.version);
      } catch (error) {
        console.warn("Cache set failed:", error);
        this.clearOldCache();
      }
    },
  
    getVersioned(key, maxAge = null) {
      try {
        const item = JSON.parse(localStorage.getItem(this.prefix + key));
        if (!item) return null;
  
        const age = Date.now() - item.timestamp;
        const isExpired = age > item.ttl || (maxAge && age > maxAge);
        
        if (isExpired) {
          this.remove(key);
          return null;
        }
  
        return {
          data: item.data,
          version: item.version,
          age: age,
          hash: item.hash
        };
      } catch (error) {
        console.warn("Cache get failed:", error);
        this.remove(key);
        return null;
      }
    },
  
    // Generate simple hash untuk detect data changes
    generateHash(data) {
      return JSON.stringify(data).split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
    },
  
    // Broadcast cache updates ke tabs lain
    broadcastCacheUpdate(key, version) {
      try {
        const event = new CustomEvent('cacheUpdate', {
          detail: { key, version, timestamp: Date.now() }
        });
        window.dispatchEvent(event);
      } catch (error) {
        console.warn("Broadcast failed:", error);
      }
    },
  
    // Smart cache invalidation
    invalidateRelated(pattern) {
      try {
        Object.keys(localStorage)
          .filter(key => key.startsWith(this.prefix) && key.includes(pattern))
          .forEach(key => localStorage.removeItem(key));
      } catch (error) {
        console.warn("Cache invalidation failed:", error);
      }
    },
  
    // Batch cache operations
    setBatch(items) {
      const operations = [];
      items.forEach(({ key, data, ttl }) => {
        operations.push(() => this.setVersioned(key, data, ttl));
      });
      
      // Execute batch dengan error handling
      operations.forEach(op => {
        try {
          op();
        } catch (error) {
          console.warn("Batch cache operation failed:", error);
        }
      });
    },
  
    remove(key) {
      try {
        localStorage.removeItem(this.prefix + key);
      } catch (error) {
        console.warn("Cache remove failed:", error);
      }
    },
  
    clearOldCache() {
      const now = Date.now();
      try {
        Object.keys(localStorage)
          .filter(key => key.startsWith(this.prefix))
          .forEach(key => {
            try {
              const item = JSON.parse(localStorage.getItem(key));
              if (item && now - item.timestamp > item.ttl) {
                localStorage.removeItem(key);
              }
            } catch (error) {
              localStorage.removeItem(key);
            }
          });
      } catch (error) {
        console.warn("Clear old cache failed:", error);
      }
    }
  };
  
  // Export untuk digunakan di file lain
  window.sharedCacheManager = sharedCacheManager;

// Listen untuk cache updates dari tabs lain
window.addEventListener('cacheUpdate', (event) => {
    const { key, version, timestamp } = event.detail;
    
    // Check jika ada handler yang perlu di-notify
    if (window.penjualanHandler && key.includes('stock')) {
      window.penjualanHandler.lastStockUpdate = 0; // Force refresh
    }
    
    if (window.laporanStokHandler && key.includes('transaction')) {
      window.laporanStokHandler.clearRelevantCache();
    }
  });
  
  // Periodic cache cleanup
  setInterval(() => {
    sharedCacheManager.clearOldCache();
  }, 10 * 60 * 1000); // Setiap 10 menit
  