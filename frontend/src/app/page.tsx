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
  ChevronDown,
  Plus,
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

function extractConflictSummary(item: ConflictItem): string {
  const amountPattern = /\$[\d,]+(?:\.\d+)?/g;
  const amountsA = item.claim_a.match(amountPattern) || [];
  const amountsB = item.claim_b.match(amountPattern) || [];
  
  if (amountsA.length > 0 && amountsB.length > 0) {
    const valA = amountsA.length > 1 && /to\s+\$[\d,]+/i.test(item.claim_a) 
      ? amountsA[amountsA.length - 1] 
      : amountsA[0];
    const valB = amountsB.length > 1 && /to\s+\$[\d,]+/i.test(item.claim_b) 
      ? amountsB[amountsB.length - 1] 
      : amountsB[0];

    if (valA && valB && valA !== valB) {
      const isInvoiceB = /invoice|bill|inv-/i.test(item.document_b) || /invoice|bill|billed/i.test(item.claim_b);
      const isInvoiceA = /invoice|bill|inv-/i.test(item.document_a) || /invoice|bill|billed/i.test(item.claim_a);
      if (isInvoiceB) {
        return `Invoice bills ${valB} vs ${valA} approved`;
      }
      if (isInvoiceA) {
        return `Invoice bills ${valA} vs ${valB} approved`;
      }
      return `Amount changed ${amountsA[0]} -> ${amountsB[amountsB.length - 1]}`;
    }
  }

  const dateRegex = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?/gi;
  const datesA = item.claim_a.match(dateRegex) || [];
  const datesB = item.claim_b.match(dateRegex) || [];
  const dateA = datesA[0];
  const dateB = datesB[0];
  if (dateA && dateB && dateA.toLowerCase() !== dateB.toLowerCase()) {
    const shortenDate = (d: string) => {
      return d.replace(/January/i, "Jan")
        .replace(/February/i, "Feb")
        .replace(/March/i, "Mar")
        .replace(/April/i, "Apr")
        .replace(/June/i, "Jun")
        .replace(/July/i, "Jul")
        .replace(/August/i, "Aug")
        .replace(/September/i, "Sep")
        .replace(/October/i, "Oct")
        .replace(/November/i, "Nov")
        .replace(/December/i, "Dec")
        .replace(/,\s*\d{4}/, "");
    };
    return `deadline moved ${shortenDate(dateA)} -> ${shortenDate(dateB)}`;
  }

  if (item.topic) {
    return item.topic;
  }
  return `${item.document_a} vs ${item.document_b}`;
}

function generateBannerSubtitle(conflicts: ConflictItem[]): string {
  if (!conflicts || conflicts.length === 0) return "";
  const summaries = conflicts.map(extractConflictSummary);
  if (summaries.length === 1) {
    return summaries[0];
  }
  const top2 = summaries.slice(0, 2);
  let text = top2.join(" and ");
  if (summaries.length > 2) {
    text += `, +${summaries.length - 2} more`;
  }
  return text;
}

function cleanSectionHeadings(markdown: string): string {
  const hasMultiple = /#{1,4}\s+2\.\s+/m.test(markdown);
  if (!hasMultiple) {
    return markdown.replace(/^(#{1,4}\s+)1\.\s+/gm, "$1");
  }
  return markdown;
}

function getConflictValues(item: ConflictItem): string[] {
  const combined = `${item.claim_a} ${item.claim_b} ${item.topic}`;
  const amounts = combined.match(/\$[\d,]+(?:\.\d+)?/g) || [];
  const dates = combined.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?/gi) || [];
  return Array.from(new Set([...amounts, ...dates]));
}

function getAllConflictValues(conflicts: ConflictItem[]): string[] {
  const all: string[] = [];
  for (const c of conflicts) {
    all.push(...getConflictValues(c));
  }
  return Array.from(new Set(all));
}

function highlightQuoteValues(quote: string, relevantValues: string[]) {
  if (!quote || !relevantValues || relevantValues.length === 0) return quote;
  
  const uniqueVals = Array.from(new Set(relevantValues.filter(v => v && v.trim().length >= 2)));
  if (uniqueVals.length === 0) return quote;

  uniqueVals.sort((a, b) => b.length - a.length);
  const pattern = uniqueVals.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');

  const parts = quote.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = uniqueVals.some(v => v.toLowerCase() === part.toLowerCase());
        if (isMatch) {
          return (
            <mark
              key={i}
              className="bg-[var(--accent)]/20 text-[var(--text)] font-bold px-1 py-0.2 rounded border border-[var(--accent)]/30 not-italic"
            >
              {part}
            </mark>
          );
        }
        return part;
      })}
    </>
  );
}

export default function Home() {
  const [apiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isUp = scrollHeight - scrollTop - clientHeight > 100;
    setShowScrollBottom(isUp);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleInspectConflict = (result: InvestigationResult, targetIndex: number = 0) => {
    setActiveResult(result);
    setArtifactTab("conflicts");
    setArtifactOpen(true);
    setTimeout(() => {
      const el = document.getElementById(`conflict-item-${targetIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 120);
  };

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
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
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
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
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
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[var(--surface-raised)] hover:bg-[#20201d] border border-[var(--border)] text-sm font-medium text-[var(--text)] transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>New Investigation</span>
          </button>
        </div>

        {/* Upload & Knowledge Repository */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          <div>
            <div className="flex items-center justify-between text-sm font-medium text-[var(--text-muted)] mb-2 px-1">
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
                <p className="text-sm font-medium text-[var(--text)]">
                  {uploading ? "Ingesting & indexing..." : "Add documents"}
                </p>
                <p className="text-xs text-[var(--text-muted)]">PDFs, Scanned OCR, Text</p>
              </div>
            </label>
          </div>

          {/* Active Documents List */}
          <div className="space-y-1.5">
            {documents.length === 0 ? (
              <div className="p-4 text-center text-[var(--text-muted)] text-sm">
                No documents loaded.
                <button
                  onClick={handleLoadSample}
                  className="block mx-auto mt-2 text-sm text-[var(--accent)] hover:underline cursor-pointer"
                >
                  Load Demo Case
                </button>
              </div>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-2.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] transition flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                    <div className="overflow-hidden">
                      <p className="text-sm text-[var(--text)] truncate font-medium">{doc.filename}</p>
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
      <div className="flex-1 relative flex flex-col h-full overflow-hidden bg-[var(--bg)]">
        {/* Top Navbar */}
        <header className="absolute top-0 inset-x-0 h-13 px-5 flex items-center justify-between bg-[var(--bg)]/80 backdrop-blur-md z-20">
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
              <span className="text-[15px] font-semibold text-[var(--text)] tracking-tight">docV.ai</span>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="text-sm text-[var(--text-muted)]">Intelligent Document Investigator</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleLoadSample}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition cursor-pointer disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load Demo Case</span>
            </button>

            {activeResult && !artifactOpen && (
              <button
                onClick={() => setArtifactOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--border-subtle)] text-[var(--text)] transition cursor-pointer"
              >
                <PanelRightOpen className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span>Findings ({activeResult.conflicts_detected.length})</span>
              </button>
            )}
          </div>
        </header>

        {/* Top Edge Fade Gradient under header */}
        <div
          className="absolute top-[52px] inset-x-0 h-10 pointer-events-none z-10"
          style={{
            background: "linear-gradient(to bottom, var(--bg) 0%, transparent 100%)"
          }}
        />

        {/* Conversation Message Stream */}
        <main
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto px-6 pt-[72px] pb-48 flex flex-col items-center"
        >
          <div className="w-full max-w-3xl flex-1 flex flex-col justify-between">
            {/* If No Messages: Clean Greeting */}
            {messages.length === 0 ? (
              <div className="my-auto text-center space-y-6 py-12">
                <div className="w-10 h-10 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center mx-auto text-[var(--text)]">
                  <Sparkles className="w-5 h-5 text-[var(--text)]" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl font-medium tracking-tight text-[var(--text)]">
                    What would you like to investigate?
                  </h1>
                  <p className="text-[15px] text-[var(--text-muted)] max-w-lg mx-auto leading-relaxed">
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
                    <div className="font-medium text-sm text-[var(--text)] group-hover:text-[var(--accent)] flex items-center gap-1.5">
                      <span>Milestone 1 Price & Deadline</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    </div>
                    <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
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
                    <div className="font-medium text-sm text-[var(--text)] group-hover:text-[var(--accent)] flex items-center gap-1.5">
                      <span>Penalties & Governing Law</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    </div>
                    <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
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
                        <div className="max-w-xl bg-[var(--surface-raised)] text-[var(--text)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[16px] leading-relaxed">
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
                          <div className="text-[16px] leading-relaxed text-[var(--text)] space-y-3">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({ node, ...props }) => <h1 className="text-lg font-semibold text-[var(--text)] mt-3.5 mb-2" {...props} />,
                                h2: ({ node, ...props }) => <h2 className="text-base font-semibold text-[var(--text)] mt-3.5 mb-2 border-b border-[var(--border-subtle)] pb-1" {...props} />,
                                h3: ({ node, ...props }) => <h3 className="text-sm font-semibold text-[var(--text)] mt-3 mb-1" {...props} />,
                                p: ({ node, ...props }) => <p className="mb-2.5 leading-relaxed text-[var(--text)] text-[15.5px]" {...props} />,
                                strong: ({ node, ...props }) => <strong className="font-semibold text-[var(--text)]" {...props} />,
                                ul: ({ node, ...props }) => <ul className="list-disc list-inside space-y-1 mb-2.5 pl-1 text-[15.5px] text-[var(--text)]" {...props} />,
                                ol: ({ node, ...props }) => <ol className="list-decimal list-inside space-y-1 mb-2.5 pl-1 text-[15.5px] text-[var(--text)]" {...props} />,
                                li: ({ node, ...props }) => <li className="leading-relaxed text-[15.5px]" {...props} />,
                                hr: () => <hr className="border-[var(--border-subtle)] my-3" />,
                                table: ({ node, ...props }) => (
                                  <div className="overflow-x-auto my-3 rounded border border-[var(--border)]">
                                    <table className="w-full text-left text-sm border-collapse" {...props} />
                                  </div>
                                ),
                                thead: ({ node, ...props }) => <thead className="bg-[var(--surface-raised)] text-[var(--text)] border-b border-[var(--border)]" {...props} />,
                                th: ({ node, ...props }) => <th className="p-2.5 font-semibold text-xs text-[var(--text-muted)] border-b border-[var(--border)]" {...props} />,
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
                                      className={`p-2.5 border-t border-[var(--border-subtle)] text-[13.5px] leading-relaxed ${
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
                                  <blockquote className="border-l-2 border-[var(--border)] pl-3 py-1 my-2 text-sm italic text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-r" {...props} />
                                ),
                                code: ({ node, className, children, ...props }) => (
                                  <code className="px-1.5 py-0.5 rounded bg-[var(--surface-raised)] text-[var(--text)] font-mono text-[13px] border border-[var(--border-subtle)]" {...props}>
                                    {children}
                                  </code>
                                )
                              }}
                            >
                              {cleanSectionHeadings(msg.text)}
                            </ReactMarkdown>
                          </div>

                          {/* Conflict Discrepancy Banner */}
                          {msg.result && msg.result.conflicts_detected.length > 0 && (() => {
                            const count = msg.result.conflicts_detected.length;
                            const countLabel = `${count} ${count === 1 ? "discrepancy" : "discrepancies"} found`;
                            const subtitle = generateBannerSubtitle(msg.result.conflicts_detected);
                            return (
                              <div
                                onClick={() => handleInspectConflict(msg.result!)}
                                className="rounded-lg border border-[var(--accent)]/40 bg-[var(--surface-raised)] hover:border-[var(--accent)] p-3 flex items-center justify-between cursor-pointer transition"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="p-2 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                                    <AlertTriangle className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-[var(--text)]">
                                      {countLabel}
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                      {subtitle}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-sm text-[var(--accent)] font-medium">
                                  <span>Inspect</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </div>
                              </div>
                            );
                          })()}

                          {/* Deduplicated Source Citations */}
                          {msg.result && msg.result.citations.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              <span className="text-sm text-[var(--text-muted)] mr-1">
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
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--border-subtle)] text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] transition cursor-pointer"
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
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] pt-1">
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
              <div className="mt-3 p-3 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger)]/30 text-[var(--danger)] text-sm flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-[var(--danger)] hover:text-[var(--text)]">✕</button>
              </div>
            )}
          </div>
        </main>

        {/* Bottom Fade Gradient directly above and behind input bar */}
        <div
          className="absolute bottom-0 inset-x-0 pointer-events-none z-10"
          style={{
            height: "160px",
            background: "linear-gradient(to top, var(--bg) 0%, var(--bg) 40%, transparent 100%)"
          }}
        />

        {/* Floating Input Area & Scroll-to-Bottom */}
        <div className="absolute bottom-0 inset-x-0 z-20 flex flex-col items-center pointer-events-none pb-3 px-4">
          <div className="w-full max-w-3xl flex flex-col items-center">
            {/* Scroll-to-Bottom Button */}
            <div
              className={`transition-all duration-200 mb-2 ${
                showScrollBottom
                  ? "opacity-100 scale-100 pointer-events-auto"
                  : "opacity-0 scale-95 pointer-events-none"
              }`}
            >
              <button
                onClick={scrollToBottom}
                className="w-8 h-8 rounded-full bg-[var(--surface-raised)] hover:bg-[#252522] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center justify-center shadow-md shadow-black/30 transition cursor-pointer"
                title="Scroll to bottom"
                aria-label="Scroll to bottom"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Floating Input Container */}
            <div className="w-full bg-[var(--surface-raised)] border border-[var(--border)] focus-within:border-[var(--accent)]/50 rounded-[24px] px-3.5 py-2 shadow-md shadow-black/20 transition-colors pointer-events-auto">
              {/* Row 1: Subtle Document Chips */}
              {documents.length > 0 && (
                <div className="flex items-center gap-1.5 px-1 pt-0.5 pb-1 text-xs text-[var(--text-muted)]">
                  <Layers className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
                  <span className="font-normal text-[12px]">{documents.length} {documents.length === 1 ? "document" : "documents"} loaded:</span>
                  <div className="flex items-center gap-1 overflow-x-auto truncate scrollbar-none">
                    {documents.slice(0, 3).map((d) => (
                      <span
                        key={d.id}
                        className="px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-muted)] truncate text-[11.5px] max-w-[140px]"
                        title={d.filename}
                      >
                        {d.filename}
                      </span>
                    ))}
                    {documents.length > 3 && (
                      <span className="text-[11px] text-[var(--text-muted)]">+{documents.length - 3}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Row 2: Plus button, textarea, circular send button */}
              <div className="flex items-end gap-2 px-1">
                {/* Plus button for file upload */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-8 h-8 rounded-full text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] flex items-center justify-center transition flex-shrink-0 cursor-pointer disabled:opacity-50 mb-0.5"
                  title={uploading ? "Ingesting documents..." : "Add documents"}
                  aria-label="Add documents"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {/* Hidden File Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploading}
                />

                {/* Auto-growing Textarea */}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputQuery}
                  onChange={(e) => {
                    setInputQuery(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
                  }}
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
                  className="flex-1 bg-transparent border-0 text-[15px] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none resize-none max-h-36 min-h-[36px] py-1.5 px-1 leading-relaxed"
                />

                {/* Circular Send Button */}
                <button
                  onClick={() => executeInvestigation()}
                  disabled={loading || !inputQuery.trim() || documents.length === 0}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition flex-shrink-0 mb-0.5 ${
                    !loading && inputQuery.trim() && documents.length > 0
                      ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white cursor-pointer"
                      : "bg-[var(--surface)] text-[var(--text-muted)]/40 cursor-not-allowed"
                  }`}
                  title="Send"
                  aria-label="Send query"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {/* Helper Text Below Bar */}
            <p className="text-[12px] text-[var(--text-muted)] text-center pt-2 select-none pointer-events-none">
              docV.ai can make mistakes. Check important details against the source documents.
            </p>
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
                <h3 className="text-sm font-semibold text-[var(--text)]">Findings</h3>
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
          <div className="flex border-b border-[var(--border-subtle)] bg-[var(--surface)] px-3 pt-2 gap-1 text-[13px] overflow-x-auto">
            <button
              onClick={() => setArtifactTab("conflicts")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
                artifactTab === "conflicts"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="whitespace-nowrap">Conflicts ({activeResult.conflicts_detected.length})</span>
            </button>

            <button
              onClick={() => setArtifactTab("uncertainty")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
                artifactTab === "uncertainty"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="whitespace-nowrap">Grounding ({activeResult.confidence_score}%)</span>
            </button>

            <button
              onClick={() => setArtifactTab("sources")}
              className={`pb-2 px-2.5 font-medium transition cursor-pointer border-b-2 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
                artifactTab === "sources"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="whitespace-nowrap">Sources ({activeResult.citations.length})</span>
            </button>
          </div>

          {/* Dossier Content Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Tab 1: Cross-Document Conflict Matrix */}
            {artifactTab === "conflicts" && (
              <div className="space-y-3.5">
                {activeResult.conflicts_detected.length === 0 ? (
                  <div className="p-6 text-center text-sm text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-[var(--success)] mx-auto mb-2" />
                    No cross-document contradictions detected.
                  </div>
                ) : (
                  activeResult.conflicts_detected.map((item, idx) => {
                    const itemValues = getConflictValues(item);
                    return (
                      <div
                        key={idx}
                        id={`conflict-item-${idx}`}
                        className="border-b border-[var(--border)] pb-4 pt-1 space-y-2.5 last:border-b-0"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-[var(--text)]">{item.topic}</span>
                          <span
                            className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                              item.severity === "HIGH"
                                ? "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger)]/30"
                                : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                            }`}
                          >
                            {item.severity}
                          </span>
                        </div>

                        {/* Clean claim comparison with highlighted values */}
                        <div className="space-y-2 text-sm">
                          <div className="border-l-2 border-[var(--border)] pl-2.5 py-0.5 space-y-0.5">
                            <span className="text-[13px] text-[var(--text-muted)] font-medium block truncate">
                              {item.document_a}
                            </span>
                            <p className="text-[13px] text-[var(--text)] font-mono leading-relaxed">
                              "{highlightQuoteValues(item.claim_a, itemValues)}"
                            </p>
                          </div>

                          <div className="border-l-2 border-[var(--border)] pl-2.5 py-0.5 space-y-0.5">
                            <span className="text-[13px] text-[var(--text-muted)] font-medium block truncate">
                              {item.document_b}
                            </span>
                            <p className="text-[13px] text-[var(--text)] font-mono leading-relaxed">
                              "{highlightQuoteValues(item.claim_b, itemValues)}"
                            </p>
                          </div>
                        </div>

                        {/* Resolution Note with Markdown Rendering */}
                        <div className="text-[13.5px] text-[var(--text-muted)] leading-relaxed pt-1.5 border-t border-[var(--border-subtle)]">
                          <span className="text-[var(--text)] font-medium mr-1">Resolution:</span>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ node, ...p }) => <span className="inline text-[var(--text-muted)]" {...p} />,
                              strong: ({ node, ...p }) => <strong className="font-semibold text-[var(--text)]" {...p} />,
                              em: ({ node, ...p }) => <em className="italic text-[var(--text)]" {...p} />,
                              code: ({ node, ...p }) => (
                                <code className="px-1 py-0.5 rounded bg-[var(--surface-raised)] text-[var(--text)] font-mono text-xs" {...p} />
                              )
                            }}
                          >
                            {item.resolution_note}
                          </ReactMarkdown>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Tab 2: Uncertainty & Grounding Metrics */}
            {artifactTab === "uncertainty" && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Grounding Score</span>
                    <span className="font-bold text-[var(--text)] text-base">{activeResult.confidence_score}%</span>
                  </div>
                  <div className="w-full bg-[var(--surface)] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[var(--accent)] h-full rounded-full transition-all"
                      style={{ width: `${activeResult.confidence_score}%` }}
                    />
                  </div>
                  <div className="text-sm text-[var(--text-muted)] flex justify-between">
                    <span>Uncertainty Level:</span>
                    <span className="font-semibold text-[var(--text)]">{activeResult.uncertainty_level}</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] space-y-2">
                  <h4 className="text-sm font-semibold text-[var(--text)] flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    Factors & Caveats
                  </h4>
                  <ul className="text-[13.5px] text-[var(--text-muted)] space-y-2 list-disc list-inside">
                    {activeResult.uncertainty_reasons.map((reason, i) => (
                      <li key={i} className="leading-relaxed">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ node, ...p }) => <span {...p} />,
                            strong: ({ node, ...p }) => <strong className="font-semibold text-[var(--text)]" {...p} />,
                            em: ({ node, ...p }) => <em className="italic text-[var(--text)]" {...p} />,
                            code: ({ node, ...p }) => <code className="px-1 py-0.5 rounded bg-[var(--surface)] font-mono text-xs" {...p} />
                          }}
                        >
                          {reason}
                        </ReactMarkdown>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Tab 3: Verbatim Source Excerpts */}
            {artifactTab === "sources" && (
              <div className="space-y-3.5">
                {(() => {
                  const allConflictValues = getAllConflictValues(activeResult.conflicts_detected);
                  return activeResult.citations.map((cite, i) => (
                    <div
                      key={i}
                      className="border-b border-[var(--border)] pb-3.5 pt-1 space-y-1.5 last:border-b-0 text-sm"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-[var(--text)] truncate">{cite.doc_name}</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          Page {cite.page_number}
                        </span>
                      </div>
                      <p className="text-[13px] text-[var(--text-muted)] font-mono bg-[var(--surface-raised)] p-3 rounded border border-[var(--border-subtle)] leading-relaxed">
                        "{highlightQuoteValues(cite.quote, allConflictValues)}"
                      </p>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
