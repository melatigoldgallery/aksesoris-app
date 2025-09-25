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
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// DOM refs
const form = document.getElementById("barangForm");
const tanggalInput = document.getElementById("tanggal");
const btnAddRow = document.getElementById("btnAddRow");
const btnSave = document.getElementById("btnSave");
const inputTbody = document.querySelector("#inputTable tbody");

const filterTanggal = document.getElementById("filterTanggal");
const btnTampilkan = document.getElementById("btnTampilkan");
const dataTbody = document.querySelector("#dataTable tbody");
const btnSendWA = document.getElementById("btnSendWA");

const collRef = collection(firestore, "restokBarang");
let SUPPLIER_PHONE = null;

async function loadSupplierPhone() {
  try {
    const candidates = [
      { col: "settings", docId: "whatsapp", fields: ["supplierPhone", "phone", "suplierphone"] },
      { col: "setting", docId: "whatsapp", fields: ["suplierphone", "supplierPhone", "phone"] },
    ];

    for (const c of candidates) {
      try {
        const ref = doc(firestore, c.col, c.docId);
        const snap = await getDoc(ref);
        if (!snap.exists()) continue;
        const data = snap.data() || {};
        let raw = "";
        for (const f of c.fields) {
          if (data[f]) {
            raw = data[f];
            break;
          }
        }
        if (raw) {
          const cleaned = String(raw).replace(/[^+\d]/g, "");
          SUPPLIER_PHONE = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
          return true;
        }
      } catch (_) {
        /* continue to next candidate */
      }
    }
    console.warn("Supplier phone settings not found. Checked: settings/whatsapp and setting/whatsapp");
    return false;
  } catch (err) {
    console.error("Failed to load supplier phone:", err);
    return false;
  }
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

// Helpers
function pad(n) {
  return n.toString().padStart(2, "0");
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setDefaultDates() {
  const t = todayStr();
  if (tanggalInput) tanggalInput.value = t;
  if (filterTanggal) filterTanggal.value = t;
}

// Input rows
function makeRow() {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="form-control" placeholder="Nama barang" required></td>
    <td><input type="text" class="form-control" placeholder="Kadar" required></td>
    <td><input type="text" class="form-control" placeholder="Berat (gr)"></td>
    <td><input type="text" class="form-control" placeholder="Panjang (cm)"></td>
    <td class="actions-cell"><button type="button" class="btn btn-outline-danger btn-sm btn-remove">Hapus</button></td>
  `;
  tr.querySelector(".btn-remove").addEventListener("click", () => {
    tr.remove();
    toggleSaveState();
  });
  inputTbody.appendChild(tr);
  toggleSaveState();
}

function getInputRowsData() {
  const rows = Array.from(inputTbody.querySelectorAll("tr"));
  return rows.map((tr) => {
    const [nama, kadar, berat, panjang] = Array.from(tr.querySelectorAll("input")).map((i) => i.value.trim());
    // berat dan panjang disimpan sebagai string (opsional, bisa range "2 - 3", dlsb)
    return { nama, kadar, berat, panjang };
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
    inputs.forEach((inp, idx) => {
      const val = inp.value.trim();
      // Hanya wajib untuk kolom 0: nama, 1: kadar
      let valid = idx < 2 ? val !== "" : true;
      inp.classList.toggle("is-invalid", !valid);
      if (!valid) ok = false;
    });
  });
  return ok;
}

function toggleSaveState() {
  if (btnSave) btnSave.disabled = inputTbody.children.length === 0;
}

// Save batch to Firestore
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateInputForm()) return;
    btnSave.disabled = true;
    const tanggal = tanggalInput.value;
    const rows = getInputRowsData();
    try {
      for (const item of rows) {
        await addDoc(collRef, {
          tanggal,
          nama: item.nama,
          kadar: item.kadar,
          // berat & panjang disimpan apa adanya (string), bisa kosong atau range
          berat: item.berat,
          panjang: item.panjang,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      // reset
      inputTbody.innerHTML = "";
      makeRow();
      toastSuccess("Data berhasil disimpan");
      // refresh listing for selected filter date if equals tanggal
      if (filterTanggal && filterTanggal.value === tanggal) {
        await fetchAndRender();
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

// Listing
async function fetchByDate(dateStr) {
  try {
    const q = query(collRef, where("tanggal", "==", dateStr));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      items.push({ id: docSnap.id, ...data });
    });
    items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return items;
  } catch (err) {
    console.error("Gagal mengambil data:", err);
    return [];
  }
}

function renderRows(items) {
  dataTbody.innerHTML = items
    .map(
      (x) => `
    <tr data-id="${x.id}">
      <td>${x.tanggal || ""}</td>
      <td>${x.nama || ""}</td>
      <td>${x.kadar || ""}</td>
      <td>${x.berat ?? ""}</td>
      <td>${x.panjang ?? ""}</td>
      <td class="actions-cell">
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-primary btn-edit">Edit</button>
          <button type="button" class="btn btn-outline-danger btn-delete">Hapus</button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  // Bind actions
  dataTbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => enterEditMode(btn.closest("tr")));
  });
  dataTbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteRow(btn.closest("tr")));
  });
}

async function fetchAndRender() {
  const dateStr = filterTanggal?.value || todayStr();
  const items = await fetchByDate(dateStr);
  renderRows(items);
}

function enterEditMode(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  const tds = tr.children;
  const tanggal = tds[0].textContent.trim();
  const nama = tds[1].textContent.trim();
  const kadar = tds[2].textContent.trim();
  const berat = tds[3].textContent.trim();
  const panjang = tds[4].textContent.trim();

  tr.innerHTML = `
    <td>${tanggal}</td>
    <td><input type="text" class="form-control form-control-sm" value="${nama}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${kadar}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${berat}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${panjang}"></td>
    <td class="actions-cell">
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-success btn-save">Simpan</button>
        <button type="button" class="btn btn-secondary btn-cancel">Batal</button>
      </div>
    </td>
  `;
  tr.dataset.id = id;

  tr.querySelector(".btn-save").addEventListener("click", async () => {
    const [namaI, kadarI, beratI, panjangI] = Array.from(tr.querySelectorAll("input"));
    const newNama = namaI.value.trim();
    const newKadar = kadarI.value.trim();
    const newBerat = beratI.value.trim();
    const newPanjang = panjangI.value.trim();
    if (!newNama || !newKadar) {
      alert("Nama dan kadar wajib diisi");
      return;
    }
    try {
      await updateDoc(doc(firestore, "restokBarang", id), {
        nama: newNama,
        kadar: newKadar,
        // berat & panjang disimpan sebagai string (opsional)
        berat: newBerat,
        panjang: newPanjang,
        updatedAt: Date.now(),
      });
      await fetchAndRender();
      toastSuccess("Perubahan disimpan");
    } catch (err) {
      console.error("Gagal mengubah data:", err);
      alert("Gagal mengubah data");
    }
  });

  tr.querySelector(".btn-cancel").addEventListener("click", async () => {
    await fetchAndRender();
  });
}

async function deleteRow(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  if (!id) return;
  const ok = await confirmDelete("Hapus data ini?");
  if (!ok) return;
  try {
    await deleteDoc(doc(firestore, "restokBarang", id));
    tr.remove();
    toastSuccess("Data dihapus");
  } catch (err) {
    console.error("Gagal menghapus data:", err);
    alert("Gagal menghapus data");
  }
}

// WhatsApp send for current list
if (btnSendWA) {
  btnSendWA.addEventListener("click", () => {
    const rows = Array.from(dataTbody.querySelectorAll("tr"));
    if (rows.length === 0) {
      alert("Tidak ada data untuk dikirim");
      return;
    }
    if (!SUPPLIER_PHONE) {
      alert("Nomor WhatsApp pemasok belum tersedia");
      return;
    }
    const lines = ["Data Restok Barang:"];
    rows.forEach((tr) => {
      const [tgl, nama, kadar, berat, panjang] = Array.from(tr.children)
        .slice(0, 5)
        .map((td) => td.textContent.trim());
      lines.push(`- ${tgl} | ${nama} | ${kadar} | ${berat} gr | ${panjang} cm`);
    });
    const text = encodeURIComponent(lines.join("\n"));
    const url = `https://wa.me/${SUPPLIER_PHONE}?text=${text}`;
    window.open(url, "_blank");
  });
}

// Tampilkan button
if (btnTampilkan) {
  btnTampilkan.addEventListener("click", fetchAndRender);
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  // Load supplier phone on start
  loadSupplierPhone();
  setDefaultDates();
  if (inputTbody && inputTbody.children.length === 0) {
    makeRow();
  }
  fetchAndRender();
});
