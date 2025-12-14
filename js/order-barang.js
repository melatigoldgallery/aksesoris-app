import app, { firestore } from './configFirebase.js'
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
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js'

// DOM refs
const btnTambah = document.getElementById('btnTambah')
const btnTampilkan = document.getElementById('btnTampilkan')
const btnCariKode = document.getElementById('btnCariKode')
const filterBulan = document.getElementById('filterBulan')
const searchKode = document.getElementById('searchKode')
const filterStatus = document.getElementById('filterStatus')
const filterStatusOrder = document.getElementById('filterStatusOrder')
const inputModal = document.getElementById('inputModal')
const inputForm = document.getElementById('inputForm')
const tanggalInput = document.getElementById('tanggal')
const btnAddRow = document.getElementById('btnAddRow')
const btnSave = document.getElementById('btnSave')
const inputTbody = document.querySelector('#inputTable tbody')
const dataTable = document.querySelector('#dataTable tbody')

const collRef = collection(firestore, 'orderBarang')
let currentFilterMonth = null

// Helpers
function pad(n) {
  return n.toString().padStart(2, '0')
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

function getMonthRange(monthStr) {
  const [year, month] = monthStr.split('-')
  const startDate = `${year}-${month}-01`
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
  const endDate = `${year}-${month}-${pad(lastDay)}`
  return { startDate, endDate }
}

function formatPhoneNumber(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '')
  if (cleaned.startsWith('08')) {
    return '62' + cleaned.slice(1)
  } else if (cleaned.startsWith('8')) {
    return '62' + cleaned
  } else if (cleaned.startsWith('62')) {
    return cleaned
  }
  return cleaned
}

function toastSuccess(title = 'Berhasil') {
  if (window.Swal) {
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 1500,
      timerProgressBar: true,
    })
    Toast.fire({ icon: 'success', title })
  } else {
    alert(title)
  }
}

async function confirmDelete(text = 'Hapus data ini?') {
  if (window.Swal) {
    const res = await Swal.fire({
      icon: 'warning',
      title: 'Yakin?',
      text,
      showCancelButton: true,
      confirmButtonText: 'Ya, hapus',
      cancelButtonText: 'Batal',
    })
    return res.isConfirmed
  }
  return confirm(text)
}

// Modal Functions
function openInputModal() {
  inputTbody.innerHTML = ''
  makeRow()
  if (tanggalInput) tanggalInput.value = todayStr()
  new bootstrap.Modal(inputModal).show()
}

function makeRow() {
  const tr = document.createElement('tr')
  tr.innerHTML = `
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama sales..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama customer..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="08xxx..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Jenis barang..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="0.00" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="750" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="0"></td>
    <td class="text-center">
      <span class="badge bg-warning text-dark">Belum Dihubungi</span>
    </td>
    <td class="text-center"><button type="button" class="btn btn-danger btn-sm btn-remove"><i class="fas fa-trash"></i></button></td>
  `
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove()
    toggleSaveState()
  })
  inputTbody.appendChild(tr)
  toggleSaveState()

  const firstInput = tr.querySelector('input')
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 100)
  }
}

function toggleSaveState() {
  if (btnSave) btnSave.disabled = inputTbody.children.length === 0
}

function getInputRowsData() {
  const rows = Array.from(inputTbody.querySelectorAll('tr'))
  return rows.map((tr) => {
    const inputs = tr.querySelectorAll('input')
    const [sales, namaCustomer, noWa, orderBarang, berat, kadar, panjang] = Array.from(inputs).map(
      (i) => i.value.trim()
    )
    return { sales, namaCustomer, noWa, orderBarang, berat, kadar, panjang }
  })
}

function validateInputForm() {
  let ok = true
  if (!tanggalInput.value) {
    tanggalInput.classList.add('is-invalid')
    ok = false
  } else {
    tanggalInput.classList.remove('is-invalid')
  }
  const trs = Array.from(inputTbody.querySelectorAll('tr'))
  if (trs.length === 0) ok = false
  trs.forEach((tr) => {
    const inputs = tr.querySelectorAll('input')
    inputs.forEach((inp, idx) => {
      const val = inp.value.trim()
      // panjang (idx 6) optional
      const valid = idx === 6 ? true : val !== ''
      inp.classList.toggle('is-invalid', !valid)
      if (!valid) ok = false
    })
  })
  return ok
}

// Save Data
if (btnSave) {
  btnSave.addEventListener('click', async () => {
    if (!validateInputForm()) return
    btnSave.disabled = true
    const tanggal = tanggalInput.value
    const rows = getInputRowsData()
    try {
      for (const item of rows) {
        const formattedWa = formatPhoneNumber(item.noWa)
        await addDoc(collRef, {
          tanggal,
          sales: item.sales,
          namaCustomer: item.namaCustomer,
          noWa: formattedWa,
          orderBarang: item.orderBarang,
          berat: item.berat,
          kadar: item.kadar,
          panjang: item.panjang,
          status: 'belum_dihubungi',
          statusOrder: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
      const modalInstance = bootstrap.Modal.getInstance(inputModal)
      if (modalInstance) modalInstance.hide()
      inputTbody.innerHTML = ''
      makeRow()
      toastSuccess('Data berhasil disimpan')
      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth, searchKode?.value?.trim() || '')
      }
    } catch (err) {
      console.error('Gagal menyimpan:', err)
      alert('Gagal menyimpan data')
    } finally {
      btnSave.disabled = false
    }
  })
}

if (btnAddRow) {
  btnAddRow.addEventListener('click', () => makeRow())
}

if (btnTambah) {
  btnTambah.addEventListener('click', openInputModal)
}

// Fetch and Render Data
async function fetchAndRender(monthStr, filterText = '') {
  if (!monthStr) {
    renderTable([])
    return
  }

  try {
    const { startDate, endDate } = getMonthRange(monthStr)
    const q = query(
      collRef,
      where('tanggal', '>=', startDate),
      where('tanggal', '<=', endDate),
      orderBy('tanggal', 'desc')
    )
    const snap = await getDocs(q)
    const items = []
    snap.forEach((docSnap) => {
      const data = docSnap.data()
      items.push({ id: docSnap.id, ...data })
    })

    // Filter by text if provided - search across all columns
    let filteredData = items
    if (filterText) {
      const lower = filterText.toLowerCase()
      filteredData = filteredData.filter(
        (x) =>
          (x.tanggal || '').toLowerCase().includes(lower) ||
          (x.sales || '').toLowerCase().includes(lower) ||
          (x.namaCustomer || '').toLowerCase().includes(lower) ||
          (x.noWa || '').toLowerCase().includes(lower) ||
          (x.orderBarang || '').toLowerCase().includes(lower) ||
          (x.berat || '').toLowerCase().includes(lower) ||
          (x.kadar || '').toLowerCase().includes(lower) ||
          (x.panjang || '').toLowerCase().includes(lower)
      )
    }

    // Filter by status
    const statusValue = filterStatus?.value || ''
    if (statusValue) {
      filteredData = filteredData.filter((x) => x.status === statusValue)
    }

    // Filter by status order
    const statusOrderValue = filterStatusOrder?.value || ''
    if (statusOrderValue) {
      filteredData = filteredData.filter((x) => x.statusOrder === statusOrderValue)
    }

    filteredData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    renderTable(filteredData)
  } catch (err) {
    console.error('Gagal mengambil data:', err)
    alert('Gagal mengambil data')
  }
}

function getStatusBadge(status) {
  if (status === 'sudah_dihubungi') {
    return '<span class="badge bg-success">Sudah Dihubungi</span>'
  }
  return '<span class="badge bg-warning text-dark">Belum Dihubungi</span>'
}

function getStatusOrderBadge(statusOrder) {
  if (statusOrder === 'berhasil') {
    return '<span class="badge bg-success">Berhasil</span>'
  } else if (statusOrder === 'cancel') {
    return '<span class="badge bg-danger">Cancel</span>'
  }
  return '<span class="badge bg-secondary">Pending</span>'
}

function renderTable(items) {
  if (!currentFilterMonth) {
    dataTable.innerHTML = `
      <tr>
        <td colspan="13" class="text-center text-muted py-5">
          <i class="fas fa-calendar-alt fa-2x mb-3 opacity-50"></i>
          <div class="h6">Pilih bulan dan klik "Tampilkan" untuk melihat data</div>
        </td>
      </tr>
    `
    return
  }

  if (items.length === 0) {
    dataTable.innerHTML = `
      <tr>
        <td colspan="13" class="text-center text-muted py-4">
          <i class="fas fa-inbox fa-2x mb-2"></i>
          <div>Data tidak ditemukan</div>
        </td>
      </tr>
    `
    return
  }

  dataTable.innerHTML = items
    .map(
      (x, idx) => `
    <tr data-id="${x.id}">
      <td>${idx + 1}</td>
      <td>${x.tanggal || ''}</td>
      <td>${x.sales || ''}</td>
      <td>${x.namaCustomer || ''}</td>
      <td>${x.noWa || ''}</td>
      <td>${x.orderBarang || ''}</td>
      <td>${x.berat || ''}</td>
      <td>${x.kadar || ''}</td>
      <td>${x.panjang || '-'}</td>
      <td class="text-center">${getStatusBadge(x.status)}</td>
      <td class="text-center">${getStatusOrderBadge(x.statusOrder)}</td>
      <td class="text-center">
        <button type="button" class="btn btn-success btn-sm btn-wa" title="Hubungi via WhatsApp" data-wa="${
          x.noWa
        }" data-nama="${x.namaCustomer}" data-barang="${x.orderBarang}" data-berat="${
        x.berat
      }" data-kadar="${x.kadar}" data-panjang="${x.panjang}">
          <i class="fab fa-whatsapp"></i>
        </button>
      </td>
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
    .join('')

  dataTable.querySelectorAll('.btn-wa').forEach((btn) => {
    btn.addEventListener('click', () => sendWhatsApp(btn))
  })
  dataTable.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => enterEditMode(btn.closest('tr')))
  })
  dataTable.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteRow(btn.closest('tr')))
  })
}

// WhatsApp Function
function sendWhatsApp(btn) {
  const wa = btn.dataset.wa
  const nama = btn.dataset.nama
  const barang = btn.dataset.barang
  const berat = btn.dataset.berat
  const kadar = btn.dataset.kadar
  const panjang = btn.dataset.panjang

  const message = `Halo ${nama},

Barang yang Anda order sudah ready!

Detail Order:
- Barang: ${barang}
- Berat: ${berat} gr
- Kadar: ${kadar}
${panjang ? `- Panjang: ${panjang} cm` : ''}

Silakan konfirmasi untuk proses selanjutnya.

Terima kasih`

  const encodedMsg = encodeURIComponent(message)
  const url = `https://wa.me/${wa}?text=${encodedMsg}`
  window.open(url, '_blank')
}

// Edit Mode
function enterEditMode(tr) {
  if (!tr) return
  const id = tr.dataset.id
  const tds = tr.children
  const no = tds[0].textContent.trim()
  const tanggal = tds[1].textContent.trim()
  const sales = tds[2].textContent.trim()
  const namaCustomer = tds[3].textContent.trim()
  const noWa = tds[4].textContent.trim()
  const orderBarang = tds[5].textContent.trim()
  const berat = tds[6].textContent.trim()
  const kadar = tds[7].textContent.trim()
  const panjang = tds[8].textContent.trim()

  // Extract status dari badge
  const statusBadge = tds[9].querySelector('.badge')
  const currentStatus = statusBadge?.textContent.includes('Sudah')
    ? 'sudah_dihubungi'
    : 'belum_dihubungi'

  const statusOrderBadge = tds[10].querySelector('.badge')
  let currentStatusOrder = 'pending'
  if (statusOrderBadge?.textContent.includes('Berhasil')) currentStatusOrder = 'berhasil'
  else if (statusOrderBadge?.textContent.includes('Cancel')) currentStatusOrder = 'cancel'

  tr.innerHTML = `
    <td>${no}</td>
    <td>${tanggal}</td>
    <td><input type="text" class="form-control form-control-sm" value="${sales}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${namaCustomer}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${noWa}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${orderBarang}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${berat}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${kadar}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${
      panjang === '-' ? '' : panjang
    }"></td>
    <td>
      <select class="form-select form-select-sm">
        <option value="belum_dihubungi" ${
          currentStatus === 'belum_dihubungi' ? 'selected' : ''
        }>Belum Dihubungi</option>
        <option value="sudah_dihubungi" ${
          currentStatus === 'sudah_dihubungi' ? 'selected' : ''
        }>Sudah Dihubungi</option>
      </select>
    </td>
    <td>
      <select class="form-select form-select-sm">
        <option value="pending" ${
          currentStatusOrder === 'pending' ? 'selected' : ''
        }>Pending</option>
        <option value="berhasil" ${
          currentStatusOrder === 'berhasil' ? 'selected' : ''
        }>Berhasil</option>
        <option value="cancel" ${currentStatusOrder === 'cancel' ? 'selected' : ''}>Cancel</option>
      </select>
    </td>
    <td colspan="2">
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-success btn-save">Simpan</button>
        <button type="button" class="btn btn-secondary btn-cancel">Batal</button>
      </div>
    </td>
  `
  tr.dataset.id = id

  tr.querySelector('.btn-save').addEventListener('click', async () => {
    const inputs = Array.from(tr.querySelectorAll('input'))
    const selects = Array.from(tr.querySelectorAll('select'))
    const [newSales, newNamaCustomer, newNoWa, newOrderBarang, newBerat, newKadar, newPanjang] =
      inputs.map((i) => i.value.trim())
    const newStatus = selects[0].value
    const newStatusOrder = selects[1].value

    if (!newSales || !newNamaCustomer || !newNoWa || !newOrderBarang || !newBerat || !newKadar) {
      alert('Field Sales, Nama Customer, No WA, Order Barang, Berat, dan Kadar wajib diisi')
      return
    }

    try {
      const formattedWa = formatPhoneNumber(newNoWa)
      await updateDoc(doc(firestore, 'orderBarang', id), {
        sales: newSales,
        namaCustomer: newNamaCustomer,
        noWa: formattedWa,
        orderBarang: newOrderBarang,
        berat: newBerat,
        kadar: newKadar,
        panjang: newPanjang,
        status: newStatus,
        statusOrder: newStatusOrder,
        updatedAt: Date.now(),
      })
      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth, searchKode?.value?.trim() || '')
      }
      toastSuccess('Perubahan disimpan')
    } catch (err) {
      console.error('Gagal mengubah data:', err)
      alert('Gagal mengubah data')
    }
  })

  tr.querySelector('.btn-cancel').addEventListener('click', async () => {
    if (currentFilterMonth) {
      await fetchAndRender(currentFilterMonth, searchKode?.value?.trim() || '')
    }
  })
}

// Delete Row
async function deleteRow(tr) {
  if (!tr) return
  const id = tr.dataset.id
  if (!id) return
  const ok = await confirmDelete('Hapus data ini?')
  if (!ok) return
  try {
    await deleteDoc(doc(firestore, 'orderBarang', id))
    tr.remove()
    toastSuccess('Data dihapus')
  } catch (err) {
    console.error('Gagal menghapus data:', err)
    alert('Gagal menghapus data')
  }
}

// Filter Bulan - Button Tampilkan
if (btnTampilkan) {
  btnTampilkan.addEventListener('click', () => {
    const monthStr = filterBulan?.value
    if (!monthStr) {
      alert('Pilih bulan terlebih dahulu')
      return
    }
    currentFilterMonth = monthStr
    const filterText = searchKode?.value?.trim() || ''
    fetchAndRender(monthStr, filterText)
  })
}

// Search
if (btnCariKode) {
  btnCariKode.addEventListener('click', () => {
    if (!currentFilterMonth) {
      alert('Pilih bulan terlebih dahulu')
      return
    }
    const filterText = searchKode?.value?.trim() || ''
    fetchAndRender(currentFilterMonth, filterText)
  })
}

if (searchKode) {
  searchKode.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      btnCariKode?.click()
    }
  })
}

// Filter Status Dropdown
if (filterStatus) {
  filterStatus.addEventListener('change', () => {
    if (!currentFilterMonth) {
      alert('Pilih bulan terlebih dahulu')
      filterStatus.value = ''
      return
    }
    const filterText = searchKode?.value?.trim() || ''
    fetchAndRender(currentFilterMonth, filterText)
  })
}

// Filter Status Order Dropdown
if (filterStatusOrder) {
  filterStatusOrder.addEventListener('change', () => {
    if (!currentFilterMonth) {
      alert('Pilih bulan terlebih dahulu')
      filterStatusOrder.value = ''
      return
    }
    const filterText = searchKode?.value?.trim() || ''
    fetchAndRender(currentFilterMonth, filterText)
  })
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  if (filterBulan) {
    filterBulan.value = currentMonthStr()
  }
  renderTable([])
})
