
/* EduOne - Notificaciones en segundo plano */

importScripts(
  "https://www.gstatic.com/firebasejs/11.3.1/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/11.3.1/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyA3U98y5BJWQwpypFCAyNioqSRfXkr9UA0",
  authDomain: "eduone-5f7cf.firebaseapp.com",
  projectId: "eduone-5f7cf",
  storageBucket: "eduone-5f7cf.firebasestorage.app",
  messagingSenderId: "541282614006",
  appId: "1:541282614006:web:f8cf617c99f08403df0ad7"
});

const messaging = firebase.messaging();

// Firebase mostrará las notificaciones recibidas
// en segundo plano cuando incluyan el campo notification.
