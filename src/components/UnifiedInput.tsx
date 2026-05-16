"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ============================================================
// Unified Input Console
// A single bar combining: Text Input + File Upload + Voice (Gemini)
// Text area auto-expands for long prompts.
// ============================================================

interface UnifiedInputProps {
  onSubmit: (text: string, files: File[]) => void;
  placeholder?: string;
  context?: "intake" | "clarification" | "command";
  compact?: boolean;
  submitLabel?: string;
  agentRole?: string;
  agentId?: string;
  initialValue?: string;
  /** Called whenever the text value changes (for parent state sync) */
  onTextChange?: (text: string) => void;
}

export default function UnifiedInput({
  onSubmit,
  placeholder = "Type a message...",
  context = "intake",
  compact = false,
  submitLabel,
  agentRole,
  initialValue = "",
  onTextChange,
}: UnifiedInputProps) {
  const [text, setText] = useState(initialValue);
  const [files, setFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // ── Auto-resize textarea ──
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      const minH = compact ? 34 : 42;
      ta.style.height = `${Math.max(minH, ta.scrollHeight)}px`;
    }
  }, [text, compact]);

  // ── Sync external initial value changes ──
  useEffect(() => {
    if (initialValue && initialValue !== text) {
      setText(initialValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  const updateText = (newText: string) => {
    setText(newText);
    onTextChange?.(newText);
  };

  // ── Voice ──
  const toggleVoice = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: SpeechRecognitionEvent) => {
      let fin = "", tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else tmp += t;
      }
      if (fin) {
        setText(prev => {
          const newText = (prev + " " + fin).trim();
          setTimeout(() => onTextChange?.(newText), 0);
          return newText;
        });
      }
      setInterim(tmp);
    };
    r.onend = () => { setRecording(false); setInterim(""); };
    r.onerror = () => { setRecording(false); setInterim(""); };
    recognitionRef.current = r;
    r.start();
    setRecording(true);
  }, [recording, text, onTextChange]);

  // ── File ──
  const handleFiles = (fl: FileList) => {
    setFiles((prev) => [...prev, ...Array.from(fl).slice(0, 5 - prev.length)]);
  };
  const removeFile = (idx: number) => setFiles((f) => f.filter((_, i) => i !== idx));

  // ── Submit ──
  const handleSubmit = () => {
    if (!text.trim() && files.length === 0) return;
    onSubmit(text.trim(), files);
    setText("");
    setFiles([]);
    if (recording) { recognitionRef.current?.stop(); setRecording(false); }
  };

  const label = submitLabel || (context === "command" ? (compact ? "➤" : `Send to ${agentRole || "Agent"}`) : context === "clarification" ? "↵ Answer" : "⚡ Generate Blueprint");

  return (
    <div className="unified-bar-wrap">
      {/* File Chips */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "var(--space-xs)" }}>
          {files.map((f, i) => (
            <span key={i} className="file-chip">
              📄 {f.name.length > 20 ? f.name.slice(0, 18) + "…" : f.name}
              <button onClick={() => removeFile(i)}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Input Row */}
      <div className={`unified-bar ${compact ? "compact" : ""} ${recording ? "recording" : ""}`}>
        {/* File trigger */}
        <button className="ub-icon-btn" title="Attach file" onClick={() => fileRef.current?.click()}>
          📎
        </button>
        <input ref={fileRef} type="file" multiple accept=".pdf,.csv,.json,.txt,.md,.xlsx,.docx,.png,.jpg"
          style={{ display: "none" }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />

        {/* Expanding text area */}
        <textarea
          ref={textareaRef}
          className="ub-text"
          value={recording && interim ? (text ? `${text} ${interim}` : interim) : text}
          onChange={(e) => updateText(e.target.value)}
          placeholder={recording ? "Listening…" : placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          rows={1}
        />

        {/* Voice trigger */}
        <button
          className={`ub-icon-btn ${recording ? "ub-rec" : ""}`}
          title={recording ? "Stop recording" : "Voice input (Gemini Live)"}
          onClick={toggleVoice}
        >
          {recording ? "⏹" : "🎙️"}
        </button>

        {/* Submit */}
        <button
          className="ub-submit"
          onClick={handleSubmit}
          disabled={!text.trim() && files.length === 0}
        >
          {label}
        </button>
      </div>

      {/* Recording indicator */}
      {recording && (
        <div className="gemini-wave" style={{ marginTop: "var(--space-xs)" }}>
          <span /><span /><span /><span /><span />
        </div>
      )}
    </div>
  );
}
