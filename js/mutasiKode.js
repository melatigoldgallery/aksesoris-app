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

console.log("mutasiKode.js loaded");
// Konstanta untuk caching
const CACHE_KEY = "kodeDataCache";
const CACHE_DURATION = 10 * 60 * 1000; // 10 menit
const CACHE_VERSION = "v3.0"; // Update versi untuk sistem fallback

// Variabel untuk real-time listener dan tracking sumber data
let unsubscribeListener = null;
let currentDataSource = null; // Track sumber data yang sedang digunakan

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

// Fungsi untuk cache management
function isCacheValid() {
  const cachedData = localStorage.getItem(CACHE_KEY);
  if (!cachedData) return false;

  try {
    const { timestamp, data, version } = JSON.parse(cachedData);
    return version === CACHE_VERSION && Date.now() - timestamp < CACHE_DURATION;
  } catch (error) {
    console.error("Error parsing cache:", error);
    localStorage.removeItem(CACHE_KEY);
    return false;
  }
}

function saveToCache(data, source) {
  try {
    const cacheData = {
      timestamp: Date.now(),
      version: CACHE_VERSION,
      data: data,
      source: source, // Track sumber data
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    console.log(`Data saved to cache from source: ${source}`);
  } catch (error) {
    console.error("Error saving to cache:", error);
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (retryError) {
      console.error("Failed to save cache after cleanup:", retryError);
    }
  }
}

function getFromCache() {
  try {
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (cachedData) {
      const { data, version, source } = JSON.parse(cachedData);
      if (version === CACHE_VERSION) {
        console.log(`Using cached data from source: ${source}`);
        currentDataSource = source;
        return data;
      } else {
        localStorage.removeItem(CACHE_KEY);
        console.log("Old cache version removed");
      }
    }
    return null;
  } catch (error) {
    console.error("Error getting from cache:", error);
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

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

      // Periksa apakah prefix ada dalam daftar jenis barang
      if (!(prefix in jenisBarang)) {
        console.warn("Unknown prefix:", prefix, "for code:", kode);
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

    // Validasi data yang diperlukan
    if (!data.kode || !data.namaBarang) {
      console.warn("Invalid mutasiKode data found:", data);
      return;
    }

    const prefix = data.kode.charAt(0).toUpperCase();

    // Periksa apakah prefix ada dalam daftar jenis barang
    if (!(prefix in jenisBarang)) {
      console.warn("Unknown prefix:", prefix, "for code:", data.kode);
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
    console.log("Attempting to load data from penjualanAksesoris...");

    // Query untuk mengambil data penjualan manual
    const penjualanQuery = query(
      collection(firestore, "penjualanAksesoris"),
      where("jenisPenjualan", "==", "manual"),
      orderBy("timestamp", "desc")
    );

    const querySnapshot = await getDocs(penjualanQuery);

    if (querySnapshot.empty) {
      console.log("No data found in penjualanAksesoris");
      return null;
    }

    console.log(`Found ${querySnapshot.docs.length} manual transactions in penjualanAksesoris`);

    // Proses data yang diterima
    const processedData = processPenjualanData(querySnapshot.docs);

    // Filter hanya yang memiliki kode
    const totalItems = processedData.active.length + processedData.mutated.length;

    if (totalItems === 0) {
      console.log("No items with barcode found in penjualanAksesoris");
      return null;
    }

    console.log(`Processed ${totalItems} items with barcode from penjualanAksesoris`);
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
    console.log("Loading data from mutasiKode collection...");

    const mutasiKodeQuery = query(collection(firestore, "mutasiKode"), orderBy("timestamp", "desc"));

    const querySnapshot = await getDocs(mutasiKodeQuery);

    if (querySnapshot.empty) {
      console.log("No data found in mutasiKode");
      return {
        active: [],
        mutated: [],
      };
    }

    console.log(`Found ${querySnapshot.docs.length} items in mutasiKode`);

    // Proses data yang diterima
    const processedData = processMutasiKodeData(querySnapshot.docs);

    console.log(
      `Processed data from mutasiKode: ${processedData.active.length} active, ${processedData.mutated.length} mutated`
    );
    currentDataSource = "mutasiKode";

    return processedData;
  } catch (error) {
    console.error("Error loading from mutasiKode:", error);
    throw error;
  }
}

// Fungsi utama untuk memuat data dengan sistem fallback
async function loadKodeData(forceRefresh = false) {
  try {
    // Cek cache
    if (!forceRefresh && isCacheValid()) {
      const cachedData = getFromCache();
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
      console.log("mutasiKode empty, fallback to penjualanAksesoris");
      const fallbackData = await loadFromPenjualanAksesoris();
      if (fallbackData) {
        loadedData = fallbackData;
      }
    }

    kodeData = loadedData || { active: [], mutated: [] };
    sortKodeData();
    saveToCache(kodeData, currentDataSource);
    updateKodeDisplay();
    updateCounters();
    updateDataSourceIndicator();
    loadingToast.close();
  } catch (error) {
    console.error("Error loading kode data:", error);
    Swal.close();
    showAlert("Gagal memuat data kode: " + error.message, "Error", "error");
  }
}

// Fungsi untuk mengurutkan data
function sortKodeData() {
  // Urutkan data aktif berdasarkan timestamp terbaru
  kodeData.active.sort((a, b) => {
    const timeA = a.timestamp?.toDate?.() || new Date(a.tanggalInput);
    const timeB = b.timestamp?.toDate?.() || new Date(b.tanggalInput);
    return timeB - timeA;
  });

  // Urutkan data mutated berdasarkan timestamp terbaru
  kodeData.mutated.sort((a, b) => {
    const timeA = a.lastUpdated?.toDate?.() || new Date(a.tanggalMutasi || a.tanggalInput);
    const timeB = b.lastUpdated?.toDate?.() || new Date(b.tanggalMutasi || b.tanggalInput);
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
        </small>
      </div>
    `);
  }

  const sourceText = currentDataSource === "penjualanAksesoris" ? "Transaksi Penjualan" : "Mutasi Kode";

  const sourceColor = currentDataSource === "penjualanAksesoris" ? "text-success" : "text-info";

  $("#dataSourceText").text(sourceText).removeClass("text-success text-info").addClass(sourceColor);
}

// Fungsi untuk setup real-time listener berdasarkan sumber data
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
          console.log("Real-time update from penjualanAksesoris");
          const processedData = processPenjualanData(snapshot.docs);

          if (processedData.active.length === 0 && processedData.mutated.length === 0) {
            // Jika data penjualan kosong, switch ke mutasiKode
            console.log("penjualanAksesoris is empty, switching to mutasiKode");
            loadKodeData(true);
            return;
          }

          kodeData = processedData;
          sortKodeData();
          saveToCache(kodeData, currentDataSource);
          updateKodeDisplay();
          updateCounters();
          resetSelections();
        },
        (error) => {
          console.error("Real-time listener error for penjualanAksesoris:", error);
          // Fallback ke mutasiKode jika ada error
          setTimeout(() => loadKodeData(true), 5000);
        }
      );
    } else {
      const mutasiKodeQuery = query(collection(firestore, "mutasiKode"), orderBy("timestamp", "desc"));

      unsubscribeListener = onSnapshot(
        mutasiKodeQuery,
        (snapshot) => {
          console.log("Real-time update from mutasiKode");
          kodeData = processMutasiKodeData(snapshot.docs);
          sortKodeData();
          saveToCache(kodeData, currentDataSource);
          updateKodeDisplay();
          updateCounters();
          resetSelections();
        },
        (error) => {
          console.error("Real-time listener error for mutasiKode:", error);
          setTimeout(() => loadKodeData(true), 5000);
        }
      );
    }

    console.log(`Real-time listener setup for ${currentDataSource}`);
  } catch (error) {
    console.error("Error setting up real-time listener:", error);
  }
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

    console.log(`Processing ${selectedItems.length} items for mutation`);

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

    // Reset form dan selections
    selectedKodes.active = new Set();
    $("#mutasiModal").modal("hide");
    $("#btnMutasiSelected").prop("disabled", true).html(`<i class="fas fa-exchange-alt me-2"></i>Mutasi Terpilih`);

    // Clear cache untuk refresh data
    localStorage.removeItem(CACHE_KEY);

    Swal.fire({
      title: "Berhasil!",
      text: `${selectedItems.length} kode berhasil dimutasi`,
      icon: "success",
      confirmButtonText: "OK",
    }).then(() => {
      // Refresh data
      loadKodeData(true);
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

    selectedKodes.mutated = new Set();

    Swal.fire({
      title: "Berhasil",
      text: `${selectedItems.length} kode berhasil dikembalikan`,
      icon: "success",
      confirmButtonText: "OK",
    }).then(() => {
      loadKodeData(true);
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

    const confirmed = await showConfirm(
      "Apakah Anda yakin ingin menghapus kode yang dipilih? Tindakan ini tidak dapat dibatalkan.",
      "Konfirmasi Penghapusan"
    );

    if (!confirmed) return;

    const selectedIds = Array.from(selectedKodes.mutated);
    const selectedItems = kodeData.mutated.filter((item) => selectedIds.includes(item.id));

    if (selectedItems.length === 0) {
      showAlert("Tidak ada kode yang dipilih", "Validasi", "warning");
      return;
    }

    Swal.fire({
      title: "Memproses Penghapusan",
      text: "Mohon tunggu...",
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    for (const item of selectedItems) {
      const mutasiKodeRef = doc(firestore, "mutasiKode", item.id);
      await deleteDoc(mutasiKodeRef);
    }

    selectedKodes.mutated = new Set();

    Swal.fire({
      title: "Berhasil",
      text: `${selectedItems.length} kode berhasil dihapus`,
      icon: "success",
      confirmButtonText: "OK",
    });
  } catch (error) {
    console.error("Error deleting kodes:", error);
    Swal.fire({
      title: "Error",
      text: `Gagal menghapus kode: ${error.message}`,
      icon: "error",
      confirmButtonText: "OK",
    });
  }
}

// Fungsi untuk refresh data manual
async function refreshData() {
  try {
    localStorage.removeItem(CACHE_KEY);
    await loadKodeData(true);
    showAlert("Data berhasil diperbarui", "Berhasil", "success");
  } catch (error) {
    console.error("Error refreshing data:", error);
    showAlert("Gagal memperbarui data: " + error.message, "Error", "error");
  }
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
  const filteredActive = filterKodeData(kodeData.active);
  const filteredMutated = filterKodeData(kodeData.mutated);
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
  tableBody.empty();

  if (data.length === 0) {
    tableBody.html(`<tr><td colspan="7" class="text-center">Tidak ada data kode</td></tr>`);
    return;
  }

  data.forEach((item) => {
    const row = `
      <tr data-id="${item.id}">
        <td>
          <input type="checkbox" class="form-check-input kode-checkbox" data-id="${item.id}" data-type="${type}">
        </td>
        <td>${item.kode}</td>
        <td>${item.nama}</td>
        <td>${item.kadar}</td>
        <td>${item.berat}</td>
        <td>${type === "active" ? item.tanggalInput : item.tanggalMutasi || "-"}</td>
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

  attachTableEventHandlers(type);
}

function attachTableEventHandlers(type) {
  // Handler untuk checkbox - pastikan selector benar
  $(document).off("change", `#table${type.charAt(0).toUpperCase() + type.slice(1)}Kode .kode-checkbox`);
  $(document).on("change", `#table${type.charAt(0).toUpperCase() + type.slice(1)}Kode .kode-checkbox`, function () {
    const id = $(this).data("id");
    const checkboxType = $(this).data("type");

    console.log(`Checkbox changed: ${id}, type: ${checkboxType}, checked: ${$(this).is(":checked")}`);

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
    console.log(`Active selected count: ${selectedKodes.active.size}`);
    $("#btnMutasiSelected").prop("disabled", !hasSelected);
    
    // Update text button untuk debugging
    if (hasSelected) {
      $("#btnMutasiSelected").html(`<i class="fas fa-exchange-alt me-2"></i>Mutasi Terpilih (${selectedKodes.active.size})`);
    } else {
      $("#btnMutasiSelected").html(`<i class="fas fa-exchange-alt me-2"></i>Mutasi Terpilih`);
    }
  } else {
    const hasSelected = selectedKodes.mutated.size > 0;
    console.log(`Mutated selected count: ${selectedKodes.mutated.size}`);
    $("#btnRestoreSelected").prop("disabled", !hasSelected);
    $("#btnDeleteSelected").prop("disabled", !hasSelected);
  }
}

function updateCounters() {
  const filteredActive = filterKodeData(kodeData.active);
  const filteredMutated = filterKodeData(kodeData.mutated);
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

  console.log(`Showing modal for ${selectedItems.length} items`);

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
  const filteredData = filterKodeData(kodeData.mutated);
  exportToExcel(filteredData, "Kode_Dimutasi", "Kode Dimutasi");
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

  $("#btnMutasiSelected").off('click').on("click", function() {
    console.log(`Mutasi button clicked, selected: ${selectedKodes.active.size}`);
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

  $("#selectAllActive").off('change').on("change", function() {
    const isChecked = $(this).is(":checked");
    console.log(`Select all active: ${isChecked}`);
    
    $("#tableActiveKode .kode-checkbox").prop("checked", isChecked);
    
    if (isChecked) {
      const filteredActive = filterKodeData(kodeData.active);
      selectedKodes.active.clear();
      filteredActive.forEach(item => selectedKodes.active.add(item.id));
    } else {
      selectedKodes.active.clear();
    }
    updateButtonStatus("active");
  });

  $("#btnSaveMutasi").on("click", mutateSelectedKodes);

  $("#selectAllMutated").on("change", function () {
    const isChecked = $(this).is(":checked");
    $("#tableMutatedKode .kode-checkbox").prop("checked", isChecked);

    if (isChecked) {
      const filteredMutated = filterKodeData(kodeData.mutated);
      filteredMutated.forEach((item) => selectedKodes.mutated.add(item.id));
    } else {
      selectedKodes.mutated = new Set();
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

// Initialize page
async function initializePage() {
  try {
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

    console.log("Page initialized successfully");
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
    console.log("Real-time listener unsubscribed");
  }
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
