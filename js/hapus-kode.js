import app, { firestore } from "./configFirebase.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  deleteDoc,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// DOM refs
const btnTambah = document.getElementById("btnTambah");
const btnTampilkan = document.getElementById("btnTampilkan");
const btnCariKode = document.getElementById("btnCariKode");
const filterBulan = document.getElementById("filterBulan");
const searchKode = document.getElementById("searchKode");
const inputModal = document.getElementById("inputModal");
const inputForm = document.getElementById("inputForm");
const tanggalInput = document.getElementById("tanggal");
const btnAddRow = document.getElementById("btnAddRow");
const btnSave = document.getElementById("btnSave");
const inputTbody = document.querySelector("#inputTable tbody");
const dataTable = document.querySelector("#dataTable tbody");

const collRef = collection(firestore, "hapusKode");
let currentFilterMonth = null;

// Helpers
function pad(n) {
  return n.toString().padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function getMonthRange(monthStr) {
  const [year, month] = monthStr.split("-");
  const startDate = `${year}-${month}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const endDate = `${year}-${month}-${pad(lastDay)}`;
  return { startDate, endDate };
}

function toastSuccess(title = "Berhasil") {
  if (window.Swal) {
    const Toast = Swal.mixin({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 1500,
      timerProgressBar: true,
    });
    Toast.fire({ icon: "success", title });
  } else {
    alert(title);
  }
}

async function confirmDelete(text = "Hapus data ini?") {
  if (window.Swal) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Yakin?",
      text,
      showCancelButton: true,
      confirmButtonText: "Ya, hapus",
      cancelButtonText: "Batal",
    });
    return res.isConfirmed;
  }
  return confirm(text);
}

// Modal Functions
function openInputModal() {
  inputTbody.innerHTML = "";
  makeRow();
  if (tanggalInput) tanggalInput.value = todayStr();
  new bootstrap.Modal(inputModal).show();
}

function makeRow() {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama sales..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Kode barcode..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama barang..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="0.00" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Contoh: 750" required></td>
    <td><input type="date" class="form-control form-control-sm" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama penerima..."></td>
    <td class="text-center"><button type="button" class="btn btn-danger btn-sm btn-remove"><i class="fas fa-trash"></i></button></td>
  `;
  tr.querySelector(".btn-remove").addEventListener("click", () => {
    tr.remove();
    toggleSaveState();
  });
  inputTbody.appendChild(tr);
  toggleSaveState();

  // Auto-focus pada input pertama
  const firstInput = tr.querySelector("input");
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 100);
  }
}

function toggleSaveState() {
  if (btnSave) btnSave.disabled = inputTbody.children.length === 0;
}

function getInputRowsData() {
  const rows = Array.from(inputTbody.querySelectorAll("tr"));
  return rows.map((tr) => {
    const inputs = tr.querySelectorAll("input");
    const [sales, barcode, namaBarang, berat, kadar, tglTerjual, penerimaBarang] = Array.from(inputs).map((i) =>
      i.value.trim()
    );
    return { sales, barcode, namaBarang, berat, kadar, tglTerjual, penerimaBarang };
  });
}

function validateInputForm() {
  let ok = true;
  if (!tanggalInput.value) {
    tanggalInput.classList.add("is-invalid");
    ok = false;
  } else {
    tanggalInput.classList.remove("is-invalid");
  }
  const trs = Array.from(inputTbody.querySelectorAll("tr"));
  if (trs.length === 0) ok = false;
  trs.forEach((tr) => {
    const inputs = tr.querySelectorAll("input");
    inputs.forEach((inp) => {
      const val = inp.value.trim();
      const valid = val !== "";
      inp.classList.toggle("is-invalid", !valid);
      if (!valid) ok = false;
    });
  });
  return ok;
}

// Save Data
if (btnSave) {
  btnSave.addEventListener("click", async () => {
    if (!validateInputForm()) return;
    btnSave.disabled = true;
    const tanggal = tanggalInput.value;
    const jam = currentTime();
    const rows = getInputRowsData();
    try {
      for (const item of rows) {
        await addDoc(collRef, {
          tanggal,
          jam,
          sales: item.sales,
          barcode: item.barcode,
          namaBarang: item.namaBarang,
          berat: item.berat,
          kadar: item.kadar,
          tglTerjual: item.tglTerjual,
          penerimaBarang: item.penerimaBarang,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      const modalInstance = bootstrap.Modal.getInstance(inputModal);
      if (modalInstance) modalInstance.hide();
      inputTbody.innerHTML = "";
      makeRow();
      toastSuccess("Data berhasil disimpan");
      // Refresh dengan filter bulan yang aktif
      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth, searchKode?.value?.trim() || "");
      }
    } catch (err) {
      console.error("Gagal menyimpan:", err);
      alert("Gagal menyimpan data");
    } finally {
      btnSave.disabled = false;
    }
  });
}

if (btnAddRow) {
  btnAddRow.addEventListener("click", () => makeRow());
}

if (btnTambah) {
  btnTambah.addEventListener("click", openInputModal);
}

// Fetch and Render Data
async function fetchAndRender(monthStr, filterKode = "") {
  if (!monthStr) {
    renderTable([]);
    return;
  }

  try {
    const { startDate, endDate } = getMonthRange(monthStr);
    const q = query(
      collRef,
      where("tanggal", ">=", startDate),
      where("tanggal", "<=", endDate),
      orderBy("tanggal", "desc")
    );
    const snap = await getDocs(q);
    const items = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      items.push({ id: docSnap.id, ...data });
    });

    // Filter by kode if provided
    let filteredData = items;
    if (filterKode) {
      filteredData = items.filter((x) => (x.barcode || "").toLowerCase().includes(filterKode.toLowerCase()));
    }

    // Sort by createdAt desc for same date
    filteredData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    renderTable(filteredData);
  } catch (err) {
    console.error("Gagal mengambil data:", err);
    alert("Gagal mengambil data");
  }
}

function renderTable(items) {
  if (!currentFilterMonth) {
    dataTable.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-muted py-5">
          <i class="fas fa-calendar-alt fa-2x mb-3 opacity-50"></i>
          <div class="h6">Pilih bulan dan klik "Tampilkan" untuk melihat data</div>
        </td>
      </tr>
    `;
    return;
  }

  if (items.length === 0) {
    dataTable.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-muted py-4">
          <i class="fas fa-inbox fa-2x mb-2"></i>
          <div>Data tidak ditemukan</div>
        </td>
      </tr>
    `;
    return;
  }

  dataTable.innerHTML = items
    .map(
      (x, idx) => `
    <tr data-id="${x.id}">
      <td>${idx + 1}</td>
      <td>${x.tanggal || ""}</td>
      <td>${x.jam || ""}</td>
      <td>${x.sales || ""}</td>
      <td>${x.barcode || ""}</td>
      <td>${x.namaBarang || ""}</td>
      <td>${x.berat || ""}</td>
      <td>${x.kadar || ""}</td>
      <td>${x.tglTerjual || ""}</td>
      <td>${x.penerimaBarang || ""}</td>
      <td>
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-primary btn-edit" title="Edit">
            <i class="fas fa-edit"></i>
          </button>
          <button type="button" class="btn btn-danger btn-delete" title="Hapus">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  dataTable.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => enterEditMode(btn.closest("tr")));
  });
  dataTable.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteRow(btn.closest("tr")));
  });
}

// Edit Mode
function enterEditMode(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  const tds = tr.children;
  const no = tds[0].textContent.trim();
  const tanggal = tds[1].textContent.trim();
  const jam = tds[2].textContent.trim();
  const sales = tds[3].textContent.trim();
  const barcode = tds[4].textContent.trim();
  const namaBarang = tds[5].textContent.trim();
  const berat = tds[6].textContent.trim();
  const kadar = tds[7].textContent.trim();
  const tglTerjual = tds[8].textContent.trim();
  const penerimaBarang = tds[9].textContent.trim();

  tr.innerHTML = `
    <td>${no}</td>
    <td>${tanggal}</td>
    <td>${jam}</td>
    <td><input type="text" class="form-control form-control-sm" value="${sales}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${barcode}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${namaBarang}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${berat}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${kadar}"></td>
    <td><input type="date" class="form-control form-control-sm" value="${tglTerjual}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${penerimaBarang}"></td>
    <td>
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-success btn-save">Simpan</button>
        <button type="button" class="btn btn-secondary btn-cancel">Batal</button>
      </div>
    </td>
  `;
  tr.dataset.id = id;

  tr.querySelector(".btn-save").addEventListener("click", async () => {
    const inputs = Array.from(tr.querySelectorAll("input"));
    const [newSales, newBarcode, newNamaBarang, newBerat, newKadar, newTglTerjual, newPenerimaBarang] = inputs.map(
      (i) => i.value.trim()
    );
    if (!newSales || !newBarcode || !newNamaBarang || !newBerat || !newKadar || !newTglTerjual) {
      alert("Field Sales, Barcode, Nama Barang, Berat, Kadar, dan Tgl Terjual wajib diisi");
      return;
    }
    try {
      await updateDoc(doc(firestore, "hapusKode", id), {
        sales: newSales,
        barcode: newBarcode,
        namaBarang: newNamaBarang,
        berat: newBerat,
        kadar: newKadar,
        tglTerjual: newTglTerjual,
        penerimaBarang: newPenerimaBarang,
        updatedAt: Date.now(),
      });
      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth, searchKode?.value?.trim() || "");
      }
      toastSuccess("Perubahan disimpan");
    } catch (err) {
      console.error("Gagal mengubah data:", err);
      alert("Gagal mengubah data");
    }
  });

  tr.querySelector(".btn-cancel").addEventListener("click", async () => {
    if (currentFilterMonth) {
      await fetchAndRender(currentFilterMonth, searchKode?.value?.trim() || "");
    }
  });
}

// Delete Row
async function deleteRow(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  if (!id) return;
  const ok = await confirmDelete("Hapus data ini?");
  if (!ok) return;
  try {
    await deleteDoc(doc(firestore, "hapusKode", id));
    tr.remove();
    toastSuccess("Data dihapus");
  } catch (err) {
    console.error("Gagal menghapus data:", err);
    alert("Gagal menghapus data");
  }
}

// Filter Bulan - Button Tampilkan
if (btnTampilkan) {
  btnTampilkan.addEventListener("click", () => {
    const monthStr = filterBulan?.value;
    if (!monthStr) {
      alert("Pilih bulan terlebih dahulu");
      return;
    }
    currentFilterMonth = monthStr;
    const filterKode = searchKode?.value?.trim() || "";
    fetchAndRender(monthStr, filterKode);
  });
}

// Search Kode
if (btnCariKode) {
  btnCariKode.addEventListener("click", () => {
    if (!currentFilterMonth) {
      alert("Pilih bulan terlebih dahulu");
      return;
    }
    const filterKode = searchKode?.value?.trim() || "";
    fetchAndRender(currentFilterMonth, filterKode);
  });
}

if (searchKode) {
  searchKode.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnCariKode?.click();
    }
  });
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  // Set default month to current
  if (filterBulan) {
    filterBulan.value = currentMonthStr();
  }
  // Show initial empty state with message
  renderTable([]);
});
