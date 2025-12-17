import { firestore } from './configFirebase.js'
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js'

// Global variables
let activeLockRow = null
let currentTransactionData = null

// Enhanced smart cache with real-time sync capabilities
const simpleCache = {
  data: new Map(),

  set(key, value) {
    this.data.set(key, value)
  },

  get(key) {
    return this.data.get(key)
  },

  remove(key) {
    this.data.delete(key)
  },

  clear() {
    this.data.clear()
  },
}

// Utility functions
const utils = {
  showAlert: (message, title = 'Informasi', type = 'info') => {
    return Swal.fire({
      title,
      text: message,
      icon: type,
      confirmButtonText: 'OK',
      confirmButtonColor: '#0d6efd',
    })
  },

  showConfirm: (message, title = 'Konfirmasi') => {
    return Swal.fire({
      title,
      text: message,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#0d6efd',
      cancelButtonColor: '#6c757d',
    }).then((result) => result.isConfirmed)
  },

  formatDate: (date) => {
    if (!date) return ''
    try {
      const d = date.toDate ? date.toDate() : date instanceof Date ? date : new Date(date)
      const day = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const year = d.getFullYear()
      return `${day}/${month}/${year}`
    } catch (error) {
      console.error('Error formatting date:', error)
      return ''
    }
  },

  parseDate: (dateString) => {
    if (!dateString) return null
    try {
      const parts = dateString.split('/')
      return new Date(parts[2], parts[1] - 1, parts[0])
    } catch (error) {
      console.error('Error parsing date:', error)
      return null
    }
  },

  formatRupiah: (angka) => {
    if (!angka && angka !== 0) return '0'
    const number = typeof angka === 'string' ? parseInt(angka.replace(/\./g, '')) : angka
    return new Intl.NumberFormat('id-ID').format(number)
  },

  showLoading: (show) => {
    const loader = document.getElementById('loadingIndicator')
    if (loader) loader.style.display = show ? 'flex' : 'none'
  },

  isSameDate: (date1, date2) => {
    if (!date1 || !date2) return false
    const d1 = date1 instanceof Date ? date1 : new Date(date1)
    const d2 = date2 instanceof Date ? date2 : new Date(date2)
    return d1.toDateString() === d2.toDateString()
  },

  debounce: (func, wait) => {
    let timeout
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout)
        func(...args)
      }
      clearTimeout(timeout)
      timeout = setTimeout(later, wait)
    }
  },
}

// Enhanced reads monitor for Firestore optimization
const readsMonitor = {
  reads: {},
  dailyLimit: 50000,

  increment(operation, count = 1) {
    const today = new Date().toDateString()
    if (!this.reads[today]) {
      this.reads[today] = {}
    }
    if (!this.reads[today][operation]) {
      this.reads[today][operation] = 0
    }
    this.reads[today][operation] += count

    try {
      localStorage.setItem('firestore_reads', JSON.stringify(this.reads))
    } catch (error) {
      console.warn('Failed to store reads data:', error)
    }

    this.checkLimits()
  },

  getTodayReads() {
    const today = new Date().toDateString()
    const todayReads = this.reads[today] || {}
    return Object.values(todayReads).reduce((sum, count) => sum + count, 0)
  },

  // PERBAIKAN: Tambahkan method yang hilang
  getUsagePercent() {
    const todayReads = this.getTodayReads()
    return (todayReads / this.dailyLimit) * 100
  },

  checkLimits() {
    const percentage = this.getUsagePercent()

    if (percentage > 80) {
      console.warn(`🔥 Firestore reads at ${percentage.toFixed(1)}% of daily limit`)
    }

    if (percentage > 95) {
      console.error('🚨 Firestore reads approaching daily limit!')
    }
  },

  getStats() {
    const today = new Date().toDateString()
    const todayReads = this.reads[today] || {}
    const total = this.getTodayReads()

    return {
      today: todayReads,
      total,
      percentage: this.getUsagePercent(),
      remaining: this.dailyLimit - total,
    }
  },

  init() {
    try {
      const stored = localStorage.getItem('firestore_reads')
      if (stored) {
        this.reads = JSON.parse(stored)
      }
    } catch (error) {
      console.warn('Failed to load reads data:', error)
      this.reads = {}
    }
  },
}

// Main application handler
const penjualanHandler = {
  stockData: [],
  salesData: [],
  stockCache: new Map(),
  isSaving: false,

  // Real-time listeners
  stockListener: null,
  salesListener: null,

  // User activity tracking
  isUserActive: true,
  lastActivity: Date.now(),
  inactivityTimer: null,
  INACTIVITY_TIMEOUT: 10 * 60 * 1000, // 10 menit

  // Initialize application
  async init() {
    this.setupEventListeners()
    this.initDatePicker()
    this.setDefaultDate()
    this.setupInactivityMonitor()

    // Load initial data
    await this.loadInitialData()

    // Setup real-time listeners
    this.setupSmartListeners()

    this.updateUIForSalesType('aksesoris')
    $('#sales').focus()

    console.log(`📊 Reads usage: ${readsMonitor.getUsagePercent()}%`)
  },

  // Setup inactivity monitoring
  setupInactivityMonitor() {
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']

    const resetInactivityTimer = () => {
      this.isUserActive = true
      this.lastActivity = Date.now()

      clearTimeout(this.inactivityTimer)
      this.inactivityTimer = setTimeout(() => {
        this.handleUserInactivity()
      }, this.INACTIVITY_TIMEOUT)
    }

    activityEvents.forEach((event) => {
      document.addEventListener(event, resetInactivityTimer, { passive: true })
    })

    // Initial timer
    resetInactivityTimer()
  },

  // Handle user inactivity
  handleUserInactivity() {
    this.isUserActive = false
    console.log('🔇 User inactive - pausing real-time updates')

    // Remove listeners to save resources
    this.removeListeners()

    // Show notification
    const notification = document.createElement('div')
    notification.id = 'inactivityNotification'
    notification.className = 'alert alert-info position-fixed'
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; cursor: pointer;'
    notification.innerHTML = `
      <i class="fas fa-pause-circle me-2"></i>
      Mode hemat aktif - Klik untuk mengaktifkan kembali
    `

    notification.onclick = () => {
      this.handleUserReactivation()
      notification.remove()
    }

    document.body.appendChild(notification)

    // Auto remove notification after 30 seconds
    setTimeout(() => {
      if (document.getElementById('inactivityNotification')) {
        notification.remove()
      }
    }, 30000)
  },

  // Handle user reactivation
  handleUserReactivation() {
    this.isUserActive = true
    this.lastActivity = Date.now()
    console.log('🔊 User reactivated - resuming real-time updates')

    // Resume listeners
    this.setupSmartListeners()
  },

  // Load initial data with minimal reads
  async loadInitialData() {
    try {
      utils.showLoading(true)

      // HAPUS: TTL check, langsung load dari cache atau firestore
      const cachedStock = simpleCache.get('stockData')

      if (cachedStock && cachedStock.length > 0) {
        console.log('📦 Using cached stock data')
        this.stockData = cachedStock
        this.buildStockCache()
        this.populateStockTables()
      } else {
        await this.loadStockData()
      }

      // Setup real-time listeners setelah load initial
      this.setupSmartListeners()
    } catch (error) {
      console.error('Error loading initial data:', error)
      utils.showAlert('Gagal memuat data awal: ' + error.message, 'Error', 'error')
    } finally {
      utils.showLoading(false)
    }
  },

  // Load today's sales data
  async loadStockData() {
    try {
      console.log('🔄 Loading stock data from Firestore')

      const stockQuery = query(
        collection(firestore, 'stokAksesoris'),
        where('stokAkhir', '>', 0) // Hanya ambil yang stoknya > 0
      )

      const snapshot = await getDocs(stockQuery)
      readsMonitor.increment('Load Stock Data', snapshot.size)

      this.stockData = []
      snapshot.forEach((doc) => {
        this.stockData.push({
          id: doc.id,
          ...doc.data(),
        })
      })

      // GANTI: Gunakan simple cache
      simpleCache.set('stockData', this.stockData)
      this.buildStockCache()
      this.populateStockTables()

      console.log(`✅ Loaded ${this.stockData.length} stock items`)
    } catch (error) {
      console.error('Error loading stock data:', error)
      throw error
    }
  },

  // Setup smart real-time listeners
  setupSmartListeners() {
    if (!this.isUserActive) return

    // Remove existing listeners
    this.removeListeners()

    // Stock listener - hanya untuk perubahan stok
    const stockQuery = query(
      collection(firestore, 'stokAksesoris'),
      where('stokAkhir', '>', 0) // Hanya yang masih ada stok
    )

    this.stockListener = onSnapshot(
      stockQuery,
      (snapshot) => {
        if (!snapshot.metadata.hasPendingWrites) {
          // PERBAIKAN: Hanya proses perubahan, bukan semua data
          this.handleStockChanges(snapshot.docChanges())
        }
      },
      (error) => {
        console.error('Stock listener error:', error)
        this.stockListener = null
      }
    )

    console.log('🔊 Real-time listeners activated (changes only)')
  },

  // TAMBAH: Method baru untuk handle stock changes
  handleStockChanges(changes) {
    if (changes.length === 0) return

    let hasUpdates = false

    changes.forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() }

      if (change.type === 'added' || change.type === 'modified') {
        // Update atau tambah item
        const index = this.stockData.findIndex((item) => item.id === data.id)
        if (index !== -1) {
          this.stockData[index] = data
        } else {
          this.stockData.push(data)
        }

        // Update cache untuk quick lookup
        this.stockCache.set(data.kode, data.stokAkhir || 0)
        hasUpdates = true
      } else if (change.type === 'removed') {
        // Hapus item (stok = 0)
        this.stockData = this.stockData.filter((item) => item.id !== data.id)
        this.stockCache.delete(data.kode)
        hasUpdates = true
      }
    })

    if (hasUpdates) {
      // Update cache dan UI
      simpleCache.set('stockData', this.stockData)
      this.populateStockTables()

      console.log(`✅ Stock updated: ${changes.length} changes processed`)
    }
  },

  // TAMBAH: Show stock warning
  showStockWarning(kode) {
    const warningId = `stock-warning-${kode}`

    // Hindari duplikasi warning
    if (document.getElementById(warningId)) return

    const warning = $(`
    <div id="${warningId}" class="alert alert-warning alert-dismissible fade show mt-2">
      <i class="fas fa-exclamation-triangle me-2"></i>
      <strong>Perhatian!</strong> Stok untuk kode ${kode} sudah habis.
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  `)

    $('.container-fluid').prepend(warning)

    // Auto remove after 5 seconds
    setTimeout(() => {
      warning.alert('close')
    }, 5000)
  },

  // Remove all listeners
  removeListeners() {
    if (this.stockListener) {
      this.stockListener()
      this.stockListener = null
    }
    if (this.salesListener) {
      this.salesListener()
      this.salesListener = null
    }
  },

  // Handle stock updates from real-time listener
  handleStockUpdates(changes) {
    let hasChanges = false

    changes.forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() }

      if (change.type === 'added' || change.type === 'modified') {
        const index = this.stockData.findIndex((item) => item.id === data.id)
        if (index !== -1) {
          this.stockData[index] = data
        } else {
          this.stockData.push(data)
        }

        // Update cache
        this.stockCache.set(data.kode, data.stokAkhir || 0)
        hasChanges = true
      } else if (change.type === 'removed') {
        this.stockData = this.stockData.filter((item) => item.id !== data.id)
        this.stockCache.delete(data.kode)
        hasChanges = true
      }
    })

    if (hasChanges) {
      simpleCache.set('stockData', this.stockData)
      this.populateStockTables()
      console.log('✅ Stock data updated from real-time listener')
    }
  },

  // Handle sales updates from real-time listener
  handleSalesUpdates(changes) {
    let hasChanges = false

    changes.forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() }

      if (change.type === 'added') {
        // Add new sale to beginning of array
        this.salesData.unshift(data)
        hasChanges = true
      } else if (change.type === 'modified') {
        const index = this.salesData.findIndex((item) => item.id === data.id)
        if (index !== -1) {
          this.salesData[index] = data
          hasChanges = true
        }
      } else if (change.type === 'removed') {
        this.salesData = this.salesData.filter((item) => item.id !== data.id)
        hasChanges = true
      }
    })

    if (hasChanges) {
      const dateKey = new Date().toISOString().split('T')[0] // Format: YYYY-MM-DD
      simpleCache.set(`salesData_${dateKey}`, this.salesData)
      console.log('✅ Sales data updated from real-time listener')
    }
  },

  // Refresh stale data when user becomes active
  async refreshStaleData() {
    try {
      console.log('🔄 Refreshing data from Firestore')

      // Langsung load ulang tanpa TTL check
      await Promise.all([this.loadStockData(), this.loadTodaySales()])

      console.log('✅ Data refreshed successfully')
    } catch (error) {
      console.error('Error refreshing data:', error)
    }
  },

  // Build stock cache for quick lookups
  buildStockCache() {
    this.stockCache.clear()
    this.stockData.forEach((item) => {
      this.stockCache.set(item.kode, item.stokAkhir || 0)
    })
  },

  // Get stock for item (from cache first)
  getStockForItem(kode) {
    return this.stockCache.get(kode) || 0
  },

  // Setup all event listeners
  setupEventListeners() {
    // Sales type change
    $('#jenisPenjualan').on('change', (e) => {
      this.updateUIForSalesType(e.target.value)
    })

    // Payment method change
    $('#metodeBayar').on('change', (e) => {
      this.handlePaymentMethodChange(e.target.value)
    })

    // Button events
    $('#btnTambah').on('click', () => this.showStockModal())
    $('#btnTambahBaris').on('click', () => this.addNewRow('manual'))
    $('#btnSimpanPenjualan').on('click', () => this.saveTransaction())
    $('#btnBatal').on('click', () => this.resetForm())
    $('#btnPrintReceipt').on('click', (e) => {
      e.preventDefault()
      this.printDocument('receipt')
    })
    $('#btnPrintInvoice').on('click', (e) => {
      e.preventDefault()
      this.printDocument('invoice')
    })

    // Input events with debouncing
    $('#jumlahBayar').on(
      'input',
      utils.debounce(() => this.calculateKembalian(), 300)
    )
    $('#nominalDP').on(
      'input',
      utils.debounce(() => this.calculateSisaPembayaran(), 300)
    )

    $('#jumlahBayar, #nominalDP').on('blur', function () {
      const value = $(this).val().replace(/\./g, '')
      $(this).val(utils.formatRupiah(parseInt(value || 0)))
    })

    // Search events
    $('#searchAksesoris, #searchKotak, #searchLock').on(
      'input',
      utils.debounce((e) => {
        this.searchTable(e.target)
      }, 300)
    )

    // Sales validation
    $('#sales').on('blur', () => this.validateSales())
    $('#sales').on('focus', function () {
      $(this).removeClass('is-invalid is-valid')
      $(this).next('.invalid-feedback').remove()
    })
  },

  // Initialize date picker
  initDatePicker() {
    $('#tanggal').datepicker({
      format: 'dd/mm/yyyy',
      autoclose: true,
      language: 'id',
      todayHighlight: true,
    })

    $('#calendarIcon').on('click', () => $('#tanggal').datepicker('show'))
  },

  // Set default date
  setDefaultDate() {
    const today = new Date()
    $('#tanggal').val(utils.formatDate(today))
  },

  // Populate stock tables
  populateStockTables() {
    const categories = {
      aksesoris: '#tableAksesoris',
      kotak: '#tableKotak',
    }

    Object.entries(categories).forEach(([category, selector]) => {
      const tbody = $(`${selector} tbody`)
      tbody.empty()

      // FILTER: Hanya tampilkan yang stoknya > 0
      const items = this.stockData.filter(
        (item) => item.kategori === category && (item.stokAkhir || 0) > 0
      )

      if (items.length === 0) {
        tbody.append(
          `<tr><td colspan="2" class="text-center text-muted">Tidak ada stok ${category}</td></tr>`
        )
      } else {
        items.forEach((item) => {
          const row = `
          <tr data-kode="${item.kode}" data-nama="${item.nama}" data-harga="${item.hargaJual || 0}">
            <td>${item.kode || '-'}</td>
            <td>${item.nama || '-'}</td>
          </tr>`
          tbody.append(row)
        })
      }
    })

    // Update lock table
    const lockTable = $('#tableLock tbody')
    lockTable.empty()

    const lockItems = this.stockData.filter(
      (item) => item.kategori === 'aksesoris' && (item.stokAkhir || 0) > 0
    )

    if (lockItems.length === 0) {
      lockTable.append(
        '<tr><td colspan="2" class="text-center text-muted">Tidak ada stok lock</td></tr>'
      )
    } else {
      lockItems.forEach((item) => {
        const row = `
        <tr data-kode="${item.kode}" data-nama="${item.nama}" data-harga="${item.hargaJual || 0}">
          <td>${item.kode || '-'}</td>
          <td>${item.nama || '-'}</td>
        </tr>`
        lockTable.append(row)
      })
    }

    // Re-attach click handlers
    this.attachTableRowClickHandlers()
  },

  // Attach table row click handlers
  attachTableRowClickHandlers() {
    // Remove existing handlers to prevent duplicates
    $('#tableAksesoris tbody tr, #tableKotak tbody tr, #tableLock tbody tr').off('click')

    // Aksesoris table
    $('#tableAksesoris tbody tr').on('click', function () {
      if ($(this).data('kode')) {
        const data = {
          kode: $(this).data('kode'),
          nama: $(this).data('nama'),
          harga: $(this).data('harga'),
        }
        penjualanHandler.addAksesorisToTable(data)
        $('#modalPilihAksesoris').modal('hide')
      }
    })

    // Kotak table
    $('#tableKotak tbody tr').on('click', function () {
      if ($(this).data('kode')) {
        const data = {
          kode: $(this).data('kode'),
          nama: $(this).data('nama'),
          harga: $(this).data('harga'),
        }
        penjualanHandler.addKotakToTable(data)
        $('#modalPilihKotak').modal('hide')
      }
    })

    // Lock table
    $('#tableLock tbody tr').on('click', function () {
      if ($(this).data('kode') && activeLockRow) {
        const kode = $(this).data('kode')

        if (activeLockRow.hasClass('input-row')) {
          $('#manualInputKodeLock').val(kode)
        } else {
          activeLockRow.find('.kode-lock-input').val(kode)
        }

        activeLockRow = null
        $('#modalPilihLock').modal('hide')
      }
    })
  },

  // Show stock modal based on sales type
  showStockModal() {
    const salesType = $('#jenisPenjualan').val()

    if (salesType === 'aksesoris') {
      $('#modalPilihAksesoris').modal('show')
    } else if (salesType === 'kotak') {
      $('#modalPilihKotak').modal('show')
    }
  },

  // Add aksesoris to table
  addAksesorisToTable(data) {
    const { kode, nama, harga } = data
    const newRow = `
      <tr>
        <td>${kode}</td>
        <td>${nama}</td>
        <td>
          <input type="number" class="form-control form-control-sm jumlah-input" value="1" min="1">
        </td>
        <td>
          <input type="text" class="form-control form-control-sm kadar-input" value="" placeholder="Masukkan kadar" required>
        </td>
        <td>
          <input type="text" class="form-control form-control-sm berat-input" value="" placeholder="0.00" required>
        </td>
        <td>
          <input type="text" class="form-control form-control-sm harga-per-gram-input" value="0" readonly>
        </td>
        <td>
          <input type="text" class="form-control form-control-sm total-harga-input" value="" placeholder="Masukkan harga" required>
        </td>
        <td>
          <button class="btn btn-sm btn-danger btn-delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `

    $('#tableAksesorisDetail tbody').append(newRow)
    const $newRow = $('#tableAksesorisDetail tbody tr:last-child')
    $newRow.find('.kadar-input').focus()
    this.attachRowEventHandlers($newRow)
    this.updateGrandTotal('aksesoris')
  },

  // Add kotak to table
  addKotakToTable(data) {
    const { kode, nama, harga } = data
    const jumlah = 1
    const hargaSatuan = harga
    const totalHarga = jumlah * hargaSatuan

    const newRow = `
      <tr>
        <td>${kode}</td>
        <td>${nama}</td>
        <td>
          <input type="number" class="form-control form-control-sm jumlah-input" value="${jumlah}" min="1">
        </td>
        <td>
          <input type="text" class="form-control form-control-sm harga-input" value="${utils.formatRupiah(
            hargaSatuan
          )}" placeholder="Masukkan harga" required>
        </td>
        <td class="total-harga">${utils.formatRupiah(totalHarga)}</td>
        <td>
          <button class="btn btn-sm btn-danger btn-delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `

    $('#tableKotakDetail tbody').append(newRow)
    const $newRow = $('#tableKotakDetail tbody tr:last-child')
    $newRow.find('.harga-input').focus().select()
    this.attachRowEventHandlers($newRow)
    this.updateGrandTotal('kotak')
  },

  // Attach row event handlers
  attachRowEventHandlers($row) {
    // Remove existing handlers
    $row.find('input, button').off()

    if ($row.closest('table').attr('id') === 'tableAksesorisDetail') {
      this.attachAksesorisRowHandlers($row)
    } else if ($row.closest('table').attr('id') === 'tableKotakDetail') {
      this.attachKotakRowHandlers($row)
    }

    // Delete button handler
    $row.find('.btn-delete').on('click', () => {
      const tableId = $row.closest('table').attr('id')
      const salesType =
        tableId === 'tableAksesorisDetail'
          ? 'aksesoris'
          : tableId === 'tableKotakDetail'
          ? 'kotak'
          : 'manual'
      $row.remove()
      this.updateGrandTotal(salesType)
    })
  },

  // Attach aksesoris row handlers
  attachAksesorisRowHandlers($row) {
    const $beratInput = $row.find('.berat-input')
    const $totalHargaInput = $row.find('.total-harga-input')
    const $hargaPerGramInput = $row.find('.harga-per-gram-input')
    const $kadarInput = $row.find('.kadar-input')
    const $jumlahInput = $row.find('.jumlah-input')

    // Calculate harga per gram
    const calculateHargaPerGram = () => {
      const berat = parseFloat($beratInput.val()) || 0
      let totalHarga = $totalHargaInput.val().replace(/\./g, '')
      totalHarga = parseFloat(totalHarga) || 0

      let hargaPerGram = 0
      if (berat > 0) {
        hargaPerGram = totalHarga / berat
      }

      $hargaPerGramInput.val(utils.formatRupiah(Math.round(hargaPerGram)))
      this.updateGrandTotal('aksesoris')
    }

    $totalHargaInput.add($beratInput).on('input', calculateHargaPerGram)
    $jumlahInput.on('input', () => this.updateGrandTotal('aksesoris'))

    // Format total harga
    $totalHargaInput.on('blur', function () {
      const value = $(this).val().replace(/\./g, '')
      $(this).val(utils.formatRupiah(parseInt(value || 0)))
    })

    // Enter key navigation untuk aksesoris
    $kadarInput.on('keypress', (e) => {
      if (e.which === 13) {
        e.preventDefault()
        $beratInput.focus()
      }
    })

    $beratInput.on('keypress', (e) => {
      if (e.which === 13) {
        e.preventDefault()
        $totalHargaInput.focus().select()
      }
    })

    $totalHargaInput.on('keypress', (e) => {
      if (e.which === 13) {
        e.preventDefault()
        const value = $totalHargaInput.val().replace(/\./g, '')
        $totalHargaInput.val(utils.formatRupiah(parseInt(value || 0)))
        calculateHargaPerGram()
        $('#jumlahBayar').focus()
      }
    })
  },

  // Attach kotak row handlers
  attachKotakRowHandlers($row) {
    const $jumlahInput = $row.find('.jumlah-input')
    const $hargaInput = $row.find('.harga-input')
    const $totalCell = $row.find('.total-harga')

    const calculateTotal = () => {
      const jumlah = parseInt($jumlahInput.val())
      const harga = parseInt($hargaInput.val().replace(/\./g, '')) || 0
      const total = jumlah * harga
      $totalCell.text(utils.formatRupiah(total))
      this.updateGrandTotal('kotak')
    }

    $jumlahInput.add($hargaInput).on('input', calculateTotal)

    // Format harga saat blur
    $hargaInput.on('blur', function () {
      const value = $(this).val().replace(/\./g, '')
      $(this).val(utils.formatRupiah(parseInt(value)))
    })

    // Enter key navigation untuk kotak
    $hargaInput.on('keypress', (e) => {
      if (e.which === 13) {
        e.preventDefault()
        const value = $hargaInput.val().replace(/\./g, '')
        $hargaInput.val(utils.formatRupiah(parseInt(value)))
        calculateTotal()
        $('#jumlahBayar').focus()
      }
    })

    $jumlahInput.on('keypress', (e) => {
      if (e.which === 13) {
        e.preventDefault()
        $hargaInput.focus().select()
      }
    })
  },

  // Update UI for sales type
  updateUIForSalesType(type) {
    // Hide all containers
    $('#aksesorisTableContainer, #kotakTableContainer, #manualTableContainer').hide()
    $('#btnTambah, #btnTambahBaris').hide()

    let detailTitle = 'Detail Barang'

    switch (type) {
      case 'aksesoris':
        $('#aksesorisTableContainer').show()
        $('#btnTambah').show()
        detailTitle = 'Detail Aksesoris'
        break
      case 'kotak':
        $('#kotakTableContainer').show()
        $('#btnTambah').show()
        detailTitle = 'Detail Kotak'
        break
      case 'manual':
        $('#manualTableContainer').show()
        $('#btnTambahBaris').show()
        detailTitle = 'Detail Penjualan Manual'
        this.resetTableAndAddInputRow('manual')
        break
    }

    $('#detailTitle').text(detailTitle)
    this.updatePaymentMethodOptions(type)
  },

  // Update payment method options
  updatePaymentMethodOptions(salesType) {
    const currentMethod = $('#metodeBayar').val()
    $('#metodeBayar').empty()

    $('#metodeBayar').append('<option value="tunai">Tunai</option>')

    if (salesType === 'manual') {
      $('#metodeBayar').append('<option value="dp">DP</option>')
    }

    if (salesType === 'kotak' || salesType === 'aksesoris') {
      $('#metodeBayar').append('<option value="free">Free</option>')
    }

    if ($("#metodeBayar option[value='" + currentMethod + "']").length > 0) {
      $('#metodeBayar').val(currentMethod)
    } else {
      $('#metodeBayar').val('tunai')
    }

    $('#metodeBayar').trigger('change')
  },

  // Handle payment method change
  handlePaymentMethodChange(method) {
    const salesType = $('#jenisPenjualan').val()

    if (method === 'free') {
      $('.payment-field, .dp-field').hide()
      $('#totalOngkos').val('0')
    } else if (method === 'dp') {
      if (salesType === 'manual') {
        $('.payment-field, .dp-field').show()
      } else {
        $('#metodeBayar').val('tunai')
        $('.payment-field').show()
        $('.dp-field').hide()
      }
      this.updateTotal()
    } else {
      $('.payment-field').show()
      $('.dp-field').hide()
      this.updateTotal()
    }
  },

  // Reset table and add input row for manual
  resetTableAndAddInputRow(type) {
    $('#tableManualDetail tbody').empty()

    const inputRow = `
      <tr class="input-row">
        <td><input type="text" class="form-control form-control-sm" id="manualInputKode" placeholder="Kode"></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputNamaBarang" placeholder="Nama barang"></td>
        <td>
          <div class="input-group input-group-sm">
            <input type="text" class="form-control" id="manualInputKodeLock" placeholder="Pilih kode" readonly>
            <button class="btn btn-outline-secondary" id="manualBtnPilihKodeLock" type="button">
              <i class="fas fa-search"></i>
            </button>
          </div>
        </td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputKadar" placeholder="Kadar" required></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputBerat" placeholder="0.00" required></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputHargaPerGram" placeholder="0" readonly></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputTotalHarga" placeholder="Masukkan harga" required></td>
        <td><input type="text" class="form-control form-control-sm" id="manualInputKeterangan" placeholder="Keterangan"></td>
        <td></td>
      </tr>
    `

    $('#tableManualDetail tbody').append(inputRow)
    this.attachManualInputHandlers()
    $('#manualInputKode').focus()
  },

  // Attach manual input handlers
  attachManualInputHandlers() {
    // Remove existing handlers
    $('#manualBtnPilihKodeLock').off('click')
    $('#manualInputBerat, #manualInputTotalHarga').off('input')

    // Pilih kode lock button
    $('#manualBtnPilihKodeLock').on('click', function () {
      activeLockRow = $(this).closest('tr')
      $('#modalPilihLock').modal('show')
    })

    // Calculate harga per gram
    $('#manualInputBerat, #manualInputTotalHarga').on('input', () => {
      this.calculateHargaPerGram('manual')
    })

    // Enter key navigation
    const inputs = [
      '#manualInputKode',
      '#manualInputNamaBarang',
      '#manualInputKadar',
      '#manualInputBerat',
      '#manualInputTotalHarga',
      '#manualInputKeterangan',
    ]

    inputs.forEach((selector, index) => {
      $(selector)
        .off('keypress')
        .on('keypress', (e) => {
          if (e.which === 13) {
            e.preventDefault()
            if (index < inputs.length - 1) {
              $(inputs[index + 1]).focus()
            } else {
              this.addNewRow('manual')
            }
          }
        })
    })
  },

  // Calculate harga per gram for manual
  calculateHargaPerGram(type) {
    const berat = parseFloat($(`#${type}InputBerat`).val()) || 0
    const totalHarga = parseFloat($(`#${type}InputTotalHarga`).val().replace(/\./g, '')) || 0

    let hargaPerGram = 0
    if (berat > 0) {
      hargaPerGram = totalHarga / berat
    }

    $(`#${type}InputHargaPerGram`).val(utils.formatRupiah(Math.round(hargaPerGram)))
  },

  // Add new row for manual
  addNewRow(type) {
    const kode = $(`#${type}InputKode`).val() || '-'
    const namaBarang = $(`#${type}InputNamaBarang`).val()
    const kodeLock = $(`#${type}InputKodeLock`).val() || '-'
    const kadar = $(`#${type}InputKadar`).val() || '-'
    const berat = $(`#${type}InputBerat`).val() || 0
    const totalHargaValue = $(`#${type}InputTotalHarga`).val() || '0'
    const totalHarga = parseFloat(totalHargaValue.replace(/\./g, '')) || 0
    const hargaPerGram = $(`#${type}InputHargaPerGram`).val() || '0'
    const keterangan = $(`#${type}InputKeterangan`).val() || ''

    // Validation
    if (!namaBarang) {
      utils.showAlert('Nama barang harus diisi!')
      $(`#${type}InputNamaBarang`).focus()
      return
    }
    if (!kadar) {
      utils.showAlert('Kadar harus diisi!')
      $(`#${type}InputKadar`).focus()
      return
    }
    if (berat <= 0) {
      utils.showAlert('Berat harus lebih dari 0!')
      $(`#${type}InputBerat`).focus()
      return
    }
    if (totalHarga <= 0) {
      utils.showAlert('Total harga harus lebih dari 0!')
      $(`#${type}InputTotalHarga`).focus()
      return
    }

    const newRow = `
        <tr>
          <td>${kode}</td>
          <td>${namaBarang}</td>
          <td>${kodeLock}</td>
          <td>${kadar}</td>
          <td>${berat}</td>
          <td>${hargaPerGram}</td>
          <td class="total-harga">${utils.formatRupiah(totalHarga)}</td>
          <td class="keterangan">${keterangan}</td>
          <td>
            <button class="btn btn-sm btn-danger btn-delete">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `

    $(`#table${type.charAt(0).toUpperCase() + type.slice(1)}Detail tbody`).append(newRow)

    // Clear input row
    $(
      `#${type}InputKode, #${type}InputNamaBarang, #${type}InputKodeLock, #${type}InputKadar, #${type}InputBerat, #${type}InputHargaPerGram, #${type}InputTotalHarga, #${type}InputKeterangan`
    ).val('')

    $(`#${type}InputKode`).focus()
    this.updateGrandTotal(type)
  },

  // Update grand total
  updateGrandTotal(salesType) {
    let tableSelector, grandTotalId

    switch (salesType) {
      case 'aksesoris':
        tableSelector = '#tableAksesorisDetail'
        grandTotalId = '#grand-total-aksesoris'
        break
      case 'kotak':
        tableSelector = '#tableKotakDetail'
        grandTotalId = '#grand-total-kotak'
        break
      case 'manual':
        tableSelector = '#tableManualDetail'
        grandTotalId = '#grand-total-manual'
        break
    }

    let total = 0

    if (salesType === 'aksesoris') {
      $(tableSelector + ' tbody tr:not(.input-row) .total-harga-input').each(function () {
        const value = $(this).val().replace(/\./g, '')
        total += parseFloat(value) || 0
      })
    } else if (salesType === 'kotak') {
      $(tableSelector + ' tbody tr:not(.input-row) .total-harga').each(function () {
        const value = $(this).text().replace(/\./g, '')
        total += parseFloat(value) || 0
      })
    } else {
      $(tableSelector + ' tbody tr:not(.input-row) .total-harga').each(function () {
        const value = $(this).text().replace(/\./g, '')
        total += parseFloat(value) || 0
      })
    }

    $(grandTotalId).text(utils.formatRupiah(total))
    $('#totalOngkos').val(utils.formatRupiah(total))

    if ($('#metodeBayar').val() === 'dp') {
      this.calculateSisaPembayaran()
    }
  },

  // Update total
  updateTotal() {
    const salesType = $('#jenisPenjualan').val()
    const paymentMethod = $('#metodeBayar').val()

    if (paymentMethod === 'free') {
      $('#totalOngkos').val('0')
      return
    }

    let total = 0
    const grandTotalSelector =
      salesType === 'aksesoris'
        ? '#grand-total-aksesoris'
        : salesType === 'kotak'
        ? '#grand-total-kotak'
        : '#grand-total-manual'

    total = parseFloat($(grandTotalSelector).text().replace(/\./g, '')) || 0
    $('#totalOngkos').val(utils.formatRupiah(total))

    if (paymentMethod === 'dp') {
      this.calculateSisaPembayaran()
    }
  },

  // Calculate sisa pembayaran
  calculateSisaPembayaran() {
    const total = parseFloat($('#totalOngkos').val().replace(/\./g, '')) || 0
    const nominalDP = parseFloat($('#nominalDP').val().replace(/\./g, '')) || 0

    if (nominalDP >= total) {
      // Jika DP >= total, tidak ada sisa pembayaran
      $('#sisaPembayaran').val('0')

      // Jika DP > total, ada kembalian
      if (nominalDP > total) {
        const kembalian = nominalDP - total
        $('#kembalian').val(utils.formatRupiah(kembalian))
      } else {
        $('#kembalian').val('0')
      }
    } else {
      // Jika DP < total, hitung sisa pembayaran
      const sisa = total - nominalDP
      $('#sisaPembayaran').val(utils.formatRupiah(sisa))
      $('#kembalian').val('0')
    }

    // Update jumlah bayar jika sudah ada input
    if ($('#jumlahBayar').val()) {
      this.calculateKembalian()
    }
  },

  // Calculate kembalian
  calculateKembalian() {
    const paymentMethod = $('#metodeBayar').val()
    const jumlahBayar = parseFloat($('#jumlahBayar').val().replace(/\./g, '')) || 0

    if (paymentMethod === 'dp') {
      const total = parseFloat($('#totalOngkos').val().replace(/\./g, '')) || 0
      const nominalDP = parseFloat($('#nominalDP').val().replace(/\./g, '')) || 0

      if (nominalDP >= total) {
        // Jika DP sudah menutupi total, kembalian = (DP - total) + jumlah bayar
        const kembalian = nominalDP - total + jumlahBayar
        $('#kembalian').val(utils.formatRupiah(kembalian))
      } else {
        // Jika masih ada sisa, hitung kembalian dari sisa pembayaran
        const sisaPembayaran = parseFloat($('#sisaPembayaran').val().replace(/\./g, '')) || 0
        const kembalian = jumlahBayar - sisaPembayaran
        $('#kembalian').val(utils.formatRupiah(kembalian >= 0 ? kembalian : 0))
      }
    } else {
      // Untuk pembayaran tunai
      const total = parseFloat($('#totalOngkos').val().replace(/\./g, '')) || 0
      const kembalian = jumlahBayar - total
      $('#kembalian').val(utils.formatRupiah(kembalian >= 0 ? kembalian : 0))
    }
  },

  // Search table
  searchTable(input) {
    const searchText = $(input).val().toLowerCase()
    const tableId = $(input).attr('id').replace('search', 'table')

    $(`#${tableId} tbody tr`).each(function () {
      const kode = $(this).find('td:nth-child(1)').text().toLowerCase()
      const nama = $(this).find('td:nth-child(2)').text().toLowerCase()

      if (kode.includes(searchText) || nama.includes(searchText)) {
        $(this).show()
      } else {
        $(this).hide()
      }
    })
  },

  // Validate sales
  validateSales() {
    const salesName = $('#sales').val().trim()
    if (!salesName) {
      $('#sales').addClass('is-invalid')
      if (!$('#sales').next('.invalid-feedback').length) {
        $('#sales').after('<div class="invalid-feedback">Nama sales harus diisi!</div>')
      }
    } else {
      $('#sales').removeClass('is-invalid').addClass('is-valid')
      $('#sales').next('.invalid-feedback').remove()
    }
  },

  // Save transaction
  async saveTransaction() {
    try {
      // Validasi sales name
      const salesName = $('#sales').val().trim()
      if (!salesName) {
        utils.showAlert('Nama sales harus diisi!')
        $('#sales').focus()
        return
      }

      const salesType = $('#jenisPenjualan').val()
      const tableSelector =
        salesType === 'aksesoris'
          ? '#tableAksesorisDetail'
          : salesType === 'kotak'
          ? '#tableKotakDetail'
          : '#tableManualDetail'

      // Check if table has rows
      if ($(tableSelector + ' tbody tr:not(.input-row)').length === 0) {
        utils.showAlert('Tidak ada barang yang ditambahkan!')
        return
      }

      // PERBAIKAN: Validasi pembayaran yang disederhanakan
      const paymentMethod = $('#metodeBayar').val()
      const total = parseFloat($('#totalOngkos').val().replace(/\./g, '')) || 0

      if (paymentMethod === 'dp') {
        const nominalDP = parseFloat($('#nominalDP').val().replace(/\./g, '')) || 0

        // Validasi DP harus diisi dan > 0
        if (nominalDP <= 0) {
          utils.showAlert('Nominal DP harus diisi dan lebih dari 0!')
          $('#nominalDP').focus()
          return
        }

        // HAPUS validasi yang membatasi DP - sekarang DP boleh >= total
      } else if (paymentMethod !== 'free') {
        const jumlahBayar = parseFloat($('#jumlahBayar').val().replace(/\./g, '')) || 0

        if (jumlahBayar < total) {
          utils.showAlert('Jumlah bayar kurang dari total!')
          $('#jumlahBayar').focus()
          return
        }
      }

      utils.showLoading(true)

      // Collect items data
      const items = this.collectItemsData(salesType, tableSelector)

      // Prepare transaction data
      const transactionData = {
        jenisPenjualan: salesType,
        tanggal: $('#tanggal').val(),
        sales: salesName,
        customerName: ($('#customerName').val() || '').trim(),
        customerPhone: ($('#customerPhone').val() || '').trim(),
        metodeBayar: paymentMethod,
        totalHarga: total,
        timestamp: serverTimestamp(),
        items: items,
      }

      // Mark as ganti lock if applicable
      if (salesType === 'manual' && items.some((item) => item.kodeLock)) {
        transactionData.isGantiLock = true
      }

      // PERBAIKAN: Add payment details dengan logika yang benar
      if (paymentMethod === 'dp') {
        const nominalDP = parseFloat($('#nominalDP').val().replace(/\./g, '')) || 0
        const sisaPembayaran = parseFloat($('#sisaPembayaran').val().replace(/\./g, '')) || 0
        const jumlahBayar = parseFloat($('#jumlahBayar').val().replace(/\./g, '')) || 0
        const kembalian = parseFloat($('#kembalian').val().replace(/\./g, '')) || 0

        transactionData.nominalDP = nominalDP
        transactionData.sisaPembayaran = sisaPembayaran
        transactionData.jumlahBayar = jumlahBayar
        transactionData.kembalian = kembalian

        // PERBAIKAN: Status pembayaran selalu "DP" dengan nominal
        transactionData.statusPembayaran = `DP ${utils.formatRupiah(nominalDP)}`

        // TAMBAHAN: Flag untuk menandai apakah DP sudah menutupi total
        transactionData.isDPComplete = nominalDP >= total
      } else if (paymentMethod === 'free') {
        transactionData.statusPembayaran = 'Free'
      } else {
        transactionData.jumlahBayar = parseFloat($('#jumlahBayar').val().replace(/\./g, '')) || 0
        transactionData.kembalian = parseFloat($('#kembalian').val().replace(/\./g, '')) || 0
        transactionData.statusPembayaran = 'Lunas'
      }

      // Save transaction
      const docRef = await addDoc(collection(firestore, 'penjualanAksesoris'), transactionData)
      readsMonitor.increment('Save Transaction', 1)

      // Update stock
      await this.updateStock(salesType, items)

      // Duplikasi ke mutasiKode jika transaksi manual
      if (transactionData.jenisPenjualan === 'manual') {
        await this.duplicateToMutasiKode(transactionData, docRef.id)
      }

      // Update local cache
      const newTransaction = { id: docRef.id, ...transactionData }
      this.salesData.unshift(newTransaction)

      const dateKey = new Date().toISOString().split('T')[0]
      simpleCache.set(`salesData_${dateKey}`, this.salesData)

      utils.showAlert('Transaksi berhasil disimpan!', 'Sukses', 'success')

      // Store transaction data for printing
      currentTransactionData = {
        id: docRef.id,
        salesType: salesType,
        tanggal: $('#tanggal').val(),
        sales: salesName,
        customerName: ($('#customerName').val() || '').trim(),
        customerPhone: ($('#customerPhone').val() || '').trim(),
        totalHarga: $('#totalOngkos').val(),
        items: items,
        metodeBayar: paymentMethod,
      }

      // PERBAIKAN: Add DP information dengan data yang lengkap
      if (paymentMethod === 'dp') {
        currentTransactionData.nominalDP = $('#nominalDP').val()
        currentTransactionData.sisaPembayaran = $('#sisaPembayaran').val()
        currentTransactionData.jumlahBayar = $('#jumlahBayar').val()
        currentTransactionData.kembalian = $('#kembalian').val()
        currentTransactionData.statusPembayaran = transactionData.statusPembayaran
      }

      // Show print modal
      $('#printModal').modal('show')

      // Reset form after modal is closed
      $('#printModal').on('hidden.bs.modal', () => {
        this.resetForm()
        $('#sales').focus()
        $('#printModal').off('hidden.bs.modal')
      })
    } catch (error) {
      console.error('Error saving transaction:', error)
      utils.showAlert(
        'Terjadi kesalahan saat menyimpan transaksi: ' + error.message,
        'Error',
        'error'
      )
    } finally {
      utils.showLoading(false)
    }
  },

  // Collect items data based on sales type
  collectItemsData(salesType, tableSelector) {
    const items = []

    if (salesType === 'aksesoris') {
      $(tableSelector + ' tbody tr:not(.input-row)').each(function () {
        const kode = $(this).find('td:nth-child(1)').text()
        const nama = $(this).find('td:nth-child(2)').text()
        const jumlah = parseInt($(this).find('.jumlah-input').val()) || 1
        const kadar = $(this).find('.kadar-input').val() || '-'
        const berat = parseFloat($(this).find('.berat-input').val()) || 0
        const hargaPerGram =
          parseFloat($(this).find('.harga-per-gram-input').val().replace(/\./g, '')) || 0
        const totalHarga =
          parseFloat($(this).find('.total-harga-input').val().replace(/\./g, '')) || 0

        items.push({
          kodeText: kode,
          nama: nama,
          jumlah: jumlah,
          kadar: kadar,
          berat: berat,
          hargaPerGram: hargaPerGram,
          totalHarga: totalHarga,
        })
      })
    } else if (salesType === 'kotak') {
      $(tableSelector + ' tbody tr:not(.input-row)').each(function () {
        const kode = $(this).find('td:nth-child(1)').text()
        const nama = $(this).find('td:nth-child(2)').text()
        const jumlah = parseInt($(this).find('.jumlah-input').val()) || 1
        const hargaSatuan = parseFloat($(this).find('.harga-input').val().replace(/\./g, '')) || 0
        const totalHarga = parseFloat($(this).find('.total-harga').text().replace(/\./g, '')) || 0

        items.push({
          kodeText: kode,
          nama: nama,
          jumlah: jumlah,
          totalHarga: totalHarga,
          hargaSatuan: hargaSatuan,
        })
      })
    } else {
      // Manual
      $(tableSelector + ' tbody tr:not(.input-row)').each(function () {
        const kode = $(this).find('td:nth-child(1)').text()
        const nama = $(this).find('td:nth-child(2)').text()
        const kodeLock = $(this).find('td:nth-child(3)').text()
        const kadar = $(this).find('td:nth-child(4)').text()
        const berat = parseFloat($(this).find('td:nth-child(5)').text()) || 0
        const hargaPerGram =
          parseFloat($(this).find('td:nth-child(6)').text().replace(/\./g, '')) || 0
        const totalHarga =
          parseFloat($(this).find('td:nth-child(7)').text().replace(/\./g, '')) || 0
        const keterangan = $(this).find('td:nth-child(8)').text() || ''

        items.push({
          kodeText: kode,
          nama: nama,
          kodeLock: kodeLock !== '-' ? kodeLock : null,
          kadar: kadar,
          berat: berat,
          hargaPerGram: hargaPerGram,
          totalHarga: totalHarga,
          keterangan: keterangan,
        })
      })
    }

    return items
  },

  // Update stock after sales
  async updateStock(salesType, items) {
    try {
      const updatePromises = []

      for (const item of items) {
        const kode = item.kodeText
        if (!kode || kode === '-') continue

        if (salesType === 'manual') {
          // Untuk penjualan manual
          if (item.kodeLock && item.kodeLock !== '-') {
            // Kode aksesoris yang dipilih - mengurangi stok sebagai ganti lock
            const currentStock = this.getStockForItem(item.kodeLock)
            const jumlah = parseInt(item.jumlah) || 1
            const newStock = Math.max(0, currentStock - jumlah)

            updatePromises.push(
              this.processSingleStockUpdate(item.kodeLock, {
                item: { ...item, kodeText: item.kodeLock, nama: `Ganti lock untuk ${item.nama}` },
                currentStock,
                newStock,
                jumlah,
                isGantiLock: true,
              })
            )
          }
        } else {
          // Untuk penjualan aksesoris dan kotak
          const currentStock = this.getStockForItem(kode)
          const jumlah = parseInt(item.jumlah) || 1
          const newStock = Math.max(0, currentStock - jumlah)

          updatePromises.push(
            this.processSingleStockUpdate(kode, {
              item,
              currentStock,
              newStock,
              jumlah,
              isGantiLock: false,
            })
          )
        }
      }

      await Promise.all(updatePromises)

      // Update local cache
      for (const item of items) {
        const kode = item.kodeText
        if (kode && kode !== '-') {
          const currentStock = this.getStockForItem(kode)
          const jumlah = parseInt(item.jumlah) || 1
          const newStock = Math.max(0, currentStock - jumlah)

          // Update stock cache
          this.stockCache.set(kode, newStock)

          // Update stockData array
          const stockIndex = this.stockData.findIndex((stockItem) => stockItem.kode === kode)
          if (stockIndex !== -1) {
            this.stockData[stockIndex].stokAkhir = newStock
          }
        }
      }

      simpleCache.set('stockData', this.stockData)

      return true
    } catch (error) {
      console.error('Error updating stock:', error)
      throw error
    }
  },

  // Process single stock update
  async processSingleStockUpdate(kode, { item, currentStock, newStock, jumlah, isGantiLock }) {
    const metodeBayar = $('#metodeBayar').val()
    const salesType = $('#jenisPenjualan').val()

    let jenisTransaksi, keterangan

    // Tentukan jenis transaksi
    if (isGantiLock) {
      jenisTransaksi = 'gantiLock'
      keterangan = `Ganti lock ${kode} oleh ${$('#sales').val()}`
    } else if (metodeBayar === 'free') {
      jenisTransaksi = 'free'
      keterangan = `Penjualan ${salesType} gratis oleh ${$('#sales').val()}`
    } else {
      jenisTransaksi = 'laku'
      keterangan = `Penjualan ${salesType} oleh ${$('#sales').val()}`
    }

    try {
      // Update stok document
      const stockQuery = query(collection(firestore, 'stokAksesoris'), where('kode', '==', kode))
      const stockSnapshot = await getDocs(stockQuery)
      readsMonitor.increment('Stock Update Query', 1)

      if (!stockSnapshot.empty) {
        const stockDoc = stockSnapshot.docs[0]
        await updateDoc(doc(firestore, 'stokAksesoris', stockDoc.id), {
          stokAkhir: newStock,
          lastUpdate: serverTimestamp(),
        })
        readsMonitor.increment('Stock Update Write', 1)
      } else {
        // Buat document baru jika tidak ada
        const newStockData = {
          kode,
          nama: item.nama || '',
          kategori: this.determineCategory(kode),
          stokAwal: currentStock,
          stokAkhir: newStock,
          hargaJual: 0,
          lastUpdate: serverTimestamp(),
        }

        await addDoc(collection(firestore, 'stokAksesoris'), newStockData)
        readsMonitor.increment('Stock Create Write', 1)
      }

      // Catat transaksi stok
      await addDoc(collection(firestore, 'stokAksesorisTransaksi'), {
        kode,
        nama: item.nama || '',
        kategori: this.determineCategory(kode),
        jenis: jenisTransaksi,
        jumlah,
        stokSebelum: currentStock,
        stokSesudah: newStock,
        stokAkhir: newStock,
        timestamp: serverTimestamp(),
        keterangan,
        isGantiLock: isGantiLock || false,
      })
      readsMonitor.increment('Stock Transaction Write', 1)

      console.log(`Updated stock for ${kode}: ${currentStock} → ${newStock} (${jenisTransaksi})`)
    } catch (error) {
      console.error(`Error updating stock for ${kode}:`, error)
      throw error
    }
  },

  // Helper untuk menentukan kategori berdasarkan kode
  determineCategory(kode) {
    if (kode.startsWith('K') || kode.includes('KOTAK')) return 'kotak'
    return 'aksesoris'
  },

  // Fungsi untuk menduplikat transaksi manual ke mutasiKode
  async duplicateToMutasiKode(transactionData, transactionId) {
    try {
      // Hanya proses jika jenis penjualan adalah manual
      if (transactionData.jenisPenjualan !== 'manual' || !transactionData.items) {
        return
      }

      const jenisBarang = {
        C: 'Cincin',
        K: 'Kalung',
        L: 'Liontin',
        A: 'Anting',
        G: 'Gelang',
        S: 'Giwang',
        Z: 'HALA',
        V: 'HALA',
      }
      const duplicatePromises = []

      transactionData.items.forEach((item) => {
        // Skip item tanpa kode atau kode kosong
        if (!item.kodeText || item.kodeText === '-' || !item.kodeText.trim()) {
          return
        }

        const kode = item.kodeText.trim()
        const prefix = kode.charAt(0).toUpperCase()

        // Skip jika prefix tidak valid
        if (!jenisBarang[prefix]) {
          return
        }

        // Data untuk mutasiKode
        const mutasiKodeData = {
          kode: kode,
          namaBarang: item.nama || 'Tidak ada nama',
          kadar: item.kadar || '-',
          berat: parseFloat(item.berat) || 0,
          keterangan: item.keterangan || '',
          hargaPerGram: parseFloat(item.hargaPerGram) || 0,
          totalHarga: parseFloat(item.totalHarga) || 0,
          tanggalInput: transactionData.tanggal,
          sales: transactionData.sales || '',
          penjualanId: transactionId,
          isMutated: false,
          tanggalMutasi: null,
          mutasiKeterangan: '',
          mutasiHistory: [],
          timestamp: serverTimestamp(),
          lastUpdated: serverTimestamp(),
          jenisPrefix: prefix,
          jenisNama: jenisBarang[prefix],
        }

        duplicatePromises.push(addDoc(collection(firestore, 'mutasiKode'), mutasiKodeData))
      })

      if (duplicatePromises.length > 0) {
        await Promise.all(duplicatePromises)
        readsMonitor.increment('Mutasi Kode Write', duplicatePromises.length)
        console.log(`✅ Duplicated ${duplicatePromises.length} items to mutasiKode`)
      }
    } catch (error) {
      console.error('❌ Error duplicating to mutasiKode:', error)
      // Jangan throw error agar tidak mengganggu proses utama
    }
  },

  // Print receipt
  // Print receipt - PERBAIKAN LOGIKA DP > TOTAL
  printReceipt() {
    if (!currentTransactionData) {
      utils.showAlert('Tidak ada data transaksi untuk dicetak!')
      return
    }

    const transaction = currentTransactionData
    const printWindow = window.open('', '_blank')

    if (!printWindow) {
      utils.showAlert(
        'Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.',
        'Error',
        'error'
      )
      return
    }

    let receiptHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Struk Kasir</title>
          <style>
            body {
              font-family: consolas;
              font-size: 12px;
              margin: 0;
              padding: 0;
              width: 80mm;
            }
            .receipt {
              margin: 0 auto;
              padding: 5mm;
            }
            .receipt h3, .receipt h4 {
              text-align: center;
              margin: 2mm 0;
            }
            .receipt hr {
              border-top: 1px dashed #000;
            }
            .receipt table {
              width: 100%;
              border-collapse: collapse;
            }
            .receipt th, .receipt td {
              text-align: left;
              padding: 1mm 2mm;
            }
            .receipt .tanggal {
            margin-left: 10px
            }
            .text-center {
              text-align: center;
            }
            .text-right {
              text-align: right;
            }
            .keterangan {
              font-style: italic;
              font-size: 14px;
              margin-top: 2mm;
              border-top: 1px dotted #000;
              padding-top: 2mm;
            }
            .payment-info {
              margin-top: 2mm;
              border-top: 1px dotted #000;
              padding-top: 2mm;
            }
          </style>
        </head>
        <body>
          <div class="receipt">
            <h3>MELATI 3</h3>
            <h4>JL. DIPONEGORO NO. 116</h4>
            <h4>NOTA PENJUALAN ${transaction.salesType.toUpperCase()}</h4>
            <hr>
            <p class="tanggal">Tanggal: ${transaction.tanggal}<br>Sales: ${transaction.sales}</p>
            <hr>
            <table>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Kadar</th>
                <th>Gr</th>
                <th>Harga</th>
              </tr>
      `

    let hasKeterangan = false
    let keteranganText = ''

    transaction.items.forEach((item) => {
      const itemHarga = parseInt(item.totalHarga) || 0
      receiptHTML += `
          <tr>
            <td>${item.kodeText || '-'}</td>
            <td>${item.nama || '-'}</td>
            <td>${item.kadar || '-'}</td>
            <td>${item.berat || '-'}</td>
            <td class="text-right">${utils.formatRupiah(itemHarga)}</td>
          </tr>
        `

      if (item.keterangan && item.keterangan.trim() !== '') {
        hasKeterangan = true
        keteranganText += item.keterangan + ' '
      }
    })

    const totalHarga = parseInt(transaction.totalHarga.replace(/\./g, '')) || 0
    receiptHTML += `
              <tr>
                <td colspan="4" class="text-right"><strong>Total:</strong></td>
                <td class="text-right"><strong>${utils.formatRupiah(totalHarga)}</strong></td>
              </tr>
            </table>
      `

    // PERBAIKAN: Add DP information dengan logika yang benar
    if (transaction.metodeBayar === 'dp') {
      const dpAmount = parseInt(transaction.nominalDP.replace(/\./g, '')) || 0

      receiptHTML += `
            <div class="payment-info">
              <table>
                <tr>
                  <td>Total Harga:</td>
                  <td class="text-right">${utils.formatRupiah(totalHarga)}</td>
                </tr>
                <tr>
                  <td>DP:</td>
                  <td class="text-right">${utils.formatRupiah(dpAmount)}</td>
                </tr>
    `

      // PERBAIKAN: Logika untuk menampilkan SISA atau KEMBALIAN
      if (dpAmount >= totalHarga) {
        // Jika DP >= total, tampilkan kembalian (jika ada)
        if (dpAmount > totalHarga) {
          const kembalian = dpAmount - totalHarga
          receiptHTML += `
                <tr>
                  <td><strong>KEMBALIAN:</strong></td>
                  <td class="text-right"><strong>${utils.formatRupiah(kembalian)}</strong></td>
                </tr>
        `
        } else {
          // Jika DP = total, tampilkan LUNAS
          receiptHTML += `
                <tr>
                  <td colspan="2" class="text-center"><strong>LUNAS</strong></td>
                </tr>
        `
        }
      } else {
        // Jika DP < total, tampilkan sisa pembayaran
        const remainingAmount = parseInt(transaction.sisaPembayaran.replace(/\./g, '')) || 0
        receiptHTML += `
                <tr>
                  <td><strong>SISA:</strong></td>
                  <td class="text-right"><strong>${utils.formatRupiah(
                    remainingAmount
                  )}</strong></td>
                </tr>
      `
      }

      receiptHTML += `
              </table>
            </div>
        `
    }

    // Add keterangan if exists and is manual sale
    if (hasKeterangan && transaction.salesType === 'manual') {
      receiptHTML += `
            <div class="keterangan">
              <strong>Keterangan:</strong> ${keteranganText.trim()}
            </div>
        `
    }

    receiptHTML += `
            <hr>
            <p class="text-center">Terima Kasih<br>Atas Kunjungan Anda</p>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
        </html>
      `

    printWindow.document.write(receiptHTML)
    printWindow.document.close()
  },

  // Print invoice
  printInvoice() {
    if (!currentTransactionData) {
      utils.showAlert('Tidak ada data transaksi untuk dicetak!')
      return
    }

    const transaction = currentTransactionData
    const printWindow = window.open('', '_blank')

    if (!printWindow) {
      utils.showAlert(
        'Popup diblokir oleh browser. Mohon izinkan popup untuk mencetak.',
        'Error',
        'error'
      )
      return
    }

    // PERBAIKAN: Gunakan tanggal langsung karena sudah dalam format string dd/mm/yyyy
    // Jika timestamp ada (Firestore Timestamp), format dulu, jika tidak pakai tanggal string
    let tanggal = transaction.tanggal
    if (transaction.timestamp && transaction.timestamp.toDate) {
      tanggal = utils.formatDate(transaction.timestamp)
    }

    let invoiceHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invoice Customer</title>
      <style>
        @page { size: 10cm 20cm; margin: 0; }
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 5mm; width: 20cm; box-sizing: border-box; }
        .invoice { width: 100%; }
        .header-info { text-align: right; margin-bottom: 0.5cm; margin-right: 3cm; margin-top: 0.8cm; }
        .customer-info { text-align: right; margin-bottom: 1.1cm; margin-right: 3cm; font-size: 11px; line-height: 1.2; }
        .total-row { margin-top: 0.7cm; text-align: right; font-weight: bold; margin-right: 3cm; }
        .sales { text-align: right; margin-top: 0.6cm; margin-right: 2cm; }
        .keterangan { font-style: italic; font-size: 10px; margin-top: 1.2cm; margin-bottom: 0.5cm; padding-top: 2mm; text-align: left; margin-left: 0.5cm; margin-right: 3cm; }
        .keterangan-spacer { height: 1.6cm; }
        .item-details { display: flex; flex-wrap: wrap; }
        .item-data { display: grid; grid-template-columns: 2cm 2.7cm 4.6cm 1.8cm 1.8cm 2cm; width: 100%; column-gap: 0.2cm; margin-left: 0.5cm; margin-top: 1cm; margin-right: 3cm; }
        .item-data span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .item-data span:nth-child(3) { white-space: normal; overflow: visible; text-overflow: clip; word-wrap: break-word; }
      </style>
    </head>
    <body>
      <div class="invoice">
        <div class="header-info">
          <p>${tanggal}</p>
        </div>
        <div class="customer-info">
          <div>${transaction.customerName || '-'}</div>
          <div>${transaction.customerPhone || ''}</div>
        </div>
  `

    let hasKeterangan = false
    let keteranganText = ''
    let totalHarga = 0

    // Loop untuk menampilkan semua item-data
    transaction.items.forEach((item) => {
      const itemHarga = parseInt(item.totalHarga || 0)
      totalHarga += itemHarga

      invoiceHTML += `
      <div class="item-details">
        <div class="item-data">
          <span>${item.kodeText || '-'}</span>
          <span>${item.jumlah || ' '}pcs</span>
          <span>${item.nama || '-'}</span>
          <span>${item.kadar || '-'}</span>
          <span>${item.berat || '-'}gr</span>
          <span>${utils.formatRupiah(itemHarga)}</span>
        </div>
      </div>
    `

      // Kumpulkan keterangan
      if (item.keterangan && item.keterangan.trim() !== '') {
        hasKeterangan = true
        keteranganText += `${item.keterangan}; `
      }
    })

    // Tampilkan keterangan atau spacer
    if (hasKeterangan && transaction.salesType === 'manual') {
      invoiceHTML += `
      <div class="keterangan">
        <strong>Keterangan:</strong><br>
        ${keteranganText.trim()}
      </div>
    `
    } else {
      invoiceHTML += `<div class="keterangan-spacer"></div>`
    }

    // Tampilkan total dan sales
    invoiceHTML += `
      <div class="total-row">
        Rp ${utils.formatRupiah(totalHarga)}
      </div>
      <div class="sales">${transaction.sales || '-'}</div>
      </div>
      <script>
        window.onload = function() {
          window.print();
          setTimeout(function() { window.close(); }, 500);
        };
      </script>
    </body>
    </html>
  `

    printWindow.document.write(invoiceHTML)
    printWindow.document.close()
  },

  // Print separate invoices per item for manual sales
  printInvoicePerItem() {
    if (!currentTransactionData) {
      utils.showAlert('Tidak ada data transaksi untuk dicetak!')
      return
    }

    const tx = currentTransactionData
    const items = Array.isArray(tx.items) ? tx.items : []

    // Fallback jika hanya 1 item
    if (items.length <= 1) {
      this.printInvoice()
      return
    }

    const parseHarga = (val) => {
      if (val == null) return 0
      if (typeof val === 'number') return val
      const s = String(val)
      return parseInt(s.replace(/\./g, '')) || 0
    }

    const fmt = (n) => utils.formatRupiah(parseInt(n) || 0)

    const getField = (obj, keys, def = '-') => {
      for (const k of keys) {
        const v = obj[k]
        if (v !== undefined && v !== null && String(v) !== '') return v
      }
      return def
    }

    const buildItemHTML = (item) => {
      const kode = getField(item, ['kode', 'kodeText', 'kodeLock'], '-')
      const nama = getField(item, ['nama', 'namaBarang'], '-')
      const kadar = getField(item, ['kadar'], '-')
      const berat = getField(item, ['berat', 'gr'], 0)
      const total = parseHarga(getField(item, ['totalHarga'], 0))
      const keterangan = getField(item, ['keterangan'], '')

      return `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invoice Customer</title>
          <style>
            @page { size: 10cm 20cm; margin: 0; }
            body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 5mm; width: 20cm; box-sizing: border-box; }
            .invoice { width: 100%; }
            .header-info { text-align: right; margin-bottom: 0.5cm; margin-right: 3cm; margin-top: 0.8cm; }
            .customer-info { text-align: right; margin-bottom: 1.1cm; margin-right: 3cm; font-size: 11px; line-height: 1.2; }
            .total-row { margin-top: 0.7cm; text-align: right; font-weight: bold; margin-right: 3cm; }
            .sales { text-align: right; margin-top: 0.6cm; margin-right: 2cm; }
            .item-details { display: flex; flex-wrap: wrap; }
            .item-data { display: grid; grid-template-columns: 2cm 2.7cm 4.6cm 1.8cm 1.8cm 2cm; width: 100%; column-gap: 0.2cm; margin-left: 0.5cm; margin-top: 1cm; margin-right: 3cm; }
            .item-data span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .item-data span:nth-child(3) { white-space: normal; overflow: visible; text-overflow: clip; word-wrap: break-word; }
            .keterangan { font-style: italic; font-size: 10px; margin-top: 1.2cm; margin-bottom: 0.5cm; padding-top: 2mm; text-align: left; margin-left: 0.5cm; margin-right: 3cm; }
            .keterangan-spacer { height: 1.6cm; }
          </style>
        </head>
        <body>
          <div class="invoice">
            <div class="header-info"><p>${tx.tanggal || ''}</p></div>
            <div class="customer-info">
              <div>${tx.customerName || '-'}</div>
              <div>${tx.customerPhone || ''}</div>
            </div>

            <div class="item-details">
              <div class="item-data">
                <span>${kode}</span>
                <span> pcs</span>
                <span>${nama}</span>
                <span>${kadar}</span>
                <span>${berat}gr</span>
                <span>${fmt(total)}</span>
              </div>
            </div>
            ${
              keterangan
                ? `<div class="keterangan"><strong>Keterangan:</strong><br>${keterangan}</div>`
                : `<div class="keterangan-spacer"></div>`
            }
            <div class="total-row">Rp ${fmt(total)}</div>
            <div class="sales">${tx.sales || '-'}</div>
          </div>
        </body>
        </html>
      `
    }

    const printViaIframe = (html) =>
      new Promise((resolve) => {
        const iframe = document.createElement('iframe')
        iframe.style.position = 'fixed'
        iframe.style.right = '0'
        iframe.style.bottom = '0'
        iframe.style.width = '0'
        iframe.style.height = '0'
        iframe.style.border = '0'
        document.body.appendChild(iframe)

        const w = iframe.contentWindow
        const d = w.document
        d.open()
        d.write(html)
        d.close()

        const cleanup = () => {
          setTimeout(() => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
            resolve()
          }, 150)
        }

        const onAfterPrint = () => {
          try {
            w.removeEventListener && w.removeEventListener('afterprint', onAfterPrint)
          } catch (e) {}
          cleanup()
        }
        try {
          w.addEventListener && w.addEventListener('afterprint', onAfterPrint)
        } catch (e) {}

        // Wait for content to fully load before printing to avoid duplicate triggers
        const tryPrint = () => {
          try {
            w.focus()
            w.print()
            // Fallback cleanup if afterprint not fired
            setTimeout(cleanup, 1000)
          } catch (e) {
            // Retry once shortly if print isn't ready
            setTimeout(tryPrint, 100)
          }
        }
        // Ensure styles applied before printing
        if (d.readyState === 'complete') {
          setTimeout(tryPrint, 50)
        } else {
          w.onload = () => setTimeout(tryPrint, 50)
        }
      })

    ;(async () => {
      for (const item of items) {
        const html = buildItemHTML(item)
        await printViaIframe(html)
      }
    })()
  },

  // Reset form
  resetForm() {
    try {
      // Reset sales type to default
      $('#jenisPenjualan').val('aksesoris').trigger('change')

      // Reset date to current date
      this.setDefaultDate()

      // Reset sales name field
      $('#sales').val('').removeClass('is-valid is-invalid')
      $('#customerName').val('')
      $('#customerPhone').val('')

      // Clear all tables
      $('#tableAksesorisDetail tbody, #tableKotakDetail tbody, #tableManualDetail tbody').empty()

      // Reset payment fields
      $('#metodeBayar').val('tunai').trigger('change')
      $('#nominalDP, #totalOngkos, #sisaPembayaran, #jumlahBayar, #kembalian').val('')

      // Reset grand totals
      $('#grand-total-aksesoris, #grand-total-kotak, #grand-total-manual').text('0')

      // Clear current transaction data
      currentTransactionData = null

      // Set focus to sales field
      $('#sales').focus()

      console.log('Form reset successfully')
    } catch (error) {
      console.error('Error resetting form:', error)
    }
  },

  // Print document handler
  printDocument(type) {
    if (type === 'receipt') {
      this.printReceipt()
    } else if (type === 'invoice') {
      // Jika item > 1, cetak terpisah per item (semua jenis penjualan)
      if (
        currentTransactionData &&
        Array.isArray(currentTransactionData.items) &&
        currentTransactionData.items.length > 1
      ) {
        this.printInvoicePerItem()
      } else {
        this.printInvoice()
      }
    }
  },

  // Cleanup when page unloads
  cleanup() {
    this.removeListeners()
  },
}

// Initialize when document is ready
$(document).ready(async function () {
  try {
    // Initialize monitoring
    readsMonitor.init()

    // Initialize the main handler
    await penjualanHandler.init()

    console.log('✅ Penjualan Aksesoris initialized successfully')
    console.log('🔥 Firestore reads:', readsMonitor.getStats())
  } catch (error) {
    console.error('❌ Error initializing penjualan aksesoris:', error)
    utils.showAlert('Terjadi kesalahan saat memuat halaman: ' + error.message, 'Error', 'error')
  }
})

// Cleanup when page unloads
$(window).on('beforeunload', () => {
  penjualanHandler.cleanup()
})

// Handle visibility change for smart data refresh
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    console.log('👁️ Page became visible, checking for stale data')
    if (!penjualanHandler.stockListener || !penjualanHandler.salesListener) {
      penjualanHandler.setupSmartListeners()
    }
  }
})

// Handle online/offline status
window.addEventListener('online', async () => {
  console.log('🌐 Connection restored')
  try {
    penjualanHandler.setupSmartListeners()
    utils.showAlert('Koneksi pulih, data telah diperbarui', 'Info', 'info')
  } catch (error) {
    console.error('Failed to refresh data after reconnection:', error)
  }
})

window.addEventListener('offline', () => {
  console.log('📡 Connection lost, using cached data')
  utils.showAlert('Koneksi terputus, menggunakan data cache', 'Warning', 'warning')
})

// Performance monitoring and optimization
const performanceMonitor = {
  metrics: {},

  start(operation) {
    this.metrics[operation] = {
      startTime: performance.now(),
      memoryStart: this.getMemoryUsage(),
    }
  },

  end(operation) {
    if (!this.metrics[operation]) return

    const duration = performance.now() - this.metrics[operation].startTime
    const memoryEnd = this.getMemoryUsage()
    const memoryDelta = memoryEnd - this.metrics[operation].memoryStart

    console.log(
      `⏱️ ${operation}: ${duration.toFixed(2)}ms (Memory: ${
        memoryDelta > 0 ? '+' : ''
      }${memoryDelta.toFixed(2)}MB)`
    )

    // Log slow operations
    if (duration > 1000) {
      console.warn(`🐌 Slow operation: ${operation} took ${duration.toFixed(2)}ms`)
    }

    delete this.metrics[operation]
  },

  getMemoryUsage() {
    if (performance.memory) {
      return performance.memory.usedJSHeapSize / 1024 / 1024 // MB
    }
    return 0
  },

  wrap(operation, fn) {
    return async (...args) => {
      this.start(operation)
      try {
        const result = await fn(...args)
        this.end(operation)
        return result
      } catch (error) {
        this.end(operation)
        throw error
      }
    }
  },
}

// Wrap critical functions with performance monitoring
penjualanHandler.loadStockData = performanceMonitor.wrap(
  'Load Stock Data',
  penjualanHandler.loadStockData.bind(penjualanHandler)
)

penjualanHandler.saveTransaction = performanceMonitor.wrap(
  'Save Transaction',
  penjualanHandler.saveTransaction.bind(penjualanHandler)
)

// Auto-maintenance tasks
setInterval(() => {
  // Hanya log performance stats
  const readsStats = readsMonitor.getStats()

  console.log('📊 System Health Check:', {
    stockItems: this.stockData?.length || 0,
    reads: `${readsStats.total}/${readsMonitor.dailyLimit} (${readsStats.percentage.toFixed(1)}%)`,
  })
}, 10 * 60 * 1000) // Every 10 minutes

window.addEventListener('unhandledrejection', (event) => {
  console.error('🚫 Unhandled promise rejection:', event.reason)
  event.preventDefault()

  if (event.reason && typeof event.reason === 'object' && event.reason.message) {
    console.error('Promise rejection details:', event.reason.message)
  }
})

// Add remove listeners method to penjualanHandler
penjualanHandler.removeListeners = function () {
  // Remove all event listeners to prevent memory leaks
  $(document).off('.penjualan')
  $(window).off('.penjualan')

  // Clear intervals
  if (this.refreshInterval) {
    clearInterval(this.refreshInterval)
    this.refreshInterval = null
  }
}

// Export for potential use in other modules
window.penjualanHandler = penjualanHandler
window.readsMonitor = readsMonitor
window.performanceMonitor = performanceMonitor

// Utility functions for backward compatibility
function showAlert(message, title = 'Informasi', type = 'info') {
  return utils.showAlert(message, title, type)
}

function showConfirm(message, title = 'Konfirmasi') {
  return utils.showConfirm(message, title)
}

function formatDate(date) {
  return utils.formatDate(date)
}

function printDocument(type) {
  return penjualanHandler.printDocument(type)
}

// Add loading states for better UX
const loadingStates = {
  show(element, text = 'Loading...') {
    const $el = $(element)
    $el.prop('disabled', true)
    const originalText = $el.text()
    $el.data('original-text', originalText)
    $el.html(`<i class="fas fa-spinner fa-spin me-2"></i>${text}`)
  },

  hide(element) {
    const $el = $(element)
    $el.prop('disabled', false)
    const originalText = $el.data('original-text')
    if (originalText) {
      $el.text(originalText)
    }
  },
}

// Enhanced error handling with retry mechanism
const errorHandler = {
  retryAttempts: 3,
  retryDelay: 1000,

  async withRetry(operation, context = 'Operation') {
    let lastError

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        console.warn(`${context} failed (attempt ${attempt}/${this.retryAttempts}):`, error)

        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelay * attempt)
        }
      }
    }

    throw lastError
  },

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  },

  isRetryableError(error) {
    // Network errors, timeout errors, etc.
    return (
      error.code === 'unavailable' ||
      error.code === 'deadline-exceeded' ||
      error.message.includes('network') ||
      error.message.includes('timeout')
    )
  },
}

// Add connection status indicator
const connectionStatus = {
  indicator: null,

  init() {
    // Create status indicator
    this.indicator = $(`
      <div id="connection-status" class="position-fixed bottom-0 end-0 m-3" style="z-index: 9999;">
        <div class="badge bg-success">
          <i class="fas fa-wifi me-1"></i>
          Online
        </div>
      </div>
    `)

    $('body').append(this.indicator)
    this.updateStatus()
  },

  updateStatus() {
    const isOnline = navigator.onLine
    const badge = this.indicator.find('.badge')

    if (isOnline) {
      badge.removeClass('bg-danger').addClass('bg-success')
      badge.html('<i class="fas fa-wifi me-1"></i>Online')
    } else {
      badge.removeClass('bg-success').addClass('bg-danger')
      badge.html('<i class="fas fa-wifi-slash me-1"></i>Offline')
    }
  },
}

// Initialize connection status
$(document).ready(() => {
  connectionStatus.init()
})

window.addEventListener('online', () => connectionStatus.updateStatus())
window.addEventListener('offline', () => connectionStatus.updateStatus())

// Add data validation helpers
const validators = {
  required(value, fieldName) {
    if (!value || value.toString().trim() === '') {
      throw new Error(`${fieldName} harus diisi`)
    }
    return true
  },

  numeric(value, fieldName) {
    if (isNaN(value) || value < 0) {
      throw new Error(`${fieldName} harus berupa angka positif`)
    }
    return true
  },

  minValue(value, min, fieldName) {
    if (parseFloat(value) < min) {
      throw new Error(`${fieldName} minimal ${min}`)
    }
    return true
  },

  // TAMBAHAN: Validator khusus untuk total harga dengan metode pembayaran
  totalHarga(value, metodeBayar, fieldName) {
    const numValue = parseFloat(value)
    if (metodeBayar === 'free') {
      // Untuk metode free, total harga boleh 0
      if (numValue < 0) {
        throw new Error(`${fieldName} tidak boleh negatif`)
      }
    } else {
      // Untuk metode lain, total harga harus > 0
      if (numValue <= 0) {
        throw new Error(`${fieldName} harus lebih dari 0`)
      }
    }
    return true
  },

  maxLength(value, max, fieldName) {
    if (value.toString().length > max) {
      throw new Error(`${fieldName} maksimal ${max} karakter`)
    }
    return true
  },
}

// Add form validation to save transaction
const originalSaveTransaction = penjualanHandler.saveTransaction

// Tambahkan guard isSaving + loadingStates agar tidak double submit
penjualanHandler.saveTransaction = async function () {
  if (this.isSaving) return // cegah double-click/submit
  this.isSaving = true
  loadingStates.show('#btnSimpanPenjualan', 'Menyimpan...')

  try {
    // Validasi form (tetap)
    const salesName = $('#sales').val().trim()
    validators.required(salesName, 'Nama sales')
    validators.maxLength(salesName, 50, 'Nama sales')

    const totalHarga = parseFloat($('#totalOngkos').val().replace(/\./g, '')) || 0
    const metodeBayar = $('#metodeBayar').val()
    validators.totalHarga(totalHarga, metodeBayar, 'Total harga')

    // Panggil fungsi simpan asli
    const result = await originalSaveTransaction.call(this)

    // Pastikan handler resetForm pada printModal tidak terduplikasi
    $('#printModal')
      .off('hidden.bs.modal')
      .on('hidden.bs.modal', () => {
        this.resetForm()
        $('#sales').focus()
      })

    return result
  } catch (error) {
    if (
      error?.message?.includes('harus') ||
      error?.message?.includes('tidak boleh') ||
      error?.message?.includes('minimal') ||
      error?.message?.includes('maksimal')
    ) {
      utils.showAlert(error.message, 'Validasi Error', 'warning')
      return
    }
    throw error
  } finally {
    loadingStates.hide('#btnSimpanPenjualan')
    this.isSaving = false
  }
}
