"use client";
import { useState, useEffect, useRef } from "react";
import UnifiedInput from "@/components/UnifiedInput";
import AgentSettings from "@/components/AgentSettings";
import FileDropZone from "@/components/FileDropZone";
import RichOutputViewer from "@/components/RichOutputViewer";
import { createBrowserClient } from "@supabase/ssr";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuthPopup } from "@/components/providers/AuthProvider";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentNode { id: string; role: string; status: string; index: number; successScore: number | null; trustLevel: string; }
interface ClarificationItem { id: string; agentRole: string; question: string; context: string; category: string; priority: string; missionTitle: string; }
interface TimelineEntry { version: number; status: string; timestamp: string; label: string; active: boolean; }
interface EventEntry { icon: string; text: string; time: string; color: string; }
interface ChatMessage { role: "user" | "assistant"; text: string; }

const TRUST_ICONS: Record<string, string> = { manual: "🛑", conditional: "💬", auto: "⚡" };
const catIcons: Record<string, string> = { ambiguity: "❓", boundary: "🚧", missing_data: "📋", permission: "🔐", confirmation: "✅" };
const priorityBadges: Record<string, string> = { blocking: "badge-red", high: "badge-amber", medium: "badge-blue", low: "badge-green" };

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// RenderNode and renderFinalOutput replaced by RichOutputViewer component



export default function MissionDetailPage() {
  const { id: missionId } = useParams() as { id: string };
  const [loading, setLoading] = useState(true);
  const [mission, setMission] = useState<any>(null);
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [clarifications, setClarifications] = useState<ClarificationItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [finalOutput, setFinalOutput] = useState<string | null>(null);

  const [commandAgent, setCommandAgent] = useState<number | null>(null);
  const [agentTrust, setAgentTrust] = useState<Record<number, string>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{ role: "assistant", text: "Hi! I'm the Mission Assistant. Ask me anything about this active mission." }]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatLoading]);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [isStarting, setIsStarting] = useState(false);
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [feedback, setFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [connectorRequest, setConnectorRequest] = useState("");
  const [connectorSending, setConnectorSending] = useState(false);
  const [connectorToast, setConnectorToast] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Phase 5: Awaiting Input state
  const [pendingQuestion, setPendingQuestion] = useState<{ question: string; options: string[]; agentRole: string; agentId: string } | null>(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [resumeLoading, setResumeLoading] = useState(false);
  
  // Email inbox state
  const [emailConfig, setEmailConfig] = useState<{ inboundEmail: string | null; allowedSenders: string[]; maxSenders: number; plan: string; available: boolean } | null>(null);
  const [newSenderEmail, setNewSenderEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  
  const { triggerAuth } = useAuthPopup();

  // Schedule & Run History state
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'preset' | 'custom'>('preset');
  const [schedulePreset, setSchedulePreset] = useState('daily_9am');
  const [customDay, setCustomDay] = useState('everyday');
  const [customTime, setCustomTime] = useState('09:00');
  const [endCondition, setEndCondition] = useState<'forever' | 'max_runs' | 'end_date'>('forever');
  const [maxRuns, setMaxRuns] = useState(5);
  const [endDate, setEndDate] = useState('');
  const [runHistory, setRunHistory] = useState<Array<{event_type: string; payload: any; created_at: string}>>([]);
  const [isScheduled, setIsScheduled] = useState(false);

  const handleRequestConnector = async () => {
    if (!connectorRequest.trim()) return;
    setConnectorSending(true);
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      await fetch('/api/request-connector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectorId: connectorRequest.toLowerCase().replace(/\s+/g, '_'),
          connectorLabel: connectorRequest,
          userEmail: user?.email || '',
        }),
      });
      setConnectorToast('✅ Request sent! We\'ll notify you when it\'s ready.');
      setConnectorRequest('');
      setShowConnectorModal(false);
      setTimeout(() => setConnectorToast(null), 5000);
    } catch {
      setConnectorToast('❌ Failed to send request. Try again.');
      setTimeout(() => setConnectorToast(null), 4000);
    } finally {
      setConnectorSending(false);
    }
  };

  const handleAddSender = async () => {
    if (!newSenderEmail.trim() || !emailConfig) return;
    const updated = [...(emailConfig.allowedSenders || []), newSenderEmail.trim().toLowerCase()];
    if (updated.length > emailConfig.maxSenders) {
      alert(`Your ${emailConfig.plan} plan allows max ${emailConfig.maxSenders} sender(s) per mission.`);
      return;
    }
    setEmailSaving(true);
    try {
      const res = await fetch("/api/email/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId, allowedSenders: updated }),
      });
      if (res.ok) {
        const data = await res.json();
        setEmailConfig(prev => prev ? { ...prev, allowedSenders: data.allowedSenders, inboundEmail: data.inboundEmail } : prev);
        setNewSenderEmail("");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to add sender");
      }
    } catch {
      alert("Network error");
    }
    setEmailSaving(false);
  };

  const handleAction = async (actionId: string, status: "approved" | "rejected") => {
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, decision: status, missionId }),
      });
      if (res.ok) {
        setPendingActions(prev => prev.filter(a => a.id !== actionId));
      } else {
        const errData = await res.json().catch(() => ({ error: "Unknown error" }));
        alert(`Action failed: ${errData.error || errData.reason || "Please try again."}`);
      }
    } catch (e) {
      console.error(e);
      alert("Network error. Please try again.");
    }
  };

  useEffect(() => {
    async function fetchData() {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id || "local-demo-user";

      // Fetch Mission
      const { data: missionData } = await supabase
        .from("missions")
        .select("*")
        .eq("id", missionId)
        .eq("tenant_id", uid)
        .single();
      
      if (missionData) {
        setMission(missionData);
      }

      // Fetch Agents (including trust_level from DB)
      const { data: agentRows } = await supabase
        .from("agents")
        .select("id, role, status, agent_index, trust_level")
        .eq("mission_id", missionId)
        .order("agent_index", { ascending: true });

      if (agentRows) {
        const parsed = agentRows.map((a: any, i: number) => ({
          id: a.id || "",
          role: a.role || `Agent ${i}`,
          status: a.status || "idle",
          index: a.agent_index ?? i,
          successScore: null,
          trustLevel: a.trust_level || "conditional",
        }));
        setAgents(parsed);
        setAgentTrust(Object.fromEntries(parsed.map((a, i) => [i, a.trustLevel])));
      }

      // Fetch Clarifications
      const { data: clarRows } = await supabase
        .from("clarifications")
        .select("id, question, status, agent_id, mission_id")
        .eq("mission_id", missionId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (clarRows) {
        setClarifications(clarRows.map((c: any) => ({
          id: c.id,
          agentRole: "Agent",
          question: c.question || "",
          context: "",
          category: "ambiguity",
          priority: "medium",
          missionTitle: missionData?.title || "Mission",
        })));
      }

      // Fetch Events
      const { data: eventRows } = await supabase
        .from("events")
        .select("event_type, payload, created_at")
        .eq("entity_id", missionId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (eventRows) {
        setEvents(eventRows.map((e: any) => ({
          icon: "📋",
          text: e.event_type || "",
          time: formatTimeAgo(e.created_at),
          color: "var(--text)",
        })));

        // Check for final output event
        const completedEvent = eventRows.find((e: any) => e.event_type === "mission.completed");
        if (completedEvent && completedEvent.payload?.finalOutput) {
          setFinalOutput(completedEvent.payload.finalOutput);
        }
        
        // Phase 5: Check for awaiting_input question
        const awaitingEvent = eventRows.find((e: any) => e.event_type === "mission.awaiting_input");
        if (awaitingEvent?.payload && missionData?.status === 'awaiting_input') {
          setPendingQuestion({
            question: awaitingEvent.payload.question,
            options: awaitingEvent.payload.options || [],
            agentRole: awaitingEvent.payload.agentRole,
            agentId: awaitingEvent.payload.agentId,
          });
        } else {
          setPendingQuestion(null);
        }
      }

      // Fetch Timeline
      const { data: snapRows } = await supabase
        .from("mission_snapshots")
        .select("version, trigger, created_at")
        .eq("mission_id", missionId)
        .order("version", { ascending: true })
        .limit(10);

      if (snapRows) {
        setTimeline(snapRows.map((s: any, i: number, arr: any[]) => ({
          version: s.version || i + 1,
          status: s.trigger || "draft",
          timestamp: formatTimeAgo(s.created_at),
          label: `Snapshot v${s.version || i + 1}`,
          active: i === arr.length - 1,
        })));
      }

      // Fetch Pending Actions (Phase 4.3)
      const { data: actionsRows } = await supabase
        .from("proposed_actions")
        .select("*")
        .eq("mission_id", missionId)
        .eq("status", "pending")
        .order("submitted_at", { ascending: false });
      
      if (actionsRows) {
        setPendingActions(actionsRows);
      }

      // Fetch Email Inbox Config
      try {
        const emailRes = await fetch(`/api/email/configure?missionId=${missionId}`);
        if (emailRes.ok) {
          const emailData = await emailRes.json();
          setEmailConfig(emailData);
        }
      } catch { /* email config fetch is non-critical */ }

      // Fetch Run History & Schedule status
      try {
        const runsRes = await fetch(`/api/missions/${missionId}/runs`);
        if (runsRes.ok) {
          const runsData = await runsRes.json();
          setRunHistory(runsData.runs || []);
          setIsScheduled(runsData.hasActiveSchedule || false);
        }
      } catch { /* run history fetch is non-critical */ }

      setLoading(false);
    }
    
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [missionId, refreshTrigger]);

  useEffect(() => {
    if (mission && mission.status !== "draft" && mission.status !== "completed") {
      setIsStarting(false);
    }
  }, [mission?.status]);

  const handleStartMission = async () => {
    if (isStarting) return;
    setIsStarting(true);
    setFinalOutput(null); // Clear the bucket
    setChatMessages([{ role: "assistant", text: "Hi! I'm the Mission Assistant. Ask me anything about this active mission." }]); // Clear chat history
    
    try {
      const endpoint = mission?.status === 'draft'
        ? `/api/missions/${missionId}/run`
        : `/api/missions/${missionId}/execute`;
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      
      if (res.status === 403 && data.error === 'missing_permission') {
        setIsStarting(false);
        const providers = data.providers || [];
        
        // If it's an OAuth connector the user can connect themselves, trigger the popup
        const oauthProviders = ['google', 'linkedin_oidc', 'slack', 'github', 'notion', 'discord', 'zoho', 'twitter', 'facebook', 'instagram'];
        const connectableProviders = providers.filter((p: string) => oauthProviders.includes(p));
        const nonConnectable = providers.filter((p: string) => !oauthProviders.includes(p));
        
        if (connectableProviders.length > 0) {
          // User can connect these themselves via OAuth — show popup for the first one
          triggerAuth(connectableProviders[0], handleStartMission);
          
          // If there are multiple missing, show a message about the rest
          if (connectableProviders.length > 1) {
            setChatMessages(prev => [...prev, { 
              role: "assistant", 
              text: `🔗 **Connect Your Accounts**\n\nThis mission needs the following connectors. Please connect them from the **Connectors** page:\n\n${connectableProviders.map((p: string) => `• **${p.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}**`).join('\n')}\n\nA popup will open for the first one. After connecting, click **Force Restart** to continue.`
            }]);
          }
        } else if (nonConnectable.length > 0) {
          // These are connectors the admin needs to set up (API keys, etc.)
          // Show a friendly message — admin has been emailed
          setChatMessages(prev => [...prev, { 
            role: "assistant", 
            text: `⚠️ **Connectors Pending Setup**\n\nThis mission requires connectors that aren't available on the platform yet:\n\n${nonConnectable.map((p: string) => `• **${p.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}**`).join('\n')}\n\nOur team has been notified and will set them up shortly. You'll receive an email once they're ready.\n\nOnce configured, click **Force Restart** to run the mission with full capabilities.`
          }]);
        }
        return;
      }
      
      // The interval will catch the state update
    } catch (err) {
      console.error(err);
      setIsStarting(false);
    }
  };

  const handleChat = async (text: string) => {
    if (!text.trim()) return;
    setChatMessages(prev => [...prev, { role: "user", text }]);
    setChatLoading(true);
    
    try {
      // Auto-detect URLs and ingest them into the mission's RAG database
      const urlPattern = /https?:\/\/[^\s]+/gi;
      const detectedUrls = text.match(urlPattern);
      
      if (detectedUrls && detectedUrls.length > 0) {
        for (const url of detectedUrls) {
          try {
            await fetch("/api/ingest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceUri: url, missionId, assetType: "url", classification: "resource" }),
            });
          } catch {
            console.error(`[Chief of Staff] Failed to ingest URL: ${url}`);
          }
        }
        setChatMessages(prev => [...prev, { role: "assistant", text: `📎 ${detectedUrls.length} URL(s) detected and ingested into this mission's knowledge base.` }]);
      }

      const res = await fetch("/api/mission-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId, message: text }),
      });
      const data = await res.json();
      if (res.ok) {
        setChatMessages(prev => [...prev, { role: "assistant", text: data.reply }]);
      } else {
        setChatMessages(prev => [...prev, { role: "assistant", text: `Error: ${data.error}` }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", text: "Failed to connect to Chief of Staff." }]);
    }
    
    setChatLoading(false);
  };

  const handleFeedbackSubmit = async () => {
    if (!feedback.trim()) return;
    setFeedbackLoading(true);
    try {
      const res = await fetch("/api/missions/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId, feedback }),
      });
      if (res.ok) {
        setFeedbackSuccess(true);
        setFeedback("");
      }
    } catch (e) {
      console.error("Feedback failed", e);
    }
    setFeedbackLoading(false);
  };

  // Phase 5: Resume mission with user's answer
  const handleResumeWithAnswer = async () => {
    if (!userAnswer.trim() || resumeLoading) return;
    setResumeLoading(true);
    try {
      const res = await fetch("/api/missions/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId, answer: userAnswer }),
      });
      let data: any;
      try { data = await res.json(); } catch { data = {}; }
      if (res.ok) {
        setPendingQuestion(null);
        setUserAnswer("");
        setChatMessages(prev => [...prev, { role: "user", text: userAnswer }, { role: "assistant", text: `✅ Answer received! Mission is resuming from agent "${data.resumedFrom || 'next'}"...` }]);
      } else {
        alert(data.error || "Failed to resume mission");
      }
    } catch {
      alert("Network error. Please try again.");
    }
    setResumeLoading(false);
  };

  if (loading) return <div style={{ padding: "var(--space-2xl)", textAlign: "center" }}>Loading mission details...</div>;
  if (!mission) return <div style={{ padding: "var(--space-2xl)", textAlign: "center" }}>Mission not found.</div>;

  const pendingClarifications = clarifications.filter((c) => !answeredIds.has(c.id));

  return (
    <>      <div className="page-header" style={{ marginBottom: "var(--space-xl)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <Link href="/dashboard" style={{ fontSize: "0.85rem", color: "var(--accent)", textDecoration: "none", marginBottom: "var(--space-sm)", display: "inline-block" }}>
              ← Back to Command Center
            </Link>
            <h1 className="page-title">{mission.title || "Mission Details"}</h1>
            <p className="page-subtitle">Mission ID: {mission.id}</p>
          </div>
          <div className="row">
            <span className="badge badge-purple" style={{ textTransform: "capitalize" }}>{mission.status}</span>
            {mission.status === "draft" ? (
              <button className="btn btn-primary" onClick={handleStartMission} disabled={isStarting}>
                {isStarting ? "Starting..." : "▶ Start Mission"}
              </button>
            ) : null}
            {mission.status === "completed" ? (
              <button className="btn btn-primary" onClick={handleStartMission} disabled={isStarting}>
                {isStarting ? "Restarting..." : "↻ Run Again"}
              </button>
            ) : null}
            {mission.status === "active" ? (
              <button className="btn btn-secondary" onClick={handleStartMission} disabled={isStarting}>
                {isStarting ? "Restarting..." : "⚠️ Force Restart"}
              </button>
            ) : null}
            {mission.status === "failed" ? (
              <button className="btn btn-primary" onClick={handleStartMission} disabled={isStarting} style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                {isStarting ? "Fixing..." : "🔄 Fix & Re-run"}
              </button>
            ) : null}
            {mission.status === "awaiting_input" ? (
              <span className="badge badge-amber" style={{ fontSize: "0.85rem", padding: "8px 16px" }}>💬 Awaiting Your Input</span>
            ) : null}
            {/* Mission Lifecycle Controls */}
            {(mission.status === "active" || mission.status === "building") && (
              <button className="btn btn-ghost" onClick={async () => {
                if (!confirm("Pause this mission? Running agents will be halted.")) return;
                await fetch(`/api/missions/${missionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pause" }) });
                window.location.reload();
              }}>⏸ Pause</button>
            )}
            {(mission.status === "paused" || mission.status === "deadlocked") && (
              <button className="btn btn-primary" onClick={async () => {
                await fetch(`/api/missions/${missionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resume" }) });
                window.location.reload();
              }}>▶ Resume</button>
            )}
            {!["completed", "failed"].includes(mission.status) && mission.status !== "draft" && (
              <button className="btn btn-ghost" style={{ color: "var(--ruby)" }} onClick={async () => {
                if (!confirm("⚠️ Cancel this mission? All running agents will be terminated. This cannot be undone.")) return;
                await fetch(`/api/missions/${missionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
                window.location.reload();
              }}>✕ Cancel</button>
            )}
            {["completed", "failed", "draft", "paused", "awaiting_input"].includes(mission.status) && (
              <button className="btn btn-ghost" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }} onClick={async () => {
                if (!confirm("Delete this mission permanently? This cannot be undone.")) return;
                const res = await fetch(`/api/missions/${missionId}`, { method: "DELETE" });
                if (res.ok) window.location.href = "/dashboard";
              }}>🗑 Delete</button>
            )}
          </div>
        </div>
      </div>


      {/* CONNECTOR REQUEST CARD */}
      <div className="card" style={{ marginBottom: "var(--space-xl)", borderColor: "hsla(270,100%,70%,0.3)", background: "hsla(270,100%,70%,0.04)" }}>
        <div className="card-header">
          <span className="card-title">🔌 API Connections</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowConnectorModal(true)}>+ Request New API</button>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
          Need your agents to connect to a service we don't support yet? Request it and we'll configure it for you.
        </p>
        <div className="row" style={{ gap: "var(--space-sm)", flexWrap: "wrap" }}>
          <a href="/connectors" className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem" }}>🌐 View All Connectors</a>
          <a href="/permissions" className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem" }}>🔑 Manage Permissions</a>
        </div>
      </div>

      {/* EMAIL INBOX CARD */}
      <div className="card" style={{ marginBottom: "var(--space-xl)", borderColor: "hsla(217,91%,60%,0.3)", background: "hsla(217,91%,60%,0.04)" }}>
        <div className="card-header">
          <span className="card-title">📧 Agent Email Inbox</span>
          {emailConfig?.available === false && <span className="badge badge-amber" style={{ fontSize: "0.65rem" }}>Upgrade Required</span>}
        </div>
        {emailConfig?.available === false ? (
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Email inbox requires Individual plan or higher. <a href="/pricing" style={{ color: "var(--accent)" }}>Upgrade →</a>
          </p>
        ) : (
          <>
            {emailConfig?.inboundEmail && (
              <div style={{ marginBottom: "var(--space-md)", padding: "var(--space-sm) var(--space-md)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: 4 }}>Inbound Email Address</div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>{emailConfig.inboundEmail}</div>
              </div>
            )}
            <div style={{ marginBottom: "var(--space-sm)" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 6 }}>Allowed Senders ({emailConfig?.allowedSenders?.length || 0} / {emailConfig?.maxSenders || '?'})</div>
              {emailConfig?.allowedSenders?.map((sender, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: "0.82rem" }}>
                  <span style={{ color: "var(--emerald)" }}>✓</span>
                  <span style={{ fontFamily: "monospace" }}>{sender}</span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.7rem", padding: "2px 6px" }} onClick={async () => {
                    const updated = emailConfig.allowedSenders.filter((_, idx) => idx !== i);
                    setEmailSaving(true);
                    await fetch("/api/email/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ missionId, allowedSenders: updated }) });
                    setEmailConfig(prev => prev ? { ...prev, allowedSenders: updated } : prev);
                    setEmailSaving(false);
                  }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email" value={newSenderEmail}
                onChange={e => setNewSenderEmail(e.target.value)}
                placeholder="sender@example.com"
                className="input" style={{ flex: 1, padding: "6px 12px", fontSize: "0.82rem", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}
                onKeyDown={e => e.key === 'Enter' && handleAddSender()}
              />
              <button className="btn btn-primary btn-sm" onClick={handleAddSender} disabled={emailSaving || !newSenderEmail.trim()}>
                {emailSaving ? '...' : '+ Add'}
              </button>
            </div>
            {!emailConfig?.inboundEmail && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: "var(--space-sm)", width: "100%" }} onClick={async () => {
                setEmailSaving(true);
                const res = await fetch("/api/email/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ missionId, allowedSenders: emailConfig?.allowedSenders || [] }) });
                if (res.ok) { const data = await res.json(); setEmailConfig(prev => prev ? { ...prev, inboundEmail: data.inboundEmail } : prev); }
                setEmailSaving(false);
              }}>📧 Generate Inbox Address</button>
            )}
          </>
        )}
      </div>

      {/* CONNECTOR REQUEST MODAL */}
      {showConnectorModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={() => setShowConnectorModal(false)}>
          <div className="card" style={{ maxWidth: 480, width: "90%", padding: "var(--space-xl)" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "var(--space-md)" }}>🔌 Request API Connection</h3>
            <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "var(--space-lg)", lineHeight: 1.6 }}>
              Tell us which service you need connected. Our team will configure the OAuth integration and notify you when it's ready.
            </p>
            <input
              type="text"
              className="input"
              placeholder="e.g. Slack, HubSpot, Shopify, Twilio..."
              value={connectorRequest}
              onChange={e => setConnectorRequest(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRequestConnector()}
              style={{ marginBottom: "var(--space-md)", width: "100%", padding: "10px 14px", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.9rem" }}
            />
            <div className="row" style={{ justifyContent: "flex-end", gap: "var(--space-sm)" }}>
              <button className="btn btn-ghost" onClick={() => setShowConnectorModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRequestConnector} disabled={connectorSending || !connectorRequest.trim()}>
                {connectorSending ? 'Sending...' : '📧 Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONNECTOR TOAST */}
      {connectorToast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "var(--bg-card)", border: "1px solid var(--border)", padding: "12px 20px", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontSize: "0.85rem", zIndex: 10000, animation: "slideIn 0.3s ease" }}>
          {connectorToast}
        </div>
      )}

      {/* MISSION FAILURE CARD */}
      {mission.status === "failed" && (
        <div className="card animate-slide-in" style={{ marginBottom: "var(--space-xl)", borderColor: "hsla(0,84%,60%,0.4)", background: "hsla(0,84%,60%,0.06)" }}>
          <div className="card-header">
            <span className="card-title">❌ Mission Failed</span>
            <span className="badge badge-red">Error</span>
          </div>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "var(--space-md)", lineHeight: 1.6 }}>
            One or more agents encountered an error during execution. You can fix and re-run the mission — it will attempt to recover from the failed point.
          </p>
          {agents.filter((a: any) => a.status === "failed" || a.status === "error").length > 0 && (
            <div style={{ marginBottom: "var(--space-md)" }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "var(--space-xs)" }}>Failed agents:</p>
              {agents.filter((a: any) => a.status === "failed" || a.status === "error").map((a: any) => (
                <span key={a.id} className="badge badge-red" style={{ marginRight: 6, marginBottom: 4 }}>🤖 {a.role}</span>
              ))}
            </div>
          )}
          <button className="btn btn-primary" onClick={handleStartMission} disabled={isStarting} style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
            {isStarting ? "Fixing..." : "🔄 Fix & Re-run Mission"}
          </button>
        </div>
      )}

      {/* SCHEDULE PICKER */}
      {['completed', 'paused', 'draft', 'failed'].includes(mission.status) && (
        <div className="card" style={{ marginBottom: "var(--space-xl)", borderColor: "hsla(270,100%,70%,0.3)", background: "hsla(270,100%,70%,0.04)" }}>
          <div className="card-header">
            <span className="card-title">⏰ Schedule This Mission</span>
            {isScheduled && <span className="badge" style={{ background: "hsla(270,100%,70%,0.15)", color: "hsl(270,100%,70%)" }}>Scheduled</span>}
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-md)" }}>
            {isScheduled ? "This mission is set to run on a recurring schedule. The cron system will automatically execute it at the configured time." : "Set this mission to run automatically on a recurring schedule."}
          </p>
          {!showSchedulePicker && !isScheduled && (
            <button className="btn btn-ghost" onClick={() => setShowSchedulePicker(true)}>📅 Set Schedule</button>
          )}
          {isScheduled && (
            <button className="btn btn-ghost" style={{ color: "var(--ruby)" }} onClick={async () => {
              if (!confirm('Stop the recurring schedule for this mission?')) return;
              await fetch(`/api/missions/${missionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unschedule' }) });
              setIsScheduled(false);
              window.location.reload();
            }}>✕ Remove Schedule</button>
          )}
          {showSchedulePicker && (
            <div style={{ marginTop: "var(--space-md)" }}>
              {/* Frequency Mode Toggle */}
              <div style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
                <button 
                  className={`btn ${scheduleMode === 'preset' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: "0.85rem" }}
                  onClick={() => setScheduleMode('preset')}
                >
                  ⚡ Preset
                </button>
                <button 
                  className={`btn ${scheduleMode === 'custom' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: "0.85rem" }}
                  onClick={() => setScheduleMode('custom')}
                >
                  🎛️ Custom
                </button>
              </div>

              {scheduleMode === 'preset' ? (
                /* Preset Mode */
                <select 
                  value={schedulePreset} 
                  onChange={(e) => setSchedulePreset(e.target.value)} 
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.9rem", marginBottom: "var(--space-sm)", width: "100%" }}
                >
                  <option value="every_5_minutes">Every 5 minutes (testing)</option>
                  <option value="every_hour">Every hour</option>
                  <option value="daily_9am">Daily at 9:00 AM</option>
                  <option value="daily_6pm">Daily at 6:00 PM</option>
                  <option value="weekly_monday">Weekly on Monday (9 AM)</option>
                  <option value="weekly_friday">Weekly on Friday (5 PM)</option>
                </select>
              ) : (
                /* Custom Mode */
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                  {/* Day of Week */}
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, display: "block", color: "var(--text-secondary)" }}>Day</label>
                    <select 
                      value={customDay} 
                      onChange={(e) => setCustomDay(e.target.value)}
                      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.9rem", width: "100%" }}
                    >
                      <option value="everyday">Every day</option>
                      <option value="monday">Monday</option>
                      <option value="tuesday">Tuesday</option>
                      <option value="wednesday">Wednesday</option>
                      <option value="thursday">Thursday</option>
                      <option value="friday">Friday</option>
                      <option value="saturday">Saturday</option>
                      <option value="sunday">Sunday</option>
                    </select>
                  </div>

                  {/* Time Input */}
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, display: "block", color: "var(--text-secondary)" }}>Time</label>
                    <input 
                      type="time" 
                      value={customTime}
                      onChange={(e) => setCustomTime(e.target.value)}
                      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.9rem", width: "100%" }}
                    />
                  </div>

                  {/* End Condition */}
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, display: "block", color: "var(--text-secondary)" }}>End Condition</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
                        <input type="radio" name="endCondition" checked={endCondition === 'forever'} onChange={() => setEndCondition('forever')} style={{ accentColor: "hsl(270,100%,70%)" }} />
                        Run forever
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
                        <input type="radio" name="endCondition" checked={endCondition === 'max_runs'} onChange={() => setEndCondition('max_runs')} style={{ accentColor: "hsl(270,100%,70%)" }} />
                        Run for
                        <input 
                          type="number" 
                          min={1} max={100} 
                          value={maxRuns}
                          onChange={(e) => setMaxRuns(parseInt(e.target.value) || 1)}
                          disabled={endCondition !== 'max_runs'}
                          style={{ width: 60, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: endCondition === 'max_runs' ? "var(--bg-card)" : "var(--bg-glass)", color: "var(--text-primary)", fontSize: "0.85rem", textAlign: "center" }}
                        />
                        times
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
                        <input type="radio" name="endCondition" checked={endCondition === 'end_date'} onChange={() => setEndCondition('end_date')} style={{ accentColor: "hsl(270,100%,70%)" }} />
                        Until
                        <input 
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          disabled={endCondition !== 'end_date'}
                          min={new Date().toISOString().split('T')[0]}
                          style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: endCondition === 'end_date' ? "var(--bg-card)" : "var(--bg-glass)", color: "var(--text-primary)", fontSize: "0.85rem" }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Preview */}
                  <div style={{ padding: "var(--space-sm) var(--space-md)", background: "hsla(270,100%,70%,0.08)", borderRadius: "var(--radius-sm)", border: "1px solid hsla(270,100%,70%,0.2)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: 4 }}>Preview</div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 500, color: "hsl(270,100%,80%)" }}>
                      {(() => {
                        const dayLabel = customDay === 'everyday' ? 'Every day' : `Every ${customDay.charAt(0).toUpperCase() + customDay.slice(1)}`;
                        const [h, m] = customTime.split(':').map(Number);
                        const period = h >= 12 ? 'PM' : 'AM';
                        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                        const timeLabel = `${h12}:${String(m).padStart(2, '0')} ${period}`;
                        const endLabel = endCondition === 'forever' ? '' : endCondition === 'max_runs' ? ` • ${maxRuns} runs total` : endDate ? ` • until ${new Date(endDate).toLocaleDateString()}` : '';
                        return `${dayLabel} at ${timeLabel}${endLabel}`;
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="row" style={{ gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
                <button className="btn btn-ghost" onClick={() => setShowSchedulePicker(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => {
                  let finalConfig: string | object;
                  if (scheduleMode === 'preset') {
                    finalConfig = schedulePreset;
                  } else {
                    finalConfig = {
                      type: 'custom',
                      dayOfWeek: customDay,
                      time: customTime,
                      ...(endCondition === 'max_runs' ? { maxRuns } : {}),
                      ...(endCondition === 'end_date' && endDate ? { endDate } : {}),
                    };
                  }
                  const res = await fetch(`/api/missions/${missionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'schedule', scheduleConfig: finalConfig }) });
                  if (res.ok) { setIsScheduled(true); setShowSchedulePicker(false); window.location.reload(); }
                  else { const d = await res.json(); alert(d.error || 'Failed to schedule'); }
                }}>✅ Set Schedule</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RUN HISTORY */}
      {runHistory.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--space-xl)" }}>
          <div className="card-header">
            <span className="card-title">📊 Run History</span>
            <span className="badge badge-blue">{runHistory.length} runs</span>
          </div>
          <div className="stack" style={{ gap: "var(--space-xs)", maxHeight: 300, overflowY: "auto" }}>
            {runHistory.map((run, i) => {
              const icon = run.event_type.includes('completed') ? '✅' : run.event_type.includes('failed') ? '❌' : run.event_type.includes('resumed') ? '🔄' : run.event_type.includes('scheduled') ? '⏰' : run.event_type.includes('unscheduled') ? '⏹' : run.event_type.includes('cancelled') ? '🚫' : '📌';
              const label = run.event_type.includes('completed') ? 'Completed' : run.event_type.includes('failed') ? 'Failed' : run.event_type.includes('resumed') ? 'Started (cron)' : run.event_type.includes('unscheduled') ? 'Schedule removed' : run.event_type.includes('scheduled') ? `Scheduled: ${run.payload?.scheduleConfig || ''}` : run.event_type.includes('cancelled') ? 'Cancelled' : run.event_type.includes('wait') ? `Waiting: ${run.payload?.config || ''}` : run.event_type;
              const time = new Date(run.created_at).toLocaleString();
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "8px 12px", background: "var(--bg-glass)", borderRadius: 8, fontSize: "0.82rem" }}>
                  <span>{icon}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{time}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PHASE 4.3: Localized Approvals */}
      {pendingActions.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--space-xl)", borderColor: "var(--amber)", background: "hsla(38,92%,55%,0.05)" }}>
          <div className="card-header">
            <span className="card-title">⚠️ Requires Your Permission</span>
            <span className="badge badge-amber">{pendingActions.length} pending</span>
          </div>
          <div className="stack" style={{ gap: "var(--space-md)" }}>
            {pendingActions.map((action) => {
              const target = (action.target || action.description || '').toLowerCase();
              let icon = '🔌', label = 'Connect to external service';
              if (target.includes('gmail') || target.includes('email')) { icon = '📧'; label = 'Send emails on your behalf'; }
              else if (target.includes('sheet')) { icon = '📊'; label = 'Create & edit Google Sheets'; }
              else if (target.includes('calendar')) { icon = '📅'; label = 'Access your Google Calendar'; }
              else if (target.includes('drive')) { icon = '📁'; label = 'Access your Google Drive'; }
              else if (target.includes('tavily') || target.includes('search') || target.includes('web')) { icon = '🔍'; label = 'Search the web'; }
              else if (target.includes('twitter')) { icon = '🐦'; label = 'Post to Twitter/X'; }
              else if (target.includes('slack')) { icon = '💬'; label = 'Send Slack messages'; }
              return (
                <div key={action.id} className="card animate-slide-in">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", padding: "var(--space-md)", marginBottom: "var(--space-sm)" }}>
                    <span style={{ fontSize: "2rem" }}>{icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                        {action.description || "This agent needs permission to proceed."}
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn btn-danger" onClick={() => handleAction(action.id, "rejected")}>❌ Deny</button>
                    <button className="btn btn-primary" onClick={() => handleAction(action.id, "approved")}>✅ Allow</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PHASE 5: AWAITING INPUT POPUP */}
      {pendingQuestion && mission.status === 'awaiting_input' && (
        <div className="card animate-slide-in" style={{ 
          marginBottom: "var(--space-xl)", 
          borderColor: "hsla(217,91%,60%,0.5)", 
          background: "hsla(217,91%,60%,0.08)",
          boxShadow: "0 0 30px hsla(217,91%,60%,0.15)",
        }}>
          <div className="card-header">
            <span className="card-title">💬 Agent Needs Your Input</span>
            <span className="badge badge-blue">{pendingQuestion.agentRole}</span>
          </div>
          <div style={{ 
            padding: "var(--space-lg)", 
            background: "var(--bg-glass)", 
            borderRadius: "var(--radius-md)", 
            marginBottom: "var(--space-md)",
            fontSize: "1.05rem",
            fontWeight: 500,
            lineHeight: 1.6,
            color: "var(--text-bright)",
          }}>
            🤖 {pendingQuestion.question}
          </div>
          {pendingQuestion.options.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
              {pendingQuestion.options.map((opt, i) => (
                <button 
                  key={i} 
                  className={`btn ${userAnswer === opt ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: "0.85rem" }}
                  onClick={() => setUserAnswer(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
            <input
              type="text"
              className="input"
              value={userAnswer}
              onChange={e => setUserAnswer(e.target.value)}
              placeholder="Type your answer..."
              onKeyDown={e => e.key === 'Enter' && handleResumeWithAnswer()}
              style={{ 
                flex: 1, 
                padding: "12px 16px", 
                fontSize: "0.95rem",
                background: "var(--bg-base)", 
                border: "1px solid var(--accent)", 
                borderRadius: "var(--radius-md)", 
                color: "var(--text-bright)" 
              }}
            />
            <button 
              className="btn btn-primary btn-lg" 
              onClick={handleResumeWithAnswer} 
              disabled={resumeLoading || !userAnswer.trim()}
              style={{ whiteSpace: "nowrap" }}
            >
              {resumeLoading ? "⏳ Resuming..." : "▶ Submit & Resume"}
            </button>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "var(--space-sm)" }}>
            You can type any answer — words, sentences, emojis, or pick from the options above. The AI will interpret your response.
          </p>
        </div>
      )}

      {pendingClarifications.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--space-xl)", borderColor: "hsla(38,92%,55%,0.3)", background: "hsla(38,92%,55%,0.04)" }}>
          <div className="card-header">
            <span className="card-title">💬 Clarification Queue — Agents Need Your Input</span>
            <span className="badge badge-amber">{pendingClarifications.length} pending</span>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>Agents have paused execution and are waiting for your answers to continue.</p>
          <div className="stack" style={{ gap: "var(--space-md)" }}>
            {pendingClarifications.map((c) => (
              <div key={c.id} className="card animate-slide-in" style={{ padding: "var(--space-md)" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
                  <div className="row">
                    <span style={{ fontSize: "1.2rem" }}>{catIcons[c.category] || "❓"}</span>
                    <div>
                      <span style={{ fontWeight: 600 }}>{c.agentRole}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "var(--space-sm)" }}>{c.missionTitle}</span>
                    </div>
                  </div>
                  <div className="row">
                    <span className={`badge ${priorityBadges[c.priority]}`} style={{ fontSize: "0.65rem" }}>{c.priority}</span>
                    <span className="badge badge-purple" style={{ fontSize: "0.65rem" }}>{c.category.replace("_", " ")}</span>
                  </div>
                </div>
                <div style={{ fontSize: "0.95rem", fontWeight: 500, marginBottom: "var(--space-sm)", lineHeight: 1.5 }}>{c.question}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "var(--space-sm) var(--space-md)", background: "var(--bg-glass)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-md)", lineHeight: 1.6 }}>
                  <span style={{ color: "var(--text-muted)" }}>Context:</span> {c.context}
                </div>
                <UnifiedInput
                  context="clarification"
                  compact
                  placeholder="Type your answer, attach a file, or use voice..."
                  initialValue={clarificationAnswers[c.id] || ""}
                  onSubmit={(text) => {
                    setClarificationAnswers({ ...clarificationAnswers, [c.id]: text });
                    setAnsweredIds(new Set([...answeredIds, c.id]));
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 400px", alignItems: "start", gap: "var(--space-xl)" }}>
        <div className="stack">
          {/* ORCHESTRATION GRAPH */}
          <div className="card" style={{ position: "relative", zIndex: 10 }}>
            <div className="card-header"><span className="card-title">🔗 Agent Graph</span></div>
            <div className="graph-container">
              {agents.map((agent, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", position: "relative" }}>
                  <div className={`graph-node ${i === 0 ? "entry" : ""}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setCommandAgent(commandAgent === i ? null : i)}>
                    <div style={{ fontSize: "1.3rem" }}>{["🕷️", "📊", "📄", "🔍", "🤖"][i % 5]}</div>
                    <div className="graph-node-role">{agent.role}</div>
                    <span className="status-pill" style={{ fontSize: "0.7rem" }}><span className={`status-dot ${agent.status === "running" ? "active" : agent.status === "paused" ? "pending" : "idle"}`} />{agent.status}</span>
                    <AgentSettings
                      agentRole={agent.role}
                      currentTrust={(agentTrust[i] || agent.trustLevel) as "manual" | "conditional" | "autonomous"}
                      onTrustChange={async (level) => {
                        // Persist to DB first, then update UI
                        try {
                          const res = await fetch("/api/agents", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ agentId: agent.id, trustLevel: level }),
                          });
                          if (res.ok) {
                            setAgentTrust(prev => ({ ...prev, [i]: level }));
                          } else {
                            alert("Failed to update trust level. Try again.");
                          }
                        } catch {
                          alert("Network error updating trust level.");
                        }
                      }}
                      successScore={agent.successScore}
                      status={agent.status}
                    />
                  </div>
                  {commandAgent === i && (
                    <div className="command-popup">
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "var(--space-sm)" }}>
                        📡 Direct Command → {agent.role}
                      </div>
                      <UnifiedInput context="command" compact agentRole={agent.role} agentId={agent.id} placeholder={`Send instruction to ${agent.role}...`} onSubmit={() => setCommandAgent(null)} />
                    </div>
                  )}
                  {i < agents.length - 1 && <div className="graph-edge">→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* FINAL OUTPUT VIEWER */}
          {finalOutput && (
            <div className="card animate-slide-in">
              <div className="card-header">
                <span className="card-title">✅ Final Output Payload</span>
                <div className="row">
                  <button className="btn btn-ghost btn-sm" onClick={() => setRefreshTrigger(prev => prev + 1)} style={{ fontSize: "0.7rem", padding: "4px 8px" }}>↻ Refresh</button>
                  <span className="badge badge-emerald">Delivered</span>
                </div>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
                This is the final result generated by the end of the agent chain.
              </p>
              <div style={{ marginTop: "var(--space-sm)", overflowX: "auto", maxWidth: "100%", wordBreak: "break-word" }}>
                <RichOutputViewer output={finalOutput} />
              </div>
            </div>
          )}

          {/* PHASE 5.2: Post-Mission ML Optimization */}
          {mission.status === "completed" && (
            <div className="card animate-slide-in" style={{ borderColor: "var(--purple)", background: "hsla(270, 100%, 70%, 0.05)" }}>
              <div className="card-header">
                <span className="card-title">🧠 Continuous Learning</span>
                <span className="badge badge-purple">ML Optimization</span>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
                Rate this mission's performance. The AI will permanently rewrite the agents' core logic to adapt to your preferences for next time.
              </p>
              {feedbackSuccess ? (
                <div style={{ padding: "var(--space-md)", background: "var(--emerald-bg)", color: "var(--emerald)", borderRadius: "var(--radius-sm)", fontSize: "0.85rem", fontWeight: 500 }}>
                  ✓ Core logic successfully optimized!
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <UnifiedInput 
                    compact 
                    context="clarification" 
                    placeholder="E.g., 'The summary was too long, use bullet points'..." 
                    onSubmit={(text) => { setFeedback(text); handleFeedbackSubmit(); }} 
                  />
                  {feedbackLoading && (
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-sm)", backdropFilter: "blur(2px)", zIndex: 10 }}>
                      <div className="gemini-wave"><span /><span /><span /><span /><span /></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="stack">
          {/* Mission Chief of Staff Chat */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">🎖️ Chief of Staff</span>
              <span className="badge badge-purple">Mission-Bound</span>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
              Ask questions, request reports, upload files/URLs, or dynamically modify this mission.
            </p>
            <div style={{ maxHeight: "300px", overflowY: "auto", background: "var(--bg-glass)", padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-sm)", display: "flex", flexDirection: "column", gap: "8px" }}>
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", background: msg.role === "user" ? "var(--accent-subtle)" : "var(--bg-card)", padding: "8px 12px", borderRadius: "12px", fontSize: "0.82rem", maxWidth: "85%", border: "1px solid var(--border)", whiteSpace: "pre-wrap" }}>
                  <strong style={{ display: "block", fontSize: "0.7rem", color: msg.role === "user" ? "var(--accent)" : "var(--emerald)", marginBottom: "2px" }}>
                    {msg.role === "user" ? "You" : "Chief of Staff"}
                  </strong>
                  {msg.role === "assistant" ? (
                    <div className="cos-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                  ) : msg.text}
                </div>
              ))}
              {chatLoading && <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", padding: "8px 12px" }}>Thinking...</div>}
              <div ref={chatEndRef} />
            </div>
            <UnifiedInput context="command" compact placeholder="Ask, command, upload a URL, or request a report..." onSubmit={handleChat} />
          </div>

          {/* Knowledge Base — RAG File Upload */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">📚 Knowledge Base</span>
              <span className="badge badge-purple">RAG</span>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
              Upload files to give agents context. Files are embedded with OpenAI and indexed into this mission's vector memory.
            </p>
            <FileDropZone
              missionId={missionId as string}
              context="feed"
              compact
              classification="resource"
              onFilesAdded={(files) => console.log('Files indexed:', files.map(f => f.name))}
            />
          </div>

          {/* Timeline & Events */}
          <div className="card">
            <div className="card-header"><span className="card-title">🕐 Mission Timeline</span></div>
            {timeline.length > 0 && (
              <div style={{ position: "relative", paddingLeft: "24px", marginBottom: "var(--space-xl)" }}>
                <div style={{ position: "absolute", left: "7px", top: "8px", bottom: "8px", width: "2px", background: "var(--border)" }} />
                {timeline.map((entry, i) => (
                  <div key={i} style={{ position: "relative", marginBottom: "var(--space-sm)" }}>
                    <div style={{
                      position: "absolute", left: "-20px", top: "4px", width: "12px", height: "12px", borderRadius: "50%",
                      background: entry.active ? "var(--accent)" : "var(--bg-card)",
                      border: `2px solid ${entry.active ? "var(--accent)" : "var(--border)"}`,
                      boxShadow: entry.active ? "0 0 10px var(--accent-glow)" : "none",
                    }} />
                    <div style={{ padding: "var(--space-xs) var(--space-sm)", borderRadius: "var(--radius-sm)", background: entry.active ? "var(--accent-subtle)" : "transparent" }}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span style={{ fontSize: "0.82rem", fontWeight: entry.active ? 600 : 400 }}>{entry.label}</span>
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>v{entry.version}</span>
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{entry.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="card-title" style={{ marginBottom: "var(--space-sm)", fontSize: "0.9rem" }}>📋 Event Stream</div>
            <div className="stack" style={{ gap: "var(--space-xs)" }}>
              {events.length > 0 ? events.map((e, i) => (
                <div key={i} className="row animate-slide-in" style={{ padding: "var(--space-xs) 0", borderBottom: "1px solid var(--border)", fontSize: "0.78rem" }}>
                  <span>{e.icon}</span><span style={{ color: e.color, flex: 1 }}>{e.text}</span><span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>{e.time}</span>
                </div>
              )) : (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center", padding: "var(--space-md) 0" }}>No events yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function formatTimeAgo(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
