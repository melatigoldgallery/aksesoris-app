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
  limit,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

import StockService from "./services/stockService.js";

const CACHE_TTL_STANDARD = 24 * 60 * 60 * 1000;

const cacheStorage = {
  kodeAksesoris: new Map(),
  stockAdditions: new Map(),
  stockData: new Map(),
  timestamps: new Map(),
};

// Fungsi untuk menyimpan cache dengan timestamp
function setCacheWithTimestamp(key, data, ttl = CACHE_TTL_STANDARD) {
  cacheStorage.kodeAksesoris.set(key, data);
  cacheStorage.timestamps.set(key, {
    timestamp: Date.now(),
    ttl: ttl,
  });

  try {
    sessionStorage.setItem(
      `cache_${key}`,
      JSON.stringify({
        data: data,
        timestamp: Date.now(),
        ttl: ttl,
      })
    );
  } catch (error) {
    // Silent fail
  }
}

// Fungsi untuk mengambil cache dengan validasi TTL
function getCacheWithValidation(key) {
  const now = Date.now();

  if (cacheStorage.kodeAksesoris.has(key) && cacheStorage.timestamps.has(key)) {
    const meta = cacheStorage.timestamps.get(key);
    if (now - meta.timestamp < meta.ttl) {
      return cacheStorage.kodeAksesoris.get(key);
    } else {
      cacheStorage.kodeAksesoris.delete(key);
      cacheStorage.timestamps.delete(key);
    }
  }

  try {
    const cached = sessionStorage.getItem(`cache_${key}`);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (now - parsedCache.timestamp < parsedCache.ttl) {
        cacheStorage.kodeAksesoris.set(key, parsedCache.data);
        cacheStorage.timestamps.set(key, {
          timestamp: parsedCache.timestamp,
          ttl: parsedCache.ttl,
        });
        return parsedCache.data;
      } else {
        sessionStorage.removeItem(`cache_${key}`);
      }
    }
  } catch (error) {
    // Silent fail for cache read
  }

  return null;
}

// Fungsi untuk menghapus cache
function invalidateCache(pattern = null) {
  if (pattern) {
    for (const key of cacheStorage.kodeAksesoris.keys()) {
      if (key.includes(pattern)) {
        cacheStorage.kodeAksesoris.delete(key);
        cacheStorage.timestamps.delete(key);
        sessionStorage.removeItem(`cache_${key}`);
      }
    }
  } else {
    cacheStorage.kodeAksesoris.clear();
    cacheStorage.timestamps.clear();
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("cache_")) {
        sessionStorage.removeItem(key);
      }
    }
  }
}

// � Smart incremental cache update - pass data to avoid refetch!
// This eliminates ~200 Firestore reads per change (saves ~Rp1000/operation)
function signalKodeUpdate(kode, nama, kategori, action) {
  const changeInfo = {
    timestamp: Date.now(),
    action: action, // 'add', 'update', 'delete'
    kode: kode,
    nama: nama || "",
    kategori: kategori || "",
  };

  // Cross-tab sync (localStorage triggers 'storage' event in OTHER tabs)
  localStorage.setItem("stockMasterDataChanged", JSON.stringify(changeInfo));

  // Same-tab sync (CustomEvent fires in SAME tab)
  window.dispatchEvent(
    new CustomEvent("stockDataChanged", {
      detail: changeInfo,
    })
  );

  console.log(`🔄 Signaled kode ${action}:`, kode);
}

// Backward compatibility wrapper
function invalidateStockMasterCache() {
  // Legacy fallback: full invalidation if no specific kode
  localStorage.setItem(
    "stockMasterDataChanged",
    JSON.stringify({
      timestamp: Date.now(),
      action: "full_refresh",
    })
  );

  invalidateCache("kodeAksesoris");
  console.log("🔄 Stock master cache invalidated (full refresh)");
}

export const aksesorisSaleHandler = {
  cache: {
    lastUpdate: null,
  },

  OPSI_KOTAK: [],
  OPSI_AKSESORIS: [],
  OPSI_SILVER: [],
  modalKelolaKode: null,
  modalFormKode: null,
  currentKategori: "kotak",
  editingDocId: null,
  laporanData: [],

  // Fungsi inisialisasi
  async init() {
    this.initDomElements();
    await this.loadKodeAksesorisData();
    this.initModals();
    this.attachEventListeners();
    const selectKategori = document.getElementById("jenis-aksesoris");
    const tbody = document.querySelector("#tableTambahAksesoris tbody");
    this.handleCategoryChange(selectKategori.value, tbody);
    this.setTodayDate();
    this.renderStockAdditionHistory([]);
  },

  // Fungsi untuk mengisi tanggal hari ini
  setTodayDate() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = today.getFullYear();

    const formattedDate = `${day}/${month}/${year}`;
    const tanggalInput = document.getElementById("tanggal");
    if (tanggalInput) {
      tanggalInput.value = formattedDate;
    }
    const filterDateStart = document.getElementById("filterDateStart");
    const filterDateEnd = document.getElementById("filterDateEnd");
    if (filterDateStart) filterDateStart.value = formattedDate;
    if (filterDateEnd) filterDateEnd.value = formattedDate;
  },

  // Fungsi untuk inisialisasi elemen DOM
  initDomElements() {
    const elements = {
      selectKategori: document.getElementById("jenis-aksesoris"),
      btnTambahAksesoris: document.getElementById("btnTambahAksesoris"),
      tbody: document.querySelector("#tableTambahAksesoris tbody"),
      btnSimpanData: document.getElementById("btnSimpanData"),
      btnBatal: document.getElementById("btnBatal"),
      btnKelolaKode: document.getElementById("btnKelolaKode"),
      btnFilterHistory: document.getElementById("btnFilterHistory"),
      filterDateStart: document.getElementById("filterDateStart"),
      filterDateEnd: document.getElementById("filterDateEnd"),
    };

    const requiredElements = ["selectKategori", "btnTambahAksesoris", "tbody", "btnSimpanData"];
    for (const [key, element] of Object.entries(elements)) {
      if (!element && requiredElements.includes(key)) {
        console.error(`Elemen DOM ${key} tidak ditemukan.`);
      }
    }

    this.elements = elements;
  },

  async loadKodeAksesorisData() {
    const { OPSI_KOTAK, OPSI_AKSESORIS, OPSI_SILVER } = await this.fetchKodeAksesoris();
    this.OPSI_KOTAK = OPSI_KOTAK;
    this.OPSI_AKSESORIS = OPSI_AKSESORIS;
    this.OPSI_SILVER = OPSI_SILVER;
  },

  // Fungsi untuk inisialisasi modal
  initModals() {
    const modalKelolaKode = document.getElementById("modalKelolaKode");
    const modalFormKode = document.getElementById("modalFormKode");

    if (modalKelolaKode) {
      this.modalKelolaKode = new bootstrap.Modal(modalKelolaKode);
    }

    if (modalFormKode) {
      this.modalFormKode = new bootstrap.Modal(modalFormKode);
    }
  },

  // Fungsi untuk memasang event listener
  attachEventListeners() {
    // Event listener untuk perubahan kategori
    if (this.elements.selectKategori) {
      this.elements.selectKategori.addEventListener("change", () => {
        this.handleCategoryChange(this.elements.selectKategori.value, this.elements.tbody);
      });
    }

    // Event listener untuk tombol tambah aksesoris
    if (this.elements.btnTambahAksesoris) {
      this.elements.btnTambahAksesoris.addEventListener("click", () => {
        this.tambahBaris(this.elements.selectKategori.value, this.elements.tbody);
      });
    }

    // Event listener untuk tombol simpan data
    if (this.elements.btnSimpanData) {
      this.elements.btnSimpanData.addEventListener("click", () => {
        this.simpanData();
      });
    }

    // Event listener untuk tombol batal
    if (this.elements.btnBatal) {
      this.elements.btnBatal.addEventListener("click", () => {
        this.handleBatalClick();
      });
    }

    // Event listener untuk tombol kelola kode
    if (this.elements.btnKelolaKode) {
      this.elements.btnKelolaKode.addEventListener("click", () => {
        this.showKelolaKodeModal();
      });
    }

    // Event listener untuk tombol filter riwayat
    if (this.elements.btnFilterHistory) {
      this.elements.btnFilterHistory.addEventListener("click", () => {
        this.loadStockAdditionHistory();
      });
    }

    // Event listeners untuk tab changes
    const kotakTab = document.getElementById("kotak-tab");
    const aksesorisTab = document.getElementById("aksesoris-tab");

    if (kotakTab) {
      kotakTab.addEventListener("click", () => {
        this.currentKategori = "kotak";
        this.loadKodeBarang("kotak");
      });
    }

    if (aksesorisTab) {
      aksesorisTab.addEventListener("click", () => {
        this.currentKategori = "aksesoris";
        this.loadKodeBarang("aksesoris");
      });
    }

    const silverTab = document.getElementById("silver-tab");
    if (silverTab) {
      silverTab.addEventListener("click", () => {
        this.currentKategori = "silver";
        this.loadKodeBarang("silver");
      });
    }

    // Event listeners untuk pencarian
    this.attachSearchListeners();

    // Event listeners untuk tombol tambah kode
    const btnTambahKotak = document.getElementById("btnTambahKotak");
    const btnTambahAksesorisKode = document.getElementById("btnTambahAksesorisKode");

    if (btnTambahKotak) {
      btnTambahKotak.addEventListener("click", () => {
        this.showFormKodeModal("kotak");
      });
    }

    if (btnTambahAksesorisKode) {
      btnTambahAksesorisKode.addEventListener("click", () => {
        this.showFormKodeModal("aksesoris");
      });
    }

    const btnTambahSilver = document.getElementById("btnTambahSilver");
    if (btnTambahSilver) {
      btnTambahSilver.addEventListener("click", () => {
        this.showFormKodeModal("silver");
      });
    }

    // Event listener untuk tombol simpan kode
    const btnSimpanKode = document.getElementById("btnSimpanKode");
    if (btnSimpanKode) {
      btnSimpanKode.addEventListener("click", () => {
        this.simpanKodeBarang();
      });
    }

    // Event listener untuk tombol print laporan
    if (document.getElementById("btnPrintLaporan")) {
      document.getElementById("btnPrintLaporan").addEventListener("click", () => {
        this.printLaporanTambahBarang();
      });
    }

    // Event listener untuk tombol export excel
    if (document.getElementById("btnExportExcel")) {
      document.getElementById("btnExportExcel").addEventListener("click", () => {
        this.exportToExcel();
      });
    }

    // Event listener untuk tombol hapus data
    if (document.getElementById("btnHapusData")) {
      document.getElementById("btnHapusData").addEventListener("click", () => {
        this.hapusDataRentang();
      });
    }

    // Event listener untuk tombol simpan edit transaksi
    if (document.getElementById("btnSimpanEditTransaksi")) {
      document.getElementById("btnSimpanEditTransaksi").addEventListener("click", () => {
        this.saveEditTransaction();
      });
    }

    // Event listener untuk tombol konfirmasi delete transaksi
    if (document.getElementById("btnKonfirmasiDeleteTransaksi")) {
      document.getElementById("btnKonfirmasiDeleteTransaksi").addEventListener("click", () => {
        this.confirmDeleteTransaction();
      });
    }

    this.initFilterDatepickers();
  },

  // Method untuk inisialisasi datepicker filter
  initFilterDatepickers() {
    $("#filterDateStart").datepicker({
      format: "dd/mm/yyyy",
      autoclose: true,
      language: "id",
      todayHighlight: true,
    });

    $("#filterDateEnd").datepicker({
      format: "dd/mm/yyyy",
      autoclose: true,
      language: "id",
      todayHighlight: true,
    });

    $(".input-group-text").on("click", function () {
      $(this).siblings("input").datepicker("show");
    });
  },

  // Fungsi untuk memasang event listener pencarian
  attachSearchListeners() {
    const searchKotak = document.getElementById("searchKotak");
    const clearSearchKotak = document.getElementById("clearSearchKotak");

    if (searchKotak) {
      searchKotak.addEventListener("input", () => {
        this.filterTable("kotak", searchKotak.value);
      });
    }

    if (clearSearchKotak) {
      clearSearchKotak.addEventListener("click", () => {
        if (searchKotak) {
          searchKotak.value = "";
          this.filterTable("kotak", "");
        }
      });
    }

    const searchAksesoris = document.getElementById("searchAksesoris");
    const clearSearchAksesoris = document.getElementById("clearSearchAksesoris");

    if (searchAksesoris) {
      searchAksesoris.addEventListener("input", () => {
        this.filterTable("aksesoris", searchAksesoris.value);
      });
    }

    if (clearSearchAksesoris) {
      clearSearchAksesoris.addEventListener("click", () => {
        if (searchAksesoris) {
          searchAksesoris.value = "";
          this.filterTable("aksesoris", "");
        }
      });
    }

    // Search untuk silver
    const searchSilver = document.getElementById("searchSilver");
    const clearSearchSilver = document.getElementById("clearSearchSilver");

    if (searchSilver) {
      searchSilver.addEventListener("input", () => {
        this.filterTable("silver", searchSilver.value);
      });
    }

    if (clearSearchSilver) {
      clearSearchSilver.addEventListener("click", () => {
        if (searchSilver) {
          searchSilver.value = "";
          this.filterTable("silver", "");
        }
      });
    }
  },

  // Fungsi untuk memfilter tabel berdasarkan input pencarian
  filterTable(kategori, searchText) {
    const tableId =
      kategori === "kotak" ? "tableKodeKotak" : kategori === "aksesoris" ? "tableKodeAksesoris" : "tableKodeSilver";
    const table = document.getElementById(tableId);

    if (!table) return;

    const rows = table.querySelectorAll("tbody tr");
    const lowerSearchText = searchText.toLowerCase();

    rows.forEach((row) => {
      const kodeCell = row.cells[1];
      const namaCell = row.cells[2];

      if (!kodeCell || !namaCell) return;

      const kodeText = kodeCell.textContent.toLowerCase();
      const namaText = namaCell.textContent.toLowerCase();
      if (kodeText.includes(lowerSearchText) || namaText.includes(lowerSearchText)) {
        row.style.display = "";
      } else {
        row.style.display = "none";
      }
    });

    const tbody = table.querySelector("tbody");
    const visibleRows = [...rows].filter((row) => row.style.display !== "none");

    if (visibleRows.length === 0 && searchText) {
      const noResultRow = [...rows].find((row) => row.classList.contains("no-result-row"));

      if (!noResultRow) {
        const newRow = document.createElement("tr");
        newRow.classList.add("no-result-row");
        newRow.innerHTML = `<td colspan="5" class="text-center">Tidak ada hasil untuk pencarian "${searchText}"</td>`;
        tbody.appendChild(newRow);
      }
    } else {
      const noResultRow = tbody.querySelector(".no-result-row");
      if (noResultRow) {
        noResultRow.remove();
      }
    }
  },

  // Fungsi untuk menangani klik tombol batal
  handleBatalClick() {
    this.showConfirmation("Apakah Anda yakin ingin membatalkan?").then((confirmed) => {
      if (confirmed) {
        this.elements.tbody.innerHTML = "";
        this.handleCategoryChange(this.elements.selectKategori.value, this.elements.tbody);
        document.getElementById("total-items").textContent = "0";
      }
    });
  },

  // Cache tidak expire berdasarkan waktu, hanya di-refresh saat CRUD operation
  async fetchKodeAksesoris() {
    try {
      const cacheKey = "kodeAksesoris_all";
      const cachedData = getCacheWithValidation(cacheKey);
      if (cachedData) {
        return cachedData;
      }
      const [kotakSnapshot, aksesorisSnapshot, silverSnapshot] = await Promise.all([
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "kotak")),
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "aksesoris")),
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "silver")),
      ]);

      const OPSI_KOTAK = [{ value: "0", text: "Pilih Kategori" }];
      const OPSI_AKSESORIS = [{ value: "0", text: "Pilih Kategori" }];
      const OPSI_SILVER = [{ value: "0", text: "Pilih Kategori" }];

      kotakSnapshot.forEach((doc) => {
        const data = doc.data();
        OPSI_KOTAK.push({
          id: doc.id,
          text: data.text,
          nama: data.nama,
        });
      });

      aksesorisSnapshot.forEach((doc) => {
        const data = doc.data();
        OPSI_AKSESORIS.push({
          id: doc.id,
          text: data.text,
          nama: data.nama,
        });
      });

      silverSnapshot.forEach((doc) => {
        const data = doc.data();
        OPSI_SILVER.push({
          id: doc.id,
          text: data.text,
          nama: data.nama,
        });
      });

      const result = { OPSI_KOTAK, OPSI_AKSESORIS, OPSI_SILVER };
      setCacheWithTimestamp(cacheKey, result, CACHE_TTL_STANDARD);

      return result;
    } catch (error) {
      console.error("Error fetching kode aksesoris:", error);
      return {
        OPSI_KOTAK: [{ value: "0", text: "Pilih Kategori" }],
        OPSI_AKSESORIS: [{ value: "0", text: "Pilih Kategori" }],
        OPSI_SILVER: [{ value: "0", text: "Pilih Kategori" }],
      };
    }
  },

  // Fungsi untuk menangani perubahan kategori
  handleCategoryChange(kategori, tbody) {
    tbody.innerHTML = "";
    const options =
      kategori === "1"
        ? this.OPSI_KOTAK
        : kategori === "2"
        ? this.OPSI_AKSESORIS
        : kategori === "3"
        ? this.OPSI_SILVER
        : [];
    this.updateAllKodeBarangOptions(options);
    if (options.length) {
      this.tambahBaris(kategori, tbody);
    }
    document.getElementById("total-items").textContent = "0";
  },

  // Fungsi untuk memperbarui opsi kode barang
  updateAllKodeBarangOptions(options) {
    const kodeBarangSelects = document.querySelectorAll(".kode-barang");
    kodeBarangSelects.forEach((select) => {
      select.innerHTML = options
        .map((option) => `<option value="${option.text}" data-nama="${option.nama}">${option.text}</option>`)
        .join("");
    });
  },

  // IMPROVED: Fungsi untuk memuat data kode barang untuk diedit dengan caching
  async loadKodeBarangData(docId, kategori) {
    try {
      const cacheKey = `kodeBarang_${kategori}_${docId}`;
      const cachedData = getCacheWithValidation(cacheKey);
      if (cachedData) {
        document.getElementById("textKode").value = cachedData.text;
        document.getElementById("namaKode").value = cachedData.nama;
        // Load harga jika kategori kotak
        if (kategori === "kotak" && cachedData.harga !== undefined) {
          document.getElementById("hargaKode").value = cachedData.harga || "";
        }
        return;
      }

      const docRef = doc(firestore, "kodeAksesoris", "kategori", kategori, docId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById("textKode").value = data.text;
        document.getElementById("namaKode").value = data.nama;
        // Load harga jika kategori kotak
        if (kategori === "kotak" && data.harga !== undefined) {
          document.getElementById("hargaKode").value = data.harga || "";
        }
        setCacheWithTimestamp(cacheKey, data, CACHE_TTL_STANDARD);
      } else {
        console.error("Dokumen tidak ditemukan!");
        alert("Data tidak ditemukan!");
      }
    } catch (error) {
      console.error("Error loading kode barang data:", error);
      alert("Gagal memuat data: " + error.message);
    }
  },

  // Fungsi untuk menambah baris baru
  tambahBaris(kategori, tbody) {
    const newRow = document.createElement("tr");
    const rowCount = tbody.children.length + 1;

    const options = kategori === "1" ? this.OPSI_KOTAK : kategori === "2" ? this.OPSI_AKSESORIS : this.OPSI_SILVER;

    newRow.innerHTML = `
                  <td>${rowCount}</td>
                  <td>
                      <select class="form-select kode-barang">
                          ${options
                            .map(
                              (option) =>
                                `<option value="${option.text}" data-nama="${option.nama}">${option.text}</option>`
                            )
                            .join("")}
                      </select>
                  </td>
                  <td><input type="text" class="form-control nama-barang" placeholder="Nama Barang" readonly></td>
                  <td><input type="number" class="form-control jumlah-barang" placeholder="Jumlah" min="1"></td>
                  <td><button type="button" class="btn btn-danger btn-sm btn-hapus"><i class="fas fa-trash"></i></button></td>
              `;

    tbody.appendChild(newRow);
    this.attachRowEventListeners(newRow, tbody);
  },

  // Fungsi untuk memasang event listener pada baris
  attachRowEventListeners(row, tbody) {
    this.attachCalculationListeners(row, tbody);
    this.attachDeleteListener(row, tbody);
    this.attachKodeBarangListener(row);
  },

  // Fungsi untuk memasang event listener perhitungan
  attachCalculationListeners(row, tbody) {
    const jumlahInput = row.querySelector(".jumlah-barang");

    jumlahInput.addEventListener("input", () => {
      this.updateTotalItems(tbody);
    });
  },

  // Fungsi untuk memasang event listener hapus
  attachDeleteListener(row, tbody) {
    const deleteButton = row.querySelector(".btn-hapus");
    deleteButton.addEventListener("click", () => {
      this.handleDeleteRow(row, tbody);
    });
  },

  // Fungsi untuk menangani penghapusan baris
  handleDeleteRow(row, tbody) {
    if (tbody.children.length > 1) {
      row.remove();
      this.renumberRows(tbody);
      this.updateTotalItems(tbody);
    } else {
      this.showErrorNotification("Minimal harus ada satu baris!");
    }
  },

  // Fungsi untuk memasang event listener pada kode barang
  attachKodeBarangListener(row) {
    const kodeBarangSelect = row.querySelector(".kode-barang");
    const namaBarangInput = row.querySelector(".nama-barang");

    kodeBarangSelect.addEventListener("change", () => {
      this.updateNamaBarang(kodeBarangSelect, namaBarangInput);
    });

    // Trigger change event to set initial value
    kodeBarangSelect.dispatchEvent(new Event("change"));
  },

  // Fungsi untuk memperbarui nama barang
  updateNamaBarang(kodeBarangSelect, namaBarangInput) {
    const selectedOption = kodeBarangSelect.options[kodeBarangSelect.selectedIndex];
    const nama = selectedOption.getAttribute("data-nama");
    namaBarangInput.value = nama || "";
  },

  // Fungsi untuk menomori ulang baris
  renumberRows(tbody) {
    const rows = tbody.querySelectorAll("tr");
    rows.forEach((row, index) => {
      row.cells[0].textContent = index + 1;
    });
  },

  // Fungsi untuk memperbarui total items
  updateTotalItems(tbody) {
    const jumlahInputs = tbody.querySelectorAll(".jumlah-barang");
    let totalItems = 0;

    jumlahInputs.forEach((input) => {
      totalItems += parseInt(input.value) || 0;
    });

    const totalItemsElement = document.getElementById("total-items");
    if (totalItemsElement) {
      totalItemsElement.textContent = totalItems;
    }
  },

  async simpanData() {
    try {
      this.showLoading(true);
      if (!this.validateTransactionData()) {
        this.showLoading(false);
        return;
      }
      const items = this.collectItemsData();
      if (!items) {
        this.showLoading(false);
        return;
      }

      // ✅ Update stok aksesoris via StockService (single source of truth)
      await this.updateStokAksesoris(items);

      // IMPROVED: Invalidate related caches
      invalidateCache("stockAdditionHistory");
      invalidateCache("stockData");

      // Set flag untuk invalidate cache di halaman penjualan (cross-page)
      sessionStorage.setItem("stokAksesoris_needsRefresh", "true");
      sessionStorage.setItem("stokAksesoris_lastUpdate", Date.now().toString());

      const totalItems = items.reduce((total, item) => total + item.jumlah, 0);
      const kategoriText = this.elements.selectKategori.value === "1" ? "Kotak" : "Aksesoris";
      this.showSuccessNotification(`
              ${totalItems} item ${kategoriText} berhasil ditambahkan!
              
              Detail:
              ${items.map((item) => `• ${item.nama} (${item.kodeText}): ${item.jumlah} pcs`).join("\n")}
            `);
      this.loadStockAdditionHistory();
      this.resetForm();

      this.showLoading(false);
    } catch (error) {
      console.error("Error saving data:", error);
      this.showErrorNotification("Gagal menyimpan data: " + error.message);
      this.showLoading(false);
    }
  },

  // Fungsi untuk validasi data
  validateTransactionData() {
    const tanggal = document.getElementById("tanggal").value;
    const jenisAksesoris = document.getElementById("jenis-aksesoris");

    if (!tanggal) {
      this.showErrorNotification("Tanggal harus diisi!");
      return false;
    }

    if (jenisAksesoris.value === "Pilih Kategori") {
      this.showErrorNotification("Jenis aksesoris harus dipilih!");
      return false;
    }

    return true;
  },

  // Fungsi untuk mengumpulkan data item
  collectItemsData() {
    const tbody = document.querySelector("#tableTambahAksesoris tbody");
    const rows = tbody.querySelectorAll("tr");
    const items = [];
    let isValid = true;

    rows.forEach((row, index) => {
      const kodeSelect = row.querySelector(".kode-barang");
      const kodeText = kodeSelect.value;
      const namaBarang = row.querySelector(".nama-barang").value;
      const jumlah = row.querySelector(".jumlah-barang").value;

      if (kodeText === "Pilih Kategori" || !jumlah) {
        this.showErrorNotification(`Data pada baris ${index + 1} belum lengkap!`);
        isValid = false;
        return;
      }

      items.push({
        kodeText: kodeText,
        nama: namaBarang,
        jumlah: parseInt(jumlah),
        kategori:
          this.elements.selectKategori.value === "1"
            ? "kotak"
            : this.elements.selectKategori.value === "2"
            ? "aksesoris"
            : "silver",
      });
    });
    return isValid ? items : null;
  },

  // Fungsi untuk membuat objek data penambahan stok
  createStockAdditionData(items) {
    const tanggal = document.getElementById("tanggal").value;
    const jenisAksesoris = document.getElementById("jenis-aksesoris");
    const jenisText = jenisAksesoris.options[jenisAksesoris.selectedIndex].text;

    return {
      tanggal: tanggal,
      jenisAksesoris: jenisAksesoris.value,
      jenisText: jenisText,
      items: items,
      timestamp: serverTimestamp(),
      totalItems: items.reduce((total, item) => total + item.jumlah, 0),
    };
  },

  // Fungsi untuk menyimpan data penambahan stok ke Firestore
  async saveStockAdditionToFirestore(data) {
    try {
      const docRef = await addDoc(collection(firestore, "stockAdditions"), data);
      console.log("Data berhasil disimpan dengan ID:", docRef.id);
      return docRef.id;
    } catch (error) {
      console.error("Gagal menyimpan data:", error);
      throw error;
    }
  },

  // OPTIMIZED: Update stok dan invalidate cache - hanya refresh data yang berubah
  async updateStokAksesoris(items) {
    try {
      invalidateCache("stockData");

      const tanggal = document.getElementById("tanggal").value;
      const currentUser = JSON.parse(sessionStorage.getItem("currentUser") || "{}");
      const salesName = currentUser.username || "System";

      for (const item of items) {
        await StockService.updateStock({
          kode: item.kodeText,
          nama: item.nama,
          kategori: item.kategori,
          jenis: "stockAddition",
          jumlah: parseInt(item.jumlah) || 0,
          keterangan: `Tambah stok: ${item.nama}`,
          sales: salesName,
          tanggal: tanggal,
        });
      }

      invalidateCache("stockData");
    } catch (error) {
      console.error("Error updating stok aksesoris:", error);
      throw error;
    }
  },

  printLaporanTambahBarang() {
    const filterDateStart = document.getElementById("filterDateStart");
    const filterDateEnd = document.getElementById("filterDateEnd");

    if (!filterDateStart?.value || !filterDateEnd?.value) {
      this.showErrorNotification("Silakan pilih rentang tanggal terlebih dahulu!");
      return;
    }

    if (!this.laporanData || this.laporanData.length === 0) {
      this.showErrorNotification("Tidak ada data untuk dicetak pada rentang tanggal tersebut!");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      this.showErrorNotification("Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.");
      return;
    }

    const html = this.generateLaporanHTML();
    printWindow.document.write(html);
    printWindow.document.close();
  },

  // Fungsi untuk export data ke Excel
  async exportToExcel() {
    const filterDateStart = document.getElementById("filterDateStart");
    const filterDateEnd = document.getElementById("filterDateEnd");

    if (!filterDateStart?.value || !filterDateEnd?.value) {
      this.showErrorNotification("Silakan pilih rentang tanggal terlebih dahulu!");
      return;
    }

    if (!this.laporanData || this.laporanData.length === 0) {
      this.showErrorNotification("Tidak ada data untuk diekspor pada rentang tanggal tersebut!");
      return;
    }

    try {
      // Prepare data untuk Excel
      const excelData = this.laporanData.map((item, index) => ({
        No: index + 1,
        Tanggal: item.tanggal || "-",
        Kategori: item.jenisText || "-",
        "Kode Barang": item.kodeText || "-",
        "Nama Barang": item.nama || "-",
        Jumlah: item.jumlah || 0,
      }));

      // Tambahkan row total
      const totalItems = this.laporanData.reduce((sum, item) => sum + (item.jumlah || 0), 0);
      excelData.push({
        No: "",
        Tanggal: "",
        Kategori: "",
        "Kode Barang": "",
        "Nama Barang": "TOTAL",
        Jumlah: totalItems,
      });

      // Create workbook dan worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Laporan Tambah Stok");

      // Set column widths
      ws["!cols"] = [
        { wch: 5 }, // No
        { wch: 12 }, // Tanggal
        { wch: 15 }, // Kategori
        { wch: 15 }, // Kode Barang
        { wch: 30 }, // Nama Barang
        { wch: 10 }, // Jumlah
      ];

      // Generate filename dengan tanggal
      const filename = `Laporan_Tambah_Stok_${filterDateStart.value.replace(
        /\//g,
        "-"
      )}_sd_${filterDateEnd.value.replace(/\//g, "-")}.xlsx`;

      // Download file
      XLSX.writeFile(wb, filename);

      this.showSuccessNotification("Data berhasil diekspor ke Excel!");
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      this.showErrorNotification("Gagal mengekspor data: " + error.message);
    }
  },

  // Fungsi untuk hapus data sesuai rentang tanggal
  async hapusDataRentang() {
    const filterDateStart = document.getElementById("filterDateStart");
    const filterDateEnd = document.getElementById("filterDateEnd");

    if (!filterDateStart?.value || !filterDateEnd?.value) {
      this.showErrorNotification("Silakan pilih rentang tanggal terlebih dahulu!");
      return;
    }

    if (!this.laporanData || this.laporanData.length === 0) {
      this.showErrorNotification("Tidak ada data untuk dihapus pada rentang tanggal tersebut!");
      return;
    }

    const confirmed = await this.showConfirmation(
      `Apakah Anda yakin ingin menghapus <strong>${this.laporanData.length} data</strong> pada rentang tanggal <strong>${filterDateStart.value}</strong> s/d <strong>${filterDateEnd.value}</strong>?<br><br><span class="text-danger"><i class="fas fa-exclamation-triangle"></i> Tindakan ini tidak dapat dibatalkan!</span>`,
      "Konfirmasi Hapus Data"
    );

    if (!confirmed) return;

    try {
      this.showLoading(true);

      // Parse tanggal
      const startParts = filterDateStart.value.split("/");
      const endParts = filterDateEnd.value.split("/");
      const startDate = new Date(startParts[2], startParts[1] - 1, startParts[0]);
      const endDate = new Date(endParts[2], endParts[1] - 1, endParts[0]);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      // Query data yang akan dihapus
      const transactionsRef = collection(firestore, "stokAksesorisTransaksi");
      const q = query(
        transactionsRef,
        where("jenis", "==", "stockAddition"),
        where("timestamp", ">=", Timestamp.fromDate(startDate)),
        where("timestamp", "<=", Timestamp.fromDate(endDate))
      );

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        this.showErrorNotification("Tidak ada data yang ditemukan untuk dihapus!");
        this.showLoading(false);
        return;
      }

      // Hapus setiap dokumen
      let deletedCount = 0;
      const deletePromises = [];

      snapshot.forEach((docSnapshot) => {
        deletePromises.push(deleteDoc(doc(firestore, "stokAksesorisTransaksi", docSnapshot.id)));
        deletedCount++;
      });

      await Promise.all(deletePromises);

      // Invalidate cache
      invalidateCache("stockAdditionHistory");
      invalidateCache("stockData");

      // Refresh tampilan
      await this.loadStockAdditionHistory();

      this.showLoading(false);
      this.showSuccessNotification(`Berhasil menghapus ${deletedCount} data penambahan stok!`);
    } catch (error) {
      console.error("Error deleting data:", error);
      this.showLoading(false);
      this.showErrorNotification("Gagal menghapus data: " + error.message);
    }
  },

  // Method untuk generate HTML laporan
  generateLaporanHTML() {
    const filterDateStart = document.getElementById("filterDateStart").value;
    const filterDateEnd = document.getElementById("filterDateEnd").value;
    const groupedData = this.laporanData.reduce((acc, item) => {
      const kategori = item.jenisText || "Lainnya";
      if (!acc[kategori]) acc[kategori] = [];
      acc[kategori].push(item);
      return acc;
    }, {});

    const totalItems = this.laporanData.reduce((sum, item) => sum + (item.jumlah || 0), 0);

    let laporanHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Laporan Tambah Barang</title>
        <style>
          @page { size: A4; margin: 1cm; }
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 0; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .header h2 { margin: 5px 0; }
          .header h3 { margin: 5px 0; color: #666; }
          .period { text-align: center; margin: 15px 0; font-weight: bold; }
          .category-section { margin: 20px 0; }
          .category-title { background-color: #f0f0f0; padding: 8px; font-weight: bold; border: 1px solid #ccc; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
          th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
          th { background-color: #f8f9fa; font-weight: bold; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .summary { margin-top: 20px; border-top: 2px solid #000; padding-top: 10px; }
          .summary table { width: 50%; margin-left: auto; }
          .footer { margin-top: 30px; text-align: right; }
          .no-data { text-align: center; color: #666; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>MELATI BAWAH</h2>
          <h2>LAPORAN PENAMBAHAN STOK</h2>
        </div>
        
        <div class="period">
          Periode: ${filterDateStart} s/d ${filterDateEnd}
        </div>
    `;

    Object.entries(groupedData).forEach(([kategori, items]) => {
      const subtotal = items.reduce((sum, item) => sum + (item.jumlah || 0), 0);

      laporanHTML += `
        <div class="category-section">
          <div class="category-title">${kategori.toUpperCase()} (${subtotal} pcs)</div>
          <table>
            <thead>
              <tr>
                <th width="15%">Tanggal</th>
                <th width="20%">Kode Barang</th>
                <th width="45%">Nama Barang</th>
                <th width="20%" class="text-center">Jumlah</th>
              </tr>
            </thead>
            <tbody>
      `;

      items.forEach((item) => {
        // Format tanggal dengan fallback dari timestamp
        let displayTanggal = item.tanggal || "-";
        if ((!item.tanggal || item.tanggal === "-") && item.timestamp) {
          try {
            const date = item.timestamp.toDate ? item.timestamp.toDate() : new Date(item.timestamp);
            const day = String(date.getDate()).padStart(2, "0");
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const year = date.getFullYear();
            displayTanggal = `${day}/${month}/${year}`;
          } catch (e) {
            displayTanggal = "-";
          }
        }

        laporanHTML += `
          <tr>
            <td>${displayTanggal}</td>
            <td>${item.kodeText || "-"}</td>
            <td>${item.nama || "-"}</td>
            <td class="text-center"><strong>${item.jumlah || 0}</strong></td>
          </tr>
        `;
      });

      laporanHTML += `
            </tbody>
            <tfoot>
              <tr style="background-color: #f8f9fa;">
                <td colspan="3" class="text-right"><strong>Subtotal ${kategori}:</strong></td>
                <td class="text-center"><strong>${subtotal} pcs</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    });

    laporanHTML += `
        <div class="summary">
          <table>
            <tr>
              <td><strong>TOTAL KESELURUHAN:</strong></td>
              <td class="text-center"><strong>${totalItems} pcs</strong></td>
            </tr>
          </table>
        </div>
        
        <div class="footer">
          <p>Dicetak pada: ${new Date().toLocaleString("id-ID")}</p>
        </div>
        
        <script>
          window.onload = function() {
            setTimeout(() => {
              window.print();
              setTimeout(() => window.close(), 500);
            }, 500);
          };
        </script>
      </body>
      </html>
    `;

    return laporanHTML;
  },

  async loadStockAdditionHistory() {
    try {
      const filterDateStart = document.getElementById("filterDateStart");
      const filterDateEnd = document.getElementById("filterDateEnd");
      if (!filterDateStart || !filterDateEnd || !filterDateStart.value || !filterDateEnd.value) {
        this.renderStockAdditionHistory([]);
        return;
      }

      const startParts = filterDateStart.value.split("/");
      const endParts = filterDateEnd.value.split("/");

      if (startParts.length !== 3 || endParts.length !== 3) {
        throw new Error("Format tanggal tidak valid");
      }

      const startDate = new Date(startParts[2], startParts[1] - 1, startParts[0]);
      const endDate = new Date(endParts[2], endParts[1] - 1, endParts[0]);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error("Tanggal tidak valid");
      }

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      // Create cache key
      const cacheKey = `stockAdditionHistory_${filterDateStart.value}_${filterDateEnd.value}`;

      const cachedData = getCacheWithValidation(cacheKey);
      if (cachedData) {
        this.laporanData = cachedData;
        this.renderStockAdditionHistory(cachedData);
        return;
      }

      // ✅ Query dari stokAksesorisTransaksi dengan filter jenis stockAddition
      const transactionsRef = collection(firestore, "stokAksesorisTransaksi");
      const q = query(
        transactionsRef,
        where("jenis", "==", "stockAddition"),
        where("timestamp", ">=", Timestamp.fromDate(startDate)),
        where("timestamp", "<=", Timestamp.fromDate(endDate)),
        orderBy("timestamp", "desc")
      );

      const snapshot = await getDocs(q);
      const historyData = [];

      snapshot.forEach((doc) => {
        const data = doc.data();

        // Determine kategori untuk jenisText
        let jenisText = "Lainnya";
        if (data.kategori === "kotak") jenisText = "Kotak";
        else if (data.kategori === "aksesoris") jenisText = "Aksesoris";
        else if (data.kategori === "silver") jenisText = "Silver";

        historyData.push({
          id: doc.id,
          timestamp: data.timestamp,
          tanggal: data.tanggal || "-",
          jenisText: jenisText,
          kodeText: data.kode,
          nama: data.nama || data.keterangan || "-",
          jumlah: data.jumlah || 0,
        });
      });

      // Simpan ke cache dengan TTL panjang
      setCacheWithTimestamp(cacheKey, historyData, CACHE_TTL_STANDARD);
      this.laporanData = historyData;
      this.renderStockAdditionHistory(historyData);
    } catch (error) {
      console.error("Error loading stock addition history:", error);
      this.showErrorNotification("Gagal memuat riwayat: " + error.message);
      this.renderStockAdditionHistory([]);
    }
  },

  // Method untuk set default filter dates
  setDefaultFilterDates() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = today.getFullYear();
    const formattedDate = `${day}/${month}/${year}`;

    const filterDateStart = document.getElementById("filterDateStart");
    const filterDateEnd = document.getElementById("filterDateEnd");

    if (filterDateStart) filterDateStart.value = formattedDate;
    if (filterDateEnd) filterDateEnd.value = formattedDate;
  },
  renderStockAdditionHistory(historyData = []) {
    const tableBody = document.querySelector("#tableRiwayatTambahStok tbody");

    if (!tableBody) {
      console.error("Table body element not found");
      return;
    }
    tableBody.innerHTML = "";

    if (!historyData || historyData.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-muted py-5">
            <i class="fas fa-calendar-alt fa-2x mb-3 opacity-50"></i>
            <div class="h6">Pilih rentang tanggal dan klik tombol "Tampilkan" untuk melihat riwayat</div>
          </td>
        </tr>
      `;
      return;
    }
    historyData.forEach((item) => {
      // Format tanggal dengan fallback dari timestamp jika field tanggal tidak ada atau tidak valid
      let displayTanggal = "-";

      // Cek apakah item.tanggal valid (bukan empty, "-", atau mengandung "NaN")
      if (item.tanggal && item.tanggal !== "-" && !item.tanggal.includes("NaN")) {
        displayTanggal = item.tanggal;
      }
      // Fallback ke timestamp jika tanggal tidak valid atau kosong
      else if (item.timestamp) {
        try {
          const date = item.timestamp.toDate ? item.timestamp.toDate() : new Date(item.timestamp);
          if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, "0");
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const year = date.getFullYear();
            displayTanggal = `${day}/${month}/${year}`;
          }
        } catch (e) {
          console.warn("Failed to format timestamp:", e);
          displayTanggal = "-";
        }
      }

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${displayTanggal}</td>
        <td>${item.kodeText || "-"}</td>
        <td>${item.nama || "-"}</td>
        <td class="text-center">
          <span class="badge bg-primary">${item.jumlah || 0} pcs</span>
        </td>
        <td>
          <button class="btn btn-sm btn-warning me-1 btn-edit-transaksi" data-id="${item.id}" title="Edit">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-danger btn-delete-transaksi" data-id="${item.id}" title="Hapus">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
      tableBody.appendChild(row);
    });

    // Attach event listeners untuk tombol aksi
    this.attachTransactionActionListeners();
  },

  // Fungsi untuk menampilkan loading indicator
  showLoading(isLoading) {
    if (isLoading) {
      let loadingOverlay = document.getElementById("loadingOverlay");
      if (!loadingOverlay) {
        loadingOverlay = document.createElement("div");
        loadingOverlay.id = "loadingOverlay";
        loadingOverlay.innerHTML = `
          <div class="loading-spinner">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Menyimpan data...</p>
          </div>
        `;
        loadingOverlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
        `;
        document.body.appendChild(loadingOverlay);
      } else {
        loadingOverlay.style.display = "flex";
      }
    } else {
      const loadingOverlay = document.getElementById("loadingOverlay");
      if (loadingOverlay) {
        loadingOverlay.style.display = "none";
      }
    }
  },

  // Fungsi untuk menampilkan notifikasi sukses
  showSuccessNotification(message) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "success",
        title: "Berhasil!",
        html: message.replace(/\n/g, "<br>"),
        confirmButtonColor: "#28a745",
        timer: 3000,
        timerProgressBar: true,
        showClass: {
          popup: "animate__animated animate__fadeInDown",
        },
        hideClass: {
          popup: "animate__animated animate__fadeOutUp",
        },
        didOpen: (toast) => {
          toast.addEventListener("mouseenter", Swal.stopTimer);
          toast.addEventListener("mouseleave", Swal.resumeTimer);
        },
      });
    } else {
      alert(message);
    }
  },

  // Fungsi untuk menampilkan notifikasi error
  showErrorNotification(message) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "error",
        title: "Error!",
        html: message.replace(/\n/g, "<br>"),
        confirmButtonColor: "#dc3545",
        showClass: {
          popup: "animate__animated animate__shakeX",
        },
        footer: '<span class="text-muted">Jika masalah berlanjut, hubungi administrator</span>',
      });
    } else {
      alert(message);
    }
  },

  // Tambahkan fungsi untuk konfirmasi
  showConfirmation(message, title = "Konfirmasi") {
    return new Promise((resolve) => {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          title: title,
          html: message.replace(/\n/g, "<br>"),
          icon: "question",
          showCancelButton: true,
          confirmButtonColor: "#28a745",
          cancelButtonColor: "#dc3545",
          confirmButtonText: "Ya",
          cancelButtonText: "Tidak",
        }).then((result) => {
          resolve(result.isConfirmed);
        });
      } else {
        resolve(confirm(message));
      }
    });
  },

  // Fungsi untuk mereset form
  resetForm() {
    this.setTodayDate();
    document.getElementById("jenis-aksesoris").value = "Pilih Kategori";
    const tbody = document.querySelector("#tableTambahAksesoris tbody");
    tbody.innerHTML = "";
    this.tambahBaris(document.getElementById("jenis-aksesoris").value, tbody);
    document.getElementById("total-items").textContent = "0";
  },

  showKelolaKodeModal() {
    this.loadKodeBarang("kotak");
    this.modalKelolaKode.show();
  },

  async loadKodeBarang(kategori) {
    try {
      const tableId =
        kategori === "kotak" ? "tableKodeKotak" : kategori === "aksesoris" ? "tableKodeAksesoris" : "tableKodeSilver";
      const tableBody = document.querySelector(`#${tableId} tbody`);

      if (!tableBody) {
        console.error(`Table body dengan id ${tableId} tidak ditemukan.`);
        return;
      }

      tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';
      const cacheKey = `kodeBarang_${kategori}`;

      // 🔥 PERBAIKAN: Invalidate cache dulu untuk memastikan data terbaru dengan field harga
      invalidateCache(cacheKey);

      const snapshot = await getDocs(collection(firestore, "kodeAksesoris", "kategori", kategori));

      if (snapshot.empty) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Tidak ada data</td></tr>';
        return;
      }

      const kodeData = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        kodeData.push({
          id: doc.id,
          text: data.text,
          nama: data.nama,
          harga: data.harga || 0, // ✅ Tambahkan field harga
        });
      });

      // Debug: Log data untuk memastikan harga dimuat
      console.log(`📦 Loaded ${kodeData.length} items for kategori '${kategori}':`, kodeData);

      setCacheWithTimestamp(cacheKey, kodeData, CACHE_TTL_STANDARD);
      this.renderKodeBarangTable(tableBody, kodeData, kategori);
    } catch (error) {
      console.error("Error loading kode barang:", error);
      const tableId =
        kategori === "kotak" ? "tableKodeKotak" : kategori === "aksesoris" ? "tableKodeAksesoris" : "tableKodeSilver";
      const tableBody = document.querySelector(`#${tableId} tbody`);
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${error.message}</td></tr>`;
      }
    }
  },

  // Render tabel kode barang
  renderKodeBarangTable(tableBody, kodeData, kategori) {
    let html = "";
    let no = 1;

    kodeData.forEach((item) => {
      // 🔥 PERBAIKAN: Hanya tampilkan "-" jika harga benar-benar tidak ada (undefined/null)
      // Jika harga = 0, tetap tampilkan Rp 0
      const hargaColumn =
        kategori === "kotak"
          ? `<td>${
              item.harga !== undefined && item.harga !== null
                ? `Rp ${parseInt(item.harga).toLocaleString("id-ID")}`
                : "-"
            }</td>`
          : "";

      // Debug log per item
      if (kategori === "kotak") {
        console.log(`Item ${item.text}: harga =`, item.harga);
      }

      html += `
        <tr>
          <td>${no++}</td>
          <td>${item.text}</td>
          <td>${item.nama}</td>
          ${hargaColumn}
          <td>
            <button class="btn btn-warning btn-sm me-1 btn-edit" data-id="${item.id}">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-danger btn-sm btn-delete" data-id="${item.id}">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    });
    tableBody.innerHTML = html;
    this.attachKodeBarangActionListeners(tableBody, kategori);
  },

  // Fungsi untuk memasang event listener pada tombol aksi kode barang
  attachKodeBarangActionListeners(tableBody, kategori) {
    const editButtons = tableBody.querySelectorAll(".btn-edit");
    editButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const docId = button.getAttribute("data-id");
        this.editKodeBarang(docId, kategori);
      });
    });

    const deleteButtons = tableBody.querySelectorAll(".btn-delete");
    deleteButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const docId = button.getAttribute("data-id");
        this.deleteKodeBarang(docId, kategori);
      });
    });
  },

  // Fungsi untuk menampilkan form modal tambah kode
  showFormKodeModal(kategori, docId = null) {
    document.getElementById("formKodeBarang").reset();
    document.getElementById("kategoriKode").value = kategori;
    const modalTitle = document.getElementById("modalFormKodeLabel");
    const hargaContainer = document.getElementById("hargaKodeContainer");

    // Tampilkan input harga hanya untuk kategori kotak
    if (hargaContainer) {
      hargaContainer.style.display = kategori === "kotak" ? "block" : "none";
    }

    if (modalTitle) {
      modalTitle.textContent = docId ? "Edit Kode Barang" : "Tambah Kode Baru";
    }
    if (docId) {
      document.getElementById("docId").value = docId;
      this.loadKodeBarangData(docId, kategori);
    } else {
      document.getElementById("docId").value = "";
    }
    this.modalFormKode.show();
  },

  async simpanKodeBarang() {
    if (!this.validateKodeBarangForm()) {
      return;
    }
    const docId = document.getElementById("docId").value;
    const kategori = document.getElementById("kategoriKode").value;
    const text = document.getElementById("textKode").value;
    const nama = document.getElementById("namaKode").value;
    const harga = document.getElementById("hargaKode").value;

    const data = {
      text: text || "",
      nama: nama || "",
    };

    // Tambahkan field harga hanya untuk kategori kotak
    if (kategori === "kotak" && harga) {
      data.harga = parseInt(harga) || 0;
    }

    try {
      if (docId) {
        await this.updateKodeBarang(docId, kategori, data);
      } else {
        await this.addKodeBarang(kategori, data);
      }

      invalidateCache("kodeAksesoris");
      invalidateCache(`kodeBarang_${kategori}`);

      // Set flag untuk invalidate cache di halaman lain (cross-page)
      sessionStorage.setItem("stokAksesoris_needsRefresh", "true");
      sessionStorage.setItem("stokAksesoris_lastUpdate", Date.now().toString());

      this.modalFormKode.hide();
      this.loadKodeBarang(kategori);
      await this.loadKodeAksesorisData();
      const selectKategori = document.getElementById("jenis-aksesoris");
      if (
        selectKategori &&
        ((selectKategori.value === "1" && kategori === "kotak") ||
          (selectKategori.value === "2" && kategori === "aksesoris") ||
          (selectKategori.value === "3" && kategori === "silver"))
      ) {
        const tbody = document.querySelector("#tableTambahAksesoris tbody");
        this.handleCategoryChange(selectKategori.value, tbody);
      }
    } catch (error) {
      console.error("Error saving kode barang:", error);
      this.showErrorNotification("Gagal menyimpan data: " + error.message);
    }
  },

  // Fungsi untuk validasi form kode barang
  validateKodeBarangForm() {
    const textKode = document.getElementById("textKode");
    const namaKode = document.getElementById("namaKode");

    if (!textKode || !namaKode) {
      console.error("Form elements not found");
      this.showErrorNotification("Terjadi kesalahan: Elemen form tidak ditemukan");
      return false;
    }

    const text = textKode.value;
    const nama = namaKode.value;

    if (!text || !nama) {
      this.showErrorNotification("Semua field harus diisi!");
      return false;
    }

    return true;
  },

  // Fungsi untuk menambah kode barang baru
  async addKodeBarang(kategori, data) {
    try {
      await addDoc(collection(firestore, "kodeAksesoris", "kategori", kategori), data);

      // Tambahkan entry di stokAksesoris (tanpa harga, karena harga ada di kodeAksesoris)
      const stokData = {
        kode: data.text,
        nama: data.nama,
        kategori: kategori,
      };

      await addDoc(collection(firestore, "stokAksesoris"), stokData);
      invalidateCache("stockData");

      // Signal kode addition with full data (zero extra Firestore reads!)
      signalKodeUpdate(data.text, data.nama, kategori, "add");

      this.showSuccessNotification("Data berhasil ditambahkan!");
    } catch (error) {
      console.error("Error adding kode barang:", error);
      throw error;
    }
  },

  // Fungsi untuk memperbarui kode barang
  async updateKodeBarang(docId, kategori, data) {
    try {
      const docRef = doc(firestore, "kodeAksesoris", "kategori", kategori, docId);
      await updateDoc(docRef, data);
      const stockQuery = query(collection(firestore, "stokAksesoris"), where("kode", "==", data.text), limit(1));
      const stockSnapshot = await getDocs(stockQuery);

      if (!stockSnapshot.empty) {
        // Update hanya nama di stokAksesoris (harga tidak disimpan di sini)
        const updateData = {
          nama: data.nama,
        };

        const stockDocRef = doc(firestore, "stokAksesoris", stockSnapshot.docs[0].id);
        await updateDoc(stockDocRef, updateData);
      }
      invalidateCache("stockData");

      // Signal kode update with full data (zero extra Firestore reads!)
      signalKodeUpdate(data.text, data.nama, kategori, "update");

      this.showSuccessNotification("Data berhasil diperbarui!");
    } catch (error) {
      console.error("Error updating kode barang:", error);
      throw error;
    }
  },

  async deleteKodeBarang(docId, kategori) {
    const confirmed = await this.showConfirmation("Apakah Anda yakin ingin menghapus kode ini?");
    if (!confirmed) {
      return;
    }
    try {
      const docRef = doc(firestore, "kodeAksesoris", "kategori", kategori, docId);
      const docSnap = await getDoc(docRef);
      const kodeData = docSnap.data();
      await deleteDoc(docRef);
      if (kodeData && kodeData.text) {
        const stockQuery = query(collection(firestore, "stokAksesoris"), where("kode", "==", kodeData.text), limit(1));
        const stockSnapshot = await getDocs(stockQuery);

        if (!stockSnapshot.empty) {
          await deleteDoc(doc(firestore, "stokAksesoris", stockSnapshot.docs[0].id));
          console.log(`✅ Kode ${kodeData.text} berhasil dihapus dari stokAksesoris`);
        }
      }

      this.showSuccessNotification("Data berhasil dihapus!");
      invalidateCache("kodeAksesoris");
      invalidateCache(`kodeBarang_${kategori}`);
      invalidateCache("stockData");

      // Signal kode deletion (zero extra Firestore reads!)
      signalKodeUpdate(kodeData.text, "", kategori, "delete");

      // Set flag untuk invalidate cache di halaman lain (cross-page)
      sessionStorage.setItem("stokAksesoris_needsRefresh", "true");
      sessionStorage.setItem("stokAksesoris_lastUpdate", Date.now().toString());

      this.loadKodeBarang(kategori);
      await this.loadKodeAksesorisData();
      const selectKategori = document.getElementById("jenis-aksesoris");
      if (
        selectKategori &&
        ((selectKategori.value === "1" && kategori === "kotak") ||
          (selectKategori.value === "2" && kategori === "aksesoris"))
      ) {
        const tbody = document.querySelector("#tableTambahAksesoris tbody");
        this.handleCategoryChange(selectKategori.value, tbody);
      }
    } catch (error) {
      console.error("Error deleting kode barang:", error);
      this.showErrorNotification("Gagal menghapus data: " + error.message);
    }
  },
  async editKodeBarang(docId, kategori) {
    this.showFormKodeModal(kategori, docId);
  },

  async setNextDayStartingStock() {
    try {
      const stockSnapshot = await getDocs(collection(firestore, "stokAksesoris"));
      const batch = firestore.batch();

      stockSnapshot.forEach((stockDoc) => {
        const stockData = stockDoc.data();
        const docRef = doc(firestore, "stokAksesoris", stockDoc.id);

        batch.update(docRef, {
          stokAwal: stockData.stokAkhir || 0,
          tambahStok: 0,
          laku: 0,
          free: 0,
          gantiLock: 0,
          lastUpdate: serverTimestamp(),
        });
      });
      await batch.commit();
      invalidateCache("stockData");
      invalidateCache("stockAdditions");
    } catch (error) {
      console.error("Error setting next day starting stock:", error);
      throw error;
    }
  },

  async forceRefreshCache() {
    try {
      invalidateCache();
      await this.loadKodeAksesorisData();
      const filterDateStart = document.getElementById("filterDateStart");
      const filterDateEnd = document.getElementById("filterDateEnd");

      if (filterDateStart?.value && filterDateEnd?.value) {
        await this.loadStockAdditionHistory();
      }

      this.showSuccessNotification("Cache berhasil disegarkan!");
    } catch (error) {
      console.error("Error refreshing cache:", error);
      this.showErrorNotification("Gagal menyegarkan cache: " + error.message);
    }
  },

  getCacheStatus() {
    const now = Date.now();
    const cacheInfo = [];

    for (const [key, meta] of cacheStorage.timestamps.entries()) {
      const isExpired = now - meta.timestamp > meta.ttl;
      const ageMinutes = Math.floor((now - meta.timestamp) / (1000 * 60));

      cacheInfo.push({
        key: key,
        age: ageMinutes,
        expired: isExpired,
        ttl: Math.floor(meta.ttl / (1000 * 60)),
      });
    }

    return cacheInfo;
  },

  cleanupExpiredCache() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, meta] of cacheStorage.timestamps.entries()) {
      if (now - meta.timestamp > meta.ttl) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach((key) => {
      cacheStorage.kodeAksesoris.delete(key);
      cacheStorage.timestamps.delete(key);
      sessionStorage.removeItem(`cache_${key}`);
    });

    return expiredKeys.length;
  },

  // Attach event listeners untuk tombol aksi di riwayat transaksi
  attachTransactionActionListeners() {
    // Event listener untuk tombol edit
    document.querySelectorAll(".btn-edit-transaksi").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const transactionId = e.currentTarget.getAttribute("data-id");
        this.editStockTransaction(transactionId);
      });
    });

    // Event listener untuk tombol delete
    document.querySelectorAll(".btn-delete-transaksi").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const transactionId = e.currentTarget.getAttribute("data-id");
        this.deleteStockTransaction(transactionId);
      });
    });
  },

  // Show modal edit transaksi
  async editStockTransaction(transactionId) {
    try {
      const transaction = this.laporanData.find((item) => item.id === transactionId);
      if (!transaction) {
        this.showErrorNotification("Transaksi tidak ditemukan");
        return;
      }

      // Set data ke form
      document.getElementById("editTransaksiId").value = transaction.id;
      document.getElementById("editTransaksiKode").value = transaction.kodeText;
      document.getElementById("editTransaksiKodeDisplay").value = transaction.kodeText;
      document.getElementById("editTransaksiNama").value = transaction.nama;
      document.getElementById("editTransaksiJumlahLama").value = transaction.jumlah;
      document.getElementById("editTransaksiJumlahBaru").value = transaction.jumlah;

      // Show modal
      const modal = new bootstrap.Modal(document.getElementById("modalEditTransaksi"));
      modal.show();
    } catch (error) {
      console.error("Error showing edit modal:", error);
      this.showErrorNotification("Gagal membuka form edit");
    }
  },

  // Save edit transaksi
  async saveEditTransaction() {
    try {
      const transactionId = document.getElementById("editTransaksiId").value;
      const kode = document.getElementById("editTransaksiKode").value;
      const jumlahLama = parseInt(document.getElementById("editTransaksiJumlahLama").value);
      const jumlahBaru = parseInt(document.getElementById("editTransaksiJumlahBaru").value);

      // Validasi
      if (!jumlahBaru || jumlahBaru <= 0) {
        this.showErrorNotification("Jumlah harus lebih dari 0");
        return;
      }

      if (jumlahBaru === jumlahLama) {
        this.showErrorNotification("Jumlah tidak berubah");
        return;
      }

      this.showLoading(true);

      // Hitung delta
      const delta = jumlahBaru - jumlahLama;

      // Update transaksi di stokAksesorisTransaksi
      const transactionRef = doc(firestore, "stokAksesorisTransaksi", transactionId);
      await updateDoc(transactionRef, {
        jumlah: jumlahBaru,
        lastUpdated: serverTimestamp(),
      });

      // Update stok di stokAksesoris
      const stockQuery = query(collection(firestore, "stokAksesoris"), where("kode", "==", kode), limit(1));
      const stockSnapshot = await getDocs(stockQuery);

      if (stockSnapshot.size > 0) {
        const stockDoc = stockSnapshot.docs[0];
        const stockData = stockDoc.data();
        const currentStok = stockData.stokAkhir || 0;
        const newStok = currentStok + delta;

        await updateDoc(doc(firestore, "stokAksesoris", stockDoc.id), {
          stokAkhir: newStok,
          lastUpdated: serverTimestamp(),
        });

        console.log(`✅ Stock updated: ${kode} (${currentStok} → ${newStok})`);
      }

      // Invalidate cache dan refresh
      invalidateCache("stockAdditionHistory");
      await this.loadStockAdditionHistory();

      // Hide modal
      bootstrap.Modal.getInstance(document.getElementById("modalEditTransaksi")).hide();

      this.showSuccessNotification(
        `Transaksi berhasil diupdate<br>Kode: ${kode}<br>Jumlah: ${jumlahLama} → ${jumlahBaru} pcs<br>Delta: ${
          delta > 0 ? "+" : ""
        }${delta} pcs`
      );
    } catch (error) {
      console.error("Error saving edit transaction:", error);
      this.showErrorNotification("Gagal menyimpan perubahan: " + error.message);
    } finally {
      this.showLoading(false);
    }
  },

  // Show modal delete transaksi
  async deleteStockTransaction(transactionId) {
    try {
      const transaction = this.laporanData.find((item) => item.id === transactionId);
      if (!transaction) {
        this.showErrorNotification("Transaksi tidak ditemukan");
        return;
      }

      // Set data ke form
      document.getElementById("deleteTransaksiId").value = transaction.id;
      document.getElementById("deleteTransaksiKode").value = transaction.kodeText;
      document.getElementById("deleteTransaksiJumlah").value = transaction.jumlah;
      document.getElementById("deleteTransaksiKodeDisplay").textContent = transaction.kodeText;
      document.getElementById("deleteTransaksiNamaDisplay").textContent = transaction.nama;
      document.getElementById("deleteTransaksiJumlahDisplay").textContent = transaction.jumlah;
      document.getElementById("deleteTransaksiPassword").value = "";
      document.getElementById("deleteTransaksiPassword").classList.remove("is-invalid");

      // Show modal
      const modal = new bootstrap.Modal(document.getElementById("modalDeleteTransaksi"));
      modal.show();
    } catch (error) {
      console.error("Error showing delete modal:", error);
      this.showErrorNotification("Gagal membuka form hapus");
    }
  },

  // Confirm delete transaksi dengan password
  async confirmDeleteTransaction() {
    try {
      const password = document.getElementById("deleteTransaksiPassword").value.trim();
      const correctPassword = "smlt116"; // Password sama dengan sistem lain

      // Validasi password
      if (!password) {
        document.getElementById("deleteTransaksiPassword").classList.add("is-invalid");
        document.getElementById("deleteTransaksiPasswordError").textContent = "Password harus diisi";
        return;
      }

      if (password !== correctPassword) {
        document.getElementById("deleteTransaksiPassword").classList.add("is-invalid");
        document.getElementById("deleteTransaksiPasswordError").textContent = "Password salah";
        return;
      }

      this.showLoading(true);

      const transactionId = document.getElementById("deleteTransaksiId").value;
      const kode = document.getElementById("deleteTransaksiKode").value;
      const jumlah = parseInt(document.getElementById("deleteTransaksiJumlah").value);

      // Delete transaksi dari stokAksesorisTransaksi
      await deleteDoc(doc(firestore, "stokAksesorisTransaksi", transactionId));

      // Reverse stok di stokAksesoris (kurangi stokAkhir)
      const stockQuery = query(collection(firestore, "stokAksesoris"), where("kode", "==", kode), limit(1));
      const stockSnapshot = await getDocs(stockQuery);

      if (stockSnapshot.size > 0) {
        const stockDoc = stockSnapshot.docs[0];
        const stockData = stockDoc.data();
        const currentStok = stockData.stokAkhir || 0;
        const newStok = Math.max(0, currentStok - jumlah);

        await updateDoc(doc(firestore, "stokAksesoris", stockDoc.id), {
          stokAkhir: newStok,
          lastUpdated: serverTimestamp(),
        });

        console.log(`✅ Stock reversed: ${kode} (${currentStok} → ${newStok})`);
      }

      // Invalidate cache dan refresh
      invalidateCache("stockAdditionHistory");
      await this.loadStockAdditionHistory();

      // Hide modal
      bootstrap.Modal.getInstance(document.getElementById("modalDeleteTransaksi")).hide();

      this.showSuccessNotification(
        `Transaksi berhasil dihapus<br>Kode: ${kode}<br>Jumlah: ${jumlah} pcs<br>Stok telah dikurangi`
      );
    } catch (error) {
      console.error("Error deleting transaction:", error);
      this.showErrorNotification("Gagal menghapus transaksi: " + error.message);
    } finally {
      this.showLoading(false);
    }
  },
};

window.addEventListener("beforeunload", () => {
  aksesorisSaleHandler.cleanupExpiredCache();
});

document.addEventListener("DOMContentLoaded", function () {
  aksesorisSaleHandler.init();

  const addRefreshCacheButton = () => {
    const existingButton = document.getElementById("refreshCacheBtn");
    if (existingButton) return;
    const buttonContainer =
      document.querySelector(".card-header .d-flex") ||
      document.querySelector(".btn-group") ||
      document.querySelector(".card-body .row .col-auto");

    if (buttonContainer) {
      const refreshButton = document.createElement("button");
      refreshButton.id = "refreshCacheBtn";
      refreshButton.className = "btn btn-outline-secondary btn-sm ms-2";
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Cache';
      refreshButton.title = "Segarkan semua data dari server";

      refreshButton.addEventListener("click", () => {
        if (confirm("Apakah Anda yakin ingin menyegarkan semua cache? Data akan diambil ulang dari server.")) {
          aksesorisSaleHandler.forceRefreshCache();
        }
      });

      buttonContainer.appendChild(refreshButton);
    }
  };
  setTimeout(addRefreshCacheButton, 1000);
});

window.aksesorisCacheDebug = {
  getStatus: () => aksesorisSaleHandler.getCacheStatus(),
  cleanup: () => aksesorisSaleHandler.cleanupExpiredCache(),
  invalidate: (pattern) => invalidateCache(pattern),
  refresh: () => aksesorisSaleHandler.forceRefreshCache(),
};
