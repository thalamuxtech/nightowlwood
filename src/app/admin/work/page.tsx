"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, Loader2, Plus, Trash2, UploadCloud, X } from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getDb, getFirebaseStorage } from "@/lib/firebase";
import type { PortfolioItem } from "@/lib/types";

const CATEGORIES = ["Residential", "Commercial", "Joinery", "Custom"];

export default function WorkManagerPage() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const q = query(collection(getDb(), "workItems"), orderBy("order", "asc"));
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PortfolioItem));
      setLoading(false);
    });
  }, []);

  async function togglePublished(item: PortfolioItem) {
    await updateDoc(doc(getDb(), "workItems", item.id), { published: !item.published });
  }

  async function remove(item: PortfolioItem) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    await deleteDoc(doc(getDb(), "workItems", item.id));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-cream-50">Work Items</h1>
          <p className="mt-1 text-sm text-cream-500">
            Extra gallery items shown on the public “Our Work” page alongside the built-in set.
          </p>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brass-500 px-6 py-3 text-sm font-medium text-night-950 transition-all duration-300 hover:bg-brass-400"
        >
          <Plus size={17} /> Add work item
        </button>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {loading && <p className="text-sm text-cream-500">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="rounded-2xl border border-dashed border-night-600 p-8 text-sm text-cream-500 sm:col-span-2 lg:col-span-3">
            No custom work items yet. The public gallery currently shows the six built-in
            project applications — add items here to extend it.
          </p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="overflow-hidden rounded-2xl border border-night-700/70 bg-night-900"
          >
            <div className="relative aspect-[4/3] bg-night-800">
              {item.imageUrl && (
                <Image
                  src={item.imageUrl}
                  alt={item.title}
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover"
                  unoptimized
                />
              )}
              {!item.published && (
                <span className="absolute left-3 top-3 rounded-full bg-night-950/80 px-3 py-1 text-xs text-cream-400">
                  Hidden
                </span>
              )}
            </div>
            <div className="p-5">
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-brass-400">
                {item.category}
              </p>
              <h2 className="mt-1 font-display text-lg text-cream-100">{item.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-cream-500">{item.description}</p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => togglePublished(item)}
                  className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-night-600 px-3 py-2 text-xs text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
                >
                  {item.published ? <EyeOff size={14} /> : <Eye size={14} />}
                  {item.published ? "Unpublish" : "Publish"}
                </button>
                <button
                  onClick={() => remove(item)}
                  aria-label={`Delete ${item.title}`}
                  className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-red-500/40 px-3 py-2 text-red-400 transition-colors hover:bg-red-950/40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {editing && <AddItemModal count={items.length} onClose={() => setEditing(false)} />}
      </AnimatePresence>
    </div>
  );
}

function AddItemModal({ count, onClose }: { count: number; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");

  function onFile(f: File | null) {
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : "");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    const category = String(data.get("category") ?? CATEGORIES[0]);

    if (!title || !file) {
      setError("A title and an image are required.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const path = `work/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const storageRef = ref(getFirebaseStorage(), path);
      await uploadBytes(storageRef, file);
      const imageUrl = await getDownloadURL(storageRef);
      await addDoc(collection(getDb(), "workItems"), {
        title,
        description,
        category,
        imageUrl,
        order: count,
        published: true,
        featured: false,
      });
      onClose();
    } catch {
      setError("Upload failed. Check your connection and permissions, then try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-y-auto rounded-2xl border border-night-700/70 bg-night-900 p-7"
        role="dialog"
        aria-label="Add work item"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl text-cream-50">Add work item</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-night-600 text-cream-300 transition-colors hover:border-brass-500"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block cursor-pointer rounded-xl border border-dashed border-night-500 bg-night-800/40 p-6 text-center transition-colors hover:border-brass-500/60">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected preview" className="mx-auto max-h-48 rounded-lg object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-2 text-sm text-cream-400">
                <UploadCloud size={28} className="text-brass-400" />
                Click to choose a photo
              </span>
            )}
          </label>

          <div>
            <label htmlFor="wi-title" className="mb-1.5 block text-sm text-cream-300">
              Title
            </label>
            <input
              id="wi-title"
              name="title"
              type="text"
              required
              className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="wi-category" className="mb-1.5 block text-sm text-cream-300">
              Category
            </label>
            <select
              id="wi-category"
              name="category"
              className="w-full cursor-pointer rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="bg-night-800">
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wi-description" className="mb-1.5 block text-sm text-cream-300">
              Description
            </label>
            <textarea
              id="wi-description"
              name="description"
              rows={3}
              className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brass-500 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 size={17} className="animate-spin" /> Uploading…
              </>
            ) : (
              "Save work item"
            )}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}
