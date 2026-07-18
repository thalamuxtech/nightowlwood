"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCDE7RyNXW9g6lpPRYzXpWkyhvpHnFlFzg",
  authDomain: "nightowl-woodworks.firebaseapp.com",
  projectId: "nightowl-woodworks",
  storageBucket: "nightowl-woodworks.firebasestorage.app",
  messagingSenderId: "727828450788",
  appId: "1:727828450788:web:d74b96b4e689cba234cbf1",
  measurementId: "G-EGXB3DR8B7",
};

export function getFirebaseApp(): FirebaseApp {
  return getApps()[0] ?? initializeApp(firebaseConfig);
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(getFirebaseApp());
}

/** Fire-and-forget analytics init; safe in unsupported environments. */
export function initAnalytics() {
  if (typeof window === "undefined") return;
  import("firebase/analytics").then(({ getAnalytics, isSupported }) => {
    isSupported()
      .then((ok) => {
        if (ok) getAnalytics(getFirebaseApp());
      })
      .catch(() => {});
  });
}
