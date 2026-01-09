import { firestore } from "./configFirebase.js";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

const CACHE_KEY = "kodeDataCache";
const CACHE_TTL_STANDARD = 60 * 60 * 1000; // 1 jam untuk data historis
const CACHE_TTL_TODAY = 5 * 60 * 1000; // 5 menit untuk data yang mungkin berubah
const CACHE_VERSION = "v4.0"; // Update versi untuk sistem cache baru

// Cache storage dengan Map untuk performa lebih baik
const kodeDataCache = new Map();
const kodeDataCacheMeta = new Map();

// Variabel untuk real-time listener dan tracking sumber data
let unsubscribeListener = null;
let currentDataSource = null;

// Variabel untuk DataTable instance
let mutatedDataTable = null;

// Variabel untuk debounce save to storage
let saveToStorageTimeout = null;
const SAVE_DEBOUNCE_MS = 1000; // 1 detik

// Maximum size untuk localStorage (5MB default limit di browser)
const MAX_STORAGE_SIZE = 4 * 1024 * 1024; // 4MB untuk safety margin

// Fungsi untuk mendapatkan tanggal hari ini dalam format string
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Fungsi untuk memeriksa apakah cache masih valid
function isCacheValid(cacheKey) {
  const timestamp = kodeDataCacheMeta.get(cacheKey);
  if (!timestamp) return false;

  const now = Date.now();
  const lastUpdate = timestamp;

  // Jika cache key mencakup hari ini, gunakan TTL yang lebih pendek
  const today = getLocalDateString();
  if (cacheKey.includes(today)) {
    return now - lastUpdate < CACHE_TTL_TODAY;
  }

  // Untuk data historis, gunakan TTL standar
  return now - lastUpdate < CACHE_TTL_STANDARD;
}

// Fungsi untuk menyimpan data ke cache
function saveToCache(data, source, cacheKey = CACHE_KEY) {
  try {
    // Simpan ke Map cache
    kodeDataCache.set(cacheKey, {
      data: data,
      source: source,
      version: CACHE_VERSION,
    });

    // Update timestamp
    kodeDataCacheMeta.set(cacheKey, Date.now());

    // Debounce save to localStorage untuk menghindari terlalu sering write
    if (saveToStorageTimeout) {
      clearTimeout(saveToStorageTimeout);
    }
    saveToStorageTimeout = setTimeout(() => {
      saveCacheToStorage();
    }, SAVE_DEBOUNCE_MS);
  } catch (error) {
    console.error("Error saving to cache:", error);
  }
}

// Fungsi untuk mengambil data dari cache
function getFromCache(cacheKey = CACHE_KEY) {
  try {
    // Cek di Map cache terlebih dahulu
    if (kodeDataCache.has(cacheKey) && isCacheValid(cacheKey)) {
      const cached = kodeDataCache.get(cacheKey);
      if (cached.version === CACHE_VERSION) {
        currentDataSource = cached.source;
        return cached.data;
      }
    }

    // Fallback ke localStorage
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      const { data, version, source, timestamp } = JSON.parse(cachedData);
      if (version === CACHE_VERSION) {
        const now = Date.now();
        const isValid = now - timestamp < CACHE_TTL_STANDARD;

        if (isValid) {
          currentDataSource = source;

          // Restore ke Map cache
          kodeDataCache.set(cacheKey, { data, source, version });
          kodeDataCacheMeta.set(cacheKey, timestamp);

          return data;
        }
      }

      // Hapus cache yang tidak valid
      localStorage.removeItem(cacheKey);
    }

    return null;
  } catch (error) {
    console.error("Error getting from cache:", error);
    return null;
  }
}

// Fungsi untuk menyimpan cache ke localStorage
function saveCacheToStorage() {
  try {
    kodeDataCache.forEach((value, key) => {
      try {
        const timestamp = kodeDataCacheMeta.get(key) || Date.now();
        const cacheData = {
          timestamp: timestamp,
          version: CACHE_VERSION,
          data: value.data,
          source: value.source,
        };
        localStorage.setItem(key, JSON.stringify(cacheData));
      } catch (itemError) {
        // Skip item yang gagal (quota exceeded, corrupt data, dll)
        console.warn(`Skipping cache save for ${key}:`, itemError.message);
        // Auto-cleanup jika quota exceeded
        if (itemError.name === "QuotaExceededError" || itemError.code === 22) {
          console.warn("localStorage full, clearing old cache...");
          clearOldCache();
        }
      }
    });
  } catch (error) {
    console.error("Error saving cache to storage:", error.message);
    // Tidak melakukan retry atau rekursi - biarkan gagal gracefully
  }
}

// Fungsi untuk membersihkan cache lama
function clearOldCache() {
  const now = Date.now();
  const keysToDelete = [];

  kodeDataCacheMeta.forEach((timestamp, key) => {
    if (now - timestamp > CACHE_TTL_STANDARD) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => {
    kodeDataCache.delete(key);
    kodeDataCacheMeta.delete(key);
    localStorage.removeItem(key);
  });
}

// Fungsi untuk memuat cache dari localStorage saat startup
function loadCacheFromStorage() {
  try {
    // Scan localStorage untuk cache yang valid
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes("kode")) {
        try {
          const cachedData = localStorage.getItem(key);
          if (cachedData) {
            const { data, version, source, timestamp } = JSON.parse(cachedData);
            if (version === CACHE_VERSION) {
              const now = Date.now();
              const isValid = now - timestamp < CACHE_TTL_STANDARD;

              if (isValid) {
                kodeDataCache.set(key, { data, source, version });
                kodeDataCacheMeta.set(key, timestamp);
              } else {
                localStorage.removeItem(key);
              }
            } else {
              localStorage.removeItem(key);
            }
          }
        } catch (parseError) {
          console.error(`Error parsing cache for key ${key}:`, parseError);
          localStorage.removeItem(key);
        }
      }
    }
  } catch (error) {
    console.error("Error loading cache from storage:", error);
  }
}

// ===== END CACHE MANAGEMENT =====

// Fungsi utility untuk alert dan konfirmasi
function showAlert(message, title = "Informasi", type = "info") {
  return Swal.fire({
    title: title,
    text: message,
    icon: type,
    confirmButtonText: "OK",
    confirmButtonColor: "#0d6efd",
  });
}

function showConfirm(message, title = "Konfirmasi") {
  return Swal.fire({
    title: title,
    text: message,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Ya",
    cancelButtonText: "Batal",
    confirmButtonColor: "#0d6efd",
    cancelButtonColor: "#6c757d",
  }).then((result) => result.isConfirmed);
}

// Definisi jenis barang
const jenisBarang = {
  C: "Cincin",
  K: "Kalung",
  L: "Liontin",
  A: "Anting",
  G: "Gelang",
  S: "Giwang",
  Z: "HALA",
  V: "HALA",
};

// State untuk menyimpan data kode
let kodeData = {
  active: [],
  mutated: [],
};

// State untuk menyimpan kode yang dipilih
let selectedKodes = {
  active: new Set(),
  mutated: new Set(),
};

// Fungsi untuk memproses data dari penjualanAksesoris
function processPenjualanData(docs) {
  const processedData = {
    active: [],
    mutated: [],
  };

  docs.forEach((doc) => {
    const data = { id: doc.id, ...doc.data() };

    // Filter hanya penjualan manual dengan items yang memiliki kode
    if (data.jenisPenjualan !== "manual" || !data.items || !Array.isArray(data.items)) {
      return;
    }

    // Proses setiap item dalam transaksi
    data.items.forEach((item, index) => {
      // Skip item yang tidak memiliki kode atau kode kosong
      if (!item.kodeText || item.kodeText === "-" || !item.kodeText.trim()) {
        return;
      }

      const kode = item.kodeText.trim();
      const prefix = kode.charAt(0).toUpperCase();

      if (!(prefix in jenisBarang)) {
        return;
      }

      // Buat objek kode dengan struktur yang konsisten
      const kodeItem = {
        id: `${data.id}_${index}`, // ID unik untuk setiap item
        kode: kode,
        nama: item.nama || "Tidak ada nama",
        kadar: item.kadar || "-",
        berat: item.berat || 0,
        tanggalInput: data.tanggal || formatTimestamp(data.timestamp),
        keterangan: item.keterangan || "",
        jenisPrefix: prefix,
        jenisNama: jenisBarang[prefix],
        penjualanId: data.id,
        isMutated: false, // Data dari penjualan selalu aktif
        tanggalMutasi: null,
        mutasiKeterangan: "",
        mutasiHistory: [],
        // Metadata tambahan
        timestamp: data.timestamp,
        lastUpdated: data.timestamp,
        sales: data.sales || "",
        hargaPerGram: item.hargaPerGram || 0,
        totalHarga: item.totalHarga || 0,
      };

      // Semua data dari penjualanAksesoris dianggap aktif
      processedData.active.push(kodeItem);
    });
  });

  return processedData;
}

// Fungsi untuk memproses data dari mutasiKode
function processMutasiKodeData(docs) {
  const processedData = {
    active: [],
    mutated: [],
  };

  docs.forEach((doc) => {
    const data = { id: doc.id, ...doc.data() };

    if (!data.kode || !data.namaBarang) {
      return;
    }

    const prefix = data.kode.charAt(0).toUpperCase();

    if (!(prefix in jenisBarang)) {
      return;
    }

    // Buat objek kode dengan struktur yang konsisten
    const kodeItem = {
      id: data.id,
      kode: data.kode,
      nama: data.namaBarang || "Tidak ada nama",
      kadar: data.kadar || "-",
      berat: data.berat || 0,
      tanggalInput: data.tanggalInput || formatTimestamp(data.timestamp || data.createdAt),
      keterangan: data.keterangan || "",
      jenisPrefix: prefix,
      jenisNama: jenisBarang[prefix],
      penjualanId: data.penjualanId || data.id,
      isMutated: data.isMutated || false,
      tanggalMutasi: data.tanggalMutasi || null,
      mutasiKeterangan: data.mutasiKeterangan || "",
      mutasiHistory: data.mutasiHistory || [],
      // Metadata tambahan
      timestamp: data.timestamp || data.createdAt,
      lastUpdated: data.lastUpdated || data.timestamp || data.createdAt,
      sales: data.sales || "",
      hargaPerGram: data.hargaPerGram || 0,
      totalHarga: data.totalHarga || 0,
    };

    // Tambahkan ke array yang sesuai berdasarkan status mutasi
    if (kodeItem.isMutated) {
      processedData.mutated.push(kodeItem);
    } else {
      processedData.active.push(kodeItem);
    }
  });

  return processedData;
}

// Fungsi untuk mengambil data dari penjualanAksesoris
async function loadFromPenjualanAksesoris() {
  try {
    // Query untuk mengambil data penjualan manual
    const penjualanQuery = query(
      collection(firestore, "penjualanAksesoris"),
      where("jenisPenjualan", "==", "manual"),
      orderBy("timestamp", "desc")
    );

    const querySnapshot = await getDocs(penjualanQuery);

    if (querySnapshot.empty) {
      return null;
    }

    // Proses data yang diterima
    const processedData = processPenjualanData(querySnapshot.docs);

    // Filter hanya yang memiliki kode
    const totalItems = processedData.active.length + processedData.mutated.length;

    if (totalItems === 0) {
      return null;
    }

    currentDataSource = "penjualanAksesoris";

    return processedData;
  } catch (error) {
    console.error("Error loading from penjualanAksesoris:", error);
    return null;
  }
}

// Fungsi untuk mengambil data dari mutasiKode
async function loadFromMutasiKode() {
  try {
    const mutasiKodeQuery = query(collection(firestore, "mutasiKode"), orderBy("timestamp", "desc"));

    const querySnapshot = await getDocs(mutasiKodeQuery);

    if (querySnapshot.empty) {
      return {
        active: [],
        mutated: [],
      };
    }

    const processedData = processMutasiKodeData(querySnapshot.docs);
    currentDataSource = "mutasiKode";

    return processedData;
  } catch (error) {
    console.error("Error loading from mutasiKode:", error);
    throw error;
  }
}

// Fungsi utama untuk memuat data dengan sistem cache yang diperbaiki
async function loadKodeData(forceRefresh = false) {
  try {
    // Buat cache key berdasarkan tanggal dan sumber data
    const today = getLocalDateString();
    const cacheKey = `${CACHE_KEY}_${today}`;

    // Cek cache jika tidak force refresh
    if (!forceRefresh && isCacheValid(cacheKey)) {
      const cachedData = getFromCache(cacheKey);
      if (cachedData) {
        kodeData = cachedData;
        updateKodeDisplay();
        updateCounters();
        updateDataSourceIndicator();
        return;
      }
    }

    const loadingToast = Swal.fire({
      title: "Memuat Data",
      text: "Mengambil data dari server...",
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });

    let loadedData = null;

    // Prioritas 1: mutasiKode (data yang sudah diduplikasi)
    loadedData = await loadFromMutasiKode();

    // Prioritas 2: fallback ke penjualanAksesoris jika mutasiKode kosong
    if (!loadedData || (loadedData.active.length === 0 && loadedData.mutated.length === 0)) {
      const fallbackData = await loadFromPenjualanAksesoris();
      if (fallbackData) {
        loadedData = fallbackData;
      }
    }

    kodeData = loadedData || { active: [], mutated: [] };
    sortKodeData();

    // Simpan ke cache dengan key yang sesuai
    saveToCache(kodeData, currentDataSource, cacheKey);

    updateKodeDisplay();
    updateCounters();
    updateDataSourceIndicator();
    loadingToast.close();
  } catch (error) {
    console.error("Error loading kode data:", error);
    Swal.close();

    // Coba gunakan cache sebagai fallback jika terjadi error
    const today = getLocalDateString();
    const cacheKey = `${CACHE_KEY}_${today}`;
    const cachedData = getFromCache(cacheKey);

    if (cachedData) {
      kodeData = cachedData;
      updateKodeDisplay();
      updateCounters();
      updateDataSourceIndicator();
      showAlert("Data dimuat dari cache karena terjadi kesalahan koneksi", "Peringatan", "warning");
    } else {
      showAlert("Gagal memuat data kode: " + error.message, "Error", "error");
    }
  }
}

// Fungsi untuk parse tanggal format DD/MM/YYYY ke Date object
function parseDateDDMMYYYY(dateString) {
  if (!dateString || dateString === "-") return new Date(0);
  const parts = dateString.split("/");
  if (parts.length !== 3) return new Date(dateString);
  // parts[0] = day, parts[1] = month, parts[2] = year
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

// Fungsi untuk mengurutkan data
function sortKodeData() {
  // Urutkan data aktif berdasarkan timestamp terbaru
  kodeData.active.sort((a, b) => {
    let timeA, timeB;

    if (a.timestamp?.toDate) {
      timeA = a.timestamp.toDate();
    } else if (a.tanggalInput) {
      timeA = parseDateDDMMYYYY(a.tanggalInput);
    } else {
      timeA = new Date(0);
    }

    if (b.timestamp?.toDate) {
      timeB = b.timestamp.toDate();
    } else if (b.tanggalInput) {
      timeB = parseDateDDMMYYYY(b.tanggalInput);
    } else {
      timeB = new Date(0);
    }

    return timeB - timeA;
  });

  // Urutkan data mutated berdasarkan tanggal mutasi terbaru
  kodeData.mutated.sort((a, b) => {
    let timeA, timeB;

    // Prioritas: lastUpdated > tanggalMutasi > tanggalInput
    if (a.lastUpdated?.toDate) {
      timeA = a.lastUpdated.toDate();
    } else if (a.tanggalMutasi) {
      timeA = parseDateDDMMYYYY(a.tanggalMutasi);
    } else if (a.tanggalInput) {
      timeA = parseDateDDMMYYYY(a.tanggalInput);
    } else {
      timeA = new Date(0);
    }

    if (b.lastUpdated?.toDate) {
      timeB = b.lastUpdated.toDate();
    } else if (b.tanggalMutasi) {
      timeB = parseDateDDMMYYYY(b.tanggalMutasi);
    } else if (b.tanggalInput) {
      timeB = parseDateDDMMYYYY(b.tanggalInput);
    } else {
      timeB = new Date(0);
    }

    return timeB - timeA;
  });
}

// Fungsi untuk update indikator sumber data
function updateDataSourceIndicator() {
  const indicator = $("#dataSourceIndicator");
  if (indicator.length === 0) {
    // Buat indikator jika belum ada
    $(".page-header").append(`
      <div id="dataSourceIndicator" class="mt-2">
        <small class="text-muted">
          <i class="fas fa-database me-1"></i>
          Sumber data: <span id="dataSourceText">-</span>
          <span id="cacheIndicator" class="ms-2 badge bg-info" style="display: none;"></span>
        </small>
      </div>
    `);
  }

  const sourceText = currentDataSource === "penjualanAksesoris" ? "Transaksi Penjualan" : "Mutasi Kode";
  const sourceColor = currentDataSource === "penjualanAksesoris" ? "text-success" : "text-info";

  $("#dataSourceText").text(sourceText).removeClass("text-success text-info").addClass(sourceColor);

  // Tampilkan indikator cache jika menggunakan data cache
  const today = getLocalDateString();
  const cacheKey = `${CACHE_KEY}_${today}`;
  if (kodeDataCache.has(cacheKey)) {
    const cacheTime = new Date(kodeDataCacheMeta.get(cacheKey));
    const formattedTime = cacheTime.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
    $("#cacheIndicator").text(`Cache (${formattedTime})`).show();
  } else {
    $("#cacheIndicator").hide();
  }
}

// Fungsi untuk setup real-time listener dengan cache management
function setupRealtimeListener() {
  try {
    // Hapus listener sebelumnya jika ada
    if (unsubscribeListener) {
      unsubscribeListener();
    }

    // Setup listener berdasarkan sumber data yang sedang digunakan
    if (currentDataSource === "penjualanAksesoris") {
      const penjualanQuery = query(
        collection(firestore, "penjualanAksesoris"),
        where("jenisPenjualan", "==", "manual"),
        orderBy("timestamp", "desc")
      );

      unsubscribeListener = onSnapshot(
        penjualanQuery,
        (snapshot) => {
          if (snapshot.metadata.hasPendingWrites) return;

          if (kodeData.active.length === 0 && kodeData.mutated.length === 0) {
            const processedData = processPenjualanData(snapshot.docs);
            kodeData = processedData;
            sortKodeData();
          } else {
            handlePenjualanChanges(snapshot.docChanges());
          }

          updateKodeDisplay();
          updateCounters();
          saveToCache(kodeData, currentDataSource, `${CACHE_KEY}_${getLocalDateString()}`);
        },
        (error) => {
          console.error("Real-time listener error for penjualanAksesoris:", error);
          setTimeout(() => loadKodeData(true), 5000);
        }
      );
    } else {
      const mutasiKodeQuery = query(collection(firestore, "mutasiKode"), orderBy("timestamp", "desc"));

      unsubscribeListener = onSnapshot(
        mutasiKodeQuery,
        (snapshot) => {
          if (snapshot.metadata.hasPendingWrites) return;

          if (kodeData.active.length === 0 && kodeData.mutated.length === 0) {
            kodeData = processMutasiKodeData(snapshot.docs);
            sortKodeData();
          } else {
            handleMutasiKodeChanges(snapshot.docChanges());
          }

          updateKodeDisplay();
          updateCounters();
          saveToCache(kodeData, currentDataSource, `${CACHE_KEY}_${getLocalDateString()}`);
        },
        (error) => {
          console.error("Real-time listener error for mutasiKode:", error);
          setTimeout(() => loadKodeData(true), 5000);
        }
      );
    }
  } catch (error) {
    console.error("Error setting up real-time listener:", error);
  }
}

// Handle incremental changes dari penjualanAksesoris
function handlePenjualanChanges(changes) {
  changes.forEach((change) => {
    const docData = { id: change.doc.id, ...change.doc.data() };

    if (change.type === "added" || change.type === "modified") {
      // Process items dari transaksi
      if (docData.jenisPenjualan === "manual" && docData.items) {
        docData.items.forEach((item, index) => {
          if (!item.kodeText || item.kodeText === "-") return;

          const itemId = `${docData.id}_${index}`;
          const prefix = item.kodeText.charAt(0).toUpperCase();

          if (!(prefix in jenisBarang)) return;

          const kodeItem = {
            id: itemId,
            kode: item.kodeText.trim(),
            nama: item.nama || "Tidak ada nama",
            kadar: item.kadar || "-",
            berat: item.berat || 0,
            tanggalInput: docData.tanggal || formatTimestamp(docData.timestamp),
            keterangan: item.keterangan || "",
            jenisPrefix: prefix,
            jenisNama: jenisBarang[prefix],
            penjualanId: docData.id,
            isMutated: false,
            tanggalMutasi: null,
            mutasiKeterangan: "",
            mutasiHistory: [],
            timestamp: docData.timestamp,
            lastUpdated: docData.timestamp,
            sales: docData.sales || "",
            hargaPerGram: item.hargaPerGram || 0,
            totalHarga: item.totalHarga || 0,
          };

          // Update or add
          const existingIndex = kodeData.active.findIndex((i) => i.id === itemId);
          if (existingIndex >= 0) {
            kodeData.active[existingIndex] = kodeItem;
          } else {
            kodeData.active.unshift(kodeItem);
          }
        });
      }
    } else if (change.type === "removed") {
      // Remove items dari transaksi yang dihapus
      kodeData.active = kodeData.active.filter((item) => !item.id.startsWith(docData.id + "_"));
    }
  });
  sortKodeData();
}

// Handle incremental changes dari mutasiKode
function handleMutasiKodeChanges(changes) {
  changes.forEach((change) => {
    const docData = { id: change.doc.id, ...change.doc.data() };
    const prefix = docData.kode?.charAt(0).toUpperCase();

    if (!prefix || !(prefix in jenisBarang)) return;

    const kodeItem = {
      id: docData.id,
      kode: docData.kode,
      nama: docData.namaBarang || "Tidak ada nama",
      kadar: docData.kadar || "-",
      berat: docData.berat || 0,
      tanggalInput: docData.tanggalInput || formatTimestamp(docData.timestamp || docData.createdAt),
      keterangan: docData.keterangan || "",
      jenisPrefix: prefix,
      jenisNama: jenisBarang[prefix],
      penjualanId: docData.penjualanId || docData.id,
      isMutated: docData.isMutated || false,
      tanggalMutasi: docData.tanggalMutasi || null,
      mutasiKeterangan: docData.mutasiKeterangan || "",
      mutasiHistory: docData.mutasiHistory || [],
      timestamp: docData.timestamp || docData.createdAt,
      lastUpdated: docData.lastUpdated || docData.timestamp || docData.createdAt,
      sales: docData.sales || "",
      hargaPerGram: docData.hargaPerGram || 0,
      totalHarga: docData.totalHarga || 0,
    };

    if (change.type === "removed") {
      // Remove dari kedua array
      kodeData.active = kodeData.active.filter((item) => item.id !== docData.id);
      kodeData.mutated = kodeData.mutated.filter((item) => item.id !== docData.id);
    } else {
      // Added or Modified
      const targetArray = kodeItem.isMutated ? kodeData.mutated : kodeData.active;
      const otherArray = kodeItem.isMutated ? kodeData.active : kodeData.mutated;

      // Remove dari array yang lain (jika status berubah)
      const otherIndex = otherArray.findIndex((i) => i.id === docData.id);
      if (otherIndex >= 0) otherArray.splice(otherIndex, 1);

      // Update or add ke array yang sesuai
      const existingIndex = targetArray.findIndex((i) => i.id === docData.id);
      if (existingIndex >= 0) {
        targetArray[existingIndex] = kodeItem;
      } else {
        targetArray.unshift(kodeItem);
      }
    }
  });
  sortKodeData();
}

// Fungsi untuk reset selections
function resetSelections() {
  selectedKodes.active = new Set();
  selectedKodes.mutated = new Set();
  updateButtonStatus("active");
  updateButtonStatus("mutated");
  $("#selectAllActive, #selectAllMutated").prop("checked", false);
}

// Fungsi untuk memutasi kode (hanya untuk data dari mutasiKode)
async function mutateSelectedKodes() {
  try {
    const tanggalMutasi = $("#tanggalMutasi").val();
    const keteranganMutasi = $("#keteranganMutasi").val();

    if (!tanggalMutasi || !keteranganMutasi.trim()) {
      showAlert("Tanggal dan keterangan mutasi harus diisi", "Validasi", "warning");
      return;
    }

    const selectedIds = Array.from(selectedKodes.active);
    const selectedItems = kodeData.active.filter((item) => selectedIds.includes(item.id));

    if (selectedItems.length === 0) {
      showAlert("Tidak ada kode yang dipilih", "Validasi", "warning");
      return;
    }

    // Tampilkan loading
    Swal.fire({
      title: "Memproses Mutasi",
      text: `Memutasi ${selectedItems.length} kode...`,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    // Buat timestamp sekali untuk semua operasi
    const currentTimestamp = Timestamp.now();
    const timestampDate = currentTimestamp.toDate();

    // Proses setiap kode yang dipilih
    const updatePromises = selectedItems.map(async (item) => {
      // Buat history entry dengan timestamp biasa (bukan serverTimestamp)
      const mutasiHistory = {
        tanggal: tanggalMutasi,
        status: "Mutasi",
        keterangan: keteranganMutasi,
        timestamp: currentTimestamp, // Gunakan Timestamp.now() bukan serverTimestamp()
      };

      const updateData = {
        isMutated: true,
        tanggalMutasi: tanggalMutasi,
        mutasiKeterangan: keteranganMutasi,
        mutasiHistory: [mutasiHistory, ...(item.mutasiHistory || [])],
        lastUpdated: serverTimestamp(), // serverTimestamp() hanya untuk field langsung
      };

      // Update di Firestore
      if (currentDataSource === "mutasiKode") {
        // Update existing document
        const mutasiKodeRef = doc(firestore, "mutasiKode", item.id);
        await updateDoc(mutasiKodeRef, updateData);
      } else {
        // Create new document in mutasiKode collection
        const newMutasiData = {
          ...item,
          ...updateData,
          timestamp: serverTimestamp(),
          sourceTransactionId: item.penjualanId,
        };
        delete newMutasiData.id; // Remove old id
        await addDoc(collection(firestore, "mutasiKode"), newMutasiData);
      }

      return item.kode;
    });

    await Promise.all(updatePromises);

    // Optimistic update: pindahkan items dari active ke mutated
    selectedItems.forEach((item) => {
      const index = kodeData.active.findIndex((i) => i.id === item.id);
      if (index >= 0) {
        const updatedItem = { ...kodeData.active[index] };
        updatedItem.isMutated = true;
        updatedItem.tanggalMutasi = tanggalMutasi;
        updatedItem.mutasiKeterangan = keteranganMutasi;
        updatedItem.mutasiHistory = [
          {
            tanggal: tanggalMutasi,
            status: "Mutasi",
            keterangan: keteranganMutasi,
            timestamp: currentTimestamp,
          },
          ...(updatedItem.mutasiHistory || []),
        ];

        kodeData.active.splice(index, 1);
        kodeData.mutated.unshift(updatedItem);
      }
    });

    sortKodeData();
    updateKodeDisplay();
    updateCounters();
    saveToCache(kodeData, currentDataSource, `${CACHE_KEY}_${getLocalDateString()}`);

    // Reset form dan selections
    selectedKodes.active = new Set();
    $("#mutasiModal").modal("hide");
    $("#btnMutasiSelected").prop("disabled", true).html(`<i class="fas fa-exchange-alt me-2"></i>Mutasi Terpilih`);

    Swal.fire({
      title: "Berhasil!",
      text: `${selectedItems.length} kode berhasil dimutasi`,
      icon: "success",
      confirmButtonText: "OK",
    });
  } catch (error) {
    console.error("Error mutating kodes:", error);
    Swal.fire({
      title: "Error",
      text: `Gagal memutasi kode: ${error.message}`,
      icon: "error",
      confirmButtonText: "OK",
    });
  }
}

// Fungsi untuk restore kode (hanya untuk data dari mutasiKode)
async function restoreSelectedKodes() {
  try {
    const selectedIds = Array.from(selectedKodes.mutated);
    const selectedItems = kodeData.mutated.filter((item) => selectedIds.includes(item.id));

    if (selectedItems.length === 0) {
      showAlert("Tidak ada kode yang dipilih", "Validasi", "warning");
      return;
    }

    Swal.fire({
      title: "Memproses Pengembalian",
      text: "Mohon tunggu...",
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    const currentTimestamp = Timestamp.now();

    for (const item of selectedItems) {
      const mutasiKodeRef = doc(firestore, "mutasiKode", item.id);

      const today = new Date();
      const formattedDate = `${today.getDate().toString().padStart(2, "0")}/${(today.getMonth() + 1)
        .toString()
        .padStart(2, "0")}/${today.getFullYear()}`;

      const restoreHistory = {
        tanggal: formattedDate,
        status: "Dikembalikan",
        keterangan: "Kode dikembalikan ke status aktif",
        timestamp: currentTimestamp, // Gunakan Timestamp.now()
      };

      const updateData = {
        isMutated: false,
        mutasiHistory: [restoreHistory, ...(item.mutasiHistory || [])],
        lastUpdated: serverTimestamp(),
      };

      await updateDoc(mutasiKodeRef, updateData);
    }

    // Optimistic update: pindahkan items dari mutated ke active
    selectedItems.forEach((item) => {
      const index = kodeData.mutated.findIndex((i) => i.id === item.id);
      if (index >= 0) {
        const updatedItem = { ...kodeData.mutated[index] };
        updatedItem.isMutated = false;
        updatedItem.mutasiHistory = [
          {
            tanggal: formattedDate,
            status: "Dikembalikan",
            keterangan: "Kode dikembalikan ke status aktif",
            timestamp: currentTimestamp,
          },
          ...(updatedItem.mutasiHistory || []),
        ];

        kodeData.mutated.splice(index, 1);
        kodeData.active.unshift(updatedItem);
      }
    });

    sortKodeData();
    updateKodeDisplay();
    updateCounters();
    saveToCache(kodeData, currentDataSource, `${CACHE_KEY}_${getLocalDateString()}`);

    selectedKodes.mutated = new Set();

    Swal.fire({
      title: "Berhasil",
      text: `${selectedItems.length} kode berhasil dikembalikan`,
      icon: "success",
      confirmButtonText: "OK",
    });
  } catch (error) {
    console.error("Error restoring kodes:", error);
    Swal.fire({
      title: "Error",
      text: `Gagal mengembalikan kode: ${error.message}`,
      icon: "error",
      confirmButtonText: "OK",
    });
  }
}

// Fungsi untuk delete kode (hanya untuk data dari mutasiKode)
async function deleteSelectedKodes() {
  try {
    if (currentDataSource !== "mutasiKode") {
      showAlert("Hapus kode hanya dapat dilakukan pada data arsip.", "Informasi", "info");
      return;
    }

    const selectedIds = Array.from(selectedKodes.mutated);
    const selectedItems = kodeData.mutated.filter((item) => selectedIds.includes(item.id));

    if (selectedItems.length === 0) {
      showAlert("Tidak ada kode yang dipilih", "Validasi", "warning");
      return;
    }

    // Tampilkan modal validasi
    showValidasiHapusModal(selectedItems);
  } catch (error) {
    console.error("Error in deleteSelectedKodes:", error);
    showAlert("Terjadi kesalahan: " + error.message, "Error", "error");
  }
}

// Tambahkan fungsi baru untuk menampilkan modal validasi
function showValidasiHapusModal(selectedItems) {
  // Reset form
  $("#validasiHapusForm")[0].reset();
  $("#validasiError").addClass("d-none");

  // Update jumlah kode yang akan dihapus
  $("#jumlahKodeHapus").text(selectedItems.length);

  // Simpan data yang akan dihapus untuk digunakan nanti
  window.pendingDeleteItems = selectedItems;

  // Tampilkan modal
  $("#modalValidasiHapus").modal("show");
}

// Tambahkan fungsi validasi kredensial
async function validateCredentials(userId, password) {
  try {
    // Simulasi validasi - ganti dengan logika validasi sebenarnya
    // Contoh: cek dengan database user atau hardcoded credentials

    // Hardcoded validation (ganti dengan sistem autentikasi yang sebenarnya)
    const validCredentials = {
      input: "input116",
      manager: "manager123",
      supervisor: "super123",
    };

    // Cek apakah user ID dan password valid
    if (validCredentials[userId] && validCredentials[userId] === password) {
      return { success: true };
    }

    // Atau bisa juga validasi dengan current user session
    const currentUser = JSON.parse(sessionStorage.getItem("currentUser") || "{}");
    if (currentUser.username === userId && currentUser.password === password) {
      return { success: true };
    }

    return {
      success: false,
      message: "User ID atau Password tidak valid",
    };
  } catch (error) {
    console.error("Error validating credentials:", error);
    return {
      success: false,
      message: "Terjadi kesalahan saat validasi",
    };
  }
}

// Tambahkan fungsi untuk melakukan penghapusan setelah validasi berhasil
async function executeDelete(selectedItems) {
  try {
    Swal.fire({
      title: "Memproses Penghapusan",
      text: `Menghapus ${selectedItems.length} kode...`,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    // Hapus setiap item
    const deletePromises = selectedItems.map(async (item) => {
      const mutasiKodeRef = doc(firestore, "mutasiKode", item.id);
      await deleteDoc(mutasiKodeRef);
      return item.kode;
    });

    await Promise.all(deletePromises);

    // Optimistic update: hapus items dari local data
    const deletedIds = new Set(selectedItems.map((item) => item.id));
    kodeData.mutated = kodeData.mutated.filter((item) => !deletedIds.has(item.id));

    updateKodeDisplay();
    updateCounters();
    saveToCache(kodeData, currentDataSource, `${CACHE_KEY}_${getLocalDateString()}`);

    // Reset selections
    selectedKodes.mutated = new Set();
    updateButtonStatus("mutated");
    $("#selectAllMutated").prop("checked", false);

    // Tutup modal dan tampilkan success
    $("#modalValidasiHapus").modal("hide");

    Swal.fire({
      title: "Berhasil!",
      text: `${selectedItems.length} kode berhasil dihapus`,
      icon: "success",
      confirmButtonText: "OK",
    });
  } catch (error) {
    console.error("Error executing delete:", error);
    Swal.fire({
      title: "Error",
      text: `Gagal menghapus kode: ${error.message}`,
      icon: "error",
      confirmButtonText: "OK",
    });
  }
}

// Fungsi untuk refresh data manual dengan cache clearing
async function refreshData() {
  try {
    clearAllCache();
    await loadKodeData(true);
    showAlert("Data berhasil diperbarui", "Berhasil", "success");
  } catch (error) {
    console.error("Error refreshing data:", error);
    showAlert("Gagal memperbarui data: " + error.message, "Error", "error");
  }
}

// Fungsi untuk membersihkan semua cache
function clearAllCache() {
  kodeDataCache.clear();
  kodeDataCacheMeta.clear();

  // Hapus dari localStorage
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes("kode")) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

// Fungsi utility yang sudah ada sebelumnya
function formatTimestamp(timestamp) {
  if (!timestamp) return "-";
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1)
      .toString()
      .padStart(2, "0")}/${date.getFullYear()}`;
  } catch (error) {
    console.error("Error formatting timestamp:", error);
    return "-";
  }
}

// Fungsi untuk update tampilan (menggunakan fungsi yang sudah ada)
function updateKodeDisplay() {
  const mutatedIds = new Set((kodeData.mutated || []).map((i) => i.id));
  const activeBase = (kodeData.active || []).filter((i) => !mutatedIds.has(i.id) && !i.isMutated);
  const filteredActive = filterKodeData(activeBase);
  const filteredMutated = filterKodeData(kodeData.mutated || []);
  renderKodeTable(filteredActive, "active");
  renderKodeTable(filteredMutated, "mutated");
  updateCounters();
}

function filterKodeData(data) {
  const jenisFilter = $("#filterJenis").val();
  const searchText = $("#searchKode").val().toLowerCase();

  return data.filter((item) => {
    if (jenisFilter && item.jenisPrefix !== jenisFilter) return false;
    if (searchText) {
      const matchesKode = item.kode.toLowerCase().includes(searchText);
      const matchesNama = item.nama.toLowerCase().includes(searchText);
      if (!matchesKode && !matchesNama) return false;
    }
    return true;
  });
}

function renderKodeTable(data, type) {
  const tableId = type === "active" ? "tableActiveKode" : "tableMutatedKode";
  const tableBody = $(`#${tableId} tbody`);

  // Untuk tabel mutated, destroy DataTable jika sudah ada
  if (type === "mutated" && mutatedDataTable) {
    mutatedDataTable.destroy();
    mutatedDataTable = null;
  }

  tableBody.empty();

  if (data.length === 0) {
    const colCount = type === "active" ? 9 : 10;
    tableBody.html(`<tr><td colspan="${colCount}" class="text-center">Tidak ada data kode</td></tr>`);
    return;
  }

  data.forEach((item) => {
    const keteranganValue = type === "active" ? item.keterangan || "-" : item.keterangan || "-";
    const row = `
      <tr data-id="${item.id}">
        <td>
          <input type="checkbox" class="form-check-input kode-checkbox" data-id="${item.id}" data-type="${type}">
        </td>
        <td>${item.tanggalInput || "-"}</td>
        <td>${item.kode}</td>
        <td>${item.sales || "-"}</td>
        <td>${item.nama}</td>
        <td>${item.kadar}</td>
        <td>${item.berat}</td>
        ${type === "mutated" ? `<td>${item.tanggalMutasi || "-"}</td>` : ""}
        <td>${keteranganValue}</td>
        <td>
          <button class="btn btn-sm btn-info btn-detail" data-id="${item.id}" data-type="${type}">
            <i class="fas fa-info-circle"></i>
          </button>
          ${
            type === "active" && currentDataSource === "mutasiKode"
              ? `<button class="btn btn-sm btn-warning btn-mutasi" data-id="${item.id}">
                  <i class="fas fa-exchange-alt"></i>
                </button>`
              : ""
          }
          ${
            type === "mutated" && currentDataSource === "mutasiKode"
              ? `<button class="btn btn-sm btn-secondary btn-restore" data-id="${item.id}">
                  <i class="fas fa-undo"></i>
                </button>`
              : ""
          }
        </td>
      </tr>
    `;
    tableBody.append(row);
  });

  // Inisialisasi DataTable untuk tabel mutated
  if (type === "mutated" && data.length > 0) {
    // Custom date sorting untuk format DD/MM/YYYY
    $.fn.dataTable.ext.type.order["date-dd-mm-yyyy-pre"] = function (d) {
      if (!d || d === "-") return 0;
      const parts = d.split("/");
      if (parts.length !== 3) return 0;
      // Return timestamp for sorting: YYYYMMDD format
      return parseInt(parts[2] + parts[1].padStart(2, "0") + parts[0].padStart(2, "0"));
    };

    mutatedDataTable = $(`#${tableId}`).DataTable({
      pageLength: 25,
      lengthMenu: [
        [10, 25, 50, 100, -1],
        [10, 25, 50, 100, "Semua"],
      ],
      order: [[7, "desc"]], // Sort by Tanggal Mutasi descending (column 7)
      columnDefs: [
        { orderable: false, targets: [0, 9] }, // Disable sorting untuk checkbox & action column
        { type: "date-dd-mm-yyyy", targets: [1, 7] }, // Apply custom date sorting to date columns
        { width: "4%", targets: 0 },
        { width: "10%", targets: 1 },
        { width: "9%", targets: 2 },
        { width: "7%", targets: 3 },
        { width: "19%", targets: 4 },
        { width: "6%", targets: 5 },
        { width: "6%", targets: 6 },
        { width: "11%", targets: 7 },
        { width: "18%", targets: 8 },
        { width: "10%", targets: 9 },
      ],
      language: {
        search: "Cari:",
        lengthMenu: "Tampilkan _MENU_ data",
        info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ data",
        infoEmpty: "Menampilkan 0 sampai 0 dari 0 data",
        infoFiltered: "(disaring dari _MAX_ total data)",
        paginate: {
          first: "Pertama",
          last: "Terakhir",
          next: "Selanjutnya",
          previous: "Sebelumnya",
        },
        zeroRecords: "Tidak ada data yang cocok",
        emptyTable: "Tidak ada data kode",
      },
      dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>rt<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
      responsive: true,
      autoWidth: false,
    });
  }

  attachTableEventHandlers(type);
}

function attachTableEventHandlers(type) {
  // Handler untuk checkbox - pastikan selector benar
  $(document).off("change", `#table${type.charAt(0).toUpperCase() + type.slice(1)}Kode .kode-checkbox`);
  $(document).on("change", `#table${type.charAt(0).toUpperCase() + type.slice(1)}Kode .kode-checkbox`, function () {
    const id = $(this).data("id");
    const checkboxType = $(this).data("type");

    if ($(this).is(":checked")) {
      selectedKodes[checkboxType].add(id);
    } else {
      selectedKodes[checkboxType].delete(id);
    }
    updateButtonStatus(checkboxType);
  });

  // Handler untuk tombol detail
  $(document).off("click", `#table${type.charAt(0).toUpperCase() + type.slice(1)}Kode .btn-detail`);
  $(document).on("click", `#table${type.charAt(0).toUpperCase() + type.slice(1)}Kode .btn-detail`, function () {
    const id = $(this).data("id");
    const itemType = $(this).data("type");
    showKodeDetail(id, itemType);
  });

  // Handler untuk tombol mutasi individual
  if (type === "active") {
    $(document).off("click", "#tableActiveKode .btn-mutasi");
    $(document).on("click", "#tableActiveKode .btn-mutasi", function () {
      const id = $(this).data("id");
      selectedKodes.active = new Set([id]);
      showMutasiModal();
    });
  }

  // Handler untuk tombol restore individual
  if (type === "mutated") {
    $(document).off("click", "#tableMutatedKode .btn-restore");
    $(document).on("click", "#tableMutatedKode .btn-restore", function () {
      const id = $(this).data("id");
      selectedKodes.mutated = new Set([id]);
      confirmRestoreKode();
    });
  }
}

function updateButtonStatus(type) {
  if (type === "active") {
    const hasSelected = selectedKodes.active.size > 0;
    $("#btnMutasiSelected").prop("disabled", !hasSelected);

    if (hasSelected) {
      $("#btnMutasiSelected").html(
        `<i class="fas fa-exchange-alt me-2"></i>Mutasi Terpilih (${selectedKodes.active.size})`
      );
    } else {
      $("#btnMutasiSelected").html(`<i class="fas fa-exchange-alt me-2"></i>Mutasi Terpilih`);
    }
  } else {
    const hasSelected = selectedKodes.mutated.size > 0;
    $("#btnRestoreSelected").prop("disabled", !hasSelected);
    $("#btnDeleteSelected").prop("disabled", !hasSelected);
  }
}

function updateCounters() {
  const mutatedIds = new Set((kodeData.mutated || []).map((i) => i.id));
  const activeBase = (kodeData.active || []).filter((i) => !mutatedIds.has(i.id) && !i.isMutated);
  const filteredActive = filterKodeData(activeBase);
  const filteredMutated = filterKodeData(kodeData.mutated || []);
  $("#activeKodeCount").text(filteredActive.length);
  $("#mutatedKodeCount").text(filteredMutated.length);
}

function showKodeDetail(id, type) {
  const item =
    type === "active"
      ? kodeData.active.find((item) => item.id === id)
      : kodeData.mutated.find((item) => item.id === id);

  if (!item) {
    showAlert("Data kode tidak ditemukan", "Error", "error");
    return;
  }

  $("#detailKode").val(item.kode);
  $("#detailSales").val(item.sales || "-");
  $("#detailNama").val(item.nama);
  $("#detailKadar").val(item.kadar);
  $("#detailBerat").val(item.berat);
  $("#detailTanggal").val(item.tanggalInput);
  $("#detailJenis").val(item.jenisNama);
  $("#detailKeterangan").val(item.keterangan);

  if (type === "mutated") {
    $("#mutasiInfoContainer").show();
    $("#detailTanggalMutasi").val(item.tanggalMutasi);
    $("#detailKeteranganMutasi").val(item.mutasiKeterangan);

    const historyContainer = $("#mutasiHistoryContainer");
    historyContainer.empty();

    if (item.mutasiHistory && item.mutasiHistory.length > 0) {
      historyContainer.show();
      const historyList = $("<ul class='list-group'></ul>");

      item.mutasiHistory.forEach((history) => {
        const historyItem = $(`
          <li class="list-group-item">
            <div class="d-flex justify-content-between">
              <span>${history.tanggal}</span>
              <span class="badge bg-secondary">${history.status}</span>
            </div>
            <div class="mt-1">${history.keterangan}</div>
          </li>
        `);
        historyList.append(historyItem);
      });

      historyContainer.append(historyList);
    } else {
      historyContainer.hide();
    }
  } else {
    $("#mutasiInfoContainer").hide();
    $("#mutasiHistoryContainer").hide();
  }

  $("#kodeDetailModal").modal("show");
}

function showMutasiModal() {
  $("#mutasiForm")[0].reset();
  const selectedIds = Array.from(selectedKodes.active);
  const selectedItems = kodeData.active.filter((item) => selectedIds.includes(item.id));

  const kodeList = $("#selectedKodeList ul");
  kodeList.empty();

  selectedItems.forEach((item) => {
    kodeList.append(`
      <li class="list-group-item d-flex justify-content-between align-items-center">
        ${item.kode} - ${item.nama}
        <span class="badge bg-primary rounded-pill">${item.jenisNama}</span>
      </li>
    `);
  });

  const today = new Date();
  const formattedDate = `${today.getDate().toString().padStart(2, "0")}/${(today.getMonth() + 1)
    .toString()
    .padStart(2, "0")}/${today.getFullYear()}`;
  $("#tanggalMutasi").val(formattedDate);

  $("#mutasiModal").modal("show");
}

async function confirmRestoreKode() {
  const confirmed = await showConfirm("Apakah Anda yakin ingin mengembalikan kode yang dipilih ke status aktif?");
  if (confirmed) {
    restoreSelectedKodes();
  }
}

// Export functions
function exportToExcel(data, filename, sheetName = "Data") {
  try {
    if (typeof XLSX === "undefined") {
      showAlert("Library Excel tidak tersedia. Pastikan XLSX library sudah dimuat.", "Error", "error");
      return;
    }

    if (!data || data.length === 0) {
      showAlert("Tidak ada data untuk di-export", "Informasi", "info");
      return;
    }

    const exportData = data.map((item) => ({
      Kode: item.kode,
      Sales: item.sales || "-",
      "Nama Barang": item.nama,
      Kadar: item.kadar,
      Berat: item.berat,
      "Tanggal Input": item.tanggalInput,
      Status: item.isMutated ? "Sudah Dimutasi" : "Belum Dimutasi",
      "Tanggal Mutasi": item.tanggalMutasi || "-",
      "Keterangan Mutasi": item.mutasiKeterangan || "-",
      Keterangan: item.keterangan,
      "Sumber Data": currentDataSource === "penjualanAksesoris" ? "Live" : "Arsip",
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    const colWidths = [
      { wch: 10 },
      { wch: 25 },
      { wch: 7 },
      { wch: 7 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 25 },
      { wch: 25 },
      { wch: 10 },
    ];
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const fullFilename = `${filename}_${timestamp}.xlsx`;

    XLSX.writeFile(wb, fullFilename);
    showAlert(`Data berhasil di-export ke ${fullFilename}`, "Berhasil", "success");
  } catch (error) {
    console.error("Error exporting to Excel:", error);
    showAlert("Gagal export data: " + error.message, "Error", "error");
  }
}

function exportActiveKodes() {
  const filteredData = filterKodeData(kodeData.active);
  exportToExcel(filteredData, "Kode_Aktif", "Kode Aktif");
}

function exportMutatedKodes() {
  let dataToExport;

  if (mutatedDataTable) {
    // Export data yang difilter/visible di DataTable
    const visibleIds = [];
    mutatedDataTable.rows({ search: "applied" }).every(function () {
      const id = $(this.node()).data("id");
      visibleIds.push(id);
    });
    dataToExport = kodeData.mutated.filter((item) => visibleIds.includes(item.id));
  } else {
    dataToExport = filterKodeData(kodeData.mutated);
  }

  exportToExcel(dataToExport, "Kode_Dimutasi", "Kode Dimutasi");
}

// Initialize event handlers
function initializeEventHandlers() {
  $("#filterJenis").on("change", updateKodeDisplay);

  $("#searchKode").on("input", function () {
    clearTimeout(window.searchTimeout);
    window.searchTimeout = setTimeout(updateKodeDisplay, 300);
  });

  $("#btnRefresh").on("click", refreshData);
  $("#btnExportActive").on("click", exportActiveKodes);
  $("#btnExportMutated").on("click", exportMutatedKodes);

  $("#btnFilter").on("click", updateKodeDisplay);
  $("#btnReset").on("click", function () {
    $("#filterJenis").val("");
    $("#searchKode").val("");
    updateKodeDisplay();
  });

  $("#btnMutasiSelected")
    .off("click")
    .on("click", function () {
      if (selectedKodes.active.size > 0) {
        showMutasiModal();
      } else {
        showAlert("Pilih kode yang akan dimutasi terlebih dahulu", "Informasi", "info");
      }
    });

  $("#btnRestoreSelected").on("click", function () {
    if (selectedKodes.mutated.size > 0) {
      confirmRestoreKode();
    } else {
      showAlert("Pilih kode yang akan dikembalikan terlebih dahulu", "Informasi", "info");
    }
  });

  $("#btnDeleteSelected").on("click", function () {
    if (selectedKodes.mutated.size > 0) {
      deleteSelectedKodes();
    } else {
      showAlert("Pilih kode yang akan dihapus terlebih dahulu", "Informasi", "info");
    }
  });

  // Event handler untuk toggle password visibility
  $("#togglePasswordValidasi").on("click", function () {
    const passwordInput = $("#validasiPassword");
    const eyeIcon = $("#eyeIconValidasi");

    if (passwordInput.attr("type") === "password") {
      passwordInput.attr("type", "text");
      eyeIcon.removeClass("fa-eye").addClass("fa-eye-slash");
    } else {
      passwordInput.attr("type", "password");
      eyeIcon.removeClass("fa-eye-slash").addClass("fa-eye");
    }
  });

  // Event handler untuk form validasi hapus
  $("#validasiHapusForm").on("submit", async function (e) {
    e.preventDefault();

    const userId = $("#validasiUserId").val().trim();
    const password = $("#validasiPassword").val();

    if (!userId || !password) {
      showValidasiError("User ID dan Password harus diisi");
      return;
    }

    // Disable tombol sementara
    $("#btnKonfirmasiHapus").prop("disabled", true).html('<i class="fas fa-spinner fa-spin me-2"></i>Memvalidasi...');

    try {
      const validation = await validateCredentials(userId, password);

      if (validation.success) {
        // Validasi berhasil, lakukan penghapusan
        const selectedItems = window.pendingDeleteItems || [];
        if (selectedItems.length > 0) {
          await executeDelete(selectedItems);
        }
      } else {
        showValidasiError(validation.message);
      }
    } catch (error) {
      console.error("Validation error:", error);
      showValidasiError("Terjadi kesalahan saat validasi");
    } finally {
      // Enable tombol kembali
      $("#btnKonfirmasiHapus").prop("disabled", false).html('<i class="fas fa-trash me-2"></i>Konfirmasi Hapus');
    }
  });

  // Reset error saat modal ditutup
  $("#modalValidasiHapus").on("hidden.bs.modal", function () {
    $("#validasiError").addClass("d-none");
    $("#validasiHapusForm")[0].reset();
    window.pendingDeleteItems = null;
  });

  $("#selectAllActive")
    .off("change")
    .on("change", function () {
      const isChecked = $(this).is(":checked");

      $("#tableActiveKode .kode-checkbox").prop("checked", isChecked);

      if (isChecked) {
        const filteredActive = filterKodeData(kodeData.active);
        selectedKodes.active.clear();
        filteredActive.forEach((item) => selectedKodes.active.add(item.id));
      } else {
        selectedKodes.active.clear();
      }
      updateButtonStatus("active");
    });

  $("#btnSaveMutasi").on("click", mutateSelectedKodes);

  $("#selectAllMutated").on("change", function () {
    const isChecked = $(this).is(":checked");

    if (mutatedDataTable) {
      // Untuk DataTable: select semua yang visible di current page
      mutatedDataTable.rows({ page: "current" }).every(function () {
        const rowNode = this.node();
        $(rowNode).find(".kode-checkbox").prop("checked", isChecked);
        const id = $(rowNode).data("id");
        if (isChecked) {
          selectedKodes.mutated.add(id);
        } else {
          selectedKodes.mutated.delete(id);
        }
      });
    } else {
      // Fallback untuk tabel biasa
      $("#tableMutatedKode .kode-checkbox").prop("checked", isChecked);
      if (isChecked) {
        const filteredMutated = filterKodeData(kodeData.mutated);
        filteredMutated.forEach((item) => selectedKodes.mutated.add(item.id));
      } else {
        selectedKodes.mutated = new Set();
      }
    }
    updateButtonStatus("mutated");
  });

  $('a[data-bs-toggle="tab"]').on("shown.bs.tab", function () {
    resetSelections();
  });

  $(window).on("beforeunload", function () {
    if (unsubscribeListener) {
      unsubscribeListener();
    }
  });
}

// Tambahkan fungsi helper untuk menampilkan error validasi
function showValidasiError(message) {
  $("#validasiErrorText").text(message);
  $("#validasiError").removeClass("d-none");

  // Auto hide error setelah 5 detik
  setTimeout(() => {
    $("#validasiError").addClass("d-none");
  }, 5000);
}

// Initialize page dengan cache loading
async function initializePage() {
  try {
    // Load cache dari storage terlebih dahulu
    loadCacheFromStorage();

    Swal.fire({
      title: "Memuat Data",
      text: "Mohon tunggu...",
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    await loadKodeData();
    setupRealtimeListener();
    Swal.close();
    initializeEventHandlers();

    // Setup periodic cache cleanup
    setInterval(clearOldCache, 30 * 60 * 1000); // Cleanup setiap 30 menit
  } catch (error) {
    console.error("Error initializing page:", error);
    Swal.fire({
      title: "Error",
      text: `Gagal memuat data: ${error.message}`,
      icon: "error",
      confirmButtonText: "OK",
    });
  }
}

// Cleanup function
function cleanup() {
  if (unsubscribeListener) {
    unsubscribeListener();
  }

  // Destroy DataTable instance
  if (mutatedDataTable) {
    mutatedDataTable.destroy();
    mutatedDataTable = null;
  }

  // Simpan cache sebelum cleanup
  saveCacheToStorage();
}

// Authentication functions
function handleLogout() {
  cleanup();
  sessionStorage.removeItem("currentUser");
  window.location.href = "index.html";
}

async function checkLoginStatus() {
  const user = sessionStorage.getItem("currentUser");
  if (!user) {
    window.location.href = "index.html";
  }
}

// Initialize when document is ready
$(document).ready(function () {
  checkLoginStatus();
  initializePage();
});

// Cleanup when page unloads
$(window).on("beforeunload", cleanup);

// Export global functions
window.handleLogout = handleLogout;
window.refreshData = refreshData;
