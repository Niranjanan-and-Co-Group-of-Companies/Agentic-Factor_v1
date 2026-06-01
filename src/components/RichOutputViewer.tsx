"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

// ============================================================
// RichOutputViewer — Smart output renderer for mission results
//
// Detects content types and renders them appropriately:
//   - _artifacts with image/* → inline images with lightbox
//   - _artifacts with application/pdf → embed + download
//   - _artifacts with text/csv, xlsx → download button
//   - Arrays of objects → HTML tables
//   - Markdown strings → formatted markdown
//   - URLs → clickable links
//   - Plain text → formatted text blocks
// ============================================================

interface Artifact {
  filename: string;
  url: string;
  contentType: string;
}

// ── Artifact type detection ──
const isImage = (ct: string) => ct.startsWith("image/");
const isPDF = (ct: string) => ct === "application/pdf";
const isVideo = (ct: string) => ct.startsWith("video/");
const isSpreadsheet = (ct: string) =>
  ct === "text/csv" ||
  ct.includes("spreadsheet") ||
  ct.includes("excel");
const isDocument = (ct: string) =>
  ct.includes("document") ||
  ct.includes("presentation") ||
  ct === "text/markdown" ||
  ct === "text/plain";

// ── Artifact icon ──
const artifactIcon = (ct: string) => {
  if (isImage(ct)) return "🖼️";
  if (isPDF(ct)) return "📄";
  if (isVideo(ct)) return "🎬";
  if (isSpreadsheet(ct)) return "📊";
  if (isDocument(ct)) return "📝";
  return "📎";
};

// ── Detect if a string is markdown-like ──
function isMarkdownString(str: string): boolean {
  if (str.length < 30) return false;
  const mdPatterns = [
    /^#{1,6}\s/m,       // Headers
    /\*\*[^*]+\*\*/,    // Bold
    /\n-\s/,            // Unordered lists
    /\n\d+\.\s/,        // Ordered lists
    /\n>\s/,            // Blockquotes
    /```/,              // Code blocks
    /\|.*\|.*\|/,       // Tables
    /\[.*\]\(.*\)/,     // Links
  ];
  return mdPatterns.filter((p) => p.test(str)).length >= 2;
}

// ── Detect if an array looks like tabular data ──
function isTabularArray(arr: any[]): boolean {
  if (arr.length < 1 || arr.length > 200) return false;
  if (typeof arr[0] !== "object" || arr[0] === null || Array.isArray(arr[0])) return false;
  const keys = Object.keys(arr[0]);
  if (keys.length < 2 || keys.length > 20) return false;
  // Check at least 80% of items have the same keys
  const matchCount = arr.filter(
    (item) => typeof item === "object" && item !== null && Object.keys(item).length >= keys.length * 0.5
  ).length;
  return matchCount >= arr.length * 0.8;
}

// ── Detect URL strings ──
function isUrl(str: string): boolean {
  return /^https?:\/\/[^\s]+$/.test(str.trim());
}

function isYouTube(url: string): boolean {
  return /youtube\.com\/watch|youtu\.be\//.test(url);
}

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ============================================================
// Artifact Gallery Component
// ============================================================
function ArtifactGallery({ artifacts }: { artifacts: Artifact[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  const images = artifacts.filter((a) => isImage(a.contentType));
  const pdfs = artifacts.filter((a) => isPDF(a.contentType));
  const videos = artifacts.filter((a) => isVideo(a.contentType));
  const spreadsheets = artifacts.filter((a) => isSpreadsheet(a.contentType));
  const documents = artifacts.filter((a) => isDocument(a.contentType));
  const others = artifacts.filter(
    (a) => !isImage(a.contentType) && !isPDF(a.contentType) && !isVideo(a.contentType) && !isSpreadsheet(a.contentType) && !isDocument(a.contentType)
  );

  return (
    <div style={{ marginBottom: "var(--space-lg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-md)" }}>
        <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)" }}>📎 Attachments</span>
        <span className="badge badge-blue">{artifacts.length} file{artifacts.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Image Gallery */}
      {images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
          {images.map((img, i) => (
            <div
              key={i}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                cursor: "pointer",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
              onClick={() => setLightbox(img.url)}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = "0 4px 20px hsla(var(--accent-hsl), 0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <img
                src={img.url}
                alt={img.filename}
                style={{ width: "100%", height: "180px", objectFit: "cover", display: "block" }}
                loading="lazy"
              />
              <div style={{ padding: "8px 12px", fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🖼️ {img.filename}</span>
                <a href={img.url} download={img.filename} onClick={(e) => e.stopPropagation()} style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.7rem" }}>⬇</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video Players */}
      {videos.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
          {videos.map((vid, i) => (
            <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <video controls style={{ width: "100%", maxHeight: 400 }} preload="metadata">
                <source src={vid.url} type={vid.contentType} />
              </video>
              <div style={{ padding: "8px 12px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                🎬 {vid.filename}
                <a href={vid.url} download={vid.filename} style={{ marginLeft: 12, color: "var(--accent)", textDecoration: "none" }}>⬇ Download</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PDF Viewers */}
      {pdfs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
          {pdfs.map((pdf, i) => (
            <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <iframe
                src={`${pdf.url}#toolbar=1&navpanes=0`}
                style={{ width: "100%", height: "500px", border: "none" }}
                title={pdf.filename}
              />
              <div style={{ padding: "8px 12px", fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                <span>📄 {pdf.filename}</span>
                <a href={pdf.url} download={pdf.filename} style={{ color: "var(--accent)", textDecoration: "none" }}>⬇ Download PDF</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File Download Buttons (spreadsheets, documents, others) */}
      {[...spreadsheets, ...documents, ...others].length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
          {[...spreadsheets, ...documents, ...others].map((file, i) => (
            <a
              key={i}
              href={file.url}
              download={file.filename}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text)",
                textDecoration: "none",
                fontSize: "0.8rem",
                fontWeight: 500,
                transition: "background 0.2s, border-color 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "hsla(var(--accent-hsl), 0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-card)"; }}
            >
              {artifactIcon(file.contentType)} {file.filename}
              <span style={{ color: "var(--accent)", fontSize: "0.75rem" }}>⬇</span>
            </a>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.85)", zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "zoom-out",
          }}
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Full size"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "var(--radius-md)", boxShadow: "0 0 40px rgba(0,0,0,0.5)" }}
          />
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: "absolute", top: 20, right: 20,
              background: "rgba(255,255,255,0.15)", border: "none",
              color: "#fff", fontSize: "1.5rem", cursor: "pointer",
              width: 40, height: 40, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >×</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Table Renderer for arrays of objects
// ============================================================
function DataTable({ data }: { data: any[] }) {
  const keys = Object.keys(data[0]);
  return (
    <div style={{ overflowX: "auto", marginBottom: "var(--space-md)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr style={{ background: "var(--bg-card)" }}>
            {keys.map((k) => (
              <th
                key={k}
                style={{
                  padding: "10px 14px",
                  textAlign: "left",
                  fontWeight: 600,
                  color: "var(--accent)",
                  textTransform: "capitalize",
                  borderBottom: "2px solid var(--border)",
                  whiteSpace: "nowrap",
                }}
              >
                {k.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              style={{
                background: i % 2 === 0 ? "transparent" : "var(--bg-glass)",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "hsla(var(--accent-hsl), 0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--bg-glass)"; }}
            >
              {keys.map((k) => (
                <td
                  key={k}
                  style={{
                    padding: "8px 14px",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                    maxWidth: 300,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {typeof row[k] === "string" && isUrl(row[k]) ? (
                    <a href={row[k]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                      {row[k].length > 50 ? row[k].substring(0, 50) + "..." : row[k]}
                    </a>
                  ) : typeof row[k] === "object" ? (
                    <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                      {JSON.stringify(row[k]).substring(0, 80)}
                    </span>
                  ) : (
                    String(row[k] ?? "—")
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Smart Value Renderer — recursively renders any value type
// ============================================================
function SmartValue({ value, keyName }: { value: any; keyName?: string }) {
  if (value === null || value === undefined) {
    return <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>;
  }

  // String handling
  if (typeof value === "string") {
    // YouTube embed
    if (isYouTube(value)) {
      const videoId = getYouTubeId(value);
      if (videoId) {
        return (
          <div style={{ marginTop: 4 }}>
            <iframe
              src={`https://www.youtube.com/embed/${videoId}`}
              style={{ width: "100%", maxWidth: 560, height: 315, border: "none", borderRadius: "var(--radius-md)" }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="YouTube video"
            />
          </div>
        );
      }
    }

    // URL
    if (isUrl(value)) {
      return (
        <a href={value} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline", wordBreak: "break-all" }}>
          {value.length > 80 ? value.substring(0, 80) + "..." : value}
        </a>
      );
    }

    // Markdown
    if (isMarkdownString(value)) {
      return (
        <div
          style={{
            background: "var(--bg-card)",
            padding: "var(--space-md)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            fontSize: "0.88rem",
            lineHeight: 1.7,
            color: "var(--text)",
          }}
          className="markdown-output"
        >
          <ReactMarkdown>{value}</ReactMarkdown>
        </div>
      );
    }

    // Long text
    if (value.length > 120) {
      return (
        <div style={{
          whiteSpace: "pre-wrap",
          fontSize: "0.88rem",
          lineHeight: 1.7,
          color: "var(--text)",
          background: "var(--bg-card)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
        }}>
          {value}
        </div>
      );
    }

    // Short text
    return <span style={{ color: "var(--emerald)" }}>{value}</span>;
  }

  // Boolean
  if (typeof value === "boolean") {
    return <span style={{ color: value ? "var(--emerald)" : "var(--rose)" }}>{value ? "✅ Yes" : "❌ No"}</span>;
  }

  // Number
  if (typeof value === "number") {
    return <span style={{ color: "var(--amber)", fontFamily: "monospace" }}>{value.toLocaleString()}</span>;
  }

  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Empty list</span>;
    }

    // Tabular array → render as table
    if (isTabularArray(value)) {
      return <DataTable data={value} />;
    }

    // Simple array (strings/numbers)
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {value.map((v, i) => (
            <span
              key={i}
              style={{
                background: "var(--bg-glass)",
                border: "1px solid var(--border)",
                padding: "4px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.8rem",
                color: "var(--text)",
              }}
            >
              {typeof v === "string" && isUrl(v) ? (
                <a href={v} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>{v}</a>
              ) : String(v)}
            </span>
          ))}
        </div>
      );
    }

    // Complex array → render each item
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: 4 }}>
        {value.map((item, i) => (
          <div
            key={i}
            style={{
              background: "var(--bg-glass)",
              padding: "var(--space-sm) var(--space-md)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              borderLeft: "3px solid var(--accent)",
            }}
          >
            <SmartValue value={item} />
          </div>
        ))}
      </div>
    );
  }

  // Object
  if (typeof value === "object") {
    return <SmartObject data={value} />;
  }

  return <span>{String(value)}</span>;
}

// ============================================================
// Smart Object Renderer — key-value pairs with smart values
// ============================================================
function SmartObject({ data }: { data: Record<string, any> }) {
  // Filter out _artifacts (rendered separately)
  const entries = Object.entries(data).filter(([key]) => key !== "_artifacts");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {entries.map(([key, value]) => {
        const isComplex = typeof value === "object" && value !== null;
        const isLong = typeof value === "string" && (value.length > 120 || isMarkdownString(value));

        return (
          <div key={key}>
            <div style={{
              fontSize: "0.78rem",
              fontWeight: 600,
              color: isComplex || isLong ? "var(--accent)" : "var(--text-muted)",
              textTransform: "capitalize",
              marginBottom: isComplex || isLong ? "var(--space-xs)" : 0,
              display: isComplex || isLong ? "block" : "inline",
              marginRight: isComplex || isLong ? 0 : 8,
            }}>
              {key.replace(/_/g, " ")}:
            </div>
            <div style={{
              display: isComplex || isLong ? "block" : "inline",
            }}>
              <SmartValue value={value} keyName={key} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Export Toolbar
// ============================================================
function ExportToolbar({ output, artifacts }: { output: string; artifacts: Artifact[] }) {
  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(output).then(() => {
      alert("Copied to clipboard!");
    });
  };

  const handleDownloadJSON = () => {
    const blob = new Blob([output], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mission-output.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    // Download all artifacts
    artifacts.forEach((artifact) => {
      const a = document.createElement("a");
      a.href = artifact.url;
      a.download = artifact.filename;
      a.target = "_blank";
      a.click();
    });
  };

  return (
    <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={handleCopyMarkdown}
        style={{ fontSize: "0.75rem", padding: "4px 10px" }}
      >
        📋 Copy Raw
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={handleDownloadJSON}
        style={{ fontSize: "0.75rem", padding: "4px 10px" }}
      >
        💾 Download JSON
      </button>
      {artifacts.length > 0 && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleDownloadAll}
          style={{ fontSize: "0.75rem", padding: "4px 10px" }}
        >
          📦 Download All Files ({artifacts.length})
        </button>
      )}
    </div>
  );
}

// ============================================================
// MAIN: RichOutputViewer
// ============================================================
export default function RichOutputViewer({ output }: { output: string }) {
  let parsed: any = null;
  let artifacts: Artifact[] = [];
  let isJSON = false;

  try {
    parsed = JSON.parse(output);
    isJSON = typeof parsed === "object" && parsed !== null;
    if (isJSON && parsed._artifacts) {
      artifacts = parsed._artifacts;
    }
  } catch {
    // Not JSON — render as text/markdown
  }

  // ── Non-JSON output (plain text or markdown) ──
  if (!isJSON) {
    return (
      <div>
        <ExportToolbar output={output} artifacts={[]} />
        <div style={{ marginTop: "var(--space-md)" }}>
          {isMarkdownString(output) ? (
            <div className="markdown-output" style={{
              background: "var(--bg-card)",
              padding: "var(--space-lg)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              fontSize: "0.9rem",
              lineHeight: 1.8,
              color: "var(--text)",
            }}>
              <ReactMarkdown>{output}</ReactMarkdown>
            </div>
          ) : (
            <div style={{
              background: "var(--bg-card)",
              padding: "var(--space-lg)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              fontSize: "0.88rem",
              whiteSpace: "pre-wrap",
              lineHeight: 1.7,
              color: "var(--emerald)",
            }}>
              {output}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── JSON output — smart rendering ──
  return (
    <div>
      <ExportToolbar output={output} artifacts={artifacts} />

      {/* Artifact Gallery (images, PDFs, videos, files) */}
      {artifacts.length > 0 && (
        <div style={{ marginTop: "var(--space-md)" }}>
          <ArtifactGallery artifacts={artifacts} />
        </div>
      )}

      {/* Smart Data Rendering */}
      <div style={{ marginTop: "var(--space-md)" }}>
        <SmartObject data={parsed} />
      </div>
    </div>
  );
}
