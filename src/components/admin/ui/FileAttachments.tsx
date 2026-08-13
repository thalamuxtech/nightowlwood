"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Printer,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { getDb, getFirebaseStorage } from "@/lib/firebase";
import { writeAudit, type AuditActor } from "@/lib/erp/audit";
import { Button } from "@/components/admin/ui/Fields";

/**
 * Files attached to a record.
 *
 * Built once and used twice, because the two requirements are the same mechanism: the brief asks for
 * supporting documents on an invoice — "mostly cutting list document... this is to prevent loss of
 * customer cutting list document" — and reference images on a project. Both are "keep this piece of
 * paper with this record so it cannot go missing".
 *
 * ## Why the file lives in Storage and the record in Firestore
 *
 * The document holds the URL, the name, the size and who attached it. That way a list of attachments
 * is one cheap query, the file itself is fetched only when somebody opens it, and deleting the record
 * is instant. The file is deliberately *not* removed from Storage on delete — see `remove` below.
 *
 * ## Printing
 *
 * An image attachment can be printed straight from here, which is the point of attaching a cutting
 * list: somebody at the saw needs the customer's own sheet in their hand. Opening it in a new tab and
 * printing from there is what the print button does, because a browser prints an image better than
 * any markup this could wrap around it.
 */

export interface Attachment {
  id: string;
  name: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  uploadedByEmail?: string;
  uploadedAtMs: number | null;
}

/** 10 MB, matching the storage rules. A phone photograph of a cutting list is well under it. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * What may be attached.
 *
 * Images and PDFs only. A cutting list arrives as a photograph or a scan, and allowing arbitrary
 * files would make this a place to park documents nobody can open on a phone at the saw.
 */
const ACCEPT = "image/*,application/pdf";

function isImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileAttachments({
  /** Firestore subcollection path, e.g. `invoices/abc/attachments`. */
  path,
  /** Storage folder, e.g. `invoices`. Kept separate so files group sensibly in the bucket. */
  storageFolder,
  actor,
  canEdit,
  title = "Attachments",
  hint,
  /** Shown as a grid of thumbnails rather than a list. For reference images. */
  gallery,
}: {
  path: string;
  storageFolder: string;
  actor: AuditActor;
  canEdit: boolean;
  title?: string;
  hint?: string;
  gallery?: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [version, setVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getDocs(query(collection(getDb(), path), orderBy("uploadedAt", "desc")))
      .then((snap) => {
        if (!live) return;
        setItems(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              name: (x.name as string) ?? "file",
              url: (x.url as string) ?? "",
              contentType: (x.contentType as string) ?? "application/octet-stream",
              sizeBytes: (x.sizeBytes as number) ?? 0,
              uploadedByEmail: (x.uploadedByEmail as string) ?? undefined,
              uploadedAtMs: x.uploadedAt?.toMillis?.() ?? null,
            };
          })
        );
      })
      .catch((e) => {
        if (live) {
          setError(
            e instanceof Error ? `Could not read the attachments: ${e.message}` : "Could not read the attachments."
          );
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, version]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setUploading(true);

    /*
     * Problems are collected rather than reported one at a time.
     *
     * `setError` in a loop keeps only the last message, so selecting three oversized files told the
     * user about one of them. And the refresh has to happen even when something failed part way —
     * otherwise a file that *did* upload stays invisible, the user retries, and it uploads twice.
     */
    const problems: string[] = [];
    let uploaded = 0;

    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          problems.push(
            `${file.name} is ${readableSize(file.size)}, over the ${readableSize(MAX_BYTES)} limit`
          );
          continue;
        }

        /*
         * The stored name is prefixed with a timestamp and stripped of anything unusual.
         *
         * Two people attaching `cutting list.jpg` to different invoices must not collide, and a
         * filename with a slash or a quote in it is a path somebody did not intend.
         */
        const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        const storagePath = `${storageFolder}/${Date.now()}-${safe}`;
        const storageRef = ref(getFirebaseStorage(), storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        const created = await addDoc(collection(getDb(), path), {
          name: file.name,
          url,
          storagePath,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          uploadedByEmail: actor.email,
          uploadedAt: serverTimestamp(),
          uploadedBy: actor.uid,
        });
        uploaded += 1;

        await writeAudit(getDb(), {
          actor,
          action: "create",
          collectionName: path,
          /*
           * The Firestore document id, not the storage path.
           *
           * `remove` audits under the document id, so recording the path here meant the create and
           * delete entries for the same attachment carried different identifiers and could not be
           * joined — which defeats using the log to find files orphaned in Storage. The path is in
           * the summary, where it is still searchable.
           */
          docId: created.id,
          summary: `Attached ${file.name} (${readableSize(file.size)}) at ${storagePath}`,
        });
      }
    } catch (e) {
      problems.push(
        e instanceof Error ? e.message : "the connection dropped part way through"
      );
    } finally {
      /*
       * Refreshed and reported whatever happened.
       *
       * In `finally` so a failure half way through still shows the files that did upload. The
       * previous version refreshed only on complete success, so a partial failure left the new
       * attachment invisible and invited the user to upload it a second time.
       */
      if (uploaded > 0) setVersion((v) => v + 1);
      if (problems.length > 0) {
        setError(
          uploaded > 0
            ? `${uploaded} attached. ${problems.length} could not be: ${problems.join("; ")}.`
            : `Nothing was attached: ${problems.join("; ")}.`
        );
      }
      setUploading(false);
      // Cleared so the same file can be chosen again after a failure.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(item: Attachment) {
    const ok = window.confirm(
      `Remove ${item.name} from this record?\n\nThe file itself is kept, so a link already shared still works.`
    );
    if (!ok) return;

    setError("");
    try {
      /*
       * The Firestore record goes; the Storage file stays.
       *
       * Deliberate. A deletion here means "this does not belong on this record" — usually attached to
       * the wrong invoice — and the file may be the customer's only copy of their cutting list. Losing
       * it would defeat the reason the brief gives for having attachments at all. Orphaned files cost
       * pennies and can be swept later against the audit log, which names every one.
       */
      await deleteDoc(doc(getDb(), path, item.id));
      await writeAudit(getDb(), {
        actor,
        action: "delete",
        collectionName: path,
        docId: item.id,
        summary: `Removed ${item.name} from the record (the file itself was kept)`,
      });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it.");
    }
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <Paperclip size={18} className="text-brass-400" /> {title}
          </h2>
          {hint && <p className="mt-1 max-w-2xl text-sm text-cream-400">{hint}</p>}
        </div>
        {canEdit && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => upload(e.target.files)}
              className="hidden"
              id={`attach-${storageFolder}`}
            />
            <Button
              variant="secondary"
              busy={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <span className="flex items-center gap-1.5">
                <Upload size={14} /> Attach a file
              </span>
            </Button>
          </>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-cream-500">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-cream-500">
          Nothing attached yet.
          {canEdit && " Photographs and PDFs, up to 10 MB each."}
        </p>
      ) : gallery ? (
        // Thumbnails, for reference images where the picture *is* the information.
        <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <figure
              key={item.id}
              className="group relative overflow-hidden rounded-2xl border border-night-700/60"
            >
              {isImage(item.contentType) ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  <span className="relative block aspect-square">
                    {/* Unoptimised: a Storage download URL carries a token the image optimiser
                        cannot be configured for per file. */}
                    <Image
                      src={item.url}
                      alt={item.name}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                      unoptimized
                    />
                  </span>
                </a>
              ) : (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex aspect-square items-center justify-center bg-night-950/60 text-cream-500"
                >
                  <FileText size={28} />
                </a>
              )}
              <figcaption className="flex items-center justify-between gap-2 bg-night-950/70 px-3 py-2">
                <span className="min-w-0 truncate text-xs text-cream-300">{item.name}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    className="shrink-0 cursor-pointer text-cream-600 transition-colors hover:text-red-300"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-night-700/60 bg-night-950/30 p-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-night-800 text-cream-400">
                {isImage(item.contentType) ? <ImageIcon size={16} /> : <FileText size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm text-cream-100 hover:text-brass-300"
                >
                  {item.name}
                </a>
                <span className="mt-0.5 block text-xs text-cream-600">
                  {readableSize(item.sizeBytes)}
                  {item.uploadedByEmail && ` · ${item.uploadedByEmail}`}
                  {item.uploadedAtMs &&
                    ` · ${new Date(item.uploadedAtMs).toLocaleDateString("en-GB")}`}
                </span>
              </span>

              {/* Printing an attached cutting list is the reason this exists: somebody at the saw
                  needs the customer's own sheet in their hand. The browser prints an image better
                  than any wrapper this could put around it, so it opens in a tab. */}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-night-600 px-2.5 py-1.5 text-xs text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
              >
                <Printer size={12} /> Open to print
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="cursor-pointer rounded-lg p-2 text-cream-600 transition-colors hover:text-red-300"
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
