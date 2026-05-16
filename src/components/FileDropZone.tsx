"use client";
import { useState, useRef, useCallback } from "react";

// ============================================================
// Universal File Drop Zone
// Drag-and-drop + click-to-upload. Files are extracted, then
// sent to /api/ingest for real pgvector embedding & indexing.
// ============================================================

interface FileDropZoneProps {
  onFilesAdded: (files: UploadedFile[]) => void;
  missionId?: string;
  context?: "intake" | "blueprint" | "feed";
  accept?: string;
  maxFiles?: number;
  compact?: boolean;
  classification?: "resource" | "boundary";
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "uploading" | "processing" | "indexed" | "failed";
  vectorized: boolean;
  error?: string;
}

export default function FileDropZone({
  onFilesAdded,
  missionId,
  context = "intake",
  accept = ".pdf,.csv,.json,.txt,.md,.xlsx,.docx,.png,.jpg",
  maxFiles = 10,
  compact = false,
  classification = "resource",
}: FileDropZoneProps) {
  const [dragover, setDragover] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateFile = (id: string, updates: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const extractTextFromFile = async (file: File): Promise<string> => {
    const textTypes = [
      "text/plain", "text/markdown", "text/csv", "text/html",
      "application/json", "text/x-markdown",
    ];

    if (textTypes.includes(file.type) || file.name.match(/\.(txt|md|csv|json|html|log|yaml|yml|toml|ini|cfg|conf|env)$/i)) {
      return await file.text();
    }

    // For PDF and DOCX, send base64 to server for extraction
    if (file.type === "application/pdf" || file.name.endsWith(".pdf") || file.name.match(/\.(docx|xlsx)$/i)) {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      return `__BASE64_BINARY__:${file.name}:${base64}`;
    }

    if (file.type.startsWith("image/")) {
      return `[Image file: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) — image content will be processed by vision model]`;
    }

    // Fallback: try reading as text
    try {
      return await file.text();
    } catch {
      return `[Binary file: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`;
    }
  };

  const processFiles = useCallback(
    async (fileList: FileList) => {
      const newFiles: UploadedFile[] = Array.from(fileList)
        .slice(0, maxFiles - files.length)
        .map((f) => ({
          id: crypto.randomUUID(),
          name: f.name,
          size: f.size,
          type: f.type,
          status: "uploading" as const,
          vectorized: false,
        }));

      setFiles((prev) => [...prev, ...newFiles]);

      const rawFiles = Array.from(fileList).slice(0, maxFiles - files.length);

      // Process each file: extract text → call /api/ingest
      const indexedFiles: UploadedFile[] = [];

      for (let i = 0; i < rawFiles.length; i++) {
        const file = rawFiles[i];
        const fileEntry = newFiles[i];

        try {
          // 1. Extract text content
          updateFile(fileEntry.id, { status: "processing" });
          const content = await extractTextFromFile(file);

          if (!content || content.length < 5) {
            updateFile(fileEntry.id, { status: "failed", error: "No content extracted" });
            continue;
          }

          // 2. Send to /api/ingest for embedding + indexing
          const res = await fetch("/api/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              content,
              missionId: missionId || null,
              assetType: file.type.startsWith("image/") ? "image" : "text",
              classification,
              title: file.name,
              sourceUri: `file://${file.name}`,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const indexed = { ...fileEntry, status: "indexed" as const, vectorized: true };
            updateFile(fileEntry.id, { status: "indexed", vectorized: true });
            indexedFiles.push(indexed);
            console.log(`[FileDropZone] ${file.name}: ${data.chunksGenerated} chunks embedded`);
          } else {
            const err = await res.json().catch(() => ({ error: "Unknown error" }));
            updateFile(fileEntry.id, { status: "failed", error: err.error || err.message });
          }
        } catch (err) {
          updateFile(fileEntry.id, { status: "failed", error: (err as Error).message });
        }
      }

      if (indexedFiles.length > 0) {
        onFilesAdded(indexedFiles);
      }
    },
    [files.length, maxFiles, missionId, classification, onFilesAdded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragover(false);
      if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const contextLabels = { intake: "mission context", blueprint: "blueprint reference", feed: "agent data" };
  const formatSize = (b: number) => (b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`);

  const statusIcons: Record<string, string> = {
    uploading: "⏳",
    processing: "🔄",
    indexed: "🧠",
    failed: "❌",
  };

  return (
    <div>
      <div
        className={`drop-zone ${dragover ? "dragover" : ""}`}
        style={compact ? { padding: "var(--space-md)" } : undefined}
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept={accept} multiple style={{ display: "none" }}
          onChange={(e) => e.target.files && processFiles(e.target.files)} />
        {!compact && <div className="drop-icon">📎</div>}
        <div className="drop-text">
          {compact ? (
            <>📎 <strong>Drop files</strong> or click · Embedded into pgvector</>
          ) : (
            <>Drop files here or <strong>click to upload</strong><br />
            Files are embedded with OpenAI and indexed as {contextLabels[context]}<br />
            <span style={{ fontSize: "0.72rem" }}>{accept.replace(/\./g, "").toUpperCase()} · Max {maxFiles} files</span></>
          )}
        </div>
      </div>

      {/* File chips */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
          {files.map((f) => (
            <div key={f.id} className="file-chip" style={f.status === "failed" ? { borderColor: "var(--rose)" } : undefined}>
              {statusIcons[f.status] || "📄"}
              <span>{f.name}</span>
              <span style={{ color: "var(--text-muted)" }}>({formatSize(f.size)})</span>
              {f.status === "indexed" && <span style={{ color: "var(--emerald)", fontSize: "0.65rem" }}>✓ embedded</span>}
              {f.status === "processing" && <span style={{ color: "var(--accent)", fontSize: "0.65rem" }}>embedding...</span>}
              {f.status === "failed" && <span style={{ color: "var(--rose)", fontSize: "0.65rem" }} title={f.error}>✕ failed</span>}
              <button onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
