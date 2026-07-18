"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  PenLine,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getDb, getFirebaseStorage } from "@/lib/firebase";
import type { Post } from "@/lib/types";

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export default function BlogAdminPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Post | "new" | null>(null);

  useEffect(() => {
    const q = query(collection(getDb(), "posts"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Post));
      setLoading(false);
    });
  }, []);

  async function togglePublished(post: Post) {
    await updateDoc(doc(getDb(), "posts", post.id), { published: !post.published });
  }

  async function remove(post: Post) {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    await deleteDoc(doc(getDb(), "posts", post.id));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-cream-50">Blog</h1>
          <p className="mt-1 text-sm text-cream-500">
            Write in Markdown, attach photos that auto-slide on the article, and publish when ready.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brass-500 px-6 py-3 text-sm font-medium text-night-950 transition-all duration-300 hover:bg-brass-400"
        >
          <Plus size={17} /> New post
        </button>
      </div>

      <div className="mt-8 space-y-4">
        {loading && <p className="text-sm text-cream-500">Loading…</p>}
        {!loading && posts.length === 0 && (
          <p className="rounded-2xl border border-dashed border-night-600 p-10 text-center text-sm text-cream-500">
            No posts yet. Write your first article, for example “The best wood for kitchen
            cabinets in Nigeria and why”.
          </p>
        )}
        <AnimatePresence>
          {posts.map((post) => (
            <motion.div
              key={post.id}
              layout
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-night-700/70 bg-night-900 p-4"
            >
              <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-night-800">
                {post.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.images[0]} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-cream-100">{post.title}</p>
                <p className="truncate text-xs text-cream-500">
                  /blog/post/?s={post.id} · {post.images.length} photo{post.images.length === 1 ? "" : "s"} ·{" "}
                  {post.createdAt?.toDate?.().toLocaleDateString() ?? "-"}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs ${
                  post.published
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-night-600 text-cream-500"
                }`}
              >
                {post.published ? "Published" : "Draft"}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(post)}
                  aria-label={`Edit ${post.title}`}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-night-600 text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
                >
                  <PenLine size={15} />
                </button>
                <button
                  onClick={() => togglePublished(post)}
                  aria-label={post.published ? "Unpublish" : "Publish"}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-night-600 text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
                >
                  {post.published ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button
                  onClick={() => remove(post)}
                  aria-label={`Delete ${post.title}`}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-red-500/40 text-red-400 transition-colors hover:bg-red-950/40"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {editing && (
          <PostEditor
            post={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PostEditor({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.id ?? "");
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [contentMd, setContentMd] = useState(post?.contentMd ?? "");
  const [images, setImages] = useState<string[]>(post?.images ?? []);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  function onTitleChange(v: string) {
    setTitle(v);
    if (!post) setSlug(slugify(v));
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const path = `blog/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const storageRef = ref(getFirebaseStorage(), path);
        await uploadBytes(storageRef, file);
        urls.push(await getDownloadURL(storageRef));
      }
      setImages((prev) => [...prev, ...urls]);
    } catch {
      setError("Image upload failed. Check Storage permissions and try again.");
    } finally {
      setUploading(false);
    }
  }

  function moveImage(i: number, dir: -1 | 1) {
    setImages((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !slug.trim() || !contentMd.trim()) {
      setError("Title, slug, and content are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setDoc(
        doc(getDb(), "posts", slug),
        {
          title: title.trim(),
          excerpt: excerpt.trim(),
          contentMd,
          images,
          published: post?.published ?? false,
          createdAt: post?.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      onClose();
    } catch {
      setError("Save failed. Check your connection and permissions.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-500 focus:border-brass-500 focus:outline-none";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 overflow-y-auto bg-night-950/85 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto w-full max-w-3xl rounded-2xl border border-night-700/70 bg-night-900 p-6 sm:p-8"
        role="dialog"
        aria-label={post ? "Edit post" : "New post"}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl text-cream-50">
            {post ? "Edit post" : "New post"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-night-600 text-cream-300 transition-colors hover:border-brass-500"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-5">
          <div>
            <label htmlFor="post-title" className="mb-1.5 block text-sm text-cream-300">
              Title
            </label>
            <input
              id="post-title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className={inputCls}
              placeholder="The best wood for kitchen cabinets"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="post-slug" className="mb-1.5 block text-sm text-cream-300">
                Slug (URL) {post && <span className="text-cream-500">(fixed after creation)</span>}
              </label>
              <input
                id="post-slug"
                value={slug}
                disabled={!!post}
                onChange={(e) => setSlug(slugify(e.target.value))}
                className={`${inputCls} disabled:opacity-50`}
              />
            </div>
            <div>
              <label htmlFor="post-excerpt" className="mb-1.5 block text-sm text-cream-300">
                Excerpt (card summary)
              </label>
              <input
                id="post-excerpt"
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                className={inputCls}
                placeholder="One or two sentences shown on the blog page."
              />
            </div>
          </div>

          {/* Images */}
          <div>
            <p className="mb-1.5 text-sm text-cream-300">
              Photos <span className="text-cream-500">(first is the cover; multiple photos auto-slide)</span>
            </p>
            <div className="flex flex-wrap gap-3">
              {images.map((url, i) => (
                <div key={url} className="group relative h-20 w-28 overflow-hidden rounded-lg border border-night-600">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Post image ${i + 1}`} className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center gap-1 bg-night-950/70 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => moveImage(i, -1)} aria-label="Move earlier" className="cursor-pointer rounded bg-night-800 p-1 text-cream-200 hover:text-brass-300">
                      <ArrowUp size={13} />
                    </button>
                    <button type="button" onClick={() => moveImage(i, 1)} aria-label="Move later" className="cursor-pointer rounded bg-night-800 p-1 text-cream-200 hover:text-brass-300">
                      <ArrowDown size={13} />
                    </button>
                    <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))} aria-label="Remove image" className="cursor-pointer rounded bg-night-800 p-1 text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {i === 0 && (
                    <span className="absolute left-1 top-1 rounded bg-brass-500 px-1.5 text-[0.6rem] font-medium text-night-950">
                      Cover
                    </span>
                  )}
                </div>
              ))}
              <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-night-500 text-cream-400 transition-colors hover:border-brass-500/60 hover:text-brass-300">
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadImages(e.target.files)} />
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                <span className="text-[0.65rem]">{uploading ? "Uploading…" : "Add photos"}</span>
              </label>
            </div>
          </div>

          {/* Content with preview toggle */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="post-content" className="text-sm text-cream-300">
                Content (Markdown)
              </label>
              <button
                type="button"
                onClick={() => setPreview((v) => !v)}
                className="cursor-pointer rounded-full border border-night-600 px-4 py-1.5 text-xs text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
              >
                {preview ? "Edit" : "Preview"}
              </button>
            </div>
            {preview ? (
              <div className="prose-nightowl min-h-72 rounded-xl border border-night-600 bg-night-800/40 p-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {contentMd || "*Nothing to preview yet.*"}
                </ReactMarkdown>
              </div>
            ) : (
              <textarea
                id="post-content"
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
                rows={14}
                className={`${inputCls} font-mono text-sm leading-relaxed`}
                placeholder={"## Why oak wins in Nigerian kitchens\n\nHumidity, termites, and daily use demand...\n\n- **Durability:** ...\n- **Cost:** ...\n\n> Expert tip: always seal end grain twice."}
              />
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-full border border-night-600 px-6 py-3 text-sm text-cream-300 transition-colors hover:border-cream-500/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || uploading}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brass-500 px-7 py-3 text-sm font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {post ? "Save changes" : "Create draft"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
