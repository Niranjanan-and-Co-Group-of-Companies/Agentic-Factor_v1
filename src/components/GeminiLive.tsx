"use client";
import { useState, useRef, useCallback } from "react";

// Voice Input — floating mic button for speech-to-text via Web Speech API.
// Feeds transcript into the active input context (intake, blueprint, etc.)

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  context?: string; // "intake" | "blueprint" | "clarification"
}

export default function GeminiLive({ onTranscript, context = "intake" }: VoiceInputProps) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState<{ role: string; text: string }[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const startRecording = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setHistory((h) => [...h, { role: "system", text: "Speech recognition not supported in this browser." }]);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) {
        setTranscript((prev) => (prev + " " + final).trim());
      }
      if (interim) {
        setTranscript((prev) => prev ? prev + " " + interim : interim);
      }
    };

    recognition.onerror = () => { setRecording(false); };
    recognition.onend = () => { setRecording(false); };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setRecording(false);
    if (transcript.trim()) {
      setHistory((h) => [...h, { role: "user", text: transcript.trim() }]);
      onTranscript(transcript.trim());
      setTranscript("");
    }
  }, [transcript, onTranscript]);

  const contextLabels: Record<string, string> = {
    intake: "🎯 Mission Intake",
    blueprint: "📐 Blueprint Review",
    clarification: "💬 Clarification",
  };

  return (
    <>
      {open && (
        <div className="voice-panel">
          <div className="card-header" style={{ marginBottom: "var(--space-sm)" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>🎙️ Voice Input</span>
            <span className="badge badge-purple" style={{ fontSize: "0.6rem" }}>{contextLabels[context]}</span>
          </div>

          <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: "var(--space-md)" }}>
            {history.length === 0 && (
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center", padding: "var(--space-md)" }}>
                Tap the mic and speak your mission, edits, or answers.
              </p>
            )}
            {history.map((h, i) => (
              <div key={i} style={{ marginBottom: "var(--space-sm)", fontSize: "0.82rem" }}>
                <span style={{ color: h.role === "user" ? "var(--accent)" : "var(--emerald)", fontWeight: 600 }}>
                  {h.role === "user" ? "You" : "System"}:
                </span>{" "}
                {h.text}
              </div>
            ))}
          </div>

          {recording && (
            <div style={{ marginBottom: "var(--space-md)" }}>
              <div className="voice-wave">
                <span /><span /><span /><span /><span />
              </div>
              {transcript && (
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "var(--space-sm)", fontStyle: "italic" }}>
                  {transcript}
                </p>
              )}
            </div>
          )}

          <div className="row" style={{ justifyContent: "center" }}>
            {!recording ? (
              <button className="btn btn-primary btn-sm" onClick={startRecording}>🎙️ Start Speaking</button>
            ) : (
              <button className="btn btn-danger btn-sm" onClick={stopRecording}>⏹ Stop & Send</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); stopRecording(); }}>Close</button>
          </div>
        </div>
      )}

      <button
        className={`voice-fab ${recording ? "recording" : ""}`}
        onClick={() => { if (recording) stopRecording(); else setOpen(!open); }}
        title="Voice Input"
      >
        {recording ? "⏹" : "🎙️"}
      </button>
    </>
  );
}
