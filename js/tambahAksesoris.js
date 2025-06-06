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
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// ===== IMPROVED CACHE MANAGEMENT =====
const CACHE_TTL_STANDARD = 60 * 60 * 1000; // 1 jam untuk data statis
const CACHE_TTL_TODAY = 5 * 60 * 1000;     // 5 menit untuk data hari ini
const CACHE_TTL_STOCK = 2 * 60 * 1000;     // 2 menit untuk data stok

// Cache storage dengan timestamp
const cacheStorage = {
  kodeAksesoris: new Map(),
  stockAdditions: new Map(),
  stockData: new Map(),
  timestamps: new Map()
};

// Fungsi untuk menyimpan cache dengan timestamp
function setCacheWithTimestamp(key, data, ttl = CACHE_TTL_STANDARD) {
  cacheStorage.kodeAksesoris.set(key, data);
  cacheStorage.timestamps.set(key, {
    timestamp: Date.now(),
    ttl: ttl
  });
  
  // Simpan ke sessionStorage untuk persistensi
  try {
    sessionStorage.setItem(`cache_${key}`, JSON.stringify({
      data: data,
      timestamp: Date.now(),
      ttl: ttl
    }));
  } catch (error) {
    console.warn("Failed to save cache to sessionStorage:", error);
  }
}

// Fungsi untuk mengambil cache dengan validasi TTL
function getCacheWithValidation(key) {
  const now = Date.now();
  
  // Cek memory cache terlebih dahulu
  if (cacheStorage.kodeAksesoris.has(key) && cacheStorage.timestamps.has(key)) {
    const meta = cacheStorage.timestamps.get(key);
    if ((now - meta.timestamp) < meta.ttl) {
      return cacheStorage.kodeAksesoris.get(key);
    } else {
      // Cache expired, hapus dari memory
      cacheStorage.kodeAksesoris.delete(key);
      cacheStorage.timestamps.delete(key);
    }
  }
  
  // Cek sessionStorage sebagai fallback
  try {
    const cached = sessionStorage.getItem(`cache_${key}`);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if ((now - parsedCache.timestamp) < parsedCache.ttl) {
        // Restore ke memory cache
        cacheStorage.kodeAksesoris.set(key, parsedCache.data);
        cacheStorage.timestamps.set(key, {
          timestamp: parsedCache.timestamp,
          ttl: parsedCache.ttl
        });
        return parsedCache.data;
      } else {
        // Cache expired, hapus dari sessionStorage
        sessionStorage.removeItem(`cache_${key}`);
      }
    }
  } catch (error) {
    console.warn("Failed to read cache from sessionStorage:", error);
  }
  
  return null;
}

// Fungsi untuk menghapus cache
function invalidateCache(pattern = null) {
  if (pattern) {
    // Hapus cache yang sesuai dengan pattern
    for (const key of cacheStorage.kodeAksesoris.keys()) {
      if (key.includes(pattern)) {
        cacheStorage.kodeAksesoris.delete(key);
        cacheStorage.timestamps.delete(key);
        sessionStorage.removeItem(`cache_${key}`);
      }
    }
  } else {
    // Hapus semua cache
    cacheStorage.kodeAksesoris.clear();
    cacheStorage.timestamps.clear();
    
    // Hapus dari sessionStorage
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('cache_')) {
        sessionStorage.removeItem(key);
      }
    }
  }
}

// Utility functions
export const aksesorisSaleHandler = {
  // Simplified cache properties
  cache: {
    lastUpdate: null,
  },

  // Other properties
  OPSI_KOTAK: [],
  OPSI_AKSESORIS: [],
  modalKelolaKode: null,
  modalFormKode: null,
  currentKategori: "kotak",
  editingDocId: null,
  laporanData: [],

  // Fungsi inisialisasi
  async init() {
    // Inisialisasi elemen DOM
    this.initDomElements();

    // Fetch data kode aksesoris dari Firestore (dengan caching)
    await this.loadKodeAksesorisData();

    // Inisialisasi modal
    this.initModals();

    // Pasang event listener
    this.attachEventListeners();

    // Inisialisasi tabel
    const selectKategori = document.getElementById("jenis-aksesoris");
    const tbody = document.querySelector("#tableTambahAksesoris tbody");
    this.handleCategoryChange(selectKategori.value, tbody);

    // Set tanggal hari ini
    this.setTodayDate();

    // Load riwayat penambahan stok
    this.loadStockAdditionHistory();
  },

  // Fungsi untuk mengisi tanggal hari ini
  setTodayDate() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = today.getFullYear();

    const formattedDate = `${day}/${month}/${year}`;

    // Set tanggal input utama
    const tanggalInput = document.getElementById("tanggal");
    if (tanggalInput) {
      tanggalInput.value = formattedDate;
    }

    // Set filter tanggal mulai dan akhir ke hari ini
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
      filterDate: document.getElementById("filterDate"),
    };

    // Validasi elemen DOM
    for (const [key, element] of Object.entries(elements)) {
      if (!element) {
        console.error(`Elemen DOM ${key} tidak ditemukan.`);
      }
    }

    this.elements = elements;
  },

  // IMPROVED: Fungsi untuk memuat data kode aksesoris dengan caching yang lebih efisien
  async loadKodeAksesorisData() {
    const { OPSI_KOTAK, OPSI_AKSESORIS } = await this.fetchKodeAksesoris();
    this.OPSI_KOTAK = OPSI_KOTAK;
    this.OPSI_AKSESORIS = OPSI_AKSESORIS;
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

    // Initialize datepicker untuk filter tanggal
    this.initFilterDatepickers();

    // Initialize datepicker for filter date
    if (this.elements.filterDate) {
      $(this.elements.filterDate).datepicker({
        format: "dd/mm/yyyy",
        autoclose: true,
        language: "id",
        todayHighlight: true,
      });

      // Calendar icon click handler
      const filterDateIcon = document.getElementById("filterDateIcon");
      if (filterDateIcon) {
        filterDateIcon.addEventListener("click", () => {
          $(this.elements.filterDate).datepicker("show");
        });
      }
    }
  },

  // Method untuk inisialisasi datepicker filter
  initFilterDatepickers() {
    // Datepicker untuk filter start
    $("#filterDateStart").datepicker({
      format: "dd/mm/yyyy",
      autoclose: true,
      language: "id",
      todayHighlight: true,
    });

    // Datepicker untuk filter end
    $("#filterDateEnd").datepicker({
      format: "dd/mm/yyyy",
      autoclose: true,
      language: "id",
      todayHighlight: true,
    });

    // Calendar icon click handlers
    $(".input-group-text").on("click", function () {
      $(this).siblings("input").datepicker("show");
    });
  },

  // Fungsi untuk memasang event listener pencarian
  attachSearchListeners() {
    // Search untuk kotak
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

    // Search untuk aksesoris
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
  },

  // Fungsi untuk memfilter tabel berdasarkan input pencarian
  filterTable(kategori, searchText) {
    const tableId = kategori === "kotak" ? "tableKodeKotak" : "tableKodeAksesoris";
    const table = document.getElementById(tableId);

    if (!table) return;

    const rows = table.querySelectorAll("tbody tr");
    const lowerSearchText = searchText.toLowerCase();

    rows.forEach((row) => {
      const kodeCell = row.cells[1]; // Kolom kode
      const namaCell = row.cells[2]; // Kolom nama

      if (!kodeCell || !namaCell) return;

      const kodeText = kodeCell.textContent.toLowerCase();
      const namaText = namaCell.textContent.toLowerCase();

      // Tampilkan baris jika kode atau nama mengandung teks pencarian
      if (kodeText.includes(lowerSearchText) || namaText.includes(lowerSearchText)) {
        row.style.display = "";
      } else {
        row.style.display = "none";
      }
    });

    // Tampilkan pesan jika tidak ada hasil
    const tbody = table.querySelector("tbody");
    const visibleRows = [...rows].filter((row) => row.style.display !== "none");

    if (visibleRows.length === 0 && searchText) {
      // Cek apakah sudah ada pesan "tidak ada hasil"
      const noResultRow = [...rows].find((row) => row.classList.contains("no-result-row"));

      if (!noResultRow) {
        const newRow = document.createElement("tr");
        newRow.classList.add("no-result-row");
        newRow.innerHTML = `<td colspan="5" class="text-center">Tidak ada hasil untuk pencarian "${searchText}"</td>`;
        tbody.appendChild(newRow);
      }
    } else {
      // Hapus pesan "tidak ada hasil" jika ada
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

  // IMPROVED: Fungsi untuk mengambil data kode aksesoris dari Firestore dengan caching yang efisien
  async fetchKodeAksesoris() {
    try {
      const cacheKey = "kodeAksesoris_all";
      
      // Cek cache terlebih dahulu
      const cachedData = getCacheWithValidation(cacheKey);
      if (cachedData) {
        console.log("Using cached kode aksesoris data");
        return cachedData;
      }

      console.log("Fetching fresh kode aksesoris data");
      
      // Fetch data dari Firestore
      const [kotakSnapshot, aksesorisSnapshot] = await Promise.all([
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "kotak")),
        getDocs(collection(firestore, "kodeAksesoris", "kategori", "aksesoris"))
      ]);

      const OPSI_KOTAK = [{ value: "0", text: "Pilih Kategori" }];
      const OPSI_AKSESORIS = [{ value: "0", text: "Pilih Kategori" }];

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

      const result = { OPSI_KOTAK, OPSI_AKSESORIS };
      
      // Simpan ke cache dengan TTL standar (data ini jarang berubah)
      setCacheWithTimestamp(cacheKey, result, CACHE_TTL_STANDARD);

      return result;
    } catch (error) {
      console.error("Error fetching kode aksesoris:", error);
      return {
        OPSI_KOTAK: [{ value: "0", text: "Pilih Kategori" }],
        OPSI_AKSESORIS: [{ value: "0", text: "Pilih Kategori" }],
      };
    }
  },

  // Fungsi untuk menangani perubahan kategori
  handleCategoryChange(kategori, tbody) {
    tbody.innerHTML = ""; // Clear table
    const options = kategori === "1" ? this.OPSI_KOTAK : kategori === "2" ? this.OPSI_AKSESORIS : [];
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
      
      // Cek cache terlebih dahulu
      const cachedData = getCacheWithValidation(cacheKey);
      if (cachedData) {
        document.getElementById("textKode").value = cachedData.text;
        document.getElementById("namaKode").value = cachedData.nama;
        return;
      }

      const docRef = doc(firestore, "kodeAksesoris", "kategori", kategori, docId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById("textKode").value = data.text;
        document.getElementById("namaKode").value = data.nama;
        
        // Simpan ke cache
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

    const options = kategori === "1" ? this.OPSI_KOTAK : this.OPSI_AKSESORIS;

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

  // IMPROVED: Fungsi untuk menyimpan data penambahan stok dengan cache invalidation
  async simpanData() {
    try {
      // Show loading indicator
      this.showLoading(true);

      // Validasi data
      if (!this.validateTransactionData()) {
        this.showLoading(false);
        return;
      }

      // Kumpulkan data dari tabel
      const items = this.collectItemsData();
      if (!items) {
        this.showLoading(false);
        return;
      }

      // Buat objek data penambahan stok
      const stockAdditionData = this.createStockAdditionData(items);

      // Simpan data penambahan stok ke Firestore
      const docId = await this.saveStockAdditionToFirestore(stockAdditionData);
      console.log("Stock addition saved with ID:", docId);

      // Update stok aksesoris
      await this.updateStokAksesoris(items);

      // IMPROVED: Invalidate related caches
      invalidateCache("stockAdditions");
      invalidateCache("stockData");

      // Hitung total item yang ditambahkan
      const totalItems = items.reduce((total, item) => total + item.jumlah, 0);
      const kategoriText = this.elements.selectKategori.value === "1" ? "Kotak" : "Aksesoris";

      // Tampilkan notifikasi sukses dengan detail
      this.showSuccessNotification(`
              ${totalItems} item ${kategoriText} berhasil ditambahkan!
              
              Detail:
              ${items.map((item) => `• ${item.nama} (${item.kodeText}): ${item.jumlah} pcs`).join("\n")}
            `);

      // Reload riwayat penambahan stok
      this.loadStockAdditionHistory();

      // Reset form
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
        kategori: this.elements.selectKategori.value === "1" ? "kotak" : "aksesoris",
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
      // Simpan ke koleksi stockAdditions
      const docRef = await addDoc(collection(firestore, "stockAdditions"), data);
      console.log("Data berhasil disimpan dengan ID:", docRef.id);
      return docRef.id;
    } catch (error) {
      console.error("Gagal menyimpan data:", error);
      throw error;
    }
  },

  // IMPROVED: Fungsi untuk memperbarui stok aksesoris dengan cache invalidation
  async updateStokAksesoris(items) {
    try {
      // Invalidate stock cache sebelum update
      invalidateCache("stockData");

      for (const item of items) {
        // Cek apakah item sudah ada di koleksi stokAksesoris
        const stokQuery = query(collection(firestore, "stokAksesoris"), where("kode", "==", item.kodeText));

        const stokSnapshot = await getDocs(stokQuery);

        if (stokSnapshot.empty) {
          // Jika belum ada, buat dokumen baru
          const newStockData = {
            kode: item.kodeText,
            nama: item.nama,
            kategori: item.kategori,
            stokAwal: 0,
            tambahStok: parseInt(item.jumlah) || 0,
            laku: 0,
            free: 0,
            gantiLock: 0,
            stokAkhir: parseInt(item.jumlah) || 0,
            lastUpdate: serverTimestamp(),
          };

          await addDoc(collection(firestore, "stokAksesoris"), newStockData);
        } else {
          // Jika sudah ada, update dokumen
          const stokDoc = stokSnapshot.docs[0];
          const stokData = stokDoc.data();

          // Hitung stok akhir baru
          const currentTambahStok = parseInt(stokData.tambahStok) || 0;
          const newTambahStok = currentTambahStok + (parseInt(item.jumlah) || 0);

          const stokAwal = parseInt(stokData.stokAwal) || 0;
          const laku = parseInt(stokData.laku) || 0;
          const free = parseInt(stokData.free) || 0;
          const gantiLock = parseInt(stokData.gantiLock) || 0;

          const stokAkhir = stokAwal + newTambahStok - laku - free - gantiLock;

          const updateData = {
            tambahStok: newTambahStok,
            stokAkhir: stokAkhir,
            lastUpdate: serverTimestamp(),
          };

          await updateDoc(doc(firestore, "stokAksesoris", stokDoc.id), updateData);
        }
      }
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

  // Method untuk generate HTML laporan
  generateLaporanHTML() {
    const filterDateStart = document.getElementById("filterDateStart").value;
    const filterDateEnd = document.getElementById("filterDateEnd").value;
    
    // Group data by kategori
    const groupedData = this.laporanData.reduce((acc, item) => {
      const kategori = item.jenisText || "Lainnya";
      if (!acc[kategori]) acc[kategori] = [];
      acc[kategori].push(item);
      return acc;
    }, {});

    // Hitung total
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

    // Tambahkan data per kategori
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

      items.forEach(item => {
        laporanHTML += `
          <tr>
            <td>${item.tanggal || "-"}</td>
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
          <p>Dicetak pada: ${new Date().toLocaleString('id-ID')}</p>
          <p>Admin: ${localStorage.getItem('currentUser') || 'Admin'}</p>
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

  // IMPROVED: Fungsi untuk memuat riwayat penambahan stok dengan caching yang efisien
  async loadStockAdditionHistory() {
    try {
      const filterDateStart = document.getElementById("filterDateStart");
      const filterDateEnd = document.getElementById("filterDateEnd");
      
      // Validasi elemen ada dan memiliki value
      if (!filterDateStart || !filterDateEnd || !filterDateStart.value || !filterDateEnd.value) {
        console.log("Filter tanggal belum diset, menggunakan tanggal hari ini");
        this.setDefaultFilterDates();
        return;
      }

      // Parse tanggal filter dengan validasi
      const startParts = filterDateStart.value.split("/");
      const endParts = filterDateEnd.value.split("/");
      
      if (startParts.length !== 3 || endParts.length !== 3) {
        throw new Error("Format tanggal tidak valid");
      }

      const startDate = new Date(startParts[2], startParts[1] - 1, startParts[0]);
      const endDate = new Date(endParts[2], endParts[1] - 1, endParts[0]);
      
      // Validasi tanggal valid
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error("Tanggal tidak valid");
      }
      
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      // Create cache key
      const cacheKey = `stockAdditions_${filterDateStart.value}_${filterDateEnd.value}`;
      
      // Cek apakah rentang tanggal mencakup hari ini untuk menentukan TTL
      const today = new Date();
      const includesCurrentDay = (startDate <= today && today <= endDate);
      const ttl = includesCurrentDay ? CACHE_TTL_TODAY : CACHE_TTL_STANDARD;

      // Cek cache terlebih dahulu
      const cachedData = getCacheWithValidation(cacheKey);
      if (cachedData) {
        console.log("Using cached stock addition history");
        this.laporanData = cachedData;
        this.renderStockAdditionHistory(cachedData);
        return;
      }

      // Query data dari Firestore
      const stockAdditionsRef = collection(firestore, "stockAdditions");
      const q = query(
        stockAdditionsRef,
        where("timestamp", ">=", startDate),
        where("timestamp", "<=", endDate),
        orderBy("timestamp", "desc")
      );

      const snapshot = await getDocs(q);
      const historyData = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.items && data.items.length) {
          data.items.forEach((item) => {
            historyData.push({
              id: doc.id,
              timestamp: data.timestamp,
              tanggal: data.tanggal,
              jenisText: data.jenisText,
              kodeText: item.kodeText,
              nama: item.nama,
              jumlah: item.jumlah,
            });
          });
        }
      });

      // Simpan ke cache
      setCacheWithTimestamp(cacheKey, historyData, ttl);

      // Simpan data untuk laporan
      this.laporanData = historyData;

      // Render data
      this.renderStockAdditionHistory(historyData);
      
    } catch (error) {
      console.error("Error loading stock addition history:", error);
      this.renderStockAdditionHistory([]); // Render tabel kosong dengan pesan error
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
    
    // Load data setelah set tanggal
    setTimeout(() => this.loadStockAdditionHistory(), 100);
  },

  // Render riwayat penambahan stok ke tabel
  renderStockAdditionHistory(historyData = []) {
    const tableBody = document.querySelector("#tableRiwayatTambahStok tbody");
    
    if (!tableBody) {
      console.error("Table body element not found");
      return;
    }

    // Clear existing content
    tableBody.innerHTML = "";

    if (!historyData || historyData.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="4" class="text-center text-muted py-4">
            <i class="fas fa-inbox fa-2x mb-2 d-block"></i>
            <span>Tidak ada data penambahan stok pada periode ini</span>
          </td>
        </tr>
      `;
      return;
    }

    // Render data
    historyData.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.tanggal || "-"}</td>
        <td>${item.kodeText || "-"}</td>
        <td>${item.nama || "-"}</td>
        <td class="text-center">
          <span class="badge bg-primary">${item.jumlah || 0} pcs</span>
        </td>
      `;
      tableBody.appendChild(row);
    });
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
    // Set tanggal hari ini
    this.setTodayDate();

    // Reset jenis aksesoris
    document.getElementById("jenis-aksesoris").value = "Pilih Kategori";

    // Reset tabel
    const tbody = document.querySelector("#tableTambahAksesoris tbody");
    tbody.innerHTML = "";
    this.tambahBaris(document.getElementById("jenis-aksesoris").value, tbody);

    // Reset total items
    document.getElementById("total-items").textContent = "0";
  },

  // ===== FUNGSI UNTUK MENGELOLA KODE BARANG =====

  // Fungsi untuk menampilkan modal kelola kode
  showKelolaKodeModal() {
    // Load data kode barang untuk kategori default (kotak)
    this.loadKodeBarang("kotak");
    this.modalKelolaKode.show();
  },

  // IMPROVED: Fungsi untuk memuat data kode barang dengan caching yang efisien
  async loadKodeBarang(kategori) {
    try {
      const tableId = kategori === "kotak" ? "tableKodeKotak" : "tableKodeAksesoris";
      const tableBody = document.querySelector(`#${tableId} tbody`);

      if (!tableBody) {
        console.error(`Table body dengan id ${tableId} tidak ditemukan.`);
        return;
      }

      tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';

      // Create cache key
      const cacheKey = `kodeBarang_${kategori}`;
      
      // Cek cache terlebih dahulu
      const cachedData = getCacheWithValidation(cacheKey);
      if (cachedData) {
        console.log(`Using cached ${kategori} data`);
        this.renderKodeBarangTable(tableBody, cachedData, kategori);
        return;
      }

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
        });
      });

      // Simpan ke cache
      setCacheWithTimestamp(cacheKey, kodeData, CACHE_TTL_STANDARD);

      // Render table
      this.renderKodeBarangTable(tableBody, kodeData, kategori);
    } catch (error) {
      console.error("Error loading kode barang:", error);
      const tableId = kategori === "kotak" ? "tableKodeKotak" : "tableKodeAksesoris";
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
      html += `
        <tr>
          <td>${no++}</td>
          <td>${item.text}</td>
          <td>${item.nama}</td>
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

    // Pasang event listener untuk tombol edit dan delete
    this.attachKodeBarangActionListeners(tableBody, kategori);
  },

  // Fungsi untuk memasang event listener pada tombol aksi kode barang
  attachKodeBarangActionListeners(tableBody, kategori) {
    // Event listener untuk tombol edit
    const editButtons = tableBody.querySelectorAll(".btn-edit");
    editButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const docId = button.getAttribute("data-id");
        this.editKodeBarang(docId, kategori);
      });
    });

    // Event listener untuk tombol delete
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
    // Reset form
    document.getElementById("formKodeBarang").reset();
    document.getElementById("kategoriKode").value = kategori;

    // Set judul modal
    const modalTitle = document.getElementById("modalFormKodeLabel");
    if (modalTitle) {
      modalTitle.textContent = docId ? "Edit Kode Barang" : "Tambah Kode Baru";
    }

    // Jika edit, set docId
    if (docId) {
      document.getElementById("docId").value = docId;
      this.loadKodeBarangData(docId, kategori);
    } else {
      document.getElementById("docId").value = "";
    }

    // Tampilkan modal
    this.modalFormKode.show();
  },

  // IMPROVED: Fungsi untuk menyimpan kode barang dengan cache invalidation
  async simpanKodeBarang() {
    // Validasi form
    if (!this.validateKodeBarangForm()) {
      return;
    }

    // Ambil data dari form
    const docId = document.getElementById("docId").value;
    const kategori = document.getElementById("kategoriKode").value;
    const text = document.getElementById("textKode").value;
    const nama = document.getElementById("namaKode").value;

    // Pastikan semua field memiliki nilai valid
    const data = {
      text: text || "",
      nama: nama || "",
    };

    try {
      if (docId) {
        // Update existing document
        await this.updateKodeBarang(docId, kategori, data);
      } else {
        // Add new document
        await this.addKodeBarang(kategori, data);
      }

      // IMPROVED: Invalidate related caches
      invalidateCache("kodeAksesoris");
      invalidateCache(`kodeBarang_${kategori}`);

      // Reload data
      this.modalFormKode.hide();
      this.loadKodeBarang(kategori);

      // Reload kode aksesoris data for the main form
      await this.loadKodeAksesorisData();

      // Update dropdown options if category is active
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
      this.showSuccessNotification("Data berhasil diperbarui!");
    } catch (error) {
      console.error("Error updating kode barang:", error);
      throw error;
    }
  },

  // IMPROVED: Ganti confirm di deleteKodeBarang dengan cache invalidation
  async deleteKodeBarang(docId, kategori) {
    const confirmed = await this.showConfirmation("Apakah Anda yakin ingin menghapus kode ini?");
    if (!confirmed) {
      return;
    }

    try {
      const docRef = doc(firestore, "kodeAksesoris", "kategori", kategori, docId);
      await deleteDoc(docRef);
      this.showSuccessNotification("Data berhasil dihapus!");

      // IMPROVED: Invalidate related caches
      invalidateCache("kodeAksesoris");
      invalidateCache(`kodeBarang_${kategori}`);

      // Reload data
      this.loadKodeBarang(kategori);

      // Reload kode aksesoris data for the main form
      await this.loadKodeAksesorisData();
      
      // Update dropdown options if category is active
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

  // Fungsi untuk mengedit kode barang
  async editKodeBarang(docId, kategori) {
    this.showFormKodeModal(kategori, docId);
  },

  // IMPROVED: Fungsi untuk mengatur stok awal hari berikutnya dengan cache invalidation
  async setNextDayStartingStock() {
    try {
      // Ambil semua data stok
      const stockSnapshot = await getDocs(collection(firestore, "stokAksesoris"));

      // Update stok awal untuk setiap item
      const batch = firestore.batch();

      stockSnapshot.forEach((stockDoc) => {
        const stockData = stockDoc.data();
        const docRef = doc(firestore, "stokAksesoris", stockDoc.id);

        // Set stok awal = stok akhir hari sebelumnya
        batch.update(docRef, {
          stokAwal: stockData.stokAkhir || 0,
          tambahStok: 0, // Reset tambah stok
          laku: 0, // Reset laku
          free: 0, // Reset free
          gantiLock: 0, // Reset ganti lock
          lastUpdate: serverTimestamp(),
        });
      });

      // Commit batch update
      await batch.commit();
      console.log("Stok awal hari berikutnya berhasil diatur");

      // IMPROVED: Invalidate stock cache setelah update
      invalidateCache("stockData");
      invalidateCache("stockAdditions");
    } catch (error) {
      console.error("Error setting next day starting stock:", error);
      throw error;
    }
  },

  // IMPROVED: Tambahkan fungsi untuk force refresh cache
  async forceRefreshCache() {
    try {
      // Hapus semua cache
      invalidateCache();
      
      // Reload data utama
      await this.loadKodeAksesorisData();
      
      // Reload riwayat jika ada filter tanggal
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

  // IMPROVED: Tambahkan fungsi untuk mendapatkan status cache
  getCacheStatus() {
    const now = Date.now();
    const cacheInfo = [];
    
    for (const [key, meta] of cacheStorage.timestamps.entries()) {
      const isExpired = (now - meta.timestamp) > meta.ttl;
      const ageMinutes = Math.floor((now - meta.timestamp) / (1000 * 60));
      
      cacheInfo.push({
        key: key,
        age: ageMinutes,
        expired: isExpired,
        ttl: Math.floor(meta.ttl / (1000 * 60)) // TTL in minutes
      });
    }
    
    return cacheInfo;
  },

  // IMPROVED: Tambahkan fungsi untuk cleanup cache yang expired
  cleanupExpiredCache() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, meta] of cacheStorage.timestamps.entries()) {
      if ((now - meta.timestamp) > meta.ttl) {
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => {
      cacheStorage.kodeAksesoris.delete(key);
      cacheStorage.timestamps.delete(key);
      sessionStorage.removeItem(`cache_${key}`);
    });
    
    if (expiredKeys.length > 0) {
      console.log(`Cleaned up ${expiredKeys.length} expired cache entries`);
    }
    
    return expiredKeys.length;
  }
};

// IMPROVED: Auto cleanup expired cache setiap 5 menit
setInterval(() => {
  aksesorisSaleHandler.cleanupExpiredCache();
}, 5 * 60 * 1000);

// IMPROVED: Cleanup cache saat halaman akan ditutup
window.addEventListener('beforeunload', () => {
  aksesorisSaleHandler.cleanupExpiredCache();
});

// IMPROVED: Tambahkan event listener untuk tombol refresh cache jika ada
document.addEventListener("DOMContentLoaded", function () {
  // Initialize handler
  aksesorisSaleHandler.init();

  // Set up datepicker untuk filterDate
  $("#filterDate").datepicker({
    format: "dd/mm/yyyy",
    autoclose: true,
    language: "id",
    todayHighlight: true,
  });

  // Calendar icon click handler
  $("#filterDateIcon").on("click", function () {
    $("#filterDate").datepicker("show");
  });

  // IMPROVED: Tambahkan tombol refresh cache jika belum ada
  const addRefreshCacheButton = () => {
    const existingButton = document.getElementById("refreshCacheBtn");
    if (existingButton) return;

    // Cari container yang sesuai untuk menambahkan tombol
    const buttonContainer = document.querySelector(".card-header .d-flex") || 
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

  // Tambahkan tombol setelah DOM selesai dimuat
  setTimeout(addRefreshCacheButton, 1000);

  // IMPROVED: Tambahkan indikator cache status jika diperlukan
  const addCacheStatusIndicator = () => {
    const existingIndicator = document.getElementById("cacheStatusIndicator");
    if (existingIndicator) return;

    const statusContainer = document.querySelector(".card-footer") || 
                           document.querySelector(".card-body");

    if (statusContainer) {
      const indicator = document.createElement("small");
      indicator.id = "cacheStatusIndicator";
      indicator.className = "text-muted d-block mt-2";
      indicator.innerHTML = '<i class="fas fa-database"></i> <span id="cacheStatusText">Cache aktif</span>';
      
      // Update status setiap 30 detik
      const updateCacheStatus = () => {
        const cacheInfo = aksesorisSaleHandler.getCacheStatus();
        const activeCache = cacheInfo.filter(info => !info.expired).length;
        const expiredCache = cacheInfo.filter(info => info.expired).length;
        
        const statusText = document.getElementById("cacheStatusText");
        if (statusText) {
          statusText.textContent = `Cache: ${activeCache} aktif, ${expiredCache} expired`;
        }
      };
      
      statusContainer.appendChild(indicator);
      updateCacheStatus();
      setInterval(updateCacheStatus, 30000);
    }
  };

  // Tambahkan indikator setelah DOM selesai dimuat
  setTimeout(addCacheStatusIndicator, 1500);
});

// IMPROVED: Export fungsi cache management untuk debugging
window.aksesorisCacheDebug = {
  getStatus: () => aksesorisSaleHandler.getCacheStatus(),
  cleanup: () => aksesorisSaleHandler.cleanupExpiredCache(),
  invalidate: (pattern) => invalidateCache(pattern),
  refresh: () => aksesorisSaleHandler.forceRefreshCache()
};