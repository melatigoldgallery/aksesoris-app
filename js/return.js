import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { firestore } from "./configFirebase.js";

import StockService from "./services/stockService.js";

// Utils function untuk alert
const showAlert = (message, title = "Informasi", type = "info") => {
  return Swal.fire({
    title,
    text: message,
    icon: type,
    confirmButtonText: "OK",
    confirmButtonColor: "#0d6efd",
  });
};

// Helper function untuk parse tanggal dd/mm/yyyy ke Date object
const parseDate = (dateString) => {
  if (!dateString) return null;
  const parts = dateString.split("/");
  if (parts.length !== 3) return null;
  // parts[0] = day, parts[1] = month, parts[2] = year
  return new Date(parts[2], parts[1] - 1, parts[0]);
};

const returnHandler = {
  stockData: [],
  stockListener: null,
  isSaving: false,
  riwayatData: [],
  currentDeleteData: null,
  isDeleting: false,
  deletePassword: "smlt116",

  async init() {
    try {
      this.initDatePickers();
      await this.setupEventListeners();
      this.setupRealTimeListeners();
      this.setDefaultDate();
      this.setDefaultFilterDates();
      // Tidak auto-load, user harus klik tombol Tampilkan
    } catch (error) {
      console.error("Error initializing return handler:", error);
      showAlert("Terjadi kesalahan saat memuat halaman", "Error", "error");
    }
  },

  // Initialize date pickers
  initDatePickers() {
    $(".datepicker").datepicker({
      format: "dd/mm/yyyy",
      autoclose: true,
      language: "id",
      todayHighlight: true,
      endDate: "0d", // Tidak bisa pilih tanggal masa depan
    });
  },

  // Set default filter date
  setDefaultFilterDates() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = today.getFullYear();
    const formattedToday = `${day}/${month}/${year}`;
    $("#filterStartDate").val(formattedToday);
    $("#filterEndDate").val(formattedToday);
  },

  // Load riwayat return dari stokAksesorisTransaksi (Single Source of Truth)
  async loadRiwayatReturn(startDate = null, endDate = null) {
    try {
      // Jika tidak ada parameter, tidak load data
      if (!startDate || !endDate) {
        this.riwayatData = [];
        this.renderRiwayatReturn();
        return;
      }

      // Convert to Date object to handle time zones properly
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Validate dates
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        console.warn("Invalid date range:", { startDate, endDate });
        this.riwayatData = [];
        this.renderRiwayatReturn();
        return;
      }

      const startOfDay = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);

      console.log(`🔍 Query return data from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

      // Query dari stokAksesorisTransaksi dengan jenis = "return"
      const transactionRef = collection(firestore, "stokAksesorisTransaksi");
      const returnQuery = query(
        transactionRef,
        where("jenis", "==", "return"),
        where("timestamp", ">=", Timestamp.fromDate(startOfDay)),
        where("timestamp", "<=", Timestamp.fromDate(endOfDay)),
        orderBy("timestamp", "desc"),
      );

      const snapshot = await getDocs(returnQuery);
      console.log(`📦 Found ${snapshot.size} return transactions`);

      // Transform data untuk format yang compatible dengan renderRiwayatReturn
      this.riwayatData = snapshot.docs.map((doc) => {
        const data = doc.data();
        // Get tanggal from timestamp field (more reliable)
        let tanggalStr = new Date().toISOString();
        if (data.timestamp && data.timestamp.toDate) {
          tanggalStr = data.timestamp.toDate().toISOString();
        } else if (data.tanggal) {
          tanggalStr = data.tanggal;
        }

        return {
          id: doc.id,
          tanggal: tanggalStr,
          namaSales: data.sales || "-",
          jenisReturn: data.jenisReturn || data.kategori || "-",
          detailReturn: [
            {
              kode: data.kode,
              namaBarang: data.namaBarang || data.nama || "-",
              jumlah: data.jumlah,
              keterangan: data.keterangan || "",
            },
          ],
        };
      });

      console.log(`✅ Loaded ${this.riwayatData.length} return records`);
      this.renderRiwayatReturn();
    } catch (error) {
      console.error("Error loading riwayat return:", error);
      showAlert("Gagal memuat data riwayat return. Error: " + error.message, "Error", "error");
    }
  },

  // Render riwayat return
  renderRiwayatReturn() {
    const $tbody = $("#tableRiwayatReturn tbody");
    $tbody.empty();

    if (this.riwayatData.length === 0) {
      $tbody.append(`
      <tr>
        <td colspan="8" class="text-center">Tidak ada data</td>
      </tr>
    `);
      return;
    }

    this.riwayatData.forEach((data) => {
      // Format tanggal untuk display
      let displayDate = data.tanggal;
      try {
        const date = new Date(data.tanggal);
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear();
        displayDate = `${day}/${month}/${year}`;
      } catch (e) {
        console.error("Error formatting date:", e);
      }

      // Handle multiple items in detailReturn
      data.detailReturn.forEach((item, index) => {
        // Hanya tampilkan tombol hapus pada row pertama untuk setiap return
        const deleteButton =
          index === 0
            ? `
        <button type="button" class="btn btn-danger btn-delete-return" 
                data-return-id="${data.id}" 
                data-tanggal="${data.tanggal}" 
                data-sales="${data.namaSales}"
                title="Hapus Data Return">
          <i class="fas fa-trash"></i>
        </button>
      `
            : "";

        $tbody.append(`
        <tr>
          <td>${displayDate}</td>
          <td>${data.namaSales}</td>
          <td>${data.jenisReturn}</td>
          <td>${item.kode}</td>
          <td>${item.namaBarang}</td>
          <td>${item.jumlah}</td>
          <td>${item.keterangan || "-"}</td>
          <td class="action-column">${deleteButton}</td>
        </tr>
      `);
      });
    });
  },

  // Print laporan return
  printLaporanReturn() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showAlert("Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.", "Error", "error");
      return;
    }

    const startDate = $("#filterStartDate").val();
    const endDate = $("#filterEndDate").val();

    if (!startDate || !endDate) {
      showAlert("Mohon pilih tanggal mulai dan tanggal akhir terlebih dahulu", "Warning", "warning");
      return;
    }

    const formattedStartDate = new Date(startDate).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const formattedEndDate = new Date(endDate).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const dateRange = startDate === endDate ? formattedStartDate : `${formattedStartDate} - ${formattedEndDate}`;

    let printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Laporan Return Barang</title>
          <style>
            body { font-family: Arial, sans-serif; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f4f4f4; }
            .header { text-align: center; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>Laporan Return Barang</h2>
            <p>Periode: ${dateRange}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Sales</th>
                <th>Jenis Return</th>
                <th>Kode</th>
                <th>Nama Barang</th>
                <th>Jumlah</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
    `;

    this.riwayatData.forEach((data) => {
      // Format tanggal untuk display
      let displayDate = data.tanggal;
      try {
        const date = new Date(data.tanggal);
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear();
        displayDate = `${day}/${month}/${year}`;
      } catch (e) {
        console.error("Error formatting date:", e);
      }

      data.detailReturn.forEach((item) => {
        printContent += `
          <tr>
            <td>${displayDate}</td>
            <td>${data.namaSales}</td>
            <td>${data.jenisReturn}</td>
            <td>${item.kode}</td>
            <td>${item.namaBarang}</td>
            <td>${item.jumlah}</td>
            <td>${item.keterangan || "-"}</td>
          </tr>
        `;
      });
    });

    printContent += `
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  },

  // Filter riwayat return
  filterRiwayatReturn() {
    const startDateStr = $("#filterStartDate").val();
    const endDateStr = $("#filterEndDate").val();

    if (!startDateStr || !endDateStr) {
      showAlert("Mohon pilih tanggal mulai dan tanggal akhir", "Warning", "warning");
      return;
    }

    // Parse tanggal dari format dd/mm/yyyy
    const startDate = parseDate(startDateStr);
    const endDate = parseDate(endDateStr);

    if (!startDate || !endDate) {
      showAlert("Format tanggal tidak valid", "Warning", "warning");
      return;
    }

    if (startDate > endDate) {
      showAlert("Tanggal mulai tidak boleh lebih besar dari tanggal akhir", "Warning", "warning");
      return;
    }

    // Konversi ke format ISO untuk query
    const startISO = startDate.toISOString().split("T")[0];
    const endISO = endDate.toISOString().split("T")[0];

    this.loadRiwayatReturn(startISO, endISO);
  },

  // Setup event listeners
  setupEventListeners() {
    // Jenis return change
    $("#jenisReturn").on("change", () => {
      const jenisReturn = $("#jenisReturn").val();
      if (jenisReturn) {
        this.loadStockData(jenisReturn);
      }
    });

    // Filter and print buttons
    $("#btnTampilkan").on("click", () => this.filterRiwayatReturn());
    $("#btnPrintLaporan").on("click", () => this.printLaporanReturn());

    // Pilih barang button
    $("#btnPilihBarang").on("click", async () => {
      const jenisReturn = $("#jenisReturn").val();
      if (!jenisReturn) {
        showAlert("Pilih jenis return terlebih dahulu", "Warning", "warning");
        return;
      }
      // Load data sebelum menampilkan modal
      await this.loadStockData(jenisReturn);
      $("#modalPilihBarang").modal("show");
    });

    // Search barang dengan debounce
    let searchTimeout;
    $("#searchBarang").on("keyup", () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.searchTable("#searchBarang", "#tableBarang tbody tr");
      }, 300);
    });

    // Table barang row click
    $("#tableBarang tbody").on("click", "tr", (e) => {
      const $row = $(e.currentTarget);
      const kode = $row.find("td:first").text();
      const nama = $row.find("td:eq(1)").text();

      this.addReturnRow(kode, nama);
      $("#modalPilihBarang").modal("hide");
    });

    // Delete return row
    $("#tableReturn tbody").on("click", ".btn-delete", (e) => {
      $(e.currentTarget).closest("tr").remove();
    });

    // Simpan return
    $("#btnSimpanReturn").on("click", () => this.saveReturn());

    // Batal button
    $("#btnBatal").on("click", () => this.resetForm());

    // Event listener untuk tombol hapus return
    $("#tableRiwayatReturn tbody").on("click", ".btn-delete-return", (e) => {
      const $btn = $(e.currentTarget);
      const returnId = $btn.data("return-id");
      const tanggal = $btn.data("tanggal");
      const sales = $btn.data("sales");

      this.showDeleteConfirmation(returnId, tanggal, sales);
    });

    // Event listener untuk modal konfirmasi hapus
    $("#btnKonfirmasiHapus").on("click", () => this.deleteReturnData());

    // Reset password field when modal is hidden
    $("#modalKonfirmasiHapus").on("hidden.bs.modal", () => {
      $("#passwordHapus").val("").removeClass("is-invalid");
      $("#passwordError").text("");
      this.currentDeleteData = null;
    });
  },

  // Setup realtime listeners
  setupRealTimeListeners() {
    // Listen for stock changes
    const stockQuery = collection(firestore, "stokAksesoris");
    this.stockListener = onSnapshot(stockQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "modified") {
          this.updateStockInTable(change.doc.data());
        }
      });
    });
  },

  // Load master data and calculate stock from transactions (single source of truth)
  async loadStockData(type) {
    try {
      console.log(`🔍 Loading stock data for type: ${type}`);

      // 1. Get master data (kode, nama, kategori) from stokAksesoris
      const stockRef = collection(firestore, "stokAksesoris");
      const snapshot = await getDocs(stockRef);
      const masterData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      console.log(`📦 Loaded ${masterData.length} master items`);

      // 2. Calculate real stock from transactions (single source of truth)
      const stockMap = await StockService.calculateAllStocksBatch();
      console.log(`📊 Calculated stock for ${stockMap.size} items`);

      // 3. Merge master data with calculated stock
      const mergedData = masterData.map((item) => ({
        ...item,
        stok: stockMap.get(item.kode) || 0, // Real stock from transactions
      }));

      // 4. Filter by type and stock > 0
      this.stockData = mergedData.filter((item) => {
        const itemKategori = (item.kategori || item.jenis || "").toLowerCase();

        // Match type (support kotak, aksesoris, silver)
        const matchesType =
          type === "kotak"
            ? itemKategori.includes("kotak")
            : type === "aksesoris"
              ? itemKategori.includes("aksesoris")
              : type === "silver"
                ? itemKategori.includes("silver")
                : false;

        const hasStock = item.stok > 0;

        if (matchesType) {
          console.log(`✓ ${item.kode}: kategori=${itemKategori}, stock=${item.stok}`);
        }

        return matchesType && hasStock;
      });

      this.populateStockTable();
      console.log(`✅ Loaded ${this.stockData.length} items for type '${type}' with stock > 0`);
    } catch (error) {
      console.error("❌ Error loading stock data:", error);
      showAlert("Gagal memuat data stok", "Error", "error");
    }
  },

  // Populate stock table
  populateStockTable() {
    const $tbody = $("#tableBarang tbody");
    $tbody.empty();

    if (!this.stockData || this.stockData.length === 0) {
      $tbody.append(`
        <tr>
          <td colspan="2" class="text-center">Tidak ada data dengan stok tersedia</td>
        </tr>
      `);
      return;
    }

    this.stockData.forEach((item) => {
      $tbody.append(`
        <tr data-id="${item.id}" data-kode="${item.kode}">
          <td>${item.kode}</td>
          <td>${item.nama || "-"}</td>
        </tr>
      `);
    });

    console.log(`📋 Populated table with ${this.stockData.length} items`);
  },

  // Add return row
  addReturnRow(kode, nama) {
    const $tbody = $("#tableReturn tbody");
    const rowHtml = `
      <tr>
        <td>${kode}</td>
        <td>${nama}</td>
        <td>
          <input type="number" class="form-control form-control-sm jumlah-return" 
                 min="1" required style="width: 100px">
        </td>
        <td>
          <input type="text" class="form-control form-control-sm keterangan" 
                 placeholder="Opsional">
        </td>
        <td>
          <button type="button" class="btn btn-danger btn-sm btn-delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
    $tbody.append(rowHtml);
  },

  // Search table function
  searchTable(input, targetRows) {
    const searchText = $(input).val().toLowerCase();
    $(targetRows).each(function () {
      const rowText = $(this).text().toLowerCase();
      $(this).toggle(rowText.includes(searchText));
    });
  },

  // Set default date
  setDefaultDate() {
    const today = new Date();
    // Format tanggal ke dd/mm/yyyy
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const formattedDate = `${day}/${month}/${year}`;

    // Set nilai default untuk input tanggal
    $("#tanggalReturn").val(formattedDate);
  },

  // Validate return
  validateReturn() {
    let isValid = true;
    const sales = $("#sales").val().trim();
    const jenisReturn = $("#jenisReturn").val();

    if (!sales) {
      $("#sales").addClass("is-invalid");
      isValid = false;
    } else {
      $("#sales").removeClass("is-invalid");
    }

    if (!jenisReturn) {
      $("#jenisReturn").addClass("is-invalid");
      isValid = false;
    } else {
      $("#jenisReturn").removeClass("is-invalid");
    }

    // Check if table has rows
    if ($("#tableReturn tbody tr").length === 0) {
      showAlert("Tambahkan minimal satu barang", "Warning", "warning");
      isValid = false;
    }

    // Validate jumlah return
    $(".jumlah-return").each(function () {
      const value = $(this).val();
      if (!value || value < 1) {
        $(this).addClass("is-invalid");
        isValid = false;
      } else {
        $(this).removeClass("is-invalid");
      }
    });

    return isValid;
  },

  // NEW: Get current stock data for specific item
  async getCurrentStockData(kode) {
    try {
      const stockRef = collection(firestore, "stokAksesoris");
      const stockQuery = query(stockRef, where("kode", "==", kode));
      const snapshot = await getDocs(stockQuery);

      if (!snapshot.empty) {
        const stockDoc = snapshot.docs[0];
        return {
          id: stockDoc.id,
          ...stockDoc.data(),
        };
      }
      return null;
    } catch (error) {
      console.error("Error getting current stock:", error);
      return null;
    }
  },

  // Save to stokAksesorisTransaksi collection (Single Source of Truth)
  async saveToStokTransaksi(returnData) {
    try {
      const savedTransactions = [];

      for (const item of returnData.detailReturn) {
        // Calculate current stock from transactions
        const stokSebelum = await StockService.calculateStockFromTransactions(item.kode);
        const stokSesudah = Math.max(0, stokSebelum - item.jumlah);

        // ✅ Gunakan StockService dengan field lengkap untuk single source of truth
        const transactionRef = await StockService.updateStock({
          kode: item.kode,
          jenis: "return",
          jumlah: item.jumlah,
          tanggal: returnData.tanggal, // Tanggal return yang dipilih user
          keterangan: item.keterangan || "",
          sales: returnData.namaSales,
          nama: item.namaBarang,
          namaBarang: item.namaBarang,
          jenisReturn: returnData.jenisReturn, // kotak/aksesoris/silver
          currentStock: stokSebelum,
          newStock: stokSesudah,
        });

        savedTransactions.push(transactionRef.id);
        console.log(`✅ Return transaction saved for ${item.kode} (ID: ${transactionRef.id})`);
      }

      return savedTransactions;
    } catch (error) {
      console.error("Error saving to stokAksesorisTransaksi:", error);
      throw error;
    }
  },

  // UPDATED: Save return with transaction logging
  async saveReturn() {
    if (this.isSaving || !this.validateReturn()) return;

    try {
      this.isSaving = true;
      $("#btnSimpanReturn").prop("disabled", true);

      // Prepare return data
      const selectedDateStr = $("#tanggalReturn").val();
      const selectedDate = parseDate(selectedDateStr);

      if (!selectedDate) {
        showAlert("Format tanggal tidak valid", "Error", "error");
        return;
      }

      // Format tanggal ke ISO string untuk Firestore
      const isoDate = selectedDate.toISOString();

      const returnData = {
        tanggal: isoDate,
        namaSales: $("#sales").val().trim(),
        jenisReturn: $("#jenisReturn").val(),
        detailReturn: [],
        timestamp: serverTimestamp(),
      };

      // Collect items data
      $("#tableReturn tbody tr").each(function () {
        const $row = $(this);
        returnData.detailReturn.push({
          kode: $row.find("td:first").text(),
          namaBarang: $row.find("td:eq(1)").text(),
          jumlah: parseInt($row.find(".jumlah-return").val()),
          keterangan: $row.find(".keterangan").val() || "",
        });
      });

      console.log("Saving return data:", returnData);

      // ✅ Single Source of Truth: Simpan HANYA ke stokAksesorisTransaksi
      const savedIds = await this.saveToStokTransaksi(returnData);
      console.log(`✅ Return saved with transaction IDs:`, savedIds);

      showAlert("Data return berhasil disimpan dan stok telah diperbarui", "Sukses", "success");
      this.resetForm();

      // Refresh data dengan filter tanggal yang aktif
      const startDateStr = $("#filterStartDate").val();
      const endDateStr = $("#filterEndDate").val();
      if (startDateStr && endDateStr) {
        const startDate = parseDate(startDateStr);
        const endDate = parseDate(endDateStr);
        if (startDate && endDate) {
          const startISO = startDate.toISOString().split("T")[0];
          const endISO = endDate.toISOString().split("T")[0];
          await this.loadRiwayatReturn(startISO, endISO);
        }
      }
    } catch (error) {
      console.error("Error saving return:", error);
      showAlert("Gagal menyimpan data return", "Error", "error");
    } finally {
      this.isSaving = false;
      $("#btnSimpanReturn").prop("disabled", false);
    }
  },

  // Reset form
  resetForm() {
    this.setDefaultDate();
    $("#sales").val("").removeClass("is-invalid");
    $("#jenisReturn").val("").removeClass("is-invalid");
    $("#tableReturn tbody").empty();
    $("#tableBarang tbody").empty();
  },

  // Update stock in table
  updateStockInTable(updatedStock) {
    const $row = $(`#tableBarang tbody tr:contains('${updatedStock.kode}')`);
    if ($row.length) {
      $row.find("td:eq(2)").text(updatedStock.stok || 0);
    }
  },

  // NEW: Show delete confirmation modal
  showDeleteConfirmation(returnId, tanggal, sales) {
    // Find the return data
    const returnData = this.riwayatData.find((data) => data.id === returnId);
    if (!returnData) {
      showAlert("Data return tidak ditemukan", "Error", "error");
      return;
    }

    this.currentDeleteData = returnData;

    // Populate detail data
    const $detailList = $("#detailHapusData");
    $detailList.empty();

    $detailList.append(`<li><strong>Tanggal:</strong> ${tanggal}</li>`);
    $detailList.append(`<li><strong>Kasir:</strong> ${sales}</li>`);
    $detailList.append(`<li><strong>Jenis Return:</strong> ${returnData.jenisReturn}</li>`);
    $detailList.append(`<li><strong>Items:</strong></li>`);

    returnData.detailReturn.forEach((item) => {
      $detailList.append(`
      <li style="margin-left: 20px;">
        ${item.kode} - ${item.namaBarang} (Qty: ${item.jumlah})
      </li>
    `);
    });

    // Show modal
    $("#modalKonfirmasiHapus").modal("show");
  },

  // Delete return data (Single Source of Truth - hapus dari stokAksesorisTransaksi)
  async deleteReturnData() {
    if (this.isDeleting || !this.currentDeleteData) return;

    const password = $("#passwordHapus").val().trim();

    // Validate password
    if (!password) {
      $("#passwordHapus").addClass("is-invalid");
      $("#passwordError").text("Password harus diisi");
      return;
    }

    if (password !== this.deletePassword) {
      $("#passwordHapus").addClass("is-invalid");
      $("#passwordError").text("Password salah");
      return;
    }

    try {
      this.isDeleting = true;
      $("#btnKonfirmasiHapus").prop("disabled", true).html('<i class="fas fa-spinner fa-spin me-2"></i>Menghapus...');

      // ✅ Single Source of Truth: Hapus langsung dari stokAksesorisTransaksi
      // Data ID sudah merujuk ke dokumen di stokAksesorisTransaksi
      await deleteDoc(doc(firestore, "stokAksesorisTransaksi", this.currentDeleteData.id));
      console.log(`✅ Return transaction deleted: ${this.currentDeleteData.id}`);

      showAlert("Data return berhasil dihapus dan stok otomatis dikembalikan", "Sukses", "success");

      // Hide modal and refresh data
      $("#modalKonfirmasiHapus").modal("hide");

      // Refresh dengan filter tanggal yang aktif
      const startDateStr = $("#filterStartDate").val();
      const endDateStr = $("#filterEndDate").val();
      if (startDateStr && endDateStr) {
        const startDate = parseDate(startDateStr);
        const endDate = parseDate(endDateStr);
        if (startDate && endDate) {
          const startISO = startDate.toISOString().split("T")[0];
          const endISO = endDate.toISOString().split("T")[0];
          await this.loadRiwayatReturn(startISO, endISO);
        }
      }
    } catch (error) {
      console.error("Error deleting return data:", error);
      showAlert("Gagal menghapus data return", "Error", "error");
    } finally {
      this.isDeleting = false;
      $("#btnKonfirmasiHapus").prop("disabled", false).html('<i class="fas fa-trash me-2"></i>Hapus Data');
    }
  },

  // ✅ Tidak perlu reverseStockChanges lagi!
  // Karena menggunakan Single Source of Truth (stokAksesorisTransaksi),
  // menghapus transaksi return otomatis mengembalikan stok
  // karena StockService.calculateStockFromTransactions() menghitung dari semua transaksi

  // Cleanup
  cleanup() {
    if (this.stockListener) {
      this.stockListener();
    }
  },
};

// Initialize when document is ready
$(document).ready(async () => {
  try {
    await returnHandler.init();
    console.log("✅ Return handler initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing return handler:", error);
  }
});

// Cleanup when page unloads
$(window).on("beforeunload", () => {
  returnHandler.cleanup();
});
