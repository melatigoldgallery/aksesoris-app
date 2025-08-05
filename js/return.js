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
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { firestore } from "./configFirebase.js";

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

const returnHandler = {
  stockData: [],
  stockListener: null,
  isSaving: false,
  riwayatData: [],
  currentDeleteData: null,
  isDeleting: false,
  deletePassword: "smlt116",

  async filterRiwayatReturn() {
    const selectedDate = $("#filterDate").val();
    if (!selectedDate) {
      showAlert("Mohon pilih tanggal", "Warning", "warning");
      return;
    }
    this.loadRiwayatReturn(selectedDate);
  },

  async init() {
    try {
      await this.setupEventListeners();
      this.setupRealTimeListeners();
      this.setDefaultDate();
      this.setDefaultFilterDates();
      await this.loadRiwayatReturn();
    } catch (error) {
      console.error("Error initializing return handler:", error);
      showAlert("Terjadi kesalahan saat memuat halaman", "Error", "error");
    }
  },

  // Set default filter date
  setDefaultFilterDates() {
    const today = new Date();
    $("#filterDate").val(today.toISOString().split("T")[0]);
  },

  // Load riwayat return
  async loadRiwayatReturn(selectedDate = null) {
    try {
      const returnRef = collection(firestore, "returnBarang");
      let returnQuery = returnRef;

      if (selectedDate) {
        // Convert to Date object to handle time zones properly
        const date = new Date(selectedDate);
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

        returnQuery = query(
          returnRef,
          where("tanggal", ">=", startOfDay.toISOString()),
          where("tanggal", "<=", endOfDay.toISOString())
        );
      }

      const snapshot = await getDocs(returnQuery);
      this.riwayatData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      this.renderRiwayatReturn();
    } catch (error) {
      console.error("Error loading riwayat return:", error);
      showAlert("Gagal memuat data riwayat return", "Error", "error");
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
          <td>${data.tanggal}</td>
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

    const selectedDate = $("#filterDate").val();
    const formattedDate = new Date(selectedDate).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

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
            <p>Tanggal: ${formattedDate}</p>
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
      data.detailReturn.forEach((item) => {
        printContent += `
          <tr>
            <td>${data.tanggal}</td>
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
    const selectedDate = $("#filterDate").val();
    if (!selectedDate) {
      showAlert("Mohon pilih tanggal", "Warning", "warning");
      return;
    }
    this.loadRiwayatReturn(selectedDate);
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

    // Add filter function
    async function filterRiwayatReturn() {
      const selectedDate = $("#filterDate").val();
      if (!selectedDate) {
        showAlert("Mohon pilih tanggal", "Warning", "warning");
        return;
      }
      await this.loadRiwayatReturn(selectedDate);
    }

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

  // Load stock data based on type
  async loadStockData(type) {
    try {
      // Get all stock data first
      const stockRef = collection(firestore, "stokAksesoris");
      const snapshot = await getDocs(stockRef);

      // Log raw data for debugging
      console.log(
        "Raw Firestore data:",
        snapshot.docs.map((doc) => doc.data())
      );

      this.stockData = snapshot.docs.map((doc) => {
        const data = doc.data();
        return { id: doc.id, ...data };
      });

      // Filter based on type
      this.stockData = this.stockData.filter((item) => {
        // Check both kategori and jenis fields
        const itemType = (item.kategori || item.jenis || "").toLowerCase();
        const isMatchingType =
          type === "kotak" ? itemType.includes("kotak") : itemType.includes("aksesoris") || itemType === "";

        // Check stock
        const hasStock = (parseInt(item.stok) || parseInt(item.stokAkhir) || 0) > 0;

        // Log item details for debugging
        console.log(`Item ${item.kode}:`, {
          type: itemType,
          matches: isMatchingType,
          stock: hasStock,
          stok: item.stok,
          stokAkhir: item.stokAkhir,
        });

        return isMatchingType && hasStock;
      });

      this.populateStockTable();

      // Log filtered results
      console.log(`Loaded ${this.stockData.length} items for type: ${type}`);
      console.log("Filtered data:", this.stockData);
    } catch (error) {
      console.error("Error loading stock data:", error);
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
          <td colspan="3" class="text-center">Tidak ada data</td>
        </tr>
      `);
      return;
    }

    this.stockData.forEach((item) => {
      const stok = parseInt(item.stok) || parseInt(item.stokAkhir) || 0;
      if (stok > 0) {
        $tbody.append(`
          <tr data-id="${item.id}" data-kode="${item.kode}">
            <td>${item.kode}</td>
            <td>${item.nama || "-"}</td>
          </tr>
        `);
      }
    });

    // Log untuk debugging
    console.log(`Populated table with ${this.stockData.length} items`);
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
    // Format tanggal ke YYYY-MM-DD
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const formattedDate = `${year}-${month}-${day}`;

    // Set nilai default untuk input tanggal
    $("#tanggalReturn").val(formattedDate);
    $("#filterDate").val(formattedDate); // Set juga untuk filter tanggal

    // Set max date ke hari ini untuk mencegah pemilihan tanggal masa depan
    $("#tanggalReturn").attr("max", formattedDate);
    $("#filterDate").attr("max", formattedDate);
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

  // NEW: Update stock in stokAksesoris collection
  async updateStockAfterReturn(kode, jumlahReturn) {
    try {
      const stockRef = collection(firestore, "stokAksesoris");
      const stockQuery = query(stockRef, where("kode", "==", kode));
      const snapshot = await getDocs(stockQuery);

      if (!snapshot.empty) {
        const stockDoc = snapshot.docs[0];
        const currentData = stockDoc.data();
        const currentStok = parseInt(currentData.stok) || parseInt(currentData.stokAkhir) || 0;
        const newStok = currentStok + jumlahReturn;

        // Update stok
        await updateDoc(doc(firestore, "stokAksesoris", stockDoc.id), {
          stok: newStok,
          stokAkhir: newStok,
        });

        return true;
      }
      return false;
    } catch (error) {
      console.error("Error updating stock:", error);
      return false;
    }
  },

  // NEW: Save to stokAksesorisTransaksi collection
  async saveToStokTransaksi(returnData) {
    try {
      for (const item of returnData.detailReturn) {
        // Get current stock data
        const currentStock = await this.getCurrentStockData(item.kode);

        if (currentStock) {
          const stokSebelum = parseInt(currentStock.stok) || parseInt(currentStock.stokAkhir) || 0;
          const stokSesudah = stokSebelum + item.jumlah;

          // Prepare transaction data
          const transaksiData = {
            isScantiLock: false,
            jenis: "return", // Menandakan ini adalah transaksi return
            jumlah: item.jumlah,
            kategori: currentStock.kategori || returnData.jenisReturn,
            keterangan: `Return barang oleh ${returnData.namaSales}${item.keterangan ? ` - ${item.keterangan}` : ""}`,
            kode: item.kode,
            nama: item.namaBarang,
            stokAkhir: stokSesudah,
            stokSebelum: stokSebelum,
            stokSesudah: stokSesudah,
            timestamp: serverTimestamp(),
          };

          // Save to stokAksesorisTransaksi
          await addDoc(collection(firestore, "stokAksesorisTransaksi"), transaksiData);

          // Update stock in stokAksesoris
          await this.updateStockAfterReturn(item.kode, item.jumlah);

          console.log(`✅ Transaction saved for ${item.kode}`);
        } else {
          console.warn(`⚠️ Stock data not found for ${item.kode}`);
        }
      }
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
      const selectedDate = $("#tanggalReturn").val();

      const returnData = {
        tanggal: selectedDate,
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

      // Save to returnBarang collection
      await addDoc(collection(firestore, "returnBarang"), returnData);

      // Save to stokAksesorisTransaksi collection and update stock
      await this.saveToStokTransaksi(returnData);

      showAlert("Data return berhasil disimpan dan stok telah diperbarui", "Sukses", "success");
      this.resetForm();

      // Refresh data if needed
      await this.loadRiwayatReturn();
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

  // NEW: Delete return data
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

      // Delete from returnBarang collection
      await deleteDoc(doc(firestore, "returnBarang", this.currentDeleteData.id));

      // Optionally: Reverse stock changes
      await this.reverseStockChanges(this.currentDeleteData);

      showAlert("Data return berhasil dihapus", "Sukses", "success");

      // Hide modal and refresh data
      $("#modalKonfirmasiHapus").modal("hide");
      await this.loadRiwayatReturn($("#filterDate").val());
    } catch (error) {
      console.error("Error deleting return data:", error);
      showAlert("Gagal menghapus data return", "Error", "error");
    } finally {
      this.isDeleting = false;
      $("#btnKonfirmasiHapus").prop("disabled", false).html('<i class="fas fa-trash me-2"></i>Hapus Data');
    }
  },

  // NEW: Reverse stock changes when deleting return
  async reverseStockChanges(returnData) {
    try {
      for (const item of returnData.detailReturn) {
        // Get current stock data
        const currentStock = await this.getCurrentStockData(item.kode);

        if (currentStock) {
          const currentStok = parseInt(currentStock.stok) || parseInt(currentStock.stokAkhir) || 0;
          const newStok = currentStok - item.jumlah; // Kurangi stok karena return dibatalkan

          // Update stock in stokAksesoris
          await updateDoc(doc(firestore, "stokAksesoris", currentStock.id), {
            stok: Math.max(0, newStok), // Pastikan stok tidak negatif
            stokAkhir: Math.max(0, newStok),
          });

          // Create reverse transaction entry
          const reverseTransaksiData = {
            isScantiLock: false,
            jenis: "reverse_return",
            jumlah: -item.jumlah, // Negatif untuk menandakan pengurangan
            kategori: currentStock.kategori || returnData.jenisReturn,
            keterangan: `Pembatalan return - ${returnData.namaSales}`,
            kode: item.kode,
            nama: item.namaBarang,
            stokAkhir: Math.max(0, newStok),
            stokSebelum: currentStok,
            stokSesudah: Math.max(0, newStok),
            timestamp: serverTimestamp(),
          };

          // Save reverse transaction
          await addDoc(collection(firestore, "stokAksesorisTransaksi"), reverseTransaksiData);

          console.log(`✅ Stock reversed for ${item.kode}`);
        }
      }
    } catch (error) {
      console.error("Error reversing stock changes:", error);
      // Don't throw error here to avoid blocking the delete operation
    }
  },

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
