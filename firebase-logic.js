
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch, runTransaction, serverTimestamp, setLogLevel
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===================================
// KONFIGURASI DAN INISIALISASI FIREBASE
// ===================================
// Variabel global yang akan disediakan oleh environment
const appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId || 'default-pos-app';
// const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {}; // HAPUS BARIS INI
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Inisialisasi Firebase App
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// setLogLevel('debug');

// ===================================
// VARIABEL STATE APLIKASI
// ===================================
let penggunaAktif = null;
let pinSaatIni = '';
let mejaAktifId = null;
let unsubscribeListeners = []; // Menyimpan semua listener real-time

// Data lokal untuk cache, diisi oleh listener Firebase
const localData = {
    pengguna: [],
    bahanBaku: [],
    menu: [],
    meja: [],
    pesananDapur: [],
    transaksi: []
};

// ===================================
// ELEMEN DOM
// ===================================
const loadingOverlay = document.getElementById('loading-overlay');
const layarLogin = document.getElementById('layar-login');
const aplikasiUtama = document.getElementById('aplikasi-utama');
const pinDisplay = document.getElementById('pin-display');
const pinButtons = document.querySelectorAll('.pin-button[data-value]');
const pinClear = document.getElementById('pin-clear');
const pinBackspace = document.getElementById('pin-backspace');

const namaPenggunaEl = document.getElementById('nama-pengguna');
const peranPenggunaEl = document.getElementById('peran-pengguna');
const tombolLogout = document.getElementById('tombol-logout');

const tampilanPOS = document.getElementById('tampilan-pos');
const tampilanDapur = document.getElementById('tampilan-dapur');
const tampilanAdmin = document.getElementById('tampilan-admin');

const containerMeja = document.getElementById('container-meja');
const containerMenu = document.getElementById('container-menu');
const containerPesanan = document.getElementById('container-pesanan');
const labelMejaAktif = document.getElementById('label-meja-aktif');
const subtotalPesananEl = document.getElementById('subtotal-pesanan');
const pajakPesananEl = document.getElementById('pajak-pesanan');
const totalPesananEl = document.getElementById('total-pesanan');
const tombolKirimDapur = document.getElementById('tombol-kirim-dapur');
const tombolBayar = document.getElementById('tombol-bayar');

const containerDapur = document.getElementById('container-dapur');
const dapurKosongMsg = document.getElementById('dapur-kosong');

const adminMenuItems = document.querySelectorAll('.admin-menu-item');
const adminPanels = document.querySelectorAll('.admin-panel');

// ===================================
// FUNGSI HELPER
// ===================================
const formatRupiah = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

const getCollectionPath = (collName) => `/artifacts/${appId}/public/data/${collName}`;

// ===================================
// FUNGSI RENDER (Hanya menampilkan data dari localData)
// ===================================
function renderMeja() {
    containerMeja.innerHTML = '';
    localData.meja.sort((a, b) => a.id_meja - b.id_meja).forEach(m => {
        const statusColor = m.status === 'tersedia' ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-red-100 text-red-800 hover:bg-red-200';
        const isActive = mejaAktifId && mejaAktifId === m.id ? 'ring-4 ring-indigo-400' : '';
        const mejaEl = document.createElement('button');
        mejaEl.className = `p-4 rounded-lg font-bold text-center transition ${statusColor} ${isActive}`;
        mejaEl.textContent = m.nama;
        mejaEl.onclick = () => pilihMeja(m.id);
        containerMeja.appendChild(mejaEl);
    });
}

function renderMenu() {
    containerMenu.innerHTML = '';
    const kategori = [...new Set(localData.menu.map(item => item.kategori))];

    kategori.forEach(k => {
        const kategoriHeader = document.createElement('h3');
        kategoriHeader.className = 'text-lg font-bold text-gray-600 mt-4 mb-2';
        kategoriHeader.textContent = k;
        containerMenu.appendChild(kategoriHeader);

        const menuByKategori = localData.menu.filter(item => item.kategori === k);
        menuByKategori.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'flex justify-between items-center p-3 bg-gray-50 rounded-lg mb-2';
            itemEl.innerHTML = `
                        <div>
                            <p class="font-semibold">${item.nama} (${item.kode})</p>
                            <p class="text-sm text-gray-500">${formatRupiah(item.harga)}</p>
                        </div>
                        <button class="tambah-menu-btn bg-indigo-500 text-white w-10 h-10 rounded-full text-2xl font-bold hover:bg-indigo-600 transition">+</button>
                    `;
            itemEl.querySelector('.tambah-menu-btn').onclick = () => tambahItemKePesanan(item.id);
            containerMenu.appendChild(itemEl);
        });
    });
}

async function renderPesanan() {
    const mejaAktif = localData.meja.find(m => m.id === mejaAktifId);
    if (!mejaAktif) {
        containerPesanan.innerHTML = '<p class="text-gray-400 text-center mt-10">Pilih meja untuk memulai pesanan.</p>';
        labelMejaAktif.textContent = 'Pilih Meja';
        updateTotalPesanan();
        return;
    }

    labelMejaAktif.textContent = mejaAktif.nama;
    containerPesanan.innerHTML = '';

    if (!mejaAktif.pesanan || mejaAktif.pesanan.length === 0) {
        containerPesanan.innerHTML = '<p class="text-gray-400 text-center mt-10">Belum ada item ditambahkan.</p>';
    } else {
        for (const item of mejaAktif.pesanan) {
            const itemData = localData.menu.find(m => m.id === item.id);
            if (!itemData) continue;
            const itemEl = document.createElement('div');
            itemEl.className = 'flex items-center justify-between p-3 mb-2';
            itemEl.innerHTML = `
                        <div>
                            <p class="font-semibold">${itemData.nama}</p>
                            <p class="text-sm text-gray-500">${formatRupiah(itemData.harga)}</p>
                        </div>
                        <div class="flex items-center gap-3">
                            <button class="kurang-item-btn bg-gray-200 w-8 h-8 rounded-full font-bold">-</button>
                            <span class="font-bold text-lg w-8 text-center">${item.jumlah}</span>
                            <button class="tambah-item-btn bg-gray-200 w-8 h-8 rounded-full font-bold">+</button>
                        </div>
                    `;
            itemEl.querySelector('.tambah-item-btn').onclick = () => tambahItemKePesanan(item.id);
            itemEl.querySelector('.kurang-item-btn').onclick = () => kurangiItemDariPesanan(item.id);
            containerPesanan.appendChild(itemEl);
        }
    }
    updateTotalPesanan();
}

function renderDapur() {
    containerDapur.innerHTML = '';
    if (localData.pesananDapur.length === 0) {
        dapurKosongMsg.classList.remove('hidden');
    } else {
        dapurKosongMsg.classList.add('hidden');
        localData.pesananDapur.forEach(pesanan => {
            const card = document.createElement('div');
            card.className = 'bg-white rounded-xl shadow-lg p-4 flex flex-col';
            let itemsHTML = pesanan.items.map(item => `
                        <li class="flex justify-between">
                            <span>${item.nama}</span>
                            <span class="font-bold">x${item.jumlah}</span>
                        </li>
                    `).join('');
            card.innerHTML = `
                        <div class="border-b pb-2 mb-2">
                            <h3 class="text-xl font-bold">${pesanan.namaMeja}</h3>
                            <p class="text-sm text-gray-500">${pesanan.targetDapur}</p>
                        </div>
                        <ul class="space-y-1 flex-1">${itemsHTML}</ul>
                        <button class="selesai-pesanan-btn mt-4 w-full bg-green-500 text-white font-bold p-3 rounded-lg hover:bg-green-600 transition">Selesai</button>
                    `;
            card.querySelector('.selesai-pesanan-btn').onclick = () => selesaikanPesananDapur(pesanan.id);
            containerDapur.appendChild(card);
        });
    }
}

function renderAdminPanels() {
    // Laporan
    let totalPendapatan = 0;
    let totalHPP = 0;
    const detailTransaksiEl = document.getElementById('laporan-transaksi');
    detailTransaksiEl.innerHTML = '';

    if (localData.transaksi.length === 0) {
        detailTransaksiEl.innerHTML = '<p class="text-gray-500">Belum ada transaksi.</p>';
    } else {
        localData.transaksi.sort((a, b) => b.waktu.seconds - a.waktu.seconds).forEach(t => {
            totalPendapatan += t.total;
            totalHPP += t.hpp;
            const waktu = t.waktu ? new Date(t.waktu.seconds * 1000).toLocaleString('id-ID') : 'N/A';
            const transaksiDiv = document.createElement('div');
            transaksiDiv.className = 'p-3 bg-white border rounded-md mb-2 flex justify-between items-center';
            transaksiDiv.innerHTML = `
                        <div>
                          <p class="font-semibold">Transaksi #${t.id.substring(0, 6)} (${t.namaMeja})</p>
                          <p class="text-sm text-gray-500">${waktu}</p>
                        </div>
                        <div class="text-right">
                          <p class="font-bold text-green-600">${formatRupiah(t.total)}</p>
                          <p class="text-sm text-red-500">HPP: ${formatRupiah(t.hpp)}</p>
                        </div>
                    `;
            detailTransaksiEl.appendChild(transaksiDiv);
        });
    }

    document.getElementById('laporan-pendapatan').textContent = formatRupiah(totalPendapatan);
    document.getElementById('laporan-hpp').textContent = formatRupiah(totalHPP);
    document.getElementById('laporan-laba').textContent = formatRupiah(totalPendapatan - totalHPP);

    // Menu
    const tabelMenuBody = document.getElementById('tabel-menu');
    tabelMenuBody.innerHTML = '';
    localData.menu.forEach(m => {
        tabelMenuBody.innerHTML += `
                    <tr>
                        <td class="table-cell">${m.kode}</td>
                        <td class="table-cell">${m.nama}</td>
                        <td class="table-cell">${formatRupiah(m.harga)}</td>
                        <td class="table-cell">${m.targetDapur}</td>
                        <td class="table-cell"><button class="text-indigo-600 hover:text-indigo-900">Edit</button></td>
                    </tr>
                `;
    });

    // Stok
    const tabelStokBody = document.getElementById('tabel-stok');
    tabelStokBody.innerHTML = '';
    localData.bahanBaku.forEach(bb => {
        tabelStokBody.innerHTML += `
                    <tr>
                        <td class="table-cell">${bb.id}</td>
                        <td class="table-cell">${bb.nama}</td>
                        <td class="table-cell">${bb.stok.toFixed(2)}</td>
                        <td class="table-cell">${formatRupiah(bb.hargaBeliPerGram)}</td>
                    </tr>
                `;
    });

    // Pengguna
    const tabelPenggunaBody = document.getElementById('tabel-pengguna');
    tabelPenggunaBody.innerHTML = '';
    localData.pengguna.forEach(p => {
        tabelPenggunaBody.innerHTML += `
                    <tr>
                        <td class="table-cell">${p.id}</td>
                        <td class="table-cell">${p.nama}</td>
                        <td class="table-cell capitalize">${p.peran}</td>
                        <td class="table-cell">${p.pin}</td>
                        <td class="table-cell"><button class="text-indigo-600 hover:text-indigo-900">Edit</button></td>
                    </tr>
                `;
    });
}

// ===================================
// FUNGSI LOGIKA FIREBASE
// ===================================
async function attachRealtimeListeners() {
    const collectionsToListen = ['pengguna', 'bahanBaku', 'menu', 'meja', 'pesananDapur', 'transaksi'];
    collectionsToListen.forEach(collName => {
        const q = query(collection(db, getCollectionPath(collName)));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const data = [];
            querySnapshot.forEach((doc) => {
                data.push({ id: doc.id, ...doc.data() });
            });
            localData[collName] = data;

            if (penggunaAktif) {
                switch (collName) {
                    case 'meja': renderMeja(); renderPesanan(); break;
                    case 'menu': renderMenu(); break;
                    case 'pesananDapur': renderDapur(); break;
                    case 'pengguna': case 'bahanBaku': case 'transaksi':
                        if (penggunaAktif.peran === 'admin') renderAdminPanels();
                        break;
                }
            }
        }, (error) => console.error(`Error listening to ${collName}:`, error));
        unsubscribeListeners.push(unsubscribe);
    });
}

function detachAllListeners() {
    unsubscribeListeners.forEach(unsubscribe => unsubscribe());
    unsubscribeListeners = [];
}

async function prosesLogin() {
    const q = query(collection(db, getCollectionPath('pengguna')), where("pin", "==", pinSaatIni));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        penggunaAktif = { id: userDoc.id, ...userDoc.data() };
        layarLogin.classList.add('hidden');
        aplikasiUtama.classList.remove('hidden');
        namaPenggunaEl.textContent = penggunaAktif.nama;
        peranPenggunaEl.textContent = penggunaAktif.peran;
        navigasiBerdasarkanPeran(penggunaAktif.peran);
    } else {
        pinDisplay.classList.add('animate-shake', 'bg-red-200');
        console.error('PIN Salah!');
        setTimeout(() => {
            pinDisplay.classList.remove('animate-shake', 'bg-red-200');
            pinSaatIni = '';
            updatePinDisplay();
        }, 500);
    }
    pinSaatIni = '';
}

function navigasiBerdasarkanPeran(peran) {
    tampilanPOS.classList.add('hidden');
    tampilanDapur.classList.add('hidden');
    tampilanAdmin.classList.add('hidden');

    if (peran === 'kasir') {
        tampilanPOS.classList.remove('hidden');
        renderMeja();
        renderMenu();
        renderPesanan();
    } else if (peran === 'dapur') {
        tampilanDapur.classList.remove('hidden');
        renderDapur();
    } else if (peran === 'admin') {
        tampilanAdmin.classList.remove('hidden');
        renderAdminPanels();
    }
}

function logout() {
    penggunaAktif = null;
    mejaAktifId = null;
    pinSaatIni = '';
    updatePinDisplay();
    aplikasiUtama.classList.add('hidden');
    layarLogin.classList.remove('hidden');
}

function pilihMeja(idMeja) {
    mejaAktifId = idMeja;
    renderMeja();
    renderPesanan();
}

async function tambahItemKePesanan(idMenu) {
    if (!mejaAktifId) { console.error('Pilih meja terlebih dahulu!'); return; }
    const mejaDocRef = doc(db, getCollectionPath('meja'), mejaAktifId);
    try {
        await runTransaction(db, async (transaction) => {
            const mejaDoc = await transaction.get(mejaDocRef);
            if (!mejaDoc.exists()) { throw "Meja tidak ditemukan!"; }
            const newPesanan = [...(mejaDoc.data().pesanan || [])];
            const itemDiPesanan = newPesanan.find(item => item.id === idMenu);
            if (itemDiPesanan) { itemDiPesanan.jumlah++; } else { newPesanan.push({ id: idMenu, jumlah: 1 }); }
            transaction.update(mejaDocRef, { pesanan: newPesanan });
        });
    } catch (e) { console.error("Gagal menambah item: ", e); }
}

async function kurangiItemDariPesanan(idMenu) {
    if (!mejaAktifId) return;
    const mejaDocRef = doc(db, getCollectionPath('meja'), mejaAktifId);
    try {
        await runTransaction(db, async (transaction) => {
            const mejaDoc = await transaction.get(mejaDocRef);
            if (!mejaDoc.exists()) { throw "Meja tidak ditemukan!"; }
            let newPesanan = [...(mejaDoc.data().pesanan || [])];
            const itemIndex = newPesanan.findIndex(item => item.id === idMenu);
            if (itemIndex > -1) {
                if (newPesanan[itemIndex].jumlah > 1) {
                    newPesanan[itemIndex].jumlah--;
                } else {
                    newPesanan.splice(itemIndex, 1);
                }
            }
            transaction.update(mejaDocRef, { pesanan: newPesanan });
        });
    } catch (e) { console.error("Gagal mengurangi item: ", e); }
}

function updateTotalPesanan() {
    const mejaAktif = localData.meja.find(m => m.id === mejaAktifId);
    if (!mejaAktif || !mejaAktif.pesanan || mejaAktif.pesanan.length === 0) {
        subtotalPesananEl.textContent = formatRupiah(0);
        pajakPesananEl.textContent = formatRupiah(0);
        totalPesananEl.textContent = formatRupiah(0);
        tombolKirimDapur.disabled = true;
        tombolBayar.disabled = true;
        return;
    }

    const subtotal = mejaAktif.pesanan.reduce((total, item) => {
        const menuData = localData.menu.find(m => m.id === item.id);
        return total + (menuData ? menuData.harga * item.jumlah : 0);
    }, 0);

    const pajak = subtotal * 0.10;
    const total = subtotal + pajak;

    subtotalPesananEl.textContent = formatRupiah(subtotal);
    pajakPesananEl.textContent = formatRupiah(pajak);
    totalPesananEl.textContent = formatRupiah(total);
    tombolKirimDapur.disabled = false;
    tombolBayar.disabled = mejaAktif.status !== 'terisi';
}


async function kirimKeDapur() {
    const mejaAktif = localData.meja.find(m => m.id === mejaAktifId);
    if (!mejaAktif || !mejaAktif.pesanan || mejaAktif.pesanan.length === 0) return;

    try {
        await runTransaction(db, async (transaction) => {
            // 1) Kumpulkan semua kebutuhan (reads only)
            const pesananPerDapur = {}; // { dapur: [item,...] }
            const bahanTotals = {};     // { bahanId: totalNeeded }
            const menuRefs = {};        // cache menu refs if needed

            for (const item of mejaAktif.pesanan) {
                const menuItem = localData.menu.find(m => m.id === item.id);
                if (!menuItem) throw new Error(`Menu ${item.id} tidak ditemukan`);
                // group by dapur
                const dapur = menuItem.targetDapur || 'default';
                pesananPerDapur[dapur] = pesananPerDapur[dapur] || [];
                pesananPerDapur[dapur].push({ nama: menuItem.nama, jumlah: item.jumlah, menuId: menuItem.id });

                // accumulate bahan needed (assumes menuItem.resep = [{ bahanId, jumlah }, ...])
                if (Array.isArray(menuItem.resep)) {
                    for (const r of menuItem.resep) {
                        bahanTotals[r.bahanId] = (bahanTotals[r.bahanId] || 0) + (r.jumlah * item.jumlah);
                    }
                }
            }

            // 2) Read all bahan documents required (all reads first)
            const bahanDocsData = {}; // { bahanId: { snap, currentStok, nama } }
            for (const bahanId of Object.keys(bahanTotals)) {
                const bahanRef = doc(db, getCollectionPath('bahanBaku'), bahanId);
                const bahanSnap = await transaction.get(bahanRef);
                if (!bahanSnap.exists()) throw new Error(`Bahan baku ${bahanId} tidak ditemukan`);
                const data = bahanSnap.data();
                bahanDocsData[bahanId] = {
                    ref: bahanRef,
                    currentStok: Number(data.stok || 0),
                    nama: data.nama || bahanId
                };
            }

            // 3) Validate stock after all reads
            for (const bahanId of Object.keys(bahanTotals)) {
                const needed = bahanTotals[bahanId];
                const current = bahanDocsData[bahanId].currentStok;
                if (current < needed) {
                    throw new Error(`Stok ${bahanDocsData[bahanId].nama} tidak mencukupi (butuh ${needed}, tersedia ${current})`);
                }
            }

            // 4) All reads done -> perform writes (updates & creates)
            // update bahan stok
            for (const bahanId of Object.keys(bahanTotals)) {
                const newStok = bahanDocsData[bahanId].currentStok - bahanTotals[bahanId];
                transaction.update(bahanDocsData[bahanId].ref, { stok: newStok });
            }

            // create pesananDapur documents
            for (const dapur of Object.keys(pesananPerDapur)) {
                const pesananRef = doc(collection(db, getCollectionPath('pesananDapur')));
                transaction.set(pesananRef, {
                    namaMeja: mejaAktif.nama || 'Meja',
                    targetDapur: dapur,
                    items: pesananPerDapur[dapur],
                    createdAt: serverTimestamp()
                });
            }

            // update meja status
            const mejaRef = doc(db, getCollectionPath('meja'), mejaAktifId);
            transaction.update(mejaRef, { status: 'terisi', updatedAt: serverTimestamp() });
        });

        console.log(`Pesanan untuk meja ${mejaAktif.nama} berhasil dikirim ke dapur.`);
    } catch (err) {
        console.error("Transaksi gagal: ", err);
        // tampilkan pesan ke UI jika perlu
    }
}

async function prosesPembayaran() {
    const mejaAktif = localData.meja.find(m => m.id === mejaAktifId);
    if (!mejaAktif || !mejaAktif.pesanan || mejaAktif.pesanan.length === 0) return;

    const subtotal = mejaAktif.pesanan.reduce((total, item) => {
        const menuData = localData.menu.find(m => m.id === item.id);
        return total + (menuData.harga * item.jumlah);
    }, 0);

    const totalHPP = mejaAktif.pesanan.reduce((total, item) => {
        const menuData = localData.menu.find(m => m.id === item.id);
        const hppPerItem = menuData.resep ? menuData.resep.reduce((hpp, resepItem) => {
            const bahan = localData.bahanBaku.find(b => b.id === resepItem.bahanId);
            return hpp + (bahan.hargaBeliPerGram * resepItem.jumlah);
        }, 0) : 0;
        return total + (hppPerItem * item.jumlah);
    }, 0);

    const pajak = subtotal * 0.10;
    const total = subtotal + pajak;

    const transaksiRef = doc(collection(db, getCollectionPath('transaksi')));
    await setDoc(transaksiRef, { waktu: serverTimestamp(), namaMeja: mejaAktif.nama, items: mejaAktif.pesanan, subtotal, pajak, total, hpp: totalHPP });

    const mejaDocRef = doc(db, getCollectionPath('meja'), mejaAktifId);
    await updateDoc(mejaDocRef, { pesanan: [], status: 'tersedia' });

    console.log(`Pembayaran untuk ${mejaAktif.nama} sebesar ${formatRupiah(total)} berhasil!`);
    mejaAktifId = null;
    renderMeja();
    renderPesanan();
}

async function selesaikanPesananDapur(idPesanan) {
    await deleteDoc(doc(db, getCollectionPath('pesananDapur'), idPesanan));
}

function updatePinDisplay() {
    pinDisplay.textContent = '●'.repeat(pinSaatIni.length);
}

function handlePinInput(value) {
    if (pinSaatIni.length < 4) {
        pinSaatIni += value;
        updatePinDisplay();
        if (pinSaatIni.length === 4) {
            prosesLogin();
        }
    }
}

async function main() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await setupInitialData();
            await attachRealtimeListeners();
            loadingOverlay.style.display = 'none';
        } else {
            try {
                if (initialAuthToken) { await signInWithCustomToken(auth, initialAuthToken); }
                else { await signInAnonymously(auth); }
            } catch (error) {
                console.error("Error signing in: ", error);
                loadingOverlay.innerHTML = "Gagal terhubung. Coba refresh.";
            }
        }
    });
}

async function setupInitialData() {
    const settingsRef = doc(db, getCollectionPath('settings'), 'app-status');
    const settingsSnap = await getDocs(settingsRef.parent);
    if (settingsSnap.empty) {
        console.log("Database kosong, menambahkan data awal...");
        loadingOverlay.querySelector('p').textContent = 'Inisialisasi Data Awal...';
        const initialData = {
            pengguna: [
                { id: 'admin01', nama: 'Super Admin', peran: 'admin', pin: '1111' }, { id: 'kasir01', nama: 'Budi Kasir', peran: 'kasir', pin: '2222' }, { id: 'dapur01', nama: 'Chef Juna', peran: 'dapur', pin: '3333' }
            ],
            bahanBaku: [
                { id: 'bb01', nama: 'Daging Sapi', stok: 5000, hargaBeliPerGram: 120 }, { id: 'bb02', nama: 'Roti Burger', stok: 10000, hargaBeliPerGram: 40 }, { id: 'bb03', nama: 'Keju Slice', stok: 2000, hargaBeliPerGram: 50 }, { id: 'bb04', nama: 'Daun Selada', stok: 1000, hargaBeliPerGram: 15 }, { id: 'bb05', nama: 'Tomat', stok: 2000, hargaBeliPerGram: 10 }, { id: 'bb06', nama: 'Kentang', stok: 10000, hargaBeliPerGram: 8 }, { id: 'bb07', nama: 'Biji Kopi', stok: 3000, hargaBeliPerGram: 25 }, { id: 'bb08', nama: 'Susu Cair', stok: 5000, hargaBeliPerGram: 15 },
            ],
            menu: [
                { id: 'm01', kode: 'MKN-01', nama: 'Beef Burger', kategori: 'Makanan', harga: 55000, targetDapur: 'Dapur Utama', resep: [{ bahanId: 'bb01', jumlah: 150 }, { bahanId: 'bb02', jumlah: 50 }, { bahanId: 'bb03', jumlah: 20 }, { bahanId: 'bb04', jumlah: 15 }, { bahanId: 'bb05', jumlah: 20 }] }, { id: 'm02', kode: 'MKN-02', nama: 'Cheeseburger', kategori: 'Makanan', harga: 60000, targetDapur: 'Dapur Utama', resep: [{ bahanId: 'bb01', jumlah: 150 }, { bahanId: 'bb02', jumlah: 50 }, { bahanId: 'bb03', jumlah: 40 }, { bahanId: 'bb04', jumlah: 15 }, { bahanId: 'bb05', jumlah: 20 }] }, { id: 'm03', kode: 'MKN-03', nama: 'Kentang Goreng', kategori: 'Makanan', harga: 25000, targetDapur: 'Dapur Utama', resep: [{ bahanId: 'bb06', jumlah: 200 }] }, { id: 'm04', kode: 'MNM-01', nama: 'Caffe Latte', kategori: 'Minuman', harga: 30000, targetDapur: 'Bar', resep: [{ bahanId: 'bb07', jumlah: 20 }, { bahanId: 'bb08', jumlah: 150 }] }, { id: 'm05', kode: 'MNM-02', nama: 'Cappuccino', kategori: 'Minuman', harga: 30000, targetDapur: 'Bar', resep: [{ bahanId: 'bb07', jumlah: 20 }, { bahanId: 'bb08', jumlah: 120 }] }
            ],
            meja: Array.from({ length: 12 }, (_, i) => ({ id: `${i + 1}`, id_meja: i + 1, nama: `Meja ${i + 1}`, status: 'tersedia', pesanan: [] }))
        };
        const batch = writeBatch(db);
        for (const key in initialData) {
            initialData[key].forEach(item => {
                const docRef = doc(db, getCollectionPath(key), item.id);
                batch.set(docRef, item);
            });
        }
        batch.set(settingsRef, { initialized: true });
        await batch.commit();
        console.log("Data awal berhasil ditambahkan.");
    }
}

pinButtons.forEach(button => button.addEventListener('click', () => handlePinInput(button.dataset.value)));
pinClear.addEventListener('click', () => { pinSaatIni = ''; updatePinDisplay(); });
pinBackspace.addEventListener('click', () => { pinSaatIni = pinSaatIni.slice(0, -1); updatePinDisplay(); });
tombolLogout.addEventListener('click', logout);
tombolKirimDapur.addEventListener('click', kirimKeDapur);
tombolBayar.addEventListener('click', prosesPembayaran);
adminMenuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        adminMenuItems.forEach(i => i.classList.remove('bg-gray-900'));
        item.classList.add('bg-gray-900');
        const targetId = item.dataset.target;
        adminPanels.forEach(panel => panel.id === targetId ? panel.classList.remove('hidden') : panel.classList.add('hidden'));
    });
});

main();