// Import Firebase modules
import { firestore } from "./configFirebase.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  Timestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// ==================== LOGGING UTILITY FUNCTIONS ====================

/**
 * Get keterangan dropdown options
 */
function getKeteranganOptions() {
  return ["restok", "dipajang", "salah update", "sudah posting", "mutasi", "diperbaiki", "laku"];
}

/**
 * Generate keterangan string untuk log
 * Format: "stock awal {before} {userName} {action} {quantity} : {keterangan}"
 */
function generateKeteranganString(log) {
  const actionVerbs = {
    tambah: "menambah",
    kurangi: "mengurangi",
    update: "mengupdate",
  };

  const verb = actionVerbs[log.action] || log.action;

  if (log.action === "update") {
    return `stock awal ${log.before} ${log.userName} ${verb} dari ${log.before} ke ${log.after} : ${log.keterangan}`;
  }

  return `stock awal ${log.before} ${log.userName} ${verb} ${log.quantity} : ${log.keterangan}`;
}

/**
 * Save stock log to daily_stock_logs collection
 * Optimized: No extra reads, uses data already in memory
 */
async function saveStockLog(logData) {
  try {
    // Validate required fields
    if (!logData.jenis || !logData.lokasi || !logData.action || !logData.userName || !logData.keterangan) {
      console.warn("Missing required fields for stock log:", logData);
      return;
    }

    // Get current date in YYYY-MM-DD format (WITA timezone)
    const now = new Date();
    const witaOffset = 8 * 60; // WITA is UTC+8
    const witaTime = new Date(now.getTime() + witaOffset * 60 * 1000);
    const dateStr = witaTime.toISOString().split("T")[0]; // YYYY-MM-DD

    const logEntry = {
      timestamp: Timestamp.now(),
      jenis: logData.jenis,
      lokasi: logData.lokasi,
      action: logData.action,
      before: logData.before || 0,
      after: logData.after || 0,
      quantity: logData.quantity || 0,
      userName: logData.userName,
      keterangan: logData.keterangan,
    };

    // Save to daily_stock_logs/{date}
    const docRef = doc(firestore, "daily_stock_logs", dateStr);

    // Use arrayUnion to append log without reading first (atomic operation)
    await setDoc(
      docRef,
      {
        date: dateStr,
        logs: arrayUnion(logEntry),
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Error saving stock log:", error);
    // Don't throw - logging failure shouldn't break stock update
  }
}

/**
 * Get current date string in YYYY-MM-DD format (WITA timezone)
 */
function getCurrentDateString() {
  const now = new Date();
  const witaOffset = 8 * 60; // WITA is UTC+8
  const witaTime = new Date(now.getTime() + witaOffset * 60 * 1000);
  return witaTime.toISOString().split("T")[0];
}

// ==================== END LOGGING UTILITY FUNCTIONS ====================

// === Konstanta dan Mapping ===
const mainCategories = [
  "KALUNG",
  "LIONTIN",
  "ANTING",
  "CINCIN",
  "HALA & SDW",
  "GELANG",
  "GIWANG",
  "KENDARI & EMAS BALI",
  "BERLIAN",
  // "SDW",
  // "EMAS_BALI",
];
const subCategories = [
  "Stok Brankas",
  "Belum Posting",
  "Display",
  "Rusak",
  "Batu Lepas",
  "Manual",
  "Admin",
  "DP",
  "Lainnya",
];
const summaryCategories = [
  "brankas",
  "posting",
  "barang-display",
  "barang-rusak",
  "batu-lepas",
  "manual",
  "admin",
  "DP",
  "lainnya",
];

const halaJewelryTypes = ["KA", "LA", "AN", "CA", "SA", "GA"];
const halaJewelryMapping = {
  KA: "Kalung",
  LA: "Liontin",
  AN: "Anting",
  CA: "Cincin",
  SA: "Giwang",
  GA: "Gelang",
};

const kalungColorTypes = ["HIJAU", "BIRU", "PUTIH", "PINK", "KUNING"];
const kalungColorMapping = {
  HIJAU: "Hijau",
  BIRU: "Biru",
  PUTIH: "Putih",
  PINK: "Pink",
  KUNING: "Kuning",
};
const liontinColorTypes = ["HIJAU", "BIRU", "PUTIH", "PINK", "KUNING"];
const liontinColorMapping = {
  HIJAU: "Hijau",
  BIRU: "Biru",
  PUTIH: "Putih",
  PINK: "Pink",
  KUNING: "Kuning",
};

const categoryMapping = {
  "Stok Brankas": "brankas",
  "Belum Posting": "posting",
  Display: "barang-display",
  Rusak: "barang-rusak",
  "Batu Lepas": "batu-lepas",
  Manual: "manual",
  Admin: "admin",
  DP: "DP",
  Lainnya: "lainnya",
};

const reverseCategoryMapping = {
  brankas: "Stok Brankas",
  posting: "Belum Posting",
  "barang-display": "Display",
  "barang-rusak": "Rusak",
  "batu-lepas": "Batu Lepas",
  manual: "Manual",
  admin: "Admin",
  DP: "DP",
  lainnya: "Lainnya",
};
const mainCategoryToId = {
  KALUNG: "kalung-table-body",
  LIONTIN: "liontin-table-body",
  ANTING: "anting-table-body",
  CINCIN: "cincin-table-body",
  "HALA & SDW": "hala-table-body",
  GELANG: "gelang-table-body",
  GIWANG: "giwang-table-body",
  "KENDARI & EMAS BALI": "kendari-table-body",
  BERLIAN: "berlian-table-body",
  // SDW: "sdw-table-body",
  // EMAS_BALI: "emas-bali-table-body",
};
const statusCardId = {
  KALUNG: "label-jenis-KALUNG",
  LIONTIN: "label-jenis-LIONTIN",
  ANTING: "label-jenis-ANTING",
  CINCIN: "label-jenis-CINCIN",
  "HALA & SDW": "label-jenis-HALA",
  GELANG: "label-jenis-GELANG",
  GIWANG: "label-jenis-GIWANG",
  "KENDARI & EMAS BALI": "label-jenis-KENDARI",
  BERLIAN: "label-jenis-BERLIAN",
  // SDW: "label-jenis-SDW",
  // EMAS_BALI: "label-jenis-EMAS_BALI",
};
const totalCardId = {
  KALUNG: "total-kalung",
  LIONTIN: "total-liontin",
  ANTING: "total-anting",
  CINCIN: "total-cincin",
  "HALA & SDW": "total-hala",
  GELANG: "total-gelang",
  GIWANG: "total-giwang",
  "KENDARI & EMAS BALI": "total-kendari",
  BERLIAN: "total-berlian",
  // SDW: "total-sdw",
  // EMAS_BALI: "total-emas-bali",
};

// === Cache Management ===
let stockData = {};
const CACHE_KEY = "stockDataCache";
const CACHE_TTL = 5 * 60 * 1000; // 5 menit
const stockCache = new Map();
const stockCacheMeta = new Map();

function initializeCache() {
  try {
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (cachedData) {
      const parsedData = JSON.parse(cachedData);
      stockData = parsedData.data || {};
      if (parsedData.meta) {
        Object.entries(parsedData.meta).forEach(([key, timestamp]) => {
          stockCacheMeta.set(key, timestamp);
        });
      }
      Object.entries(stockData).forEach(([category, data]) => {
        stockCache.set(category, data);
      });
    }
  } catch {
    localStorage.removeItem(CACHE_KEY);
    stockCache.clear();
    stockCacheMeta.clear();
  }
}
function updateCache() {
  try {
    const cacheData = {
      timestamp: Date.now(),
      data: stockData,
      meta: Object.fromEntries(stockCacheMeta),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
}
function isCacheValid(category) {
  const timestamp = stockCacheMeta.get(category);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL;
}

// === Firestore Fetch/Save ===
// GANTI fungsi fetchStockData: hanya fetch kategori yang cache-nya invalid,
// dan JANGAN memaksa re-fetch bila tidak perlu.
async function fetchStockData(forceRefresh = false) {
  // Daftar dokumen yang dikelola
  const categories = [
    "brankas",
    "posting",
    "barang-display",
    "barang-rusak",
    "batu-lepas",
    "manual",
    "admin",
    "DP",
    "lainnya",
    "stok-komputer",
  ];

  try {
    // Jika tidak force dan semua kategori masih valid di cache, langsung pakai in-memory
    if (!forceRefresh && Object.keys(stockData).length > 0 && categories.every(isCacheValid)) {
      return stockData;
    }

    // Tentukan kategori yang perlu di-fetch (invalid atau force)
    const toFetch = forceRefresh ? categories : categories.filter((c) => !isCacheValid(c));
    if (toFetch.length === 0) {
      // Tidak ada yang perlu dibaca ulang
      return stockData;
    }

    // Ambil hanya dokumen yang perlu
    const fetchPromises = toFetch.map(async (category) => {
      const categoryRef = doc(firestore, "stocks", category);
      const categoryDoc = await getDoc(categoryRef);
      let categoryData = {};

      if (categoryDoc.exists()) {
        categoryData = categoryDoc.data();
      } else {
        // Inisialisasi objek kosong di memori (agar UI bisa render),
        // lalu simpan ke Firestore (tetap dilakukan agar konsisten dengan perilaku sebelumnya).
        mainCategories.forEach((mc) => {
          categoryData[mc] = {
            quantity: 0,
            lastUpdated: null,
            history: [],
          };
        });
        await setDoc(categoryRef, categoryData);
      }

      // Inisialisasi struktur HALA (kecuali dokumen 'stok-komputer')
      // Old: if (category !== "stok-komputer" && categoryData.HALA)
      // New: support "HALA & SDW" and "KENDARI & EMAS BALI" names
      if (category !== "stok-komputer") {
        // Check for old HALA name
        if (categoryData.HALA) {
          initializeHalaStructure(categoryData, "HALA");
          categoryData.HALA.quantity = calculateHalaTotal(categoryData, "HALA");
        }
        // Check for new HALA & SDW name
        if (categoryData["HALA & SDW"]) {
          initializeHalaStructure(categoryData, "HALA & SDW");
          categoryData["HALA & SDW"].quantity = calculateHalaTotal(categoryData, "HALA & SDW");
        }
        // Check for old KENDARI name
        if (categoryData.KENDARI) {
          initializeHalaStructure(categoryData, "KENDARI");
          categoryData.KENDARI.quantity = calculateHalaTotal(categoryData, "KENDARI");
        }
        // Check for new KENDARI & EMAS BALI name
        if (categoryData["KENDARI & EMAS BALI"]) {
          initializeHalaStructure(categoryData, "KENDARI & EMAS BALI");
          categoryData["KENDARI & EMAS BALI"].quantity = calculateHalaTotal(categoryData, "KENDARI & EMAS BALI");
        }
      }

      // Simpan ke in-memory + cache meta
      stockData[category] = categoryData;
      stockCache.set(category, categoryData);
      stockCacheMeta.set(category, Date.now());
      return { category, data: categoryData };
    });

    await Promise.all(fetchPromises);
    updateCache();
    return stockData;
  } catch (error) {
    console.error("Error fetching stock data:", error);
    if (Object.keys(stockData).length > 0) {
      return stockData;
    }
    throw error;
  }
}
async function saveData(category, type) {
  try {
    const categoryRef = doc(firestore, "stocks", category);
    const payload = {};
    payload[type] = stockData[category][type];
    // Sanitize payload to remove any undefined fields (Firestore does not allow undefined)
    const sanitized = sanitizeUndefined(payload);
    // Merge write to avoid overwriting other fields in the document
    await setDoc(categoryRef, sanitized, { merge: true });
    // Mark this category as fresh so fetchStockData returns current in-memory state without refetching immediately
    stockCacheMeta.set(category, Date.now());
    updateCache();
  } catch (error) {
    console.error("Error saving data:", error);
  }
}

// Recursively remove undefined in objects and convert undefined array items to null
function sanitizeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeUndefined(v));
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      const sv = sanitizeUndefined(v);
      if (sv !== undefined) result[k] = sv;
    }
    return result;
  }
  return value === undefined ? null : value;
}

// === Helper ===
function formatDate(date) {
  if (!date) return "-";
  const d = new Date(date);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}
function getCategoryKey(subCategory) {
  return categoryMapping[subCategory] || "";
}

// === Fungsi khusus untuk HALA ===
function initializeHalaStructure(categoryData, mainCat) {
  if (!categoryData[mainCat]) {
    categoryData[mainCat] = {
      quantity: 0,
      lastUpdated: null,
      history: [],
      details: {},
    };
  }

  // Inisialisasi detail untuk setiap jenis perhiasan jika belum ada
  if (!categoryData[mainCat].details) {
    categoryData[mainCat].details = {};
  }

  halaJewelryTypes.forEach((type) => {
    if (!categoryData[mainCat].details[type]) {
      categoryData[mainCat].details[type] = 0;
    }
  });

  return categoryData[mainCat];
}

// === Generic typed helpers (digunakan untuk KALUNG agar kode ringkas) ===
function ensureTypedStructure(categoryData, mainCat, types) {
  if (!categoryData[mainCat]) {
    categoryData[mainCat] = { quantity: 0, lastUpdated: null, history: [], details: {} };
  }
  const node = categoryData[mainCat];
  if (!node.details) node.details = {};
  types.forEach((t) => {
    if (node.details[t] === undefined) node.details[t] = 0;
  });
  return node;
}

function calculateTypedTotal(categoryData, mainCat, types) {
  const node = categoryData[mainCat];
  if (!node || !node.details) return 0;
  return types.reduce((sum, t) => sum + parseInt(node.details[t] || 0), 0);
}

async function updateTypedBulk(category, mainCat, types, typeToName, updates, petugas, keterangan) {
  await fetchStockData();
  if (!stockData[category]) stockData[category] = {};
  const node = ensureTypedStructure(stockData[category], mainCat, types);
  const beforeQty = node.quantity;
  const changes = [];
  updates.forEach(({ type, newQty }) => {
    const oldQty = parseInt(node.details[type] || 0);
    if (newQty !== null && !isNaN(newQty) && newQty !== oldQty) {
      node.details[type] = newQty;
      changes.push({ type, name: typeToName[type], oldQty, newQty, diff: newQty - oldQty });
    }
  });
  if (!changes.length) throw new Error("Tidak ada perubahan yang diinput.");
  node.quantity = calculateTypedTotal(stockData[category], mainCat, types);
  const afterQty = node.quantity;
  node.lastUpdated = new Date().toISOString();
  const totalDiff = changes.reduce((a, c) => a + Math.abs(c.diff), 0);
  const netChange = changes.reduce((a, c) => a + c.diff, 0);
  const logAction = netChange > 0 ? "tambah" : netChange < 0 ? "kurangi" : "update";

  // Tentukan action untuk history berdasarkan netChange
  let historyAction;
  if (netChange > 0) {
    historyAction = "Tambah";
  } else if (netChange < 0) {
    historyAction = "Kurangi";
  } else {
    historyAction = "Update";
  }

  node.history.unshift({
    date: node.lastUpdated,
    action: historyAction,
    quantity: totalDiff,
    petugas,
    keterangan,
    items: changes.map((c) => ({
      jewelryType: c.type,
      jewelryName: c.name,
      quantity: c.diff,
      oldQuantity: c.oldQty,
      newQuantity: c.newQty,
    })),
  });
  if (node.history.length > 10) node.history = node.history.slice(0, 10);
  await saveData(category, mainCat);

  // Save to daily_stock_logs (total per lokasi)
  if (totalDiff > 0 && petugas && keterangan) {
    await saveStockLog({
      jenis: mainCat,
      lokasi: category,
      action: logAction,
      before: beforeQty,
      after: afterQty,
      quantity: Math.abs(netChange),
      userName: petugas,
      keterangan: keterangan,
    });
  }

  await populateTables();
}

// Wrapper untuk KALUNG yang memakai helper generic
async function updateStockKalungBulk(category, updates, petugas, keterangan) {
  return updateTypedBulk(category, "KALUNG", kalungColorTypes, kalungColorMapping, updates, petugas, keterangan);
}

// Wrapper untuk LIONTIN yang memakai helper generic
async function updateStockLiontinBulk(category, updates, petugas, keterangan) {
  return updateTypedBulk(category, "LIONTIN", liontinColorTypes, liontinColorMapping, updates, petugas, keterangan);
}

function calculateHalaTotal(categoryData, mainCat) {
  if (!categoryData[mainCat] || !categoryData[mainCat].details) {
    return 0;
  }

  let total = 0;
  halaJewelryTypes.forEach((type) => {
    total += parseInt(categoryData[mainCat].details[type] || 0);
  });

  return total;
}

// --- Tambahan fungsi untuk populate stok komputer
function populateStokKomputerTable() {
  const tbody = document.getElementById("stok-komputer-table-body");
  if (!tbody || !stockData["stok-komputer"]) return;
  tbody.innerHTML = "";
  mainCategories.forEach((mainCat, idx) => {
    const item = stockData["stok-komputer"][mainCat] || { quantity: 0, lastUpdated: null };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-bold" style="font-size:0.91rem;">${idx + 1}</td>
      <td class="fw-bold" style="font-size:0.91rem;">${mainCat}</td>
      <td class="text-center fw-bold" style="font-size:0.91rem;">${item.quantity}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-primary edit-komputer-btn" data-main="${mainCat}"><i class="fas fa-edit"></i> Update</button>
      </td>
      <td class="text-center text-muted small">${formatDate(item.lastUpdated)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// GANTI fungsi populateTables: tambahkan opsi { skipFetch } agar ketika dipanggil dari onSnapshot
// tidak memicu read ulang. Hindari showTableLoading berulang (hanya saat render pertama).
export async function populateTables(options = {}) {
  const { skipFetch = false } = options;

  try {
    // CSS pelindung (disuntik sekali)
    injectDropdownFixCssOnce();

    // Hanya tampilkan loading saat render pertama dan saat memang melakukan fetch
    if (!skipFetch && !populateTables._hasRendered) {
      showTableLoading();
    }

    // Ambil data stok (gunakan cache jika valid) KECUALI jika skipFetch diinstruksikan
    if (!skipFetch) {
      await fetchStockData();
    }

    // Render setiap main category dari in-memory stockData
    mainCategories.forEach((mainCat) => {
      const tbody = document.getElementById(mainCategoryToId[mainCat]);
      if (!tbody) return;

      // pastikan kontainer tabel tidak memotong dropdown
      tbody.style.overflow = "visible";
      tbody.innerHTML = "";

      subCategories.forEach((subCat, idx) => {
        const categoryKey = getCategoryKey(subCat);
        const stockItem =
          stockData[categoryKey] && stockData[categoryKey][mainCat]
            ? stockData[categoryKey][mainCat]
            : { quantity: 0, lastUpdated: null, history: [] };

        const tr = document.createElement("tr");

        // Semua kategori dan lokasi sekarang menggunakan tombol Update
        let actionColumn = "";

        // Tentukan tombol dan class berdasarkan kategori
        let btnClass = "";
        // Old logic (exact match):
        // if (mainCat === "HALA" || mainCat === "KENDARI" || mainCat === "BERLIAN" || mainCat === "SDW" || mainCat === "EMAS_BALI")

        // New logic: support new names like "HALA & SDW" and "KENDARI & EMAS BALI"
        if (
          mainCat.includes("HALA") ||
          mainCat.includes("KENDARI") ||
          mainCat.includes("BERLIAN") ||
          mainCat.includes("SDW") ||
          mainCat.includes("EMAS_BALI") ||
          mainCat === "BERLIAN"
        ) {
          btnClass = "update-hala-btn";
        } else if (mainCat === "KALUNG" || mainCat.includes("KALUNG")) {
          btnClass = "update-kalung-btn";
        } else if (mainCat === "LIONTIN" || mainCat.includes("LIONTIN")) {
          btnClass = "update-liontin-btn";
        } else {
          // ANTING, CINCIN, GELANG, GIWANG
          btnClass = "update-stock-btn";
        }

        actionColumn = `
          <td class="text-center">
            <button class="btn btn-success btn-sm ${btnClass}"
                    data-main="${mainCat}"
                    data-category="${categoryKey}"
                    data-subcategory="${subCat}">
              <i class="fas fa-edit"></i> Update
            </button>
          </td>
        `;

        tr.innerHTML = `
          <td class="fw-bold">${idx + 1}</td>
          <td class="fw-bold jenis-column" style="font-size: 0.9rem; color: #35393d;">
            <div class="d-flex justify-content-between align-items-center w-100">
              ${subCat} 
              ${
                // Old logic (exact match):
                // mainCat === "HALA" || mainCat === "KENDARI" || mainCat === "BERLIAN" || mainCat === "SDW" || mainCat === "EMAS_BALI"
                // New logic: support new names like "HALA & SDW" and "KENDARI & EMAS BALI"
                mainCat.includes("HALA") ||
                mainCat.includes("KENDARI") ||
                mainCat.includes("BERLIAN") ||
                mainCat.includes("SDW") ||
                mainCat.includes("EMAS") ||
                mainCat === "BERLIAN"
                  ? `<button class="btn btn-outline-primary btn-sm detail-hala-btn btn-hala" 
                              data-main="${mainCat}" data-category="${categoryKey}" 
                              title="Detail ${mainCat}">
                      <i class="fas fa-eye"></i>
                    </button>`
                  : ""
              }
              ${
                mainCat === "KALUNG" || mainCat.includes("KALUNG")
                  ? `<button class="btn btn-outline-primary btn-sm detail-kalung-btn ms-1" 
                              data-main="KALUNG" data-category="${categoryKey}" 
                              title="Detail Kalung">
                      <i class="fas fa-eye"></i>
                    </button>`
                  : ""
              }
              ${
                mainCat === "LIONTIN" || mainCat.includes("LIONTIN")
                  ? `<button class="btn btn-outline-primary btn-sm detail-liontin-btn ms-1" 
                              data-main="LIONTIN" data-category="${categoryKey}" 
                              title="Detail Liontin">
                      <i class="fas fa-eye"></i>
                    </button>`
                  : ""
              }
            </div>
          </td>
          <td class="text-center">
            <span class="badge bg-success fs-6 px-2 py-2">${stockItem.quantity}</span>
          </td>
          ${actionColumn}
          <td class="text-center">
            <button class="btn btn-info btn-sm show-history-btn"
                    data-main="${mainCat}"
                    data-category="${categoryKey}"
                    title="Lihat Riwayat">
              <i class="fas fa-history"></i>
            </button>
          </td>
          <td class="text-center text-muted small">${formatDate(stockItem.lastUpdated)}</td>
        `;

        // Animasi masuk: opacity saja
        tr.style.opacity = "0";
        tr.style.transition = "opacity .25s ease";
        const parent = tbody;
        parent.appendChild(tr);
        requestAnimationFrame(() => {
          tr.style.opacity = "1";
        });
      });
    });

    // Tabel stok komputer & ringkasan
    populateStokKomputerTable();
    updateSummaryTotals();

    // Listener sekali untuk mengangkat z-index
    if (!populateTables._dropdownRowElevatorBound) {
      document.body.addEventListener("shown.bs.dropdown", (ev) => {
        const row = ev.target.closest("tr");
        if (row) {
          row.style.position = "relative";
          row.style.zIndex = "3000";
        }
      });
      document.body.addEventListener("hidden.bs.dropdown", (ev) => {
        const row = ev.target.closest("tr");
        if (row) {
          row.style.zIndex = "";
          row.style.position = "";
        }
      });
      populateTables._dropdownRowElevatorBound = true;
    }

    // Tandai sudah pernah render (agar loading tidak ditampilkan lagi)
    populateTables._hasRendered = true;

    // Sembunyikan loading + notifikasi
    hideTableLoading();
  } catch (error) {
    console.error("Error populating tables (fixed):", error);
    hideTableLoading();
    showErrorMessage("Gagal memuat data tabel");
  }

  // ---- helper lokal: injeksi CSS sekali ---
  function injectDropdownFixCssOnce() {
    if (document.getElementById("dropdown-fix-css")) return;
    const style = document.createElement("style");
    style.id = "dropdown-fix-css";
    style.textContent = `
      /* cegah menu terpotong / ketiban */
      .table, .table-container, .tab-pane, .card, .card-body, .content-wrapper {
        overflow: visible !important;
      }
      .table .dropdown { position: relative; }
      .table .dropdown-menu { z-index: 2000 !important; }
    `;
    document.head.appendChild(style);
  }
}

function showTableLoading() {
  mainCategories.forEach((mainCat) => {
    const tbody = document.getElementById(mainCategoryToId[mainCat]);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-4">
            <div class="loading-spinner mx-auto mb-2"></div>
            <small class="text-muted">Memuat data...</small>
          </td>
        </tr>
      `;
    }
  });
}

function hideTableLoading() {
  // Tables will be populated by populateTables function
}

function showSuccessNotification(message) {
  const toast = document.createElement("div");
  toast.className = "toast-notification success";
  toast.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);

  // Show toast
  setTimeout(() => toast.classList.add("show"), 100);

  // Hide toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showErrorNotification(message) {
  const toast = document.createElement("div");
  toast.className = "toast-notification error";
  toast.innerHTML = `
    <i class="fas fa-exclamation-circle"></i>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);

  // Show toast
  setTimeout(() => toast.classList.add("show"), 100);

  // Hide toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

let komputerEditMainCat = "";

document.body.addEventListener("click", function (e) {
  const btn = e.target.closest && e.target.closest(".edit-komputer-btn");
  if (btn) {
    komputerEditMainCat = btn.dataset.main;
    if (komputerEditMainCat === "KALUNG" || komputerEditMainCat === "LIONTIN") {
      const disp = document.getElementById("jenisUpdateKomputerWarnaDisplay");
      const hid = document.getElementById("jenisUpdateKomputerWarna");
      if (disp) disp.value = komputerEditMainCat;
      if (hid) hid.value = komputerEditMainCat;
      document.querySelectorAll(".komputer-warna-qty-input").forEach((inp) => (inp.value = ""));
      $("#modalUpdateKomputerWarna").modal("show");
    } else {
      document.getElementById("updateKomputerJumlah").value =
        stockData["stok-komputer"][komputerEditMainCat]?.quantity || 0;
      document.getElementById("updateKomputerJenis").value = komputerEditMainCat;
      $("#modalUpdateKomputer").modal("show");
    }
  }
});

document.getElementById("formUpdateKomputer").onsubmit = async function (e) {
  e.preventDefault();
  const jumlah = document.getElementById("updateKomputerJumlah").value;
  const jenis = document.getElementById("updateKomputerJenis").value;
  if (!jumlah || !jenis) {
    alert("Jumlah harus diisi.");
    return;
  }
  await updateStokKomputer(jenis, jumlah, null);
  $("#modalUpdateKomputer").modal("hide");
};

const formUpdateKomputerWarna = document.getElementById("formUpdateKomputerWarna");
if (formUpdateKomputerWarna) {
  formUpdateKomputerWarna.onsubmit = async function (e) {
    e.preventDefault();
    try {
      const jenis = document.getElementById("jenisUpdateKomputerWarna").value || "";
      const inputs = Array.from(document.querySelectorAll(".komputer-warna-qty-input"));
      const details = inputs.reduce((acc, inp) => {
        const type = inp.dataset.type;
        const val = parseInt(inp.value || "0") || 0;
        if (type) acc[type] = val;
        return acc;
      }, {});
      const total = Object.values(details).reduce((sum, v) => sum + (parseInt(v) || 0), 0);
      if (!jenis) throw new Error("Jenis tidak valid");
      await updateStokKomputer(jenis, total, details);
      $("#modalUpdateKomputerWarna").modal("hide");
    } catch (err) {
      console.error("Gagal update stok komputer per warna", err);
      showErrorNotification("Gagal update stok komputer");
    }
  };
}

async function updateStokKomputer(jenis, jumlah, details) {
  await fetchStockData();
  if (!stockData["stok-komputer"]) return;
  if (!stockData["stok-komputer"][jenis]) {
    stockData["stok-komputer"][jenis] = { quantity: 0, lastUpdated: null };
  }
  const newQty = parseInt(jumlah);
  stockData["stok-komputer"][jenis].quantity = newQty;
  if (details && typeof details === "object") {
    stockData["stok-komputer"][jenis].details = { ...details };
  }
  stockData["stok-komputer"][jenis].lastUpdated = new Date().toISOString();
  await saveData("stok-komputer", jenis);
  await populateTables();
}

// === Update Stok Display/Manual ===
async function updateStokDisplayManual(category, mainCat, newQuantity, petugas, keterangan = "") {
  await fetchStockData();
  if (!stockData[category] || !stockData[category][mainCat]) {
    if (!stockData[category]) stockData[category] = {};
    stockData[category][mainCat] = { quantity: 0, lastUpdated: null, history: [] };
  }

  const item = stockData[category][mainCat];
  const oldQuantity = item.quantity;
  const newQty = parseInt(newQuantity);
  const beforeQty = oldQuantity;
  const afterQty = newQty;
  item.quantity = newQty;
  item.lastUpdated = new Date().toISOString();
  let actionType, quantityDiff, logAction;
  if (newQty > oldQuantity) {
    actionType = "Tambah";
    quantityDiff = newQty - oldQuantity;
    logAction = "tambah";
  } else if (newQty < oldQuantity) {
    actionType = "Kurangi";
    quantityDiff = oldQuantity - newQty;
    logAction = "kurangi";
  } else {
    actionType = "Update";
    quantityDiff = 0;
    logAction = "update";
  }
  item.history.unshift({
    date: item.lastUpdated,
    action: actionType,
    quantity: quantityDiff,
    oldQuantity: oldQuantity,
    newQuantity: newQty,
    petugas,
    keterangan: keterangan || undefined,
  });
  if (item.history.length > 10) item.history = item.history.slice(0, 10);

  await saveData(category, mainCat);

  // Save to daily_stock_logs
  if (quantityDiff > 0 && petugas && keterangan) {
    await saveStockLog({
      jenis: mainCat,
      lokasi: category,
      action: logAction,
      before: beforeQty,
      after: afterQty,
      quantity: quantityDiff,
      userName: petugas,
      keterangan: keterangan,
    });
  }

  await populateTables();
}

// === Update Status Ringkasan ===
function updateSummaryTotals() {
  mainCategories.forEach((mainCat) => {
    let total = 0;
    summaryCategories.forEach((cat) => {
      if (stockData[cat] && stockData[cat][mainCat]) total += parseInt(stockData[cat][mainCat].quantity) || 0;
    });
    let komputer = 0;
    if (stockData["stok-komputer"] && stockData["stok-komputer"][mainCat]) {
      komputer = parseInt(stockData["stok-komputer"][mainCat].quantity) || 0;
    }

    const totalEl = document.getElementById(totalCardId[mainCat]);
    const statusEl = document.getElementById(statusCardId[mainCat]);
    if (!totalEl) return;

    totalEl.textContent = total;

    if (total === komputer) {
      totalEl.className = "number text-success";
      if (statusEl) {
        statusEl.innerHTML = `<i class="fas fa-check-circle me-1"></i><span style="font-size: 0.9rem;">klop</span>`;
        statusEl.className = "text-dark fw-bold";
      }
    } else if (total < komputer) {
      totalEl.className = "number text-danger";
      if (statusEl) {
        statusEl.innerHTML = `<i class=\"fas fa-exclamation-triangle me-1\"></i><span style="font-size: 0.9rem;">Kurang ${
          komputer - total
        }</span>`;
        statusEl.className = "text-dark fw-bold";
      }
    } else {
      totalEl.className = "number text-primary";
      if (statusEl) {
        statusEl.innerHTML = `<i class=\"fas fa-arrow-up me-1\"></i><span style="font-size: 0.9rem;">Lebih ${
          total - komputer
        }</span>`;
        statusEl.className = "text-dark fw-bold";
      }
    }
  });
}

// === FUNGSI TIDAK DIPERLUKAN LAGI - SEMUA PAKAI UPDATE ===
// addStock() dan reduceStock() sudah tidak digunakan karena semua kategori pakai update

// === Fungsi untuk menampilkan detail HALA ===
function showHalaDetail(category, mainCat) {
  const modal = new bootstrap.Modal(document.getElementById("modalDetailHala"));
  const tbody = document.getElementById("hala-detail-table-body");
  const totalEl = document.getElementById("hala-detail-total");

  tbody.innerHTML = "";

  if (!stockData[category] || !stockData[category][mainCat] || !stockData[category][mainCat].details) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Tidak ada data detail</td></tr>`;
    totalEl.textContent = "0";
    return modal.show();
  }

  const details = stockData[category][mainCat].details;
  let total = 0;

  halaJewelryTypes.forEach((type, index) => {
    const quantity = parseInt(details[type] || 0);
    total += quantity;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${halaJewelryMapping[type]}</td>
      <td><span class="badge bg-primary">${type}</span></td>
      <td class="text-center"><strong>${quantity}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  totalEl.textContent = total;

  // Update modal title dengan kategori
  document.getElementById(
    "modalDetailHalaLabel"
  ).textContent = `Detail Stok ${mainCat} - ${reverseCategoryMapping[category]}`;

  modal.show();
}

// === Fungsi untuk menampilkan detail KALUNG ===
function showKalungDetail(category, mainCat) {
  const modal = new bootstrap.Modal(document.getElementById("modalDetailKalung"));
  const tbody = document.getElementById("kalung-detail-table-body");
  const totalEl = document.getElementById("kalung-detail-total");

  tbody.innerHTML = "";

  if (!stockData[category] || !stockData[category][mainCat] || !stockData[category][mainCat].details) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Tidak ada data detail</td></tr>`;
    totalEl.textContent = "0";
    return modal.show();
  }

  const details = stockData[category][mainCat].details;
  let total = 0;

  kalungColorTypes.forEach((type, index) => {
    const quantity = parseInt(details[type] || 0);
    total += quantity;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${kalungColorMapping[type]}</td>
      <td><span class="badge bg-primary">${type}</span></td>
      <td class="text-center"><strong>${quantity}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  totalEl.textContent = total;

  // Update modal title dengan kategori
  document.getElementById(
    "modalDetailKalungLabel"
  ).textContent = `Detail Stok KALUNG - ${reverseCategoryMapping[category]}`;

  modal.show();
}

// === Fungsi untuk menampilkan detail LIONTIN ===
function showLiontinDetail(category, mainCat) {
  const modal = new bootstrap.Modal(document.getElementById("modalDetailLiontin"));
  const tbody = document.getElementById("liontin-detail-table-body");
  const totalEl = document.getElementById("liontin-detail-total");

  tbody.innerHTML = "";

  if (!stockData[category] || !stockData[category][mainCat] || !stockData[category][mainCat].details) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Tidak ada data detail</td></tr>`;
    totalEl.textContent = "0";
    return modal.show();
  }

  const details = stockData[category][mainCat].details;
  let total = 0;

  liontinColorTypes.forEach((type, index) => {
    const quantity = parseInt(details[type] || 0);
    total += quantity;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${liontinColorMapping[type]}</td>
      <td><span class="badge bg-primary">${type}</span></td>
      <td class="text-center"><strong>${quantity}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  totalEl.textContent = total;

  document.getElementById(
    "modalDetailLiontinLabel"
  ).textContent = `Detail Stok LIONTIN - ${reverseCategoryMapping[category]}`;
  modal.show();
}

// === Event Listeners ===
document.body.addEventListener("click", function (e) {
  if (e.target.classList.contains("show-history-btn") || e.target.closest(".show-history-btn")) {
    // Mendukung klik icon di dalam button
    const btn = e.target.classList.contains("show-history-btn") ? e.target : e.target.closest(".show-history-btn");
    const mainCat = btn.dataset.main;
    const categoryKey = btn.dataset.category;
    showHistoryModal(categoryKey, mainCat);
  }
});

document.body.addEventListener("click", function (e) {
  if (e.target.classList.contains("show-history-btn") || e.target.closest(".show-history-btn")) {
    // Mendukung klik icon di dalam button
    const btn = e.target.classList.contains("show-history-btn") ? e.target : e.target.closest(".show-history-btn");
    const mainCat = btn.dataset.main;
    const categoryKey = btn.dataset.category;
    showHistoryModal(categoryKey, mainCat);
  }
});

function showHistoryModal(category, mainCat) {
  const titleEl = document.getElementById("riwayat-title");
  const tbody = document.getElementById("riwayat-table-body");
  const info = document.getElementById("riwayat-info");
  titleEl.textContent = `(${mainCat} - ${category})`;
  tbody.innerHTML = "";
  info.textContent = "";

  if (
    !stockData[category] ||
    !stockData[category][mainCat] ||
    !stockData[category][mainCat].history ||
    stockData[category][mainCat].history.length === 0
  ) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Tidak ada riwayat</td></tr>`;
    $("#modalRiwayat").modal("show");
    return;
  }

  const history = stockData[category][mainCat].history.slice(0, 10);
  history.forEach((record, i) => {
    const tr = document.createElement("tr");

    // Handle quantity display - always show oldQuantity → newQuantity format
    let quantityDisplay;
    if (record.oldQuantity !== undefined && record.newQuantity !== undefined) {
      quantityDisplay = `${record.oldQuantity} → ${record.newQuantity}`;
    } else {
      // Fallback for old data without these fields
      quantityDisplay = `${record.quantity || 0}`;
    }

    // Tambahan info untuk HALA (single atau bulk)
    let jewelryInfo = "";
    let keteranganText = record.keterangan || record.receiver || "-";

    if (record.items && Array.isArray(record.items)) {
      // Filter hanya items yang quantity-nya tidak 0 (benar-benar diupdate)
      const updatedItems = record.items.filter((it) => it.quantity !== 0);
      if (updatedItems.length > 0) {
        const list = updatedItems.map((it) => `${it.jewelryName}: ${it.quantity}`).join(", ");
        jewelryInfo = list;
        // Tambahkan ke keterangan jika ada
        if (keteranganText !== "-") {
          keteranganText = `${jewelryInfo} | ${keteranganText}`;
        } else {
          keteranganText = jewelryInfo;
        }
      }
    } else if (record.jewelryType && record.jewelryName) {
      jewelryInfo = `${record.jewelryName}`;
      // Tambahkan ke keterangan jika ada
      if (keteranganText !== "-") {
        keteranganText = `${jewelryInfo} | ${keteranganText}`;
      } else {
        keteranganText = jewelryInfo;
      }
    }

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${formatDate(record.date)}</td>
      <td>${quantityDisplay}</td>
      <td>${record.adder || record.pengurang || record.petugas || "-"}</td>
      <td>${keteranganText.toUpperCase()}</td>
    `;
    tbody.appendChild(tr);
  });

  if (stockData[category][mainCat].history.length > 10) {
    info.textContent = "Menampilkan 10 riwayat terbaru. Riwayat lama dihapus otomatis.";
  }
  $("#modalRiwayat").modal("show");
}

// === Event Delegation Untuk Tombol Tambah/Kurangi di Tabel ===
let currentMainCat = "";
let currentCategory = "";

document.body.addEventListener("click", function (e) {
  // Tambah stok HALA (khusus) — juga untuk KENDARI pada kategori brankas/posting
  // HANDLER INI SUDAH TIDAK DIPERLUKAN - SEMUA PAKAI UPDATE

  // Detail HALA
  if (e.target.classList.contains("detail-hala-btn") || e.target.closest(".detail-hala-btn")) {
    e.preventDefault();
    const btn = e.target.classList.contains("detail-hala-btn") ? e.target : e.target.closest(".detail-hala-btn");
    const mainCat = btn.dataset.main;
    const categoryKey = btn.dataset.category;
    // Ensure HALA-like detail structure exists for KENDARI as well
    (async () => {
      try {
        await fetchStockData();
        if (!stockData[categoryKey]) stockData[categoryKey] = {};
        initializeHalaStructure(stockData[categoryKey], mainCat);
      } catch (err) {
        // ignore init errors, show modal may still handle missing data
      }
      showHalaDetail(categoryKey, mainCat);
    })();
    return;
  }

  // Detail KALUNG
  if (e.target.classList.contains("detail-kalung-btn") || e.target.closest(".detail-kalung-btn")) {
    e.preventDefault();
    const btn = e.target.classList.contains("detail-kalung-btn") ? e.target : e.target.closest(".detail-kalung-btn");
    const mainCat = btn.dataset.main; // "KALUNG"
    const categoryKey = btn.dataset.category;
    (async () => {
      try {
        await fetchStockData();
        if (!stockData[categoryKey]) stockData[categoryKey] = {};
        ensureTypedStructure(stockData[categoryKey], mainCat, kalungColorTypes);
      } catch {}
      showKalungDetail(categoryKey, mainCat);
    })();
    return;
  }

  // Handler untuk update-kalung-btn
  if (e.target.classList.contains("update-kalung-btn") || e.target.closest(".update-kalung-btn")) {
    e.preventDefault();
    const btn = e.target.classList.contains("update-kalung-btn") ? e.target : e.target.closest(".update-kalung-btn");
    currentMainCat = "KALUNG";
    currentCategory = btn.dataset.category;
    (async () => {
      try {
        await fetchStockData();
        if (!stockData[currentCategory]) stockData[currentCategory] = {};
        const node = ensureTypedStructure(stockData[currentCategory], currentMainCat, kalungColorTypes);
        kalungColorTypes.forEach((t) => {
          const span = document.querySelector(`#modalUpdateStokKalung .current-stock[data-type="${t}"]`);
          const input = document.querySelector(`#modalUpdateStokKalung .kalung-update-qty-input[data-type="${t}"]`);
          const cur = node.details && node.details[t] !== undefined ? node.details[t] : 0;
          if (span) span.textContent = cur;
          if (input) input.value = cur; // Pre-fill dengan nilai saat ini
          if (input) input.placeholder = `(${cur})`;
        });
        const jenisDisplay = `${currentMainCat} - ${reverseCategoryMapping[currentCategory] || currentCategory}`;
        const disp = document.getElementById("jenisUpdateKalungDisplay");
        const hid = document.getElementById("jenisUpdateKalung");
        const title = document.getElementById("modalUpdateStokKalungLabel");
        if (disp) disp.value = jenisDisplay;
        if (hid) hid.value = currentCategory;
        if (title) title.textContent = `Update Stok ${jenisDisplay}`;
        const petugasInput = document.getElementById("petugasUpdateStokKalungBulk");
        if (petugasInput) petugasInput.value = "";
        const ket = document.getElementById("keteranganUpdateKalungBulk");
        if (ket) ket.value = "";
        $("#modalUpdateStokKalung").modal("show");
      } catch (err) {
        showErrorNotification("Gagal memuat stok KALUNG.");
      }
    })();
    return;
  }

  // Handler untuk update-liontin-btn
  if (e.target.classList.contains("update-liontin-btn") || e.target.closest(".update-liontin-btn")) {
    e.preventDefault();
    const btn = e.target.classList.contains("update-liontin-btn") ? e.target : e.target.closest(".update-liontin-btn");
    currentMainCat = "LIONTIN";
    currentCategory = btn.dataset.category;
    (async () => {
      try {
        await fetchStockData();
        if (!stockData[currentCategory]) stockData[currentCategory] = {};
        const node = ensureTypedStructure(stockData[currentCategory], currentMainCat, liontinColorTypes);
        liontinColorTypes.forEach((t) => {
          const span = document.querySelector(`#modalUpdateStokLiontin .current-stock[data-type="${t}"]`);
          const input = document.querySelector(`#modalUpdateStokLiontin .liontin-update-qty-input[data-type="${t}"]`);
          const cur = node.details && node.details[t] !== undefined ? node.details[t] : 0;
          if (span) span.textContent = cur;
          if (input) input.value = cur; // Pre-fill dengan nilai saat ini
          if (input) input.placeholder = `(${cur})`;
        });
        const jenisDisplay = `${currentMainCat} - ${reverseCategoryMapping[currentCategory] || currentCategory}`;
        document.getElementById("jenisUpdateLiontinDisplay").value = jenisDisplay;
        document.getElementById("jenisUpdateLiontin").value = currentCategory;
        document.getElementById("modalUpdateStokLiontinLabel").textContent = `Update Stok ${jenisDisplay}`;
        const petugasInput = document.getElementById("petugasUpdateStokLiontinBulk");
        if (petugasInput) petugasInput.value = "";
        const ket = document.getElementById("keteranganUpdateLiontinBulk");
        if (ket) ket.value = "";
        $("#modalUpdateStokLiontin").modal("show");
      } catch {
        showErrorNotification("Gagal memuat stok LIONTIN.");
      }
    })();
    return;
  }

  // Update stok Display/Manual (untuk ANTING, CINCIN, GELANG, GIWANG)
  if (e.target.classList.contains("update-stock-btn") || e.target.closest(".update-stock-btn")) {
    e.preventDefault();
    const btn = e.target.classList.contains("update-stock-btn") ? e.target : e.target.closest(".update-stock-btn");
    const mainCat = btn.dataset.main;
    const categoryKey = btn.dataset.category;
    const subCategory = btn.dataset.subcategory;

    // Populate modal dengan data saat ini
    const stockItem =
      stockData[categoryKey] && stockData[categoryKey][mainCat] ? stockData[categoryKey][mainCat] : { quantity: 0 };

    document.getElementById("updateStokMainCat").value = mainCat;
    document.getElementById("updateStokCategory").value = categoryKey;
    document.getElementById("updateStokJenis").value = `${mainCat} - ${subCategory}`;
    document.getElementById("updateStokJumlah").value = stockItem.quantity;
    // Reset field Nama Staf dan Keterangan (selalu tampil untuk semua kategori)
    const petugasInput = document.getElementById("updateStokPetugas");
    if (petugasInput) {
      petugasInput.value = "";
    }
    const keteranganSelect = document.getElementById("keteranganUpdateStok");
    if (keteranganSelect) {
      keteranganSelect.value = "";
    }

    $("#modalUpdateStok").modal("show");
  }
});

// === Handler Submit Modal Update Stok Display/Manual ===
document.getElementById("formUpdateStok").onsubmit = async function (e) {
  e.preventDefault();
  const submitBtn = document.getElementById("submitUpdateStokBtn");
  const originalText = submitBtn ? submitBtn.innerHTML : "";

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    }

    const mainCat = document.getElementById("updateStokMainCat").value;
    const category = document.getElementById("updateStokCategory").value;
    const jumlah = document.getElementById("updateStokJumlah").value;
    const petugas = document.getElementById("updateStokPetugas").value;
    const keterangan = document.getElementById("keteranganUpdateStok").value;

    if (!mainCat || !category || jumlah === "" || !petugas || !keterangan) {
      throw new Error("Semua field harus diisi.");
    }

    await updateStokDisplayManual(category, mainCat, jumlah, petugas, keterangan);
    showSuccessNotification(`Update ${mainCat} berhasil!`);
    $("#modalUpdateStok").modal("hide");
  } catch (err) {
    console.error("Gagal update stok:", err);
    alert(err.message || "Gagal update stok");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
};

// GANTI setupRealtimeListener: gunakan data snapshot langsung,
// tandai cache valid (set timestamp), lalu render tanpa fetch ulang.
function setupRealtimeListener() {
  const stocksRef = collection(firestore, "stocks");
  return onSnapshot(stocksRef, (snapshot) => {
    let updated = false;

    snapshot.docChanges().forEach((change) => {
      const cat = change.doc.id;
      const incoming = change.doc.data();
      if (!incoming) return;

      if (!stockData[cat]) {
        stockData[cat] = incoming;
        updated = true;
      } else {
        // Merge per main category, pilih node dengan lastUpdated terbaru
        const merged = { ...stockData[cat] };
        Object.keys(incoming).forEach((mainCat) => {
          const localNode = stockData[cat][mainCat];
          const remoteNode = incoming[mainCat];
          if (!localNode) {
            merged[mainCat] = remoteNode;
            updated = true;
          } else if (!remoteNode) {
            // keep local
          } else {
            const localTime = localNode.lastUpdated ? Date.parse(localNode.lastUpdated) : 0;
            const remoteTime = remoteNode.lastUpdated ? Date.parse(remoteNode.lastUpdated) : 0;
            merged[mainCat] = remoteTime >= localTime ? remoteNode : localNode;
            if (remoteTime >= localTime) updated = true;
          }
        });
        stockData[cat] = merged;
      }

      // Perbaikan penting: TANDAI cache valid, JANGAN dihapus agar fetch berikutnya tidak baca ulang
      stockCache.set(cat, stockData[cat]);
      stockCacheMeta.set(cat, Date.now());
    });

    if (updated) {
      // Render ulang dari in-memory TANPA fetch (performa lebih baik, no extra reads)
      populateTables({ skipFetch: true });
      // Persist cache ke localStorage
      updateCache();
    }
  });
}

// Cross-tab synchronization via localStorage `storage` event
function setupCrossTabSync() {
  window.addEventListener("storage", (e) => {
    if (e.key !== CACHE_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      const incomingAll = parsed?.data || {};
      let updated = false;
      Object.keys(incomingAll).forEach((cat) => {
        const incoming = incomingAll[cat];
        if (!incoming) return;
        if (!stockData[cat]) {
          stockData[cat] = incoming;
          updated = true;
        } else {
          const merged = { ...stockData[cat] };
          Object.keys(incoming).forEach((mainCat) => {
            const localNode = stockData[cat][mainCat];
            const remoteNode = incoming[mainCat];
            if (!localNode) {
              merged[mainCat] = remoteNode;
              updated = true;
            } else if (!remoteNode) {
              // keep local
            } else {
              const localTime = localNode.lastUpdated ? Date.parse(localNode.lastUpdated) : 0;
              const remoteTime = remoteNode.lastUpdated ? Date.parse(remoteNode.lastUpdated) : 0;
              merged[mainCat] = remoteTime >= localTime ? remoteNode : localNode;
              if (remoteTime >= localTime) updated = true;
            }
          });
          stockData[cat] = merged;
        }
        stockCache.set(cat, stockData[cat]);
        stockCacheMeta.set(cat, Date.now());
      });
      if (updated) {
        populateTables();
      }
    } catch (_) {
      // ignore malformed cache
    }
  });
}

// === INIT ===
document.addEventListener("DOMContentLoaded", async function () {
  try {
    initializeCache();
    await populateTables();
    setupRealtimeListener();
    setupCrossTabSync();

    // Populate staff dropdowns untuk semua form update
    if (typeof populateStaffDropdown === "function") {
      populateStaffDropdown("petugasUpdateStokKalungBulk");
      populateStaffDropdown("petugasUpdateStokLiontinBulk");
      populateStaffDropdown("petugasUpdateStokHalaBulk");
      populateStaffDropdown("updateStokPetugas");
    }
  } catch (error) {
    console.error("Error initializing:", error);
    showErrorMessage("Gagal memuat data. Silakan refresh halaman.");
  }
});

// === Handler Update HALA (baris -> buka modal, isi nilai, submit untuk update multi jenis) ===
document.body.addEventListener("click", async function (e) {
  if (e.target.classList.contains("update-hala-btn") || e.target.closest(".update-hala-btn")) {
    const btn = e.target.classList.contains("update-hala-btn") ? e.target : e.target.closest(".update-hala-btn");
    currentMainCat = btn.dataset.main; // should be 'HALA'
    currentCategory = btn.dataset.category;

    // Ambil data saat ini dan isi input pada modal Update HALA
    try {
      await fetchStockData();
      const item =
        stockData[currentCategory] && stockData[currentCategory][currentMainCat]
          ? stockData[currentCategory][currentMainCat]
          : { details: {} };
      // Isi current-stock span dan input value pada modalUpdateStokHala
      halaJewelryTypes.forEach((t) => {
        const span = document.querySelector(`#modalUpdateStokHala .current-stock[data-type="${t}"]`);
        const input = document.querySelector(`#modalUpdateStokHala .hala-update-qty-input[data-type="${t}"]`);
        if (span) span.textContent = item.details && item.details[t] !== undefined ? item.details[t] : 0;
        if (input) input.value = item.details && item.details[t] !== undefined ? item.details[t] : "";
      });

      const jenisDisplay = `${currentMainCat} - ${reverseCategoryMapping[currentCategory] || currentCategory}`;
      document.getElementById("jenisUpdateHalaDisplay").value = jenisDisplay;
      document.getElementById("jenisUpdateHala").value = currentCategory;
      document.getElementById("modalUpdateStokHalaLabel").textContent = `Update Stok ${jenisDisplay}`;
      const petugasInput = document.getElementById("petugasUpdateStokHalaBulk");
      if (petugasInput) petugasInput.value = "";
      $("#modalUpdateStokHala").modal("show");
    } catch (err) {
      console.error("Gagal buka modal update HALA", err);
      showErrorNotification("Gagal memuat data HALA");
    }
  }
});

// Submit handler untuk formUpdateStokHalaBulk — mengganti nilai semua jenis sekaligus
const formUpdateHala = document.getElementById("formUpdateStokHalaBulk");
if (formUpdateHala) {
  formUpdateHala.onsubmit = async function (e) {
    e.preventDefault();
    const submitBtn = document.getElementById("submitBulkUpdateHalaBtn");
    const originalText = submitBtn ? submitBtn.innerHTML : "";
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
      }
      const petugasInput = document.getElementById("petugasUpdateStokHalaBulk");
      const keterangan = document.getElementById("keteranganUpdateHalaBulk").value;
      const petugas = petugasInput ? petugasInput.value.trim() : "";
      if (!petugas) throw new Error("Nama staf harus diisi");
      if (!keterangan) throw new Error("Keterangan harus diisi");
      const category = document.getElementById("jenisUpdateHala").value;
      const mainCat = document.getElementById("jenisUpdateHalaDisplay").value.split(" - ")[0] || "HALA";

      await fetchStockData();
      if (!stockData[category]) stockData[category] = {};
      // Ensure the HALA structure exists and has .details initialized
      if (!stockData[category][mainCat] || !stockData[category][mainCat].details) {
        initializeHalaStructure(stockData[category], mainCat);
      }

      const item = stockData[category][mainCat] || { details: {} };
      const beforeQty = item.quantity;
      // Ambil nilai input (jika kosong, biarkan tidak diubah)
      const updates = [];
      const changes = [];
      halaJewelryTypes.forEach((t) => {
        const input = document.querySelector(`.hala-update-qty-input[data-type="${t}"]`);
        if (!input) return;
        const val = input.value;
        if (val === "") return; // kosong -> skip (tidak diubah)
        const newVal = parseInt(val || "0");
        if (isNaN(newVal) || newVal < 0) throw new Error("Nilai tidak valid");
        const oldVal = parseInt(item.details[t] || 0);
        updates.push({ type: t, qty: newVal });
        if (newVal !== oldVal) {
          changes.push({ type: t, oldQty: oldVal, newQty: newVal, diff: newVal - oldVal });
        }
      });

      if (updates.length === 0)
        throw new Error("Kosongkan kolom jika tidak ingin mengubah, atau isi minimal satu jenis.");

      // Terapkan update: set setiap details[type] = newVal
      updates.forEach((u) => {
        item.details[u.type] = u.qty;
      });
      // Recalculate total & lastUpdated & add history single entry
      item.quantity = calculateHalaTotal(stockData[category], mainCat);
      const afterQty = item.quantity;
      const totalDiff = changes.reduce((a, c) => a + Math.abs(c.diff), 0);
      const netChange = changes.reduce((a, c) => a + c.diff, 0);
      const logAction = netChange > 0 ? "tambah" : netChange < 0 ? "kurangi" : "update";

      // Tentukan action untuk history berdasarkan netChange
      let historyAction;
      if (netChange > 0) {
        historyAction = "Tambah";
      } else if (netChange < 0) {
        historyAction = "Kurangi";
      } else {
        historyAction = "Update";
      }

      item.lastUpdated = new Date().toISOString();
      item.history.unshift({
        date: item.lastUpdated,
        action: historyAction,
        quantity: totalDiff,
        petugas: petugas,
        keterangan,
        items: updates.map((it) => ({
          jewelryType: it.type,
          jewelryName: halaJewelryMapping[it.type],
          quantity: it.qty,
        })),
      });
      if (item.history.length > 10) item.history = item.history.slice(0, 10);

      await saveData(category, mainCat);

      // Save to daily_stock_logs (total per lokasi)
      if (totalDiff > 0 && petugas && keterangan) {
        await saveStockLog({
          jenis: mainCat,
          lokasi: category,
          action: logAction,
          before: beforeQty,
          after: afterQty,
          quantity: Math.abs(netChange),
          userName: petugas,
          keterangan: keterangan,
        });
      }

      await populateTables();
      showSuccessNotification(`Update ${mainCat} berhasil!`);
      $("#modalUpdateStokHala").modal("hide");
    } catch (err) {
      console.error(`Gagal update ${mainCat}`, err);
      showErrorNotification(err.message || `Gagal update ${mainCat}`);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  };
}

// Submit handler untuk formUpdateStokKalungBulk
const formUpdateKalung = document.getElementById("formUpdateStokKalungBulk");
if (formUpdateKalung) {
  formUpdateKalung.onsubmit = async function (e) {
    e.preventDefault();
    const submitBtn = document.getElementById("submitBulkKalungUpdateBtn");
    const originalText = submitBtn ? submitBtn.innerHTML : "";
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
      }

      const petugasInput = document.getElementById("petugasUpdateStokKalungBulk");
      const keterangan = document.getElementById("keteranganUpdateKalungBulk").value;
      const petugas = petugasInput ? petugasInput.value.trim() : "";

      if (!petugas) throw new Error("Nama staf harus diisi");
      if (!keterangan) throw new Error("Keterangan harus diisi");

      const category = currentCategory;
      const updates = [];

      kalungColorTypes.forEach((t) => {
        const input = document.querySelector(`#modalUpdateStokKalung .kalung-update-qty-input[data-type="${t}"]`);
        if (input && input.value !== "") {
          const newQty = parseInt(input.value);
          if (!isNaN(newQty) && newQty >= 0) {
            updates.push({ type: t, newQty });
          }
        }
      });

      if (updates.length === 0) {
        throw new Error("Minimal satu warna harus diubah");
      }

      await updateStockKalungBulk(category, updates, petugas, keterangan);
      showSuccessNotification("Update KALUNG berhasil!");
      $("#modalUpdateStokKalung").modal("hide");
    } catch (err) {
      console.error("Gagal update KALUNG", err);
      alert(err.message || "Gagal update KALUNG");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  };
}

// Submit handler untuk formUpdateStokLiontinBulk
const formUpdateLiontin = document.getElementById("formUpdateStokLiontinBulk");
if (formUpdateLiontin) {
  formUpdateLiontin.onsubmit = async function (e) {
    e.preventDefault();
    const submitBtn = document.getElementById("submitBulkLiontinUpdateBtn");
    const originalText = submitBtn ? submitBtn.innerHTML : "";
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
      }

      const petugasInput = document.getElementById("petugasUpdateStokLiontinBulk");
      const keterangan = document.getElementById("keteranganUpdateLiontinBulk").value;
      const petugas = petugasInput ? petugasInput.value.trim() : "";

      if (!petugas) throw new Error("Nama staf harus diisi");
      if (!keterangan) throw new Error("Keterangan harus diisi");

      const category = currentCategory;
      const updates = [];

      liontinColorTypes.forEach((t) => {
        const input = document.querySelector(`#modalUpdateStokLiontin .liontin-update-qty-input[data-type="${t}"]`);
        if (input && input.value !== "") {
          const newQty = parseInt(input.value);
          if (!isNaN(newQty) && newQty >= 0) {
            updates.push({ type: t, newQty });
          }
        }
      });

      if (updates.length === 0) {
        throw new Error("Minimal satu warna harus diubah");
      }

      await updateStockLiontinBulk(category, updates, petugas, keterangan);
      showSuccessNotification("Update LIONTIN berhasil!");
      $("#modalUpdateStokLiontin").modal("hide");
    } catch (err) {
      console.error("Gagal update LIONTIN", err);
      alert(err.message || "Gagal update LIONTIN");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  };
}

function showErrorMessage(message) {
  alert(message);
}

// Reset on hide
document.addEventListener("hide.bs.dropdown", function (event) {
  const dropdownMenu = event.target.nextElementSibling;
  if (dropdownMenu && dropdownMenu.classList.contains("dropdown-menu")) {
    // Reset styles
    dropdownMenu.style.position = "";
    dropdownMenu.style.left = "";
    dropdownMenu.style.top = "";
    dropdownMenu.style.minWidth = "";
  }
});

// === DAILY SNAPSHOT (AUTO) INTEGRATION ===

function formatDateKeySnapshot(date) {
  const d = new Date(date);
  if (isNaN(d)) return null;
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function getNowInWita() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 60 * 60000); // UTC+8
}

function computeCurrentSummarySnapshotForDaily() {
  const snapshot = { items: {}, breakdown: {} };

  mainCategories.forEach((mainCat) => {
    const categoryBreakdown = {};
    let totalAcrossAllDocs = 0;

    summaryCategories.forEach((cat) => {
      const node = stockData[cat] && stockData[cat][mainCat];
      if (!node) {
        categoryBreakdown[cat] = { total: 0 };
        return;
      }

      // Handle KALUNG with color details
      if (mainCat === "KALUNG" && node.details) {
        const colorBreakdown = {};
        let catTotal = 0;
        kalungColorTypes.forEach((color) => {
          const qty = parseInt(node.details[color]) || 0;
          colorBreakdown[color] = qty;
          catTotal += qty;
        });
        categoryBreakdown[cat] = { total: catTotal, details: colorBreakdown };
        totalAcrossAllDocs += catTotal;
      }
      // Handle LIONTIN with color details
      else if (mainCat === "LIONTIN" && node.details) {
        const colorBreakdown = {};
        let catTotal = 0;
        liontinColorTypes.forEach((color) => {
          const qty = parseInt(node.details[color]) || 0;
          colorBreakdown[color] = qty;
          catTotal += qty;
        });
        categoryBreakdown[cat] = { total: catTotal, details: colorBreakdown };
        totalAcrossAllDocs += catTotal;
      }
      // Handle HALA with jewelry type details
      else if (mainCat === "HALA" && node.details) {
        const halaBreakdown = {};
        let catTotal = 0;
        halaJewelryTypes.forEach((type) => {
          const qty = parseInt(node.details[type]) || 0;
          halaBreakdown[type] = qty;
          catTotal += qty;
        });
        categoryBreakdown[cat] = { total: catTotal, details: halaBreakdown };
        totalAcrossAllDocs += catTotal;
      }
      // Handle other categories (simple quantity)
      else {
        const qty = parseInt(node.quantity) || 0;
        categoryBreakdown[cat] = { total: qty };
        totalAcrossAllDocs += qty;
      }
    });

    snapshot.breakdown[mainCat] = categoryBreakdown;
    let komputer = 0;
    if (stockData["stok-komputer"] && stockData["stok-komputer"][mainCat]) {
      komputer = parseInt(stockData["stok-komputer"][mainCat].quantity) || 0;
    }

    let status;
    if (totalAcrossAllDocs === komputer) status = "Klop";
    else if (totalAcrossAllDocs < komputer) status = `Kurang ${komputer - totalAcrossAllDocs}`;
    else status = `Lebih ${totalAcrossAllDocs - komputer}`;

    snapshot.items[mainCat] = { total: totalAcrossAllDocs, komputer, status };
  });

  return snapshot;
}

async function loadDailySnapshotDoc(dateObj) {
  const dateKey = formatDateKeySnapshot(dateObj);
  if (!dateKey) return null;
  try {
    const ref = doc(firestore, "daily_stock_reports", dateKey);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

async function saveDailySnapshotDoc(dateObj, { backfilled = false } = {}) {
  const dateKey = formatDateKeySnapshot(dateObj);
  if (!dateKey) return;
  const needed = [
    "brankas",
    "posting",
    "barang-display",
    "barang-rusak",
    "batu-lepas",
    "manual",
    "admin",
    "DP",
    "lainnya",
    "stok-komputer",
  ];
  const allValid = needed.every(isCacheValid);
  if (!allValid || Object.keys(stockData).length === 0) {
    await fetchStockData(false);
  }

  const snapshotData = computeCurrentSummarySnapshotForDaily();
  const payload = {
    date: dateKey,
    createdAt: new Date().toISOString(),
    items: snapshotData.items,
    breakdown: snapshotData.breakdown,
  };
  if (backfilled) payload.backfilled = true;

  const ref = doc(firestore, "daily_stock_reports", dateKey);
  await setDoc(ref, payload, { merge: true });
  return payload;
}

async function ensureYesterdaySnapshotIfMissingFromManagement() {
  const nowWita = getNowInWita();
  const yesterday = new Date(getNowInWita().getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = formatDateKeySnapshot(yesterday);
  const existing = await loadDailySnapshotDoc(yesterday);
  if (!existing) {
    try {
      await saveDailySnapshotDoc(yesterday, { backfilled: true });
      showSuccessNotification(`Snapshot backfill (${yesterdayKey}) dibuat`);
    } catch (e) {
      console.warn("Gagal membuat snapshot backfill kemarin", e);
    }
  }
}

async function ensureTodaySnapshotIfPassedFromManagement() {
  const nowWita = getNowInWita();
  const target = new Date(nowWita);
  target.setHours(23, 0, 0, 0);
  if (nowWita >= target) {
    const existing = await loadDailySnapshotDoc(nowWita);
    if (!existing) {
      try {
        await saveDailySnapshotDoc(nowWita);
        showSuccessNotification("Snapshot otomatis (23:00 WITA) dibuat");
      } catch (e) {
        console.warn("Gagal membuat snapshot otomatis hari ini", e);
      }
    }
  }
}

function scheduleNextDailySnapshotFromManagement() {
  const nowWita = getNowInWita();
  const next = new Date(nowWita);
  next.setHours(23, 0, 0, 0);
  if (nowWita >= next) next.setDate(next.getDate() + 1);
  const delay = next - nowWita;
  setTimeout(async () => {
    try {
      await saveDailySnapshotDoc(getNowInWita());
      showSuccessNotification("Snapshot otomatis (23:00 WITA) dibuat");
    } catch (e) {
      console.warn("Gagal snapshot terjadwal", e);
    } finally {
      scheduleNextDailySnapshotFromManagement();
    }
  }, delay);
}

async function triggerDailySnapshotsFromManagement() {
  try {
    await ensureYesterdaySnapshotIfMissingFromManagement();
    await ensureTodaySnapshotIfPassedFromManagement();
    scheduleNextDailySnapshotFromManagement();
  } catch (e) {
    console.warn("Gagal inisialisasi mekanisme snapshot harian", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    triggerDailySnapshotsFromManagement();
  }, 1500);
});
