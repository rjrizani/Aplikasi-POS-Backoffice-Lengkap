// GANTI DENGAN KONFIGURASI PROYEK FIREBASE ANDA
// Anda bisa mendapatkan ini dari Firebase Console:
// Project Settings > General > Your apps > Web app > Firebase SDK snippet > Config

const firebaseConfig = {
    apiKey: "AIzaSyCDGI7HCnkzuecq7KHZB2F7k8sLHAEjFyQ",
    authDomain: "points-of-sale-f20ae.firebaseapp.com",
    projectId: "points-of-sale-f20ae",
    storageBucket: "points-of-sale-f20ae.firebasestorage.app",
    messagingSenderId: "244013009855",
    appId: "1:244013009855:web:1ee550a3017e7ae0472f0a",
    databaseURL: "https://points-of-sale-f20ae-default-rtdb.asia-southeast1.firebasedatabase.app/"
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export Firebase services
const db = firebase.database();
const auth = firebase.auth();