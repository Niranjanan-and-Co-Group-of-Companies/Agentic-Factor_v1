"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import UnifiedInput from "@/components/UnifiedInput";
import AgentSettings from "@/components/AgentSettings";

// ============================================================
// Types for the Blueprint Review Layer
// ============================================================
type TrustLevel = "manual" | "conditional" | "autonomous";
interface BlueprintAgent {
  id: string; role: string; agentIndex: number; capabilities: string[];
  requiresExternalData: boolean; systemPrompt: string;
  trustLevel: TrustLevel;
  tools: { name: string; type: string; requiresAuth: boolean; confidentialityLevel: string }[];
}
interface Blueprint {
  id: string; title: string; description: string; status: string;
  agents: BlueprintAgent[];
  orchestration: { pattern: string; timeoutSeconds: number; entryAgent: string; edges: { from: string; to: string; condition?: string }[] };
  validationChecklist: string[];
  expectedOutputFormat?: string;
  permissions: { type: string; service: string; scope: string; confidentialityLevel: string; granted: boolean }[];
  discoveryQuestions?: string[];
}
interface SimilarMission { pattern_summary: string; orchestration_pattern: string; agent_count: number; similarity: number; }
type Phase = "input" | "discovery" | "reviewing" | "confirmed";

const SIMILAR_MISSIONS: SimilarMission[] = [
  { pattern_summary: "AWS Cost Monitoring + Slack Alerts", orchestration_pattern: "sequential", agent_count: 2, similarity: 0.92 },
  { pattern_summary: "E-commerce Data Pipeline + Reporting", orchestration_pattern: "sequential", agent_count: 3, similarity: 0.85 },
  { pattern_summary: "Social Media Sentiment Analysis", orchestration_pattern: "parallel", agent_count: 4, similarity: 0.78 },
];

const TRUST_LABELS: Record<TrustLevel, { label: string; icon: string; desc: string }> = {
  manual: { label: "Manual", icon: "🛑", desc: "Every action requires HITL approval" },
  conditional: { label: "Conditional", icon: "💬", desc: "Agent asks before boundary decisions" },
  autonomous: { label: "Full Auto", icon: "⚡", desc: "Agent executes autonomously" },
};

// ============================================================
// Mission Creator — Omni-Channel MVP
// ============================================================
function MissionCreatorInner() {
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [discoveryQuestion, setDiscoveryQuestion] = useState("");
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [editingAgent, setEditingAgent] = useState<number | null>(null);
  const [newCheckItem, setNewCheckItem] = useState("");
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string>>({});
  const [confirmResult, setConfirmResult] = useState<Record<string, unknown> | null>(null);
  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{name: string; content: string; size: number}[]>([]);
  const searchParams = useSearchParams();

  // ── Extract text content from File objects ──
  const extractFileContent = async (file: File): Promise<string> => {
    const textExts = /\.(txt|md|csv|json|html|log|yaml|yml|toml|ini|cfg|env|xml|sql)$/i;
    if (file.type.startsWith('text/') || textExts.test(file.name)) {
      return await file.text();
    }
    // For PDF/DOCX — read as base64 and send to /api/ingest for server-side parsing
    if (file.name.endsWith('.pdf') || file.name.endsWith('.docx') || file.name.endsWith('.xlsx')) {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      try {
        const res = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            content: `__BASE64_BINARY__:${file.name}:${base64}`,
            assetType: file.name.endsWith('.pdf') ? 'pdf' : 'text',
            classification: 'resource',
            title: file.name,
            sourceUri: `file://${file.name}`,
          }),
        });
        if (res.ok) {
          return `[Binary file: ${file.name} — content indexed for RAG retrieval]`;
        }
      } catch { /* fall through */ }
      return `[Binary file: ${file.name} (${(file.size / 1024).toFixed(1)}KB) — could not extract text]`;
    }
    // Fallback: try reading as text
    try { return await file.text(); } catch { return `[File: ${file.name}]`; }
  };

  // ── Check auth state on mount ──
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAuthenticated(!!user);
    });
  }, []);

  // ── Guest→User Blueprint Migration ──
  useEffect(() => {
    if (searchParams.get("migrated") === "true") {
      const stored = localStorage.getItem("guest_blueprint");
      if (stored) {
        try {
          const bp = JSON.parse(stored) as Blueprint;
          setBlueprint(bp);
          setPhase("reviewing");
          // Do NOT remove from localStorage yet — wait until DB confirms
        } catch { /* ignore malformed */ }
      }
      // Clean the URL
      window.history.replaceState({}, "", "/");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Phase 1: Generate Blueprint (ASYNC via Inngest + Polling) ──
  const handleGenerate = async (overrideIntent?: string, overrideFiles?: File[]) => {
    const finalIntent = overrideIntent || intent;
    if (!finalIntent.trim() || finalIntent.length < 10) { setError("Describe your mission in at least 10 characters."); return; }
    setLoading(true); setError(""); setProgressMessage("Starting blueprint generation...");
    
    try {
      // Process any new files from this submission
      let filesToSend = attachedFiles;
      if (overrideFiles && overrideFiles.length > 0) {
        setProgressMessage("Extracting content from attached files...");
        const newFiles: {name: string; content: string; size: number}[] = [];
        for (const f of overrideFiles) {
          const content = await extractFileContent(f);
          newFiles.push({ name: f.name, content, size: f.size });
        }
        // Merge with existing attached files (deduplicate by name)
        const existingNames = new Set(attachedFiles.map(f => f.name));
        const merged = [...attachedFiles, ...newFiles.filter(f => !existingNames.has(f.name))];
        setAttachedFiles(merged);
        filesToSend = merged;
      }

      // Step 1: Fire the Inngest event (returns instantly)
      setProgressMessage("Starting blueprint generation...");
      console.log(`[Creator] Sending blueprint request with ${filesToSend.length} file(s):`, filesToSend.map(f => `${f.name} (${(f.content.length/1024).toFixed(1)}KB)`));
      const res = await fetch("/api/missions?action=blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: finalIntent,
          files: filesToSend.map(f => ({ name: f.name, content: f.content })),
        }),
        credentials: "include",
      });
      
      let data: any;
      try {
        const text = await res.text();
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}). Please try again.`);
      }
      
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to start blueprint generation");
      }
      
      const jobId = data.jobId;
      if (!jobId) {
        throw new Error("No job ID returned. Please try again.");
      }
      
      // Step 2: Stream status via SSE (no timeout — stays open until done)
      setProgressMessage("Analyzing your intent...");
      console.log(`[Creator] Opening SSE stream for job: ${jobId}`);
      
      await new Promise<void>((resolve, reject) => {
        const eventSource = new EventSource(`/api/missions/blueprint-status?jobId=${jobId}`, {
          // Note: EventSource doesn't support custom headers or credentials natively.
          // We use cookies (credentials: include) which EventSource sends automatically.
        });
        
        eventSource.onmessage = (event) => {
          try {
            const statusData = JSON.parse(event.data);
            
            // Update progress message
            if (statusData.step) {
              setProgressMessage(statusData.step);
            }
            
            // Handle terminal states
            if (statusData.status === 'completed') {
              console.log('[Creator] Blueprint completed via SSE');
              const agentsWithTrust = (statusData.blueprint.agents as BlueprintAgent[]).map((a: any) => ({
                ...a, trustLevel: ("conditional" as TrustLevel),
              }));
              setBlueprint({ ...statusData.blueprint, agents: agentsWithTrust });
              setPhase("reviewing");
              setProgressMessage("");
              setLoading(false);
              eventSource.close();
              resolve();
              return;
            }
            
            if (statusData.status === 'discovery') {
              console.log('[Creator] Discovery question via SSE');
              setDiscoveryQuestion(statusData.question);
              setPhase("discovery");
              setProgressMessage("");
              setLoading(false);
              eventSource.close();
              resolve();
              return;
            }
            
            if (statusData.status === 'failed') {
              eventSource.close();
              reject(new Error(statusData.error || "Blueprint generation failed."));
              return;
            }
            
            // Processing / pending — update UI
            if (statusData.status === 'processing') {
              setProgressMessage(statusData.step || "Designing agent team...");
            } else if (statusData.status === 'pending') {
              setProgressMessage("Starting blueprint generation...");
            }
          } catch (parseErr) {
            console.warn('[Creator] SSE parse error, continuing...', parseErr);
          }
        };
        
        eventSource.onerror = (err) => {
          console.warn('[Creator] SSE connection error, will retry automatically...', err);
          // EventSource auto-reconnects on error. Only reject if readyState is CLOSED (2)
          if (eventSource.readyState === EventSource.CLOSED) {
            reject(new Error("Lost connection to server. Please try again."));
          }
          // Otherwise let it auto-reconnect
        };
      });
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgressMessage("");
    }
  };
  const handleEditBlueprint = async (instruction: string) => {
    if (!blueprint || !instruction.trim()) return;
    setChatLoading(true);
    try {
      const res = await fetch("/api/missions?action=edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blueprint, instruction }),
      });
      
      let data: any;
      try {
        const text = await res.text();
        data = JSON.parse(text);
      } catch {
        throw new Error(res.status >= 500 ? "Server timed out while editing. Try a simpler instruction." : "Unexpected server response. Please try again.");
      }
      
      if (!res.ok) throw new Error(data.message || "Failed to edit blueprint");
      
      const updatedBlueprint = data.blueprint;
      const agentsWithTrust = updatedBlueprint.agents.map((a: any) => ({
        ...a, trustLevel: "conditional",
      }));
      setBlueprint({ ...updatedBlueprint, agents: agentsWithTrust });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Phase 2: Confirm Blueprint ──
  // If logged in → save directly. If guest → show auth popup.
  const handleConfirmClick = () => {
    if (isAuthenticated) {
      // Already logged in — skip popup, save directly
      persistBlueprint();
    } else {
      // Guest — store blueprint and show auth popup
      if (blueprint) {
        localStorage.setItem("guest_blueprint", JSON.stringify(blueprint));
      }
      // Guest — store blueprint, then redirect to Google login
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback?returnTo=/?migrated=true` },
      });
    }
  };

  // Save blueprint to DB (called by both logged-in and post-auth flows)
  const persistBlueprint = async () => {
    if (!blueprint) return;
    setLoading(true); setError("");
    try {
      // Format discovery answers to inject into system prompts
      let contextInjection = "";
      const hasAnswers = Object.values(questionAnswers).some(a => a.trim().length > 0);
      if (hasAnswers && blueprint.discoveryQuestions) {
        contextInjection = "\n\nMISSION CONTEXT AND USER PREFERENCES:\n";
        blueprint.discoveryQuestions.forEach((q: string, i: number) => {
          if (questionAnswers[i]?.trim()) {
            contextInjection += `- Q: ${q}\n  A: ${questionAnswers[i].trim()}\n`;
          }
        });
      }

      // Keep original IDs in the payload so the backend can map the orchestration graph.
      // The backend (intake.ts) will handle stripping the IDs before Postgres insertion to allow gen_random_uuid().
      const payloadMission = {
        ...blueprint,
        agents: blueprint.agents.map(a => ({ 
          ...a, 
          systemPrompt: a.systemPrompt + contextInjection
        }))
      };

      const res = await fetch("/api/missions?action=confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: payloadMission }),
        credentials: "include", // Send Supabase session cookies for real user ID
      });
      let data: any;
      try {
        const text = await res.text();
        data = JSON.parse(text);
      } catch {
        throw new Error(res.status >= 500 ? "Server error while confirming. Please try again." : "Unexpected response. Please try again.");
      }
      if (!res.ok) throw new Error(data.message || data.error || "Failed to confirm blueprint");

      // ✅ DB write confirmed — NOW safe to delete from localStorage
      localStorage.removeItem("guest_blueprint");

      setConfirmResult(data);
      setPhase("confirmed");
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  // Legacy alias for demo-user flow
  const handleConfirmAfterAuth = persistBlueprint;

  // ── Edit helpers ──
  const updateAgent = (idx: number, updates: Partial<BlueprintAgent>) => {
    if (!blueprint) return;
    const agents = [...blueprint.agents];
    agents[idx] = { ...agents[idx], ...updates };
    setBlueprint({ ...blueprint, agents });
  };
  const removeAgent = (idx: number) => {
    if (!blueprint) return;
    const agents = blueprint.agents.filter((_, i) => i !== idx);
    setBlueprint({ ...blueprint, agents: agents.map((a, i) => ({ ...a, agentIndex: i })) });
  };
  const addAgent = () => {
    if (!blueprint) return;
    const newAgent: BlueprintAgent = {
      id: "", 
      role: "New Agent",
      agentIndex: blueprint.agents.length,
      capabilities: ["llm_reasoning"],
      requiresExternalData: false,
      systemPrompt: "You are a new agent.",
      trustLevel: "conditional",
      tools: []
    };
    setBlueprint({ ...blueprint, agents: [...blueprint.agents, newAgent] });
  };
  const addCheckItem = () => {
    if (!blueprint || !newCheckItem.trim()) return;
    setBlueprint({ ...blueprint, validationChecklist: [...blueprint.validationChecklist, newCheckItem.trim()] });
    setNewCheckItem("");
  };
  const removeCheckItem = (idx: number) => {
    if (!blueprint) return;
    setBlueprint({ ...blueprint, validationChecklist: blueprint.validationChecklist.filter((_, i) => i !== idx) });
  };


  // ============================================================
  // RENDER: Input Phase
  // ============================================================
  if (phase === "input") {
    return (
      <>
        <div className="page-header">
          <h1 className="page-title">🎯 Mission Architect</h1>
          <p className="page-subtitle">Describe your goal — the AI will propose a strategy for your review</p>
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: "1fr 360px", alignItems: "start" }}>
          <div className="stack">
            <div className="hero-section">
              <div style={{ position: "relative", zIndex: 1 }}>
                <label className="input-label">What do you want your agent team to accomplish?</label>
                {/* ═══ UNIFIED INPUT BAR — SOLE INPUT ═══ */}
                <UnifiedInput
                  context="intake"
                  placeholder='e.g. "Scrape competitor pricing data from 5 sites, analyze trends, and email me a weekly report with charts."'
                  submitLabel={loading ? "⏳ Architecting..." : "⚡ Generate Blueprint"}
                  initialValue={intent}
                  onTextChange={(text) => setIntent(text)}
                  onSubmit={(text, files) => {
                    if (text.trim()) setIntent(text.trim());
                    handleGenerate(text.trim() || undefined, files.length > 0 ? files : undefined);
                  }}
                />
                {/* Attached file chips */}
                {attachedFiles.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "var(--space-xs)" }}>
                    {attachedFiles.map((f, i) => (
                      <span key={i} className="file-chip" style={{ fontSize: "0.75rem" }}>
                        🧠 {f.name} <span style={{ color: "var(--text-muted)" }}>({(f.size / 1024).toFixed(1)}KB)</span>
                        <span style={{ color: "var(--emerald)", fontSize: "0.65rem", marginLeft: 4 }}>✓ attached</span>
                        <button onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="row" style={{ justifyContent: "space-between", marginTop: "var(--space-sm)" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {intent.length > 0 ? `${intent.length} chars` : "Min 10 characters · Use 📎 for files · 🎙️ for voice"}
                    {attachedFiles.length > 0 && ` · ${attachedFiles.length} file(s) attached`}
                  </span>
                </div>
                {loading && (
                  <div style={{ marginTop: "var(--space-md)", display: "flex", alignItems: "center", gap: 8, color: "var(--accent)", fontSize: "0.85rem" }}>
                    <span className="animate-glow" style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", background: "var(--accent)" }} />
                    {progressMessage || "Generating blueprint with AI..."}
                  </div>
                )}
                {error && <div style={{ marginTop: "var(--space-md)", padding: "var(--space-md)", background: "var(--rose-bg)", borderRadius: "var(--radius-md)", color: "var(--rose)", fontSize: "0.85rem", lineHeight: 1.6 }}>❌ {error}</div>}
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-header">
                <span className="card-title">🧠 Similar Missions</span>
                <span className="badge badge-blue">Vector Memory</span>
              </div>
              <div className="stack" style={{ gap: "var(--space-sm)" }}>
                {SIMILAR_MISSIONS.map((m, i) => (
                  <div key={i} className="card" style={{ padding: "var(--space-md)", cursor: "pointer" }} onClick={() => setIntent(m.pattern_summary)}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{m.pattern_summary}</div>
                    <div className="row" style={{ marginTop: "var(--space-sm)" }}>
                      <span className="badge badge-purple" style={{ fontSize: "0.65rem" }}>{m.orchestration_pattern}</span>
                      <span className="badge badge-blue" style={{ fontSize: "0.65rem" }}>{m.agent_count} agents</span>
                      <span style={{ fontSize: "0.7rem", color: "var(--emerald)", marginLeft: "auto" }}>{(m.similarity * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{ borderColor: "hsla(217,91%,60%,0.2)", background: "var(--accent-subtle)" }}>
              <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                <strong style={{ color: "var(--accent)" }}>How it works:</strong><br />
                ① Describe your goal (text, voice, or files)<br />
                ② AI architects a team blueprint<br />
                ③ <strong>You review + edit</strong> agents, tools & trust levels<br />
                ④ You confirm → team is provisioned
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // RENDER: Discovery Phase Popup
  // ============================================================
  if (phase === "discovery") {
    return (
      <div className="page-header" style={{ height: "calc(100vh - 100px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card animate-slide-in" style={{ width: "100%", maxWidth: 600, padding: "var(--space-xl)", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)" }}>🤖</div>
          <h2 style={{ marginBottom: "var(--space-md)" }}>AI Architect Needs Context</h2>
          <p style={{ fontSize: "1.1rem", color: "var(--text-secondary)", marginBottom: "var(--space-xl)", lineHeight: 1.6 }}>
            {discoveryQuestion}
          </p>
          <UnifiedInput 
            context="clarification"
            placeholder="Type your answer or use voice..." 
            onSubmit={(answer) => {
              const newIntent = intent + "\n\nQ: " + discoveryQuestion + "\nA: " + answer;
              setIntent(newIntent);
              setPhase("input"); // Switch back so loading renders correctly
              handleGenerate(newIntent);
            }} 
          />
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: Blueprint Review Phase
  // ============================================================
  if (phase === "reviewing" && blueprint) {
    return (
      <>
        <div className="page-header">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h1 className="page-title">📐 Blueprint Review</h1>
              <p className="page-subtitle">Review the strategy. Edit agents, set trust levels, and attach reference files.</p>
            </div>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setPhase("input")}>← Back</button>
              <button className="btn btn-primary btn-lg" onClick={handleConfirmClick} disabled={loading}>
                {loading ? "🔒 Provisioning..." : "✓ Confirm Blueprint"}
              </button>
            </div>
          </div>
        </div>
        {error && <div style={{ marginBottom: "var(--space-lg)", padding: "var(--space-md)", background: "var(--rose-bg)", borderRadius: "var(--radius-md)", color: "var(--rose)", fontSize: "0.85rem" }}>❌ {error}</div>}

        {/* Mission Header */}
        <div className="card" style={{ marginBottom: "var(--space-lg)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{blueprint.title}</div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "var(--space-xs)" }}>{blueprint.description}</p>
            </div>
            <div className="row">
              <span className="badge badge-purple">{blueprint.orchestration.pattern}</span>
              <span className="badge badge-blue">{blueprint.agents.length} agents</span>
              <span className="badge badge-amber">{blueprint.orchestration.timeoutSeconds}s timeout</span>
            </div>
          </div>
        </div>

        <div className="grid-2" style={{ gridTemplateColumns: "1fr 380px", alignItems: "start" }}>
          <div className="stack">
            {/* Proposed Agents — Editable + Trust Level */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🤖 Proposed Agent Team</span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Set trust level for each agent</span>
              </div>
              <div className="stack" style={{ gap: "var(--space-sm)" }}>
                {blueprint.agents.map((agent, idx) => (
                  <div key={idx} className="card" style={{ padding: "var(--space-md)", borderColor: editingAgent === idx ? "var(--accent)" : undefined, boxShadow: editingAgent === idx ? "var(--shadow-glow)" : undefined }}>
                    <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => setEditingAgent(editingAgent === idx ? null : idx)}>
                      <div className="row">
                        <span style={{ fontSize: "1.3rem" }}>{["🕷️","📊","📄","🔍","🛡️","🧪"][idx] || "🤖"}</span>
                        <div>
                          <div style={{ fontWeight: 600 }}>{agent.role}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            Agent #{agent.agentIndex} · {agent.capabilities.length} caps · {TRUST_LABELS[agent.trustLevel].icon} {TRUST_LABELS[agent.trustLevel].label}
                          </div>
                        </div>
                      </div>
                      <div className="row">
                        {agent.requiresExternalData && <span className="badge badge-amber" style={{ fontSize: "0.65rem" }}>Research</span>}
                        {/* ═══ AGENT SETTINGS GEAR ═══ */}
                        <AgentSettings
                          agentRole={agent.role}
                          currentTrust={agent.trustLevel}
                          onTrustChange={(level) => updateAgent(idx, { trustLevel: level })}
                        />
                        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{editingAgent === idx ? "▾" : "▸"}</span>
                      </div>
                    </div>

                    {/* Expanded Edit View */}
                    {editingAgent === idx && (
                      <div className="animate-slide-in" style={{ marginTop: "var(--space-md)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-md)" }}>
                        {/* Trust Level Explanation */}
                        <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-sm) var(--space-md)", borderRadius: "var(--radius-sm)",
                          background: agent.trustLevel === "manual" ? "var(--amber-bg)" : agent.trustLevel === "autonomous" ? "var(--emerald-bg)" : "var(--accent-subtle)",
                          fontSize: "0.78rem" }}>
                          <strong>{TRUST_LABELS[agent.trustLevel].icon} {TRUST_LABELS[agent.trustLevel].label}:</strong>{" "}
                          {TRUST_LABELS[agent.trustLevel].desc}
                        </div>
                        <div style={{ marginBottom: "var(--space-md)" }}>
                          <label className="input-label">Role Name</label>
                          <input className="input" value={agent.role} onChange={(e) => updateAgent(idx, { role: e.target.value })} />
                        </div>
                        <div style={{ marginBottom: "var(--space-md)" }}>
                          <label className="input-label">System Prompt</label>
                          <textarea className="textarea" value={agent.systemPrompt} onChange={(e) => updateAgent(idx, { systemPrompt: e.target.value })} style={{ minHeight: "80px", fontSize: "0.82rem" }} />
                        </div>
                        <div style={{ marginBottom: "var(--space-md)" }}>
                          <label className="input-label">Capabilities (comma-separated)</label>
                          <input className="input" value={agent.capabilities.join(", ")} onChange={(e) => updateAgent(idx, { capabilities: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} />
                        </div>
                        <div className="row">
                          <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer" }}>
                            <input type="checkbox" checked={agent.requiresExternalData} onChange={(e) => updateAgent(idx, { requiresExternalData: e.target.checked })} />
                            Requires External Data / Research
                          </label>
                          <div style={{ flex: 1 }} />
                          <button className="btn btn-danger btn-sm" onClick={() => removeAgent(idx)}>✕ Remove</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div className="row" style={{ marginTop: "var(--space-sm)", justifyContent: "center" }}>
                  <button className="btn btn-ghost btn-sm" onClick={addAgent} style={{ width: "100%", borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--border)" }}>+ Add Another Agent</button>
                </div>
              </div>
            </div>

            {/* Context Files — Blueprint Stage */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">📎 Attached Context Files</span>
                <span className="badge badge-purple">{attachedFiles.length} file(s)</span>
              </div>
              {attachedFiles.length > 0 ? (
                <div className="stack" style={{ gap: "var(--space-xs)" }}>
                  {attachedFiles.map((f, i) => (
                    <div key={i} className="row" style={{ padding: "var(--space-sm)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", fontSize: "0.82rem" }}>
                      <span>🧠</span>
                      <span style={{ flex: 1, fontWeight: 500 }}>{f.name}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>({(f.size / 1024).toFixed(1)}KB)</span>
                      <span style={{ color: "var(--emerald)", fontSize: "0.65rem" }}>✓ injected into agents</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", textAlign: "center", padding: "var(--space-md)" }}>No files attached. Use 📎 in the input bar to add files.</p>
              )}
            </div>

            {/* Orchestration Graph */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🔗 Orchestration Flow</span>
                <span className="badge badge-purple">{blueprint.orchestration.pattern}</span>
              </div>
              <div className="graph-container">
                {blueprint.agents.map((agent, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
                    <div className={`graph-node ${i === 0 ? "entry" : ""}`}>
                      <div className="graph-node-role">{agent.role}</div>
                      <span style={{ fontSize: "0.7rem", color: agent.trustLevel === "autonomous" ? "var(--emerald)" : agent.trustLevel === "manual" ? "var(--amber)" : "var(--accent)" }}>
                        {TRUST_LABELS[agent.trustLevel].icon} {TRUST_LABELS[agent.trustLevel].label}
                      </span>
                    </div>
                    {i < blueprint.agents.length - 1 && <div className="graph-edge">→</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right — Validation Checklist & Permissions */}
          <div className="stack">
            {/* Phase 4.2: Blueprint Chat Editor */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">💬 Blueprint Editor</span>
                <span className="badge badge-emerald">Live</span>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "var(--space-sm)" }}>
                Want to change something? Ask the AI Architect to modify this blueprint.
              </p>
              <div style={{ position: "relative" }}>
                <UnifiedInput
                  compact
                  context="command"
                  placeholder={chatLoading ? "Modifying blueprint..." : "E.g., 'Add a Twitter agent to the end'"}
                  onSubmit={(text) => handleEditBlueprint(text)}
                />
                {chatLoading && (
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-sm)", backdropFilter: "blur(2px)", zIndex: 10 }}>
                    <div className="gemini-wave">
                      <span /><span /><span /><span /><span />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Discovery Questions */}
            {blueprint.discoveryQuestions && blueprint.discoveryQuestions.length > 0 && (
              <div className="card" style={{ borderColor: "var(--accent)" }}>
                <div className="card-header">
                  <span className="card-title">🔍 Discovery Questions</span>
                  <span className="badge badge-purple">{blueprint.discoveryQuestions.length} remaining</span>
                </div>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
                  Answer these to inject specific instructions into the agents' system prompts.
                </p>
                <div className="stack" style={{ gap: "var(--space-sm)" }}>
                  {blueprint.discoveryQuestions.map((q: string, idx: number) => (
                    <div key={idx} style={{ background: "var(--bg-glass)", padding: "var(--space-sm)", borderRadius: "var(--radius-sm)" }}>
                      <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "var(--space-xs)", color: "var(--text-bright)" }}>
                        {q}
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Your answer..."
                        value={questionAnswers[idx] || ""}
                        onChange={(e) => setQuestionAnswers({ ...questionAnswers, [idx]: e.target.value })}
                        style={{ background: "var(--bg-base)" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expected Output Format */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">📝 Expected Final Output</span>
                <span className="badge badge-emerald">Validation</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
                The final agent will strictly format its output to match this schema. Edit if needed.
              </p>
              <textarea
                className="textarea"
                style={{ minHeight: "120px", fontSize: "0.82rem", fontFamily: "monospace", width: "100%", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "var(--space-sm)", color: "var(--text-bright)" }}
                value={blueprint.expectedOutputFormat || ""}
                onChange={(e) => setBlueprint({ ...blueprint, expectedOutputFormat: e.target.value })}
                placeholder="e.g. { 'status': 'success', 'data': [...] }"
              />
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">✅ Validation Checklist</span>
                <span className="badge badge-green">{blueprint.validationChecklist.length} checks</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>The Validation Agent will verify these before HITL approval.</p>
              <div className="stack" style={{ gap: "var(--space-xs)" }}>
                {blueprint.validationChecklist.map((item, idx) => (
                  <div key={idx} className="row" style={{ padding: "var(--space-sm)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", fontSize: "0.82rem" }}>
                    <span style={{ color: "var(--emerald)" }}>☐</span>
                    <span style={{ flex: 1 }}>{item}</span>
                    <button onClick={() => removeCheckItem(idx)} style={{ background: "none", border: "none", color: "var(--rose)", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: "var(--space-md)" }}>
                <input className="input" value={newCheckItem} onChange={(e) => setNewCheckItem(e.target.value)} placeholder="Add a validation check..." style={{ fontSize: "0.82rem" }} onKeyDown={(e) => e.key === "Enter" && addCheckItem()} />
                <button className="btn btn-ghost btn-sm" onClick={addCheckItem}>+ Add</button>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">🔐 Required Permissions</span>
                <span className="badge badge-amber">{blueprint.permissions.filter(p => p.confidentialityLevel !== "internal" && p.confidentialityLevel !== "public").length}</span>
              </div>
              <div className="stack" style={{ gap: "var(--space-xs)" }}>
                {blueprint.permissions.filter(p => p.confidentialityLevel !== "internal" && p.confidentialityLevel !== "public").map((perm, idx) => (
                  <div key={idx} className="row" style={{ padding: "var(--space-sm)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", fontSize: "0.82rem" }}>
                    <span title={perm.type === "oauth_token" ? "OAuth" : "API Key"}>{perm.type === "oauth_token" ? "🔗" : "🔑"}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>{perm.service}</span>
                      <span style={{ color: "var(--text-muted)" }}> · {perm.scope}</span>
                    </div>
                    <span className="badge" style={{ fontSize: "0.6rem", background: "var(--bg-glass)", color: "var(--text-muted)" }}>
                      {perm.type === "oauth_token" ? "OAuth" : "API Key"}
                    </span>
                  </div>
                ))}
                {blueprint.permissions.filter(p => p.confidentialityLevel !== "internal" && p.confidentialityLevel !== "public").length === 0 && (
                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", textAlign: "center", padding: "var(--space-md)" }}>No external credentials required</p>
                )}
              </div>
            </div>

            {/* Trust Level Legend */}
            <div className="card" style={{ background: "var(--bg-glass)" }}>
              <div className="card-title" style={{ marginBottom: "var(--space-sm)", fontSize: "0.85rem" }}>🎛️ Trust Levels</div>
              {(["manual", "conditional", "autonomous"] as TrustLevel[]).map((level) => (
                <div key={level} className="row" style={{ padding: "var(--space-xs) 0", fontSize: "0.78rem" }}>
                  <span>{TRUST_LABELS[level].icon}</span>
                  <span style={{ fontWeight: 600, minWidth: 85 }}>{TRUST_LABELS[level].label}</span>
                  <span style={{ color: "var(--text-muted)" }}>{TRUST_LABELS[level].desc}</span>
                </div>
              ))}
            </div>

            <div className="card" style={{ background: "var(--accent-subtle)", borderColor: "hsla(217,91%,60%,0.2)" }}>
              <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                <strong style={{ color: "var(--accent)" }}>⚠ Lazy Execution:</strong> No database rows or agent processes are created until you click <strong>Confirm Blueprint</strong>. This is a preview only.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // RENDER: Confirmed Phase
  // ============================================================
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">✅ Blueprint Saved</h1>
        <p className="page-subtitle">Your mission blueprint has been saved. Open your mission and click <strong>Start Mission</strong> to begin execution.</p>
      </div>
      <div className="card animate-slide-in" style={{ maxWidth: 700, margin: "0 auto", textAlign: "center", padding: "var(--space-2xl)" }}>
        <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)" }}>📋</div>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>{blueprint?.title}</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-xl)" }}>{blueprint?.agents.length} agents ready · Pattern: {blueprint?.orchestration.pattern}</p>
        <div className="grid-3" style={{ marginBottom: "var(--space-xl)" }}>
          <div className="stat-card"><div className="stat-value" style={{ color: "var(--emerald)", fontSize: "1.5rem" }}>{blueprint?.agents.length ?? 0}</div><div className="stat-label">Agents</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: "var(--accent)", fontSize: "1.5rem" }}>{blueprint?.orchestration.pattern ?? '—'}</div><div className="stat-label">Pattern</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: "var(--amber)", fontSize: "1.5rem" }}>Draft</div><div className="stat-label">Status</div></div>
        </div>
        {/* Trust level summary */}
        {blueprint && (
          <div className="row" style={{ justifyContent: "center", marginBottom: "var(--space-lg)" }}>
            {(["manual", "conditional", "autonomous"] as TrustLevel[]).map((level) => {
              const count = blueprint.agents.filter(a => a.trustLevel === level).length;
              if (count === 0) return null;
              return <span key={level} className={`badge ${level === "manual" ? "badge-amber" : level === "autonomous" ? "badge-green" : "badge-blue"}`}>{TRUST_LABELS[level].icon} {count} {TRUST_LABELS[level].label}</span>;
            })}
          </div>
        )}
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn btn-ghost" onClick={() => { setPhase("input"); setBlueprint(null); setConfirmResult(null); }}>+ New Mission</button>
          {confirmResult?.missionId ? (
            <a href={`/dashboard/missions/${confirmResult.missionId as string}`} className="btn btn-primary">▶ Start Mission</a>
          ) : (
            <a href="/dashboard" className="btn btn-primary">📊 View Dashboard</a>
          )}
        </div>
      </div>
    </>
  );
}

// ── Suspense wrapper required for useSearchParams() in Next.js 16 ──
export default function MissionCreator() {
  return (
    <Suspense fallback={<div style={{ padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)" }}>Loading Mission Architect...</div>}>
      <MissionCreatorInner />
    </Suspense>
  );
}
