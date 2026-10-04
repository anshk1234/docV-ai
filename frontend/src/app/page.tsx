"use client";

import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles,
  FileText,
  UploadCloud,
  ArrowUp,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Download,
  ShieldCheck,
  Search,
  ExternalLink,
  Layers,
  HelpCircle,
  FileSpreadsheet,
  FileCode,
  Trash2,
  Maximize2
} from "lucide-react";

interface IngestedDoc {
  id: string;
  filename: string;
  file_type: string;
  total_pages: number;
  created_at: string;
}

interface Citation {
  doc_name: string;
  page_number: number;
  quote: string;
}

interface ConflictItem {
  topic: string;
  severity: string;
  document_a: string;
  claim_a: string;
  document_b: string;
  claim_b: string;
  resolution_note: string;
}

interface InvestigationResult {
  query: string;
  synthesized_answer: string;
  confidence_score: number;
  uncertainty_level: string;
  uncertainty_reasons: string[];
  conflicts_detected: ConflictItem[];
  citations: Citation[];
}

interface Message {
  id: string;
  sender: "user" | "docv";
  text: string;
  result?: InvestigationResult;
  timestamp: string;
}

export default function Home() {
  const [apiUrl] = useState("http://localhost:8000");
  const [backendOnline, setBackendOnline] = useState(false);
  const [documents, setDocuments] = useState<IngestedDoc[]>([]);
  const [inputQuery, setInputQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [activeResult, setActiveResult] = useState<InvestigationResult | null>(null);
  const [artifactTab, setArtifactTab] = useState<"conflicts" | "sources" | "uncertainty">("conflicts");
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Health check & fetch documents
  const checkHealth = async () => {
    try {
      const res = await fetch(`${apiUrl}/`);
      if (res.ok) {
        setBackendOnline(true);
        fetchDocuments();
      } else {
        setBackendOnline(false);
      }
    } catch {
      setBackendOnline(false);
    }
  };

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 6000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    for (let i = 0; i < e.target.files.length; i++) {
      formData.append("files", e.target.files[i]);
    }

    try {
      const res = await fetch(`${apiUrl}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to upload files");
      }

      await fetchDocuments();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Load sample dataset
  const handleLoadSample = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/sample-data`, { method: "POST" });
      const data = await res.json();
      await fetchDocuments();
      const defaultQuery = data.suggested_query || "What is the final approved amount and deadline for Milestone 1?";
      executeInvestigation(defaultQuery);
    } catch (err: any) {
      setError(err.message || "Failed to load sample dataset");
      setLoading(false);
    }
  };

  // Reset workspace
  const handleReset = async () => {
    try {
      await fetch(`${apiUrl}/api/reset`, { method: "POST" });
      setDocuments([]);
      setMessages([]);
      setActiveResult(null);
      setArtifactOpen(false);
      setInputQuery("");
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to reset workspace");
    }
  };

  // Execute investigation query
  const executeInvestigation = async (queryText?: string) => {
    const q = queryText || inputQuery;
    if (!q.trim()) return;

    const userMsg: Message = {
      id: Math.random().toString(),
      sender: "user",
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Investigation query failed");
      }

      const data = await res.json();
      const docvMsg: Message = {
        id: Math.random().toString(),
        sender: "docv",
        text: data.result.synthesized_answer,
        result: data.result,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, docvMsg]);
      setActiveResult(data.result);
      if (data.result.conflicts_detected && data.result.conflicts_detected.length > 0) {
        setArtifactOpen(true);
        setArtifactTab("conflicts");
      }
    } catch (err: any) {
      setError(err.message || "Investigation failed");
    } finally {
      setLoading(false);
    }
  };

  // Export report as markdown
  const handleExportReport = () => {
    if (!activeResult) return;
    const report = `# 🛡️ docV.ai — Forensic Document Investigation Dossier
Generated: ${new Date().toLocaleString()}
Official PS: ALG-AI-02 Intelligent Document Investigator
Query: "${activeResult.query}"

---

## 1. Executive Forensic Synthesis
${activeResult.synthesized_answer}

## 2. Grounding & Uncertainty Metrics
- **Factual Grounding Score:** ${activeResult.confidence_score}%
- **Uncertainty Level:** ${activeResult.uncertainty_level}
- **Factors & Caveats:**
${activeResult.uncertainty_reasons.map((r) => `  * ${r}`).join("\n")}

## 3. Cross-Document Contradictions & Conflict Matrix (${activeResult.conflicts_detected.length} Detected)
${activeResult.conflicts_detected
  .map(
    (c, i) => `
### Discrepancy ${i + 1}: ${c.topic} [Severity: ${c.severity}]
- **Source A (${c.document_a}):** "${c.claim_a}"
- **Source B (${c.document_b}):** "${c.claim_b}"
- **Auditor's Resolution:** ${c.resolution_note}
`
  )
  .join("\n")}

## 4. Supporting Verbatim Citations (${activeResult.citations.length} Sources)
${activeResult.citations
  .map((cite) => `- **${cite.doc_name} (Page ${cite.page_number})**: "${cite.quote}"`)
  .join("\n")}
`;

    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `docV_Investigation_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#141413] text-[#f4f3ef] font-sans">
      {/* 1. Left Sidebar: Document Vault (Claude-style drawer) */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } transition-all duration-300 ease-in-out border-r border-[#242421] bg-[#1a1a18] flex flex-col overflow-hidden relative z-20`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[#242421] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#cc785c]/15 border border-[#cc785c]/30 flex items-center justify-center text-[#cc785c]">
              <Sparkles className="w-4 h-4 fill-[#cc785c]" />
            </div>
            <div>
              <span className="font-semibold text-sm tracking-tight text-[#f4f3ef]">docV.ai</span>
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-[#242421] text-[#9c9a92] font-mono">
                v1.0
              </span>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-[#9c9a92] hover:text-[#f4f3ef] p-1 rounded-md hover:bg-[#242421] transition cursor-pointer"
            title="Collapse Sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* New Session Action */}
        <div className="p-3">
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[#242421] hover:bg-[#2b2b27] border border-[#2e2e29] text-xs font-medium text-[#f4f3ef] transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#cc785c]" />
            <span>New Investigation</span>
          </button>
        </div>

        {/* Upload & Knowledge Repository */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          <div>
            <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-[#9c9a92] mb-2 px-1">
              <span>Document Vault</span>
              <span className="text-[10px] bg-[#242421] px-1.5 py-0.5 rounded text-[#9c9a92]">
                {documents.length}
              </span>
            </div>

            {/* Drag & Drop Upload Tile */}
            <label className="border border-dashed border-[#2e2e29] hover:border-[#cc785c]/50 bg-[#161615] hover:bg-[#20201d] rounded-xl p-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition group">
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
              <UploadCloud className="w-5 h-5 text-[#9c9a92] group-hover:text-[#cc785c] transition" />
              <div className="text-center">
                <p className="text-xs font-medium text-[#e4e2dd]">
                  {uploading ? "Ingesting & indexing..." : "Add documents"}
                </p>
                <p className="text-[10px] text-[#787670]">PDFs, Scanned OCR, Text</p>
              </div>
            </label>
          </div>

          {/* Active Documents List */}
          <div className="space-y-1.5">
            {documents.length === 0 ? (
              <div className="p-4 text-center text-[#787670] text-xs">
                No files loaded.
                <button
                  onClick={handleLoadSample}
                  className="block mx-auto mt-2 text-[11px] text-[#cc785c] hover:underline cursor-pointer"
                >
                  Load Demo Case
                </button>
              </div>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-2.5 rounded-lg bg-[#20201d] border border-[#2b2b27] hover:border-[#3a3a34] transition flex items-center justify-between text-xs group"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="w-4 h-4 text-[#cc785c] flex-shrink-0" />
                    <div className="overflow-hidden">
                      <p className="text-xs text-[#e4e2dd] truncate font-medium">{doc.filename}</p>
                      <p className="text-[10px] text-[#787670]">
                        {doc.total_pages} {doc.total_pages === 1 ? "page" : "pages"} • {doc.file_type.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="Indexed & Grounded" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sidebar Footer with PS Info */}
        <div className="p-3 border-t border-[#242421] bg-[#161615]">
          <div className="text-[11px] text-[#9c9a92] flex items-center justify-between">
            <span>Track: ALG-AI-02</span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${backendOnline ? "bg-emerald-400" : "bg-rose-500"}`} />
              <span className="text-[10px]">{backendOnline ? "Online" : "Offline"}</span>
            </span>
          </div>
        </div>
      </aside>

      {/* 2. Main Stage: Conversation & Query View */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#141413]">
        {/* Top Navbar */}
        <header className="h-13 border-b border-[#242421] px-5 flex items-center justify-between bg-[#141413]/80 backdrop-blur-sm z-10">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-[#9c9a92] hover:text-[#f4f3ef] p-1.5 rounded-md hover:bg-[#20201d] transition cursor-pointer"
                title="Expand Document Vault"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#f4f3ef] tracking-tight">docV.ai</span>
              <span className="text-[#5a5953]">•</span>
              <span className="text-xs text-[#9c9a92]">Intelligent Document Investigator</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleLoadSample}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#cc785c]/10 text-[#cc785c] border border-[#cc785c]/25 hover:bg-[#cc785c]/20 transition cursor-pointer disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load Demo Case</span>
            </button>

            {activeResult && !artifactOpen && (
              <button
                onClick={() => setArtifactOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#20201d] border border-[#2e2e29] hover:bg-[#2b2b27] text-[#e4e2dd] transition cursor-pointer"
              >
                <PanelRightOpen className="w-3.5 h-3.5 text-[#cc785c]" />
                <span>Open Dossier ({activeResult.conflicts_detected.length} Conflicts)</span>
              </button>
            )}
          </div>
        </header>

        {/* Conversation Message Stream */}
        <main className="flex-1 overflow-y-auto px-6 py-6 flex flex-col items-center">
          <div className="w-full max-w-3xl flex-1 flex flex-col justify-between">
            {/* If No Messages: Claude Hero Greeting */}
            {messages.length === 0 ? (
              <div className="my-auto text-center space-y-6 py-12">
                <div className="w-12 h-12 rounded-2xl bg-[#cc785c]/10 border border-[#cc785c]/20 flex items-center justify-center mx-auto text-[#cc785c]">
                  <Sparkles className="w-6 h-6 fill-[#cc785c]" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl font-medium tracking-tight text-[#f4f3ef]">
                    What would you like to investigate?
                  </h1>
                  <p className="text-sm text-[#9c9a92] max-w-md mx-auto">
                    Upload multi-page contracts, scanned invoices, or email chains. docV.ai cross-references claims,
                    uncovers discrepancies, and provides page-grounded citations.
                  </p>
                </div>

                {/* Quick Investigative Prompts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl mx-auto pt-4 text-left">
                  <button
                    onClick={() => {
                      if (documents.length === 0) handleLoadSample();
                      else executeInvestigation("What is the final approved amount and deadline for Milestone 1?");
                    }}
                    className="p-3.5 rounded-xl bg-[#1e1e1c] hover:bg-[#262623] border border-[#2b2b27] transition text-xs text-[#e4e2dd] space-y-1 cursor-pointer group"
                  >
                    <div className="font-medium text-[#cc785c] group-hover:underline flex items-center gap-1.5">
                      <span>Milestone 1 Price & Deadline</span>
                      <ChevronRight className="w-3 h-3" />
                    </div>
                    <p className="text-[11px] text-[#787670]">
                      Cross-checks MSA vs. Addendum vs. Invoice for billing discrepancies.
                    </p>
                  </button>

                  <button
                    onClick={() => {
                      if (documents.length === 0) handleLoadSample();
                      else executeInvestigation("Are there any penalty or governing law stipulations?");
                    }}
                    className="p-3.5 rounded-xl bg-[#1e1e1c] hover:bg-[#262623] border border-[#2b2b27] transition text-xs text-[#e4e2dd] space-y-1 cursor-pointer group"
                  >
                    <div className="font-medium text-[#cc785c] group-hover:underline flex items-center gap-1.5">
                      <span>Penalties & Governing Law</span>
                      <ChevronRight className="w-3 h-3" />
                    </div>
                    <p className="text-[11px] text-[#787670]">
                      Audits late delivery clauses and jurisdictional obligations.
                    </p>
                  </button>
                </div>
              </div>
            ) : (
              /* Message Thread */
              <div className="space-y-6 pb-6">
                {messages.map((msg) => (
                  <div key={msg.id} className="space-y-3">
                    {msg.sender === "user" ? (
                      /* User Message */
                      <div className="flex justify-end">
                        <div className="max-w-xl bg-[#242421] text-[#f4f3ef] border border-[#2e2e29] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed">
                          {msg.text}
                        </div>
                      </div>
                    ) : (
                      /* docV.ai Assistant Message */
                      <div className="flex gap-3 max-w-2xl">
                        <div className="w-7 h-7 rounded-lg bg-[#cc785c]/15 border border-[#cc785c]/30 flex items-center justify-center text-[#cc785c] flex-shrink-0 mt-0.5">
                          <Sparkles className="w-4 h-4 fill-[#cc785c]" />
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="text-[15px] leading-relaxed text-[#dedbd4] space-y-2.5">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({ node, ...props }) => <h1 className="text-lg font-semibold text-[#f4f3ef] mt-3.5 mb-2" {...props} />,
                                h2: ({ node, ...props }) => <h2 className="text-base font-semibold text-[#f4f3ef] mt-4 mb-2 border-b border-[#2b2b27] pb-1" {...props} />,
                                h3: ({ node, ...props }) => <h3 className="text-sm font-semibold text-[#f4f3ef] mt-3 mb-1.5" {...props} />,
                                p: ({ node, ...props }) => <p className="mb-2.5 leading-relaxed text-[#dedbd4]" {...props} />,
                                strong: ({ node, ...props }) => <strong className="font-semibold text-[#f4f3ef]" {...props} />,
                                ul: ({ node, ...props }) => <ul className="list-disc list-inside space-y-1.5 mb-3 pl-1 text-[15px] text-[#dedbd4]" {...props} />,
                                ol: ({ node, ...props }) => <ol className="list-decimal list-inside space-y-1.5 mb-3 pl-1 text-[15px] text-[#dedbd4]" {...props} />,
                                li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                                hr: () => <hr className="border-[#2b2b27] my-3.5" />,
                                table: ({ node, ...props }) => (
                                  <div className="overflow-x-auto my-3 rounded-lg border border-[#2b2b27]">
                                    <table className="w-full text-left text-sm border-collapse" {...props} />
                                  </div>
                                ),
                                thead: ({ node, ...props }) => <thead className="bg-[#1e1e1c] text-[#f4f3ef] border-b border-[#2b2b27]" {...props} />,
                                th: ({ node, ...props }) => <th className="p-2.5 font-semibold text-sm text-[#cc785c]" {...props} />,
                                td: ({ node, ...props }) => <td className="p-2.5 border-t border-[#242421] text-[13.5px] text-[#dedbd4]" {...props} />,
                                blockquote: ({ node, ...props }) => (
                                  <blockquote className="border-l-2 border-[#cc785c] pl-3 py-1 my-2 text-xs italic text-[#9c9a92] bg-[#1a1a18] rounded-r" {...props} />
                                ),
                                code: ({ node, className, children, ...props }) => (
                                  <code className="px-1.5 py-0.5 rounded bg-[#242421] text-[#cc785c] font-mono text-[13px] border border-[#2e2e29]" {...props}>
                                    {children}
                                  </code>
                                )
                              }}
                            >
                              {msg.text}
                            </ReactMarkdown>
                          </div>

                          {/* Interactive Conflict Banner (Claude Artifact Trigger) */}
                          {msg.result && msg.result.conflicts_detected.length > 0 && (
                            <div
                              onClick={() => {
                                setActiveResult(msg.result || null);
                                setArtifactOpen(true);
                                setArtifactTab("conflicts");
                              }}
                              className="rounded-xl border border-[#cc785c]/30 bg-gradient-to-r from-[#cc785c]/10 to-[#20201d] p-3.5 flex items-center justify-between cursor-pointer hover:border-[#cc785c]/60 transition group shadow-sm"
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-[#cc785c]/20 text-[#cc785c]">
                                  <AlertTriangle className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-[#f4f3ef]">
                                    {msg.result.conflicts_detected.length} Cross-Document Discrepancies Found
                                  </p>
                                  <p className="text-[11px] text-[#9c9a92]">
                                    Conflicting payment terms and delivery dates detected across files.
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-[#cc785c] font-medium group-hover:translate-x-0.5 transition">
                                <span>Inspect in Dossier</span>
                                <ChevronRight className="w-4 h-4" />
                              </div>
                            </div>
                          )}

                          {/* Source Citations Badges */}
                          {msg.result && msg.result.citations.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              <span className="text-[10px] text-[#787670] uppercase font-mono tracking-wider mr-1">
                                Grounded in:
                              </span>
                              {msg.result.citations.map((cite, i) => (
                                <button
                                  key={i}
                                  onClick={() => {
                                    setActiveResult(msg.result || null);
                                    setArtifactOpen(true);
                                    setArtifactTab("sources");
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#1e1e1c] border border-[#2b2b27] hover:border-[#cc785c]/40 text-[11px] text-[#a8a49c] hover:text-[#f4f3ef] transition cursor-pointer"
                                >
                                  <FileText className="w-3 h-3 text-[#cc785c]" />
                                  <span>{cite.doc_name}</span>
                                  <span className="text-[10px] text-[#787670]">p.{cite.page_number}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Investigating Loading Indicator */}
                {loading && (
                  <div className="flex gap-3 max-w-2xl">
                    <div className="w-7 h-7 rounded-lg bg-[#cc785c]/15 border border-[#cc785c]/30 flex items-center justify-center text-[#cc785c] flex-shrink-0 mt-0.5 animate-pulse">
                      <Sparkles className="w-4 h-4 fill-[#cc785c]" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#9c9a92] pt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#cc785c] animate-ping" />
                      <span>Investigating cross-document consensus, citations, and conflicts...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Error Notice */}
            {error && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">✕</button>
              </div>
            )}
          </div>
        </main>

        {/* Permanently Fixed Compact Input Bar at the Bottom */}
        <div className="flex-shrink-0 w-full px-5 pb-3 pt-2 bg-gradient-to-t from-[#141413] via-[#141413]/95 to-transparent flex flex-col items-center z-10">
          <div className="w-full max-w-3xl">
            <div className="bg-[#1e1e1c] border border-[#2e2e29] focus-within:border-[#cc785c]/60 rounded-xl px-3 py-2 shadow-lg transition">
              {/* Ultra-compact Active Document Pill */}
              {documents.length > 0 && (
                <div className="flex items-center gap-1.5 pb-1.5 text-[10px] text-[#787670] border-b border-[#292925] mb-1.5">
                  <Layers className="w-3 h-3 text-[#cc785c]" />
                  <span>{documents.length} files active:</span>
                  <div className="flex items-center gap-1 overflow-hidden truncate">
                    {documents.slice(0, 3).map((d) => (
                      <span key={d.id} className="px-1.5 py-0.2 rounded bg-[#272724] text-[#a8a49c] truncate text-[9px]">
                        {d.filename}
                      </span>
                    ))}
                    {documents.length > 3 && (
                      <span className="text-[9px] text-[#787670]">+{documents.length - 3}</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      executeInvestigation();
                    }
                  }}
                  placeholder={
                    documents.length === 0
                      ? "Load demo case or add documents to start investigating..."
                      : "Ask docV.ai to audit, compare, or uncover conflicts..."
                  }
                  className="flex-1 bg-transparent border-0 text-sm text-[#f4f3ef] placeholder-[#6b6963] focus:outline-none resize-none max-h-24 min-h-[32px] py-1 leading-relaxed"
                />

                <button
                  onClick={() => executeInvestigation()}
                  disabled={loading || !inputQuery.trim() || documents.length === 0}
                  className="w-7 h-7 rounded-lg bg-[#cc785c] hover:bg-[#db886d] disabled:bg-[#2b2b27] text-white flex items-center justify-center transition cursor-pointer disabled:cursor-not-allowed disabled:text-[#5a5953] flex-shrink-0"
                  title="Send"
                >
                  <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>
            </div>
            <p className="text-[9px] text-center text-[#5a5953] mt-1.5">
              docV.ai • ALG-AI-02 Intelligent Document Investigator
            </p>
          </div>
        </div>
      </div>

      {/* 3. Right Panel: Investigation Dossier & Artifacts (Claude Split-Screen) */}
      {artifactOpen && activeResult && (
        <aside className="w-96 border-l border-[#242421] bg-[#1a1a18] flex flex-col h-full z-20 shadow-2xl transition-all">
          {/* Dossier Header */}
          <div className="p-4 border-b border-[#242421] flex items-center justify-between bg-[#161615]">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-[#cc785c]/10 text-[#cc785c]">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-[#f4f3ef]">Investigation Dossier</h3>
                <p className="text-[10px] text-[#787670]">Forensic Evidence & Conflict Matrix</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handleExportReport}
                className="p-1.5 text-[#9c9a92] hover:text-[#f4f3ef] rounded-md hover:bg-[#242421] transition cursor-pointer"
                title="Download Markdown Report"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => setArtifactOpen(false)}
                className="p-1.5 text-[#9c9a92] hover:text-[#f4f3ef] rounded-md hover:bg-[#242421] transition cursor-pointer"
                title="Close Dossier"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dossier Tabs */}
          <div className="flex border-b border-[#242421] bg-[#1a1a18] px-3 pt-2 gap-1 text-xs">
            <button
              onClick={() => setArtifactTab("conflicts")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
                artifactTab === "conflicts"
                  ? "border-[#cc785c] text-[#cc785c]"
                  : "border-transparent text-[#787670] hover:text-[#a8a49c]"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Conflicts ({activeResult.conflicts_detected.length})</span>
            </button>

            <button
              onClick={() => setArtifactTab("uncertainty")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
                artifactTab === "uncertainty"
                  ? "border-[#cc785c] text-[#cc785c]"
                  : "border-transparent text-[#787670] hover:text-[#a8a49c]"
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Grounding ({activeResult.confidence_score}%)</span>
            </button>

            <button
              onClick={() => setArtifactTab("sources")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
                artifactTab === "sources"
                  ? "border-[#cc785c] text-[#cc785c]"
                  : "border-transparent text-[#787670] hover:text-[#a8a49c]"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Sources ({activeResult.citations.length})</span>
            </button>
          </div>

          {/* Dossier Content Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Tab 1: Cross-Document Conflict Matrix */}
            {artifactTab === "conflicts" && (
              <div className="space-y-3.5">
                {activeResult.conflicts_detected.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#787670] border border-dashed border-[#292925] rounded-xl">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                    No cross-document contradictions detected.
                  </div>
                ) : (
                  activeResult.conflicts_detected.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-[#383832] bg-[#20201d] p-3.5 space-y-3 shadow-md"
                    >
                      <div className="flex items-center justify-between border-b border-[#292925] pb-2">
                        <span className="font-medium text-xs text-[#f4f3ef]">{item.topic}</span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            item.severity === "HIGH"
                              ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                              : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {item.severity}
                        </span>
                      </div>

                      {/* Side-by-side claim boxes */}
                      <div className="space-y-2 text-xs">
                        <div className="p-2 rounded-lg bg-[#161615] border border-[#2b2b27] space-y-1">
                          <span className="text-[10px] text-[#cc785c] font-medium block truncate">
                            {item.document_a}
                          </span>
                          <p className="text-[11px] text-[#dedbd4] font-mono leading-relaxed">
                            "{item.claim_a}"
                          </p>
                        </div>

                        <div className="p-2 rounded-lg bg-[#161615] border border-[#2b2b27] space-y-1">
                          <span className="text-[10px] text-rose-400 font-medium block truncate">
                            {item.document_b}
                          </span>
                          <p className="text-[11px] text-[#dedbd4] font-mono leading-relaxed">
                            "{item.claim_b}"
                          </p>
                        </div>
                      </div>

                      {/* Auditor Note */}
                      <div className="text-[11px] text-[#9c9a92] leading-relaxed pt-1 border-t border-[#292925]">
                        <span className="text-[#cc785c] font-medium">Resolution: </span>
                        {item.resolution_note}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 2: Uncertainty & Grounding Metrics */}
            {artifactTab === "uncertainty" && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#20201d] border border-[#2b2b27] space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#9c9a92]">Grounding Score</span>
                    <span className="font-bold text-[#f4f3ef] text-sm">{activeResult.confidence_score}%</span>
                  </div>
                  <div className="w-full bg-[#161615] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#cc785c] h-full rounded-full transition-all"
                      style={{ width: `${activeResult.confidence_score}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-[#787670] flex justify-between">
                    <span>Uncertainty Level:</span>
                    <span className="font-semibold text-emerald-400">{activeResult.uncertainty_level}</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#20201d] border border-[#2b2b27] space-y-2">
                  <h4 className="text-xs font-semibold text-[#dedbd4] flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-[#cc785c]" />
                    Factors & Caveats
                  </h4>
                  <ul className="text-xs text-[#9c9a92] space-y-1.5 list-disc list-inside">
                    {activeResult.uncertainty_reasons.map((reason, i) => (
                      <li key={i} className="text-[11px] leading-relaxed">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Tab 3: Verbatim Source Excerpts */}
            {artifactTab === "sources" && (
              <div className="space-y-3">
                {activeResult.citations.map((cite, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-[#20201d] border border-[#2b2b27] space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between text-[#cc785c] font-medium text-[11px]">
                      <span className="truncate">{cite.doc_name}</span>
                      <span className="text-[10px] text-[#787670] font-mono px-1.5 py-0.2 rounded bg-[#161615]">
                        Page {cite.page_number}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#dedbd4] font-mono bg-[#161615] p-2.5 rounded-lg border border-[#242421] leading-relaxed">
                      "{cite.quote}"
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
