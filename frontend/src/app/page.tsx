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
    const report = `# docV.ai — Investigation Report
Generated: ${new Date().toLocaleString()}
Query: "${activeResult.query}"

---

## 1. Synthesis
${activeResult.synthesized_answer}

## 2. Grounding & Uncertainty
- **Grounding Score:** ${activeResult.confidence_score}%
- **Uncertainty Level:** ${activeResult.uncertainty_level}
- **Factors & Caveats:**
${activeResult.uncertainty_reasons.map((r) => `  * ${r}`).join("\n")}

## 3. Discrepancies (${activeResult.conflicts_detected.length} Detected)
${activeResult.conflicts_detected
  .map(
    (c, i) => `
### Discrepancy ${i + 1}: ${c.topic} [Severity: ${c.severity}]
- **Source A (${c.document_a}):** "${c.claim_a}"
- **Source B (${c.document_b}):** "${c.claim_b}"
- **Resolution:** ${c.resolution_note}
`
  )
  .join("\n")}

## 4. Sources (${activeResult.citations.length})
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
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)] font-sans">
      {/* 1. Left Sidebar: Document Vault */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } transition-all duration-300 ease-in-out border-r border-[var(--border-subtle)] bg-[var(--surface)] flex flex-col overflow-hidden relative z-20`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--text)]">
              <Sparkles className="w-4 h-4 text-[var(--text)]" />
            </div>
            <div>
              <span className="font-semibold text-sm tracking-tight text-[var(--text)]">docV.ai</span>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-md hover:bg-[var(--surface-raised)] transition cursor-pointer"
            title="Collapse Sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* New Session Action */}
        <div className="p-3">
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[var(--surface-raised)] hover:bg-[#20201d] border border-[var(--border)] text-xs font-medium text-[var(--text)] transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>New Investigation</span>
          </button>
        </div>

        {/* Upload & Knowledge Repository */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-[var(--text-muted)] mb-2 px-1">
              <span>Documents</span>
              <span className="text-xs bg-[var(--surface-raised)] px-1.5 py-0.5 rounded text-[var(--text-muted)]">
                {documents.length}
              </span>
            </div>

            {/* Drag & Drop Upload Tile */}
            <label className="border border-dashed border-[var(--border)] hover:border-[var(--accent)] bg-[var(--surface-raised)] rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition group">
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
              <UploadCloud className="w-5 h-5 text-[var(--text-muted)] group-hover:text-[var(--text)] transition" />
              <div className="text-center">
                <p className="text-xs font-medium text-[var(--text)]">
                  {uploading ? "Ingesting & indexing..." : "Add documents"}
                </p>
                <p className="text-xs text-[var(--text-muted)]">PDFs, Scanned OCR, Text</p>
              </div>
            </label>
          </div>

          {/* Active Documents List */}
          <div className="space-y-1.5">
            {documents.length === 0 ? (
              <div className="p-4 text-center text-[var(--text-muted)] text-xs">
                No documents loaded.
                <button
                  onClick={handleLoadSample}
                  className="block mx-auto mt-2 text-xs text-[var(--accent)] hover:underline cursor-pointer"
                >
                  Load Demo Case
                </button>
              </div>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-2.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] transition flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                    <div className="overflow-hidden">
                      <p className="text-xs text-[var(--text)] truncate font-medium">{doc.filename}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {doc.total_pages} {doc.total_pages === 1 ? "page" : "pages"} • {doc.file_type.toUpperCase()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* 2. Main Stage: Conversation & Query View */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)]">
        {/* Top Navbar */}
        <header className="h-13 border-b border-[var(--border-subtle)] px-5 flex items-center justify-between bg-[var(--bg)]/90 backdrop-blur-sm z-10">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-[var(--text-muted)] hover:text-[var(--text)] p-1.5 rounded-md hover:bg-[var(--surface-raised)] transition cursor-pointer"
                title="Expand Document Vault"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text)] tracking-tight">docV.ai</span>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="text-xs text-[var(--text-muted)]">Intelligent Document Investigator</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleLoadSample}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition cursor-pointer disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load Demo Case</span>
            </button>

            {activeResult && !artifactOpen && (
              <button
                onClick={() => setArtifactOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--border-subtle)] text-[var(--text)] transition cursor-pointer"
              >
                <PanelRightOpen className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span>Findings ({activeResult.conflicts_detected.length})</span>
              </button>
            )}
          </div>
        </header>

        {/* Conversation Message Stream */}
        <main className="flex-1 overflow-y-auto px-6 py-6 flex flex-col items-center">
          <div className="w-full max-w-3xl flex-1 flex flex-col justify-between">
            {/* If No Messages: Clean Greeting */}
            {messages.length === 0 ? (
              <div className="my-auto text-center space-y-6 py-12">
                <div className="w-10 h-10 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center mx-auto text-[var(--text)]">
                  <Sparkles className="w-5 h-5 text-[var(--text)]" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-xl font-medium tracking-tight text-[var(--text)]">
                    What would you like to investigate?
                  </h1>
                  <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
                    Upload multi-page contracts, invoices, or addenda. docV.ai cross-references claims,
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
                    className="p-3.5 rounded-lg bg-[var(--surface-raised)] hover:bg-[#20201d] border border-[var(--border)] transition text-left cursor-pointer space-y-1 group"
                  >
                    <div className="font-medium text-xs text-[var(--text)] group-hover:text-[var(--accent)] flex items-center gap-1.5">
                      <span>Milestone 1 Price & Deadline</span>
                      <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                      Cross-checks MSA vs. Addendum vs. Invoice for billing discrepancies.
                    </p>
                  </button>

                  <button
                    onClick={() => {
                      if (documents.length === 0) handleLoadSample();
                      else executeInvestigation("Are there any penalty or governing law stipulations?");
                    }}
                    className="p-3.5 rounded-lg bg-[var(--surface-raised)] hover:bg-[#20201d] border border-[var(--border)] transition text-left cursor-pointer space-y-1 group"
                  >
                    <div className="font-medium text-xs text-[var(--text)] group-hover:text-[var(--accent)] flex items-center gap-1.5">
                      <span>Penalties & Governing Law</span>
                      <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
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
                        <div className="max-w-xl bg-[var(--surface-raised)] text-[var(--text)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[15px] leading-relaxed">
                          {msg.text}
                        </div>
                      </div>
                    ) : (
                      /* docV.ai Assistant Message */
                      <div className="flex gap-3 max-w-2xl">
                        <div className="w-7 h-7 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--text)] flex-shrink-0 mt-0.5">
                          <Sparkles className="w-4 h-4 text-[var(--text)]" />
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="text-[15px] leading-relaxed text-[var(--text)] space-y-2.5">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({ node, ...props }) => <h1 className="text-base font-semibold text-[var(--text)] mt-3 mb-1.5" {...props} />,
                                h2: ({ node, ...props }) => <h2 className="text-sm font-semibold text-[var(--text)] mt-3 mb-1.5 border-b border-[var(--border-subtle)] pb-1" {...props} />,
                                h3: ({ node, ...props }) => <h3 className="text-xs font-semibold text-[var(--text)] mt-2.5 mb-1" {...props} />,
                                p: ({ node, ...props }) => <p className="mb-2 leading-relaxed text-[var(--text)]" {...props} />,
                                strong: ({ node, ...props }) => <strong className="font-semibold text-[var(--text)]" {...props} />,
                                ul: ({ node, ...props }) => <ul className="list-disc list-inside space-y-1 mb-2.5 pl-1 text-[15px] text-[var(--text)]" {...props} />,
                                ol: ({ node, ...props }) => <ol className="list-decimal list-inside space-y-1 mb-2.5 pl-1 text-[15px] text-[var(--text)]" {...props} />,
                                li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                                hr: () => <hr className="border-[var(--border-subtle)] my-3" />,
                                table: ({ node, ...props }) => (
                                  <div className="overflow-x-auto my-3 rounded border border-[var(--border)]">
                                    <table className="w-full text-left text-xs border-collapse" {...props} />
                                  </div>
                                ),
                                thead: ({ node, ...props }) => <thead className="bg-[var(--surface-raised)] text-[var(--text)] border-b border-[var(--border)]" {...props} />,
                                th: ({ node, ...props }) => <th className="p-2.5 font-medium text-xs text-[var(--text-muted)] border-b border-[var(--border)]" {...props} />,
                                td: ({ node, children, ...props }) => {
                                  const getText = (c: any): string => {
                                    if (!c) return "";
                                    if (typeof c === "string") return c;
                                    if (typeof c === "number") return String(c);
                                    if (Array.isArray(c)) return c.map(getText).join("");
                                    if (c.props?.children) return getText(c.props.children);
                                    return "";
                                  };
                                  const raw = getText(children).trim();
                                  const isMismatch = /discrepan|mismatch|conflict|overbill|unapproved|\+\$|\$72,500|april 10/i.test(raw);
                                  return (
                                    <td
                                      className={`p-2.5 border-t border-[var(--border-subtle)] text-xs leading-relaxed ${
                                        isMismatch
                                          ? "bg-[var(--danger-bg)] text-[var(--danger)] font-medium"
                                          : "text-[var(--text)]"
                                      }`}
                                      {...props}
                                    >
                                      {children}
                                    </td>
                                  );
                                },
                                blockquote: ({ node, ...props }) => (
                                  <blockquote className="border-l-2 border-[var(--border)] pl-3 py-1 my-2 text-xs italic text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-r" {...props} />
                                ),
                                code: ({ node, className, children, ...props }) => (
                                  <code className="px-1.5 py-0.5 rounded bg-[var(--surface-raised)] text-[var(--text)] font-mono text-xs border border-[var(--border-subtle)]" {...props}>
                                    {children}
                                  </code>
                                )
                              }}
                            >
                              {msg.text}
                            </ReactMarkdown>
                          </div>

                          {/* Conflict Discrepancy Banner */}
                          {msg.result && msg.result.conflicts_detected.length > 0 && (() => {
                            const count = msg.result.conflicts_detected.length;
                            const countLabel = `${count} ${count === 1 ? "discrepancy" : "discrepancies"} found`;
                            return (
                              <div
                                onClick={() => {
                                  setActiveResult(msg.result || null);
                                  setArtifactOpen(true);
                                  setArtifactTab("conflicts");
                                }}
                                className="rounded-lg border border-[var(--accent)]/40 bg-[var(--surface-raised)] hover:border-[var(--accent)] p-3 flex items-center justify-between cursor-pointer transition"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="p-2 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                                    <AlertTriangle className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-[var(--text)]">
                                      {countLabel}
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)]">
                                      Conflicting payment terms or delivery dates detected across files.
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-[var(--accent)] font-medium">
                                  <span>Inspect</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </div>
                              </div>
                            );
                          })()}

                          {/* Deduplicated Source Citations */}
                          {msg.result && msg.result.citations.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              <span className="text-xs text-[var(--text-muted)] mr-1">
                                Sources:
                              </span>
                              {Array.from(
                                new Map(
                                  msg.result.citations.map((c) => [`${c.doc_name}-${c.page_number}`, c])
                                ).values()
                              ).map((cite, i) => (
                                <button
                                  key={i}
                                  onClick={() => {
                                    setActiveResult(msg.result || null);
                                    setArtifactOpen(true);
                                    setArtifactTab("sources");
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--border-subtle)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition cursor-pointer"
                                >
                                  <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                                  <span>{cite.doc_name}</span>
                                  <span className="text-[var(--text-muted)]/70">p.{cite.page_number}</span>
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
                    <div className="w-7 h-7 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] flex-shrink-0 mt-0.5 animate-pulse">
                      <Sparkles className="w-4 h-4 text-[var(--text-muted)]" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping" />
                      <span>Investigating cross-document consensus, citations, and conflicts...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Error Notice */}
            {error && (
              <div className="mt-3 p-3 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger)]/30 text-[var(--danger)] text-xs flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-[var(--danger)] hover:text-[var(--text)]">✕</button>
              </div>
            )}
          </div>
        </main>

        {/* Fixed Input Bar */}
        <div className="flex-shrink-0 w-full px-5 pb-3 pt-2 bg-[var(--bg)] border-t border-[var(--border-subtle)] flex flex-col items-center z-10">
          <div className="w-full max-w-3xl">
            <div className="bg-[var(--surface-raised)] border border-[var(--border)] focus-within:border-[var(--accent)] rounded-lg px-3 py-2 transition">
              {/* Active Document Indicator */}
              {documents.length > 0 && (
                <div className="flex items-center gap-1.5 pb-1.5 text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)] mb-1.5">
                  <Layers className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <span>{documents.length} {documents.length === 1 ? "document" : "documents"} loaded:</span>
                  <div className="flex items-center gap-1 overflow-hidden truncate">
                    {documents.slice(0, 3).map((d) => (
                      <span key={d.id} className="px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-muted)] truncate text-xs">
                        {d.filename}
                      </span>
                    ))}
                    {documents.length > 3 && (
                      <span className="text-xs text-[var(--text-muted)]">+{documents.length - 3}</span>
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
                  className="flex-1 bg-transparent border-0 text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none resize-none max-h-24 min-h-[32px] py-1 leading-relaxed"
                />

                <button
                  onClick={() => executeInvestigation()}
                  disabled={loading || !inputQuery.trim() || documents.length === 0}
                  className="w-7 h-7 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--border)] text-white flex items-center justify-center transition cursor-pointer disabled:cursor-not-allowed disabled:text-[var(--text-muted)] flex-shrink-0"
                  title="Send"
                >
                  <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Right Panel: Findings & Artifacts */}
      {artifactOpen && activeResult && (
        <aside className="w-96 border-l border-[var(--border-subtle)] bg-[var(--surface)] flex flex-col h-full z-20 transition-all">
          {/* Findings Header */}
          <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface)]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--text)]">
                <ShieldCheck className="w-4 h-4 text-[var(--text)]" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-[var(--text)]">Findings</h3>
                <p className="text-xs text-[var(--text-muted)]">Evidence</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handleExportReport}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] rounded-md hover:bg-[var(--surface-raised)] transition cursor-pointer"
                title="Download Markdown Report"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => setArtifactOpen(false)}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] rounded-md hover:bg-[var(--surface-raised)] transition cursor-pointer"
                title="Close Findings"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Findings Tabs */}
          <div className="flex border-b border-[var(--border-subtle)] bg-[var(--surface)] px-3 pt-2 gap-1 text-xs">
            <button
              onClick={() => setArtifactTab("conflicts")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
                artifactTab === "conflicts"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Discrepancies ({activeResult.conflicts_detected.length})</span>
            </button>

            <button
              onClick={() => setArtifactTab("uncertainty")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
                artifactTab === "uncertainty"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Grounding ({activeResult.confidence_score}%)</span>
            </button>

            <button
              onClick={() => setArtifactTab("sources")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
                artifactTab === "sources"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
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
                  <div className="p-6 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-[var(--success)] mx-auto mb-2" />
                    No cross-document contradictions detected.
                  </div>
                ) : (
                  activeResult.conflicts_detected.map((item, idx) => (
                    <div
                      key={idx}
                      className="border-b border-[var(--border)] pb-4 pt-1 space-y-2.5 last:border-b-0"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-xs text-[var(--text)]">{item.topic}</span>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                            item.severity === "HIGH"
                              ? "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger)]/30"
                              : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                          }`}
                        >
                          {item.severity}
                        </span>
                      </div>

                      {/* Clean claim comparison */}
                      <div className="space-y-2 text-xs">
                        <div className="border-l-2 border-[var(--border)] pl-2.5 py-0.5 space-y-0.5">
                          <span className="text-xs text-[var(--text-muted)] font-medium block truncate">
                            {item.document_a}
                          </span>
                          <p className="text-xs text-[var(--text)] font-mono leading-relaxed">
                            "{item.claim_a}"
                          </p>
                        </div>

                        <div className="border-l-2 border-[var(--border)] pl-2.5 py-0.5 space-y-0.5">
                          <span className="text-xs text-[var(--text-muted)] font-medium block truncate">
                            {item.document_b}
                          </span>
                          <p className="text-xs text-[var(--text)] font-mono leading-relaxed">
                            "{item.claim_b}"
                          </p>
                        </div>
                      </div>

                      {/* Resolution Note with Markdown Rendering */}
                      <div className="text-xs text-[var(--text-muted)] leading-relaxed pt-1.5 border-t border-[var(--border-subtle)]">
                        <span className="text-[var(--text)] font-medium mr-1">Resolution:</span>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ node, ...p }) => <span className="inline text-[var(--text-muted)]" {...p} />,
                            strong: ({ node, ...p }) => <strong className="font-semibold text-[var(--text)]" {...p} />,
                            em: ({ node, ...p }) => <em className="italic text-[var(--text)]" {...p} />,
                            code: ({ node, ...p }) => (
                              <code className="px-1 py-0.5 rounded bg-[var(--surface-raised)] text-[var(--text)] font-mono text-[11px]" {...p} />
                            )
                          }}
                        >
                          {item.resolution_note}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 2: Uncertainty & Grounding Metrics */}
            {artifactTab === "uncertainty" && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Grounding Score</span>
                    <span className="font-semibold text-[var(--text)] text-sm">{activeResult.confidence_score}%</span>
                  </div>
                  <div className="w-full bg-[var(--surface)] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[var(--accent)] h-full rounded-full transition-all"
                      style={{ width: `${activeResult.confidence_score}%` }}
                    />
                  </div>
                  <div className="text-xs text-[var(--text-muted)] flex justify-between">
                    <span>Uncertainty Level:</span>
                    <span className="font-semibold text-[var(--text)]">{activeResult.uncertainty_level}</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] space-y-2">
                  <h4 className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    Factors & Caveats
                  </h4>
                  <ul className="text-xs text-[var(--text-muted)] space-y-1.5 list-disc list-inside">
                    {activeResult.uncertainty_reasons.map((reason, i) => (
                      <li key={i} className="leading-relaxed">
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
                    className="border-b border-[var(--border)] pb-3 pt-1 space-y-1.5 last:border-b-0 text-xs"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[var(--text)] truncate">{cite.doc_name}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        Page {cite.page_number}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] font-mono bg-[var(--surface-raised)] p-2.5 rounded border border-[var(--border-subtle)] leading-relaxed">
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
