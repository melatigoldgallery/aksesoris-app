# 🐛 Troubleshooting: Tambah Stok Tidak Muncul di Laporan

## 📋 Problem Analysis

**Symptoms:**

- Manual add stock via tambahAksesoris.html
- Data tidak muncul di laporanStok.html
- Hard reload, clear cache, incognito - masih tidak muncul
- Screenshot shows all 0 except GB70 (has "Tambah Stok: 2")

---

## 🔍 Root Cause Analysis

### Possible Issues:

1. **Transaksi tidak tersimpan ke Firestore**

   - StockService.updateStock() gagal
   - Network error / permission issue

2. **Jenis transaksi tidak match**

   - Menggunakan "stockAddition" tapi tidak di-handle
   - Case sensitivity issue

3. **Cache tidak di-clear**

   - laporanStok.js masih pakai cached data
   - Real-time listener tidak trigger

4. **Batch query filter issue**
   - Timestamp filter exclude transactions baru
   - Date calculation salah

---

## 🔧 Diagnostic Steps

### Step 1: Verify Transaction Saved to Firestore

**Run this in browser console (F12) on tambahAksesoris.html:**

```javascript
// Check if transactions are saved
(async function () {
  const { getDocs, collection, query, orderBy, limit } = await import(
    "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js"
  );

  const db = window.firestore || firestore;

  // Get last 10 transactions
  const snapshot = await getDocs(
    query(collection(db, "stokAksesorisTransaksi"), orderBy("timestamp", "desc"), limit(10))
  );

  console.log(`📦 Found ${snapshot.size} recent transactions:`);
  snapshot.forEach((doc) => {
    const data = doc.data();
    console.log({
      id: doc.id,
      kode: data.kode,
      jenis: data.jenis,
      jumlah: data.jumlah,
      timestamp: data.timestamp?.toDate(),
      keterangan: data.keterangan,
    });
  });
})();
```

**Expected Output:**

- Should see your recent "stockAddition" transactions
- Timestamp should be recent (today)

**If NO transactions found:**
❌ **Problem:** Transactions not being saved!

---

### Step 2: Check Stock Calculation

**Run this in browser console (F12) on laporanStok.html:**

```javascript
// Test stock calculation for specific kode
(async function () {
  const kode = "GB70"; // Change to your kode

  console.log(`🔍 Calculating stock for ${kode}...`);

  const stock = await StockService.calculateStockFromTransactions(kode);
  console.log(`📊 Stock for ${kode}: ${stock}`);

  // Get transactions
  const transactions = await StockService.getTransactionsByDate(kode, new Date("2026-01-01"), new Date());

  console.log("📦 Transactions:", transactions);
})();
```

**Expected Output:**

- Should show stock value > 0 if you added stock
- Should show transactions breakdown

**If stock = 0 but transactions exist:**
❌ **Problem:** Calculation logic issue!

---

### Step 3: Force Clear Cache

**Run this in browser console (F12) on laporanStok.html:**

```javascript
// Force clear all cache
if (window.stockReport) {
  stockReport.clearAllCache();
  console.log("✅ Cache cleared");

  // Reload data
  stockReport.loadAndFilterStockData(true);
  console.log("✅ Reloading data...");
} else {
  console.log("❌ stockReport not found");
}
```

---

## 🛠️ Fixes

### Fix 1: Ensure StockService Saves Correctly

**Update `js/services/stockService.js` - Add better logging:**

```javascript
async updateStock(stockData) {
  const {
    kode,
    jenis,
    jumlah,
    keterangan = "",
    sales = "",
    kodeTransaksi = "",
    tanggal = null,
    currentStock = null,
    newStock = null,
  } = stockData;

  try {
    console.log('📝 Saving transaction:', { kode, jenis, jumlah }); // ADD THIS

    // ✅ Log to transaction (single source of truth)
    const transactionData = {
      kode,
      jenis,
      jumlah,
      timestamp: serverTimestamp(),
      keterangan,
      sales,
    };

    // Add optional fields
    if (kodeTransaksi) transactionData.kodeTransaksi = kodeTransaksi;
    if (tanggal) transactionData.tanggal = tanggal;
    if (currentStock !== null) transactionData.stokSebelum = currentStock;
    if (newStock !== null) transactionData.stokSesudah = newStock;

    const transactionRef = await addDoc(collection(firestore, "stokAksesorisTransaksi"), transactionData);

    console.log('✅ Transaction saved:', transactionRef.id); // ADD THIS

    return transactionRef;
  } catch (error) {
    console.error("❌ StockService.updateStock error:", error);
    throw error;
  }
}
```

---

### Fix 2: Update tambahAksesoris.js - Better Error Handling

```javascript
async updateStokAksesoris(items) {
  try {
    console.log('🔄 Starting stock update for', items.length, 'items'); // ADD

    // Invalidate stock cache sebelum update
    invalidateCache("stockData");

    for (const item of items) {
      console.log(`📦 Processing ${item.kodeText}...`); // ADD

      // ✅ Gunakan StockService - single source of truth
      const result = await StockService.updateStock({
        kode: item.kodeText,
        jenis: "stockAddition",
        jumlah: parseInt(item.jumlah) || 0,
        keterangan: `Tambah stok: ${item.nama}`,
        sales: "System",
      });

      console.log(`✅ Stock updated for ${item.kodeText}, ref:`, result.id); // ADD
    }

    console.log('✅ All stock updates completed'); // ADD
  } catch (error) {
    console.error("❌ Error updating stok aksesoris:", error);
    throw error;
  }
}
```

---

### Fix 3: Force Refresh in laporanStok.js After Add Stock

**Option A: Add refresh button**

Add this button to `laporanStok.html`:

```html
<button class="btn btn-warning" onclick="stockReport.forceRefresh()">🔄 Force Refresh</button>
```

Add this method to `js/laporanStok.js`:

```javascript
// Add this method to OptimizedStockReport class
forceRefresh() {
  console.log('🔄 Force refreshing...');
  this.clearAllCache();
  this.loadAndFilterStockData(true);
}
```

**Option B: Auto-refresh on focus**

Add this to `js/laporanStok.js` init():

```javascript
// Auto-refresh when user returns to tab
window.addEventListener("focus", () => {
  if (this.isDataLoaded) {
    console.log("🔄 Tab focused, refreshing data...");
    this.loadAndFilterStockData(true);
  }
});
```

---

### Fix 4: Check jenis Field Consistency

**Verify all jenis values are handled in stockService.js:**

```javascript
// In calculateStockFromTransactions
switch (data.jenis) {
  case "tambah":
  case "stockAddition": // ✅ Make sure this exists
  case "initialStock":
    stock += jumlah;
    break;

  case "laku":
  case "free":
  case "gantiLock":
  case "return":
    stock -= jumlah;
    break;

  case "adjustment":
    stock = data.stokSesudah || stock;
    break;

  default:
    console.warn(`⚠️ Unknown transaction type: ${data.jenis}`); // ADD THIS
    break;
}
```

---

## 🎯 Quick Fix Script

**Run this to verify and fix:**

```javascript
// Comprehensive diagnostic and fix script
(async function diagnosticAndFix() {
  console.clear();
  console.log("🔍 === DIAGNOSTIC START ===\n");

  // Import Firebase
  const { getDocs, collection, query, orderBy, limit, where, Timestamp } = await import(
    "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js"
  );

  const db = window.firestore || firestore;

  // 1. Check recent transactions
  console.log("1️⃣ Checking recent transactions...");
  const recentTrans = await getDocs(
    query(collection(db, "stokAksesorisTransaksi"), orderBy("timestamp", "desc"), limit(5))
  );

  console.log(`   Found ${recentTrans.size} recent transactions`);
  recentTrans.forEach((doc, i) => {
    const d = doc.data();
    console.log(`   ${i + 1}. ${d.kode} - ${d.jenis} - ${d.jumlah} - ${d.timestamp?.toDate()}`);
  });

  // 2. Check stockAddition transactions specifically
  console.log("\n2️⃣ Checking stockAddition transactions...");
  const stockAdditions = await getDocs(
    query(
      collection(db, "stokAksesorisTransaksi"),
      where("jenis", "==", "stockAddition"),
      orderBy("timestamp", "desc"),
      limit(5)
    )
  );

  console.log(`   Found ${stockAdditions.size} stockAddition transactions`);

  if (stockAdditions.size === 0) {
    console.error("   ❌ NO stockAddition transactions found!");
    console.error("   ❌ Problem: Transactions not being saved OR wrong jenis field");
  }

  // 3. Test stock calculation for a kode
  console.log("\n3️⃣ Testing stock calculation...");
  if (stockAdditions.size > 0) {
    const firstDoc = stockAdditions.docs[0].data();
    const testKode = firstDoc.kode;

    console.log(`   Testing kode: ${testKode}`);

    try {
      const stock = await StockService.calculateStockFromTransactions(testKode);
      console.log(`   📊 Calculated stock: ${stock}`);

      if (stock === 0 && stockAdditions.size > 0) {
        console.error("   ❌ Problem: Stock is 0 but transactions exist!");
        console.error("   ❌ Possible cause: jenis not handled in switch statement");
      } else {
        console.log("   ✅ Stock calculation works!");
      }
    } catch (error) {
      console.error("   ❌ Error calculating stock:", error);
    }
  }

  // 4. Check cache
  console.log("\n4️⃣ Checking cache...");
  if (window.stockReport) {
    console.log("   Cache size:", window.stockReport.cache.size);
    console.log("   Clearing cache...");
    window.stockReport.clearAllCache();
    console.log("   ✅ Cache cleared");
  }

  console.log("\n🎯 === DIAGNOSTIC COMPLETE ===");
  console.log("\nℹ️ Next steps:");
  console.log("  1. If NO transactions found → Check tambahAksesoris.js save logic");
  console.log("  2. If transactions exist but stock=0 → Check stockService.js switch statement");
  console.log("  3. If cache issue → Add force refresh button");
  console.log("  4. Reload laporanStok.html and check again");
})();
```

---

## ✅ Implementation Plan

1. **Run diagnostic script** (see above)
2. **Add logging** to stockService.js updateStock()
3. **Add logging** to tambahAksesoris.js updateStokAksesoris()
4. **Add force refresh button** to laporanStok.html
5. **Test** by adding new stock and checking laporan
6. **Verify** transactions in Firestore Console

---

## 🔎 Firebase Console Verification

1. Go to Firebase Console → Firestore
2. Open `stokAksesorisTransaksi` collection
3. Check if your recent transactions exist
4. Verify fields:
   - `kode`: should match your item code
   - `jenis`: should be "stockAddition"
   - `jumlah`: should be the amount you added
   - `timestamp`: should be recent

If transactions missing → **Problem in tambahAksesoris.js**
If transactions exist → **Problem in laporanStok.js calculation**

---

## 📞 Need Help?

Run the diagnostic script and send me:

1. Console output
2. Screenshot of Firestore stokAksesorisTransaksi collection
3. Any error messages

This will help identify the exact issue!
