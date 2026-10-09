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
  Maximize2,
  Info,
  X,
  Award,
  Star,
  Globe
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
  if (!markdown) return "";
  // Strip robotic "Forensic Audit:" prefix if present
  let cleaned = markdown.replace(/^(#+\s*|\*\*)?Forensic Audit:?\s*(\*\*)?\s*/i, "");
  const hasMultiple = /#{1,4}\s+2\.\s+/m.test(cleaned);
  if (!hasMultiple) {
    return cleaned.replace(/^(#{1,4}\s+)1\.\s+/gm, "$1");
  }
  return cleaned;
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

function getClientSessionId(): string {
  if (typeof window === "undefined") return "default_session";
  try {
    let sid = localStorage.getItem("docv_session_id");
    if (!sid) {
      sid = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : `session_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      localStorage.setItem("docv_session_id", sid);
    }
    return sid;
  } catch {
    return "default_session";
  }
}

export default function Home() {
  const [apiUrl] = useState(() => {
    if (process.env.NEXT_PUBLIC_API_URL) {
      return process.env.NEXT_PUBLIC_API_URL;
    }
    if (typeof window !== "undefined" && window.location.hostname === "localhost" && window.location.port === "3000") {
      return "http://localhost:8000";
    }
    return "";
  });
  const [sessionId, setSessionId] = useState<string>("");
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
  const [infoOpen, setInfoOpen] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  // Close info modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInfoOpen(false);
      }
    };
    if (infoOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [infoOpen]);

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

  // Health check (heartbeat only, does not clobber document state)
  const checkHealth = async (overrideSid?: string) => {
    const sid = overrideSid || sessionId || getClientSessionId();
    try {
      const res = await fetch(`${apiUrl}/api/health`, {
        headers: { "X-Session-ID": sid },
      });
      setBackendOnline(res.ok);
    } catch {
      setBackendOnline(false);
    }
  };

  const fetchDocuments = async (overrideSid?: string) => {
    const sid = overrideSid || sessionId || getClientSessionId();
    try {
      const res = await fetch(`${apiUrl}/api/documents`, {
        headers: { "X-Session-ID": sid },
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const sid = getClientSessionId();
    setSessionId(sid);

    // Clear any stale cached documents
    try {
      localStorage.removeItem("docv_docs");
    } catch (e) {}

    checkHealth(sid);
    fetchDocuments(sid);
    const interval = setInterval(() => checkHealth(sid), 10000);
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

    const sid = sessionId || getClientSessionId();
    const formData = new FormData();
    for (let i = 0; i < e.target.files.length; i++) {
      formData.append("files", e.target.files[i]);
    }

    try {
      const res = await fetch(`${apiUrl}/api/upload`, {
        method: "POST",
        headers: { "X-Session-ID": sid },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to upload files");
      }

      await fetchDocuments(sid);
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Remove single document
  const handleRemoveDocument = async (docId: string) => {
    const sid = sessionId || getClientSessionId();
    try {
      let removed = false;
      const res = await fetch(`${apiUrl}/api/documents/${docId}`, {
        method: "DELETE",
        headers: { "X-Session-ID": sid },
      });
      if (res.ok) {
        removed = true;
      } else {
        const fallbackRes = await fetch(`${apiUrl}/api/documents/${docId}/delete`, {
          method: "POST",
          headers: { "X-Session-ID": sid },
        });
        removed = fallbackRes.ok;
      }

      if (!removed) {
        throw new Error("Failed to remove document");
      }

      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      console.error("Failed to remove document:", err);
      setError(err?.message || "Failed to remove document");
    }
  };

  // Load sample dataset
  const handleLoadSample = async () => {
    setLoading(true);
    setError(null);
    const sid = sessionId || getClientSessionId();
    try {
      const res = await fetch(`${apiUrl}/api/sample-data`, {
        method: "POST",
        headers: { "X-Session-ID": sid },
      });
      const data = await res.json();
      await fetchDocuments(sid);
      const defaultQuery = data.suggested_query || "What is the final approved amount and deadline for Milestone 1?";
      executeInvestigation(defaultQuery);
    } catch (err: any) {
      setError(err.message || "Failed to load sample dataset");
      setLoading(false);
    }
  };

  // Reset workspace
  const handleReset = async () => {
    const sid = sessionId || getClientSessionId();
    try {
      await fetch(`${apiUrl}/api/reset`, {
        method: "POST",
        headers: { "X-Session-ID": sid },
      });
      setDocuments([]);
      try {
        localStorage.removeItem("docv_docs");
      } catch (e) {}
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

    const sid = sessionId || getClientSessionId();
    try {
      const res = await fetch(`${apiUrl}/api/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": sid,
        },
        body: JSON.stringify({
          query: q,
          session_id: sid,
          web_search: webSearchEnabled,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Investigation query failed");
      }

      const data = await res.json();
      if (data.result?.synthesized_answer) {
        data.result.synthesized_answer = data.result.synthesized_answer.replace(
          /^(#+\s*|\*\*)?Forensic Audit:?\s*(\*\*)?\s*/i,
          ""
        ).trim();
      }
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

function stringToUint8Array(str: string): Uint8Array {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buf[i] = str.charCodeAt(i) & 0xff;
  }
  return buf;
}

function generateReportPdf(result: InvestigationResult): Uint8Array {
  const pages: string[] = [];
  let currentCommands: string[] = [];
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 44;
  const contentWidth = pageWidth - margin * 2; // 507
  const bottomMargin = 55;
  const topMargin = 785;
  let y = topMargin;

  function newPage() {
    if (currentCommands.length > 0) {
      pages.push(currentCommands.join("\n"));
    }
    currentCommands = [];
    y = topMargin;

    // Running top header for subsequent pages
    currentCommands.push(
      "BT",
      "/F2 8 Tf 0.45 0.45 0.45 rg",
      `1 0 0 1 ${margin} 806 Tm`,
      "(docV.ai  |  FORENSIC DOCUMENT INVESTIGATION REPORT) Tj",
      "ET",
      "0.85 0.85 0.83 RG 0.5 w",
      `${margin} 800 m ${pageWidth - margin} 800 l S`
    );
  }

  function escapePdfText(text: string): string {
    if (!text) return "";
    return text
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E\t]/g, " ");
  }

  function addRect(
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    fillColor?: [number, number, number],
    strokeColor?: [number, number, number],
    lineWidth: number = 0.5
  ) {
    if (fillColor) {
      const [r, g, b] = fillColor;
      currentCommands.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
    }
    if (strokeColor) {
      const [r, g, b] = strokeColor;
      currentCommands.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
      currentCommands.push(`${lineWidth.toFixed(2)} w`);
    }
    const op = fillColor && strokeColor ? "B" : fillColor ? "f" : "S";
    currentCommands.push(`${rx.toFixed(2)} ${ry.toFixed(2)} ${rw.toFixed(2)} ${rh.toFixed(2)} re ${op}`);
  }

  function addTextAt(
    tx: number,
    ty: number,
    text: string,
    font: string,
    size: number,
    color: [number, number, number] = [0.1, 0.1, 0.1]
  ) {
    const escaped = escapePdfText(text);
    const [r, g, b] = color;
    currentCommands.push(
      "BT",
      `/${font} ${size} Tf`,
      `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`,
      `1 0 0 1 ${tx.toFixed(2)} ${ty.toFixed(2)} Tm`,
      `(${escaped}) Tj`,
      "ET"
    );
  }

  function addText(
    text: string,
    font: string,
    size: number,
    lineGap: number = 13,
    color: [number, number, number] = [0.15, 0.15, 0.15],
    indent: number = 0
  ) {
    if (y < bottomMargin + lineGap) {
      newPage();
    }
    addTextAt(margin + indent, y, text, font, size, color);
    y -= lineGap;
  }

  function wrapText(text: string, maxChars: number = 80): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + (cur ? " " : "") + w).length <= maxChars) {
        cur += (cur ? " " : "") + w;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length > 0 ? lines : [""];
  }

  function addParagraph(
    text: string,
    font: string = "F1",
    size: number = 9,
    lineGap: number = 12.5,
    maxChars: number = 86,
    color: [number, number, number] = [0.2, 0.2, 0.2],
    indent: number = 0
  ) {
    const clean = text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
    const lines = wrapText(clean, maxChars);
    for (const l of lines) {
      addText(l, font, size, lineGap, color, indent);
    }
  }

  function addSectionHeader(title: string, subtitle?: string) {
    if (y < bottomMargin + 45) newPage();
    y -= 10;
    // Section title with orange accent tag
    addRect(margin, y - 2, 3.5, 14, [0.85, 0.35, 0.12]);
    addTextAt(margin + 8, y + 1, title.toUpperCase(), "F2", 10.5, [0.1, 0.1, 0.1]);
    if (subtitle) {
      addTextAt(margin + 12 + title.length * 6, y + 1, `|  ${subtitle}`, "F1", 8.5, [0.45, 0.45, 0.45]);
    }
    addRect(margin, y - 5, contentWidth, 0.5, undefined, [0.86, 0.86, 0.84], 0.5);
    y -= 15;
  }

  // 1. Executive Top Header Banner (Page 1)
  addRect(margin, y - 36, contentWidth, 42, [0.14, 0.14, 0.15], undefined);
  addRect(margin, y - 36, 4, 42, [0.85, 0.35, 0.12]);
  addTextAt(margin + 14, y - 14, "docV.ai  |  FORENSIC DOCUMENT AUDIT REPORT", "F2", 13.5, [1, 1, 1]);
  addTextAt(margin + 14, y - 28, "Cross-Document Contradiction Analysis & Grounded Evidence Synthesis", "F1", 8.5, [0.8, 0.8, 0.8]);
  addTextAt(pageWidth - margin - 110, y - 28, `Date: ${new Date().toLocaleDateString()}`, "F1", 8, [0.75, 0.75, 0.75]);
  y -= 48;

  // 2. Query Box
  const queryLines = wrapText(`"${result.query}"`, 80);
  const qBoxHeight = Math.max(34, 20 + queryLines.length * 12);
  addRect(margin, y - qBoxHeight, contentWidth, qBoxHeight, [0.97, 0.97, 0.96], [0.88, 0.88, 0.86], 0.5);
  addRect(margin, y - qBoxHeight, 3.5, qBoxHeight, [0.85, 0.35, 0.12]);
  addTextAt(margin + 10, y - 11, "TARGET INVESTIGATION QUERY:", "F2", 8, [0.85, 0.35, 0.12]);
  for (let qIdx = 0; qIdx < queryLines.length; qIdx++) {
    addTextAt(margin + 10, y - 23 - qIdx * 12, queryLines[qIdx], "F2", 9, [0.1, 0.1, 0.1]);
  }
  y -= qBoxHeight + 8;

  // 3. Executive KPI Metric Tiles (3 Cards Row)
  const tileW = (contentWidth - 12) / 3;
  const tileH = 34;
  const tileY = y - tileH;

  // Tile 1: Confidence
  const confColor: [number, number, number] = result.confidence_score >= 80 ? [0.15, 0.6, 0.3] : [0.85, 0.45, 0.1];
  addRect(margin, tileY, tileW, tileH, [0.975, 0.975, 0.97], [0.88, 0.88, 0.86], 0.5);
  addRect(margin, tileY, 3, tileH, confColor);
  addTextAt(margin + 8, tileY + 20, "GROUNDING CONFIDENCE", "F2", 7.5, [0.45, 0.45, 0.45]);
  addTextAt(margin + 8, tileY + 7, `${result.confidence_score}% Verified`, "F2", 10.5, confColor);

  // Tile 2: Uncertainty Level
  const uncLevel = (result.uncertainty_level || "LOW").toUpperCase();
  const uncColor: [number, number, number] = uncLevel === "LOW" ? [0.15, 0.6, 0.3] : uncLevel === "HIGH" ? [0.85, 0.2, 0.2] : [0.85, 0.5, 0.1];
  const t2X = margin + tileW + 6;
  addRect(t2X, tileY, tileW, tileH, [0.975, 0.975, 0.97], [0.88, 0.88, 0.86], 0.5);
  addRect(t2X, tileY, 3, tileH, uncColor);
  addTextAt(t2X + 8, tileY + 20, "EPISTEMIC UNCERTAINTY", "F2", 7.5, [0.45, 0.45, 0.45]);
  addTextAt(t2X + 8, tileY + 7, `${uncLevel} Risk`, "F2", 10.5, uncColor);

  // Tile 3: Discrepancies Count
  const confCount = (result.conflicts_detected || []).length;
  const confTileColor: [number, number, number] = confCount > 0 ? [0.85, 0.2, 0.2] : [0.15, 0.6, 0.3];
  const t3X = margin + (tileW + 6) * 2;
  addRect(t3X, tileY, tileW, tileH, [0.975, 0.975, 0.97], [0.88, 0.88, 0.86], 0.5);
  addRect(t3X, tileY, 3, tileH, confTileColor);
  addTextAt(t3X + 8, tileY + 20, "CONTRADICTIONS FOUND", "F2", 7.5, [0.45, 0.45, 0.45]);
  addTextAt(t3X + 8, tileY + 7, `${confCount} Discrepanc${confCount === 1 ? "y" : "ies"}`, "F2", 10.5, confTileColor);
  y -= tileH + 12;

  // 4. Section: Grounded Synthesis (Structured Markdown Parser)
  addSectionHeader("1. Grounded Synthesis & Findings");
  const rawLines = (result.synthesized_answer || "").split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].trim();
    if (!raw) {
      y -= 3;
      continue;
    }

    // Dividers (--- or ***)
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(raw)) {
      if (y < bottomMargin + 18) newPage();
      addRect(margin, y - 2, contentWidth, 0.5, undefined, [0.88, 0.88, 0.86], 0.5);
      y -= 8;
      continue;
    }

    // Headings (#, ##, ###)
    const hMatch = raw.match(/^(#{1,3})\s+(.*)$/);
    if (hMatch) {
      if (y < bottomMargin + 25) newPage();
      y -= 4;
      const cleanH = hMatch[2].replace(/\*\*/g, "").trim();
      addText(cleanH, "F2", 10, 13, [0.12, 0.12, 0.12]);
      y -= 2;
      continue;
    }

    // Table rows (| col 1 | col 2 |)
    if (raw.startsWith("|") && raw.endsWith("|")) {
      if (/^\|(\s*[-:]+\s*\|)+$/.test(raw)) {
        addRect(margin, y + 2, contentWidth, 0.5, undefined, [0.8, 0.8, 0.8], 0.5);
        y -= 2;
        continue;
      }
      const cells = raw.slice(1, -1).split("|").map((c) => c.replace(/\*\*/g, "").trim());
      if (cells.length >= 2) {
        if (y < bottomMargin + 18) newPage();
        const colW = contentWidth / cells.length;
        addRect(margin, y - 3, contentWidth, 13, [0.97, 0.97, 0.96], [0.9, 0.9, 0.88], 0.4);
        for (let cIdx = 0; cIdx < cells.length; cIdx++) {
          addTextAt(margin + cIdx * colW + 4, y, cells[cIdx].slice(0, 32), "F1", 8, [0.15, 0.15, 0.15]);
        }
        y -= 14;
        continue;
      }
    }

    // Bullet points (- or * or •)
    const bulletMatch = raw.match(/^([*\-•])\s+(.*)$/);
    if (bulletMatch) {
      const cleanBullet = bulletMatch[2].replace(/\*\*(.*?)\*\*/g, "$1").trim();
      const bLines = wrapText(cleanBullet, 80);
      for (let bIdx = 0; bIdx < bLines.length; bIdx++) {
        if (bIdx === 0) {
          addText(`•  ${bLines[bIdx]}`, "F1", 8.8, 11.5, [0.18, 0.18, 0.18], 6);
        } else {
          addText(bLines[bIdx], "F1", 8.8, 11.5, [0.18, 0.18, 0.18], 15);
        }
      }
      continue;
    }

    // Standard paragraph
    addParagraph(raw, "F1", 9, 12, 86, [0.2, 0.2, 0.2]);
  }
  y -= 6;

  // 5. Section: Cross-Document Discrepancies
  const conflicts = result.conflicts_detected || [];
  addSectionHeader(
    `2. Cross-Document Contradictions (${conflicts.length})`,
    conflicts.length === 0 ? "Mutual Consistency Confirmed" : "Potential Overbilling or Scope Conflicts"
  );

  if (conflicts.length === 0) {
    addRect(margin, y - 24, contentWidth, 24, [0.96, 0.98, 0.96], [0.8, 0.9, 0.8], 0.5);
    addTextAt(margin + 12, y - 10, "No cross-document discrepancies detected. Source documents are mutually consistent.", "F2", 9, [0.15, 0.55, 0.25]);
    y -= 30;
  } else {
    conflicts.forEach((c, idx) => {
      const sev = (c.severity || "MEDIUM").toUpperCase();
      const sevColor: [number, number, number] =
        sev === "HIGH" ? [0.85, 0.2, 0.15] : sev === "LOW" ? [0.25, 0.5, 0.75] : [0.88, 0.52, 0.1];

      const claimALines = wrapText(`"${c.claim_a}"`, 80);
      const claimBLines = wrapText(`"${c.claim_b}"`, 80);
      const resLines = wrapText(c.resolution_note || "Investigate source timeline for precedence.", 82);
      const cardH = 46 + (claimALines.length + claimBLines.length + resLines.length) * 11;

      if (y < bottomMargin + cardH + 10) newPage();

      const cardY = y - cardH;
      addRect(margin, cardY, contentWidth, cardH, [0.985, 0.985, 0.98], [0.88, 0.88, 0.86], 0.5);
      addRect(margin, cardY, 3.5, cardH, sevColor);

      // Card Header
      addTextAt(margin + 10, y - 12, `DISCREPANCY #${idx + 1}: ${c.topic.toUpperCase()}`, "F2", 9, [0.1, 0.1, 0.1]);
      addTextAt(pageWidth - margin - 75, y - 12, `[${sev} IMPACT]`, "F2", 8, sevColor);

      let cardCursor = y - 24;
      // Document A
      addTextAt(margin + 10, cardCursor, `Source A (${c.document_a}):`, "F2", 8, [0.35, 0.35, 0.35]);
      cardCursor -= 10;
      for (const cal of claimALines) {
        addTextAt(margin + 18, cardCursor, cal, "F1", 8, [0.15, 0.15, 0.15]);
        cardCursor -= 10;
      }

      // Document B
      addTextAt(margin + 10, cardCursor, `Source B (${c.document_b}):`, "F2", 8, [0.35, 0.35, 0.35]);
      cardCursor -= 10;
      for (const cbl of claimBLines) {
        addTextAt(margin + 18, cardCursor, cbl, "F1", 8, [0.15, 0.15, 0.15]);
        cardCursor -= 10;
      }

      // Resolution Note
      addTextAt(margin + 10, cardCursor, "Forensic Resolution:", "F2", 8, [0.85, 0.35, 0.12]);
      cardCursor -= 10;
      for (const rl of resLines) {
        addTextAt(margin + 18, cardCursor, rl, "F1", 8, [0.35, 0.35, 0.35]);
        cardCursor -= 10;
      }

      y = cardY - 8;
    });
  }

  // 6. Section: Verifiable Citations
  const citations = result.citations || [];
  if (citations.length > 0) {
    addSectionHeader(`3. Verifiable Source Citations (${citations.length})`);
    citations.forEach((cite, idx) => {
      const isWeb = cite.doc_name.toLowerCase().includes("web");
      const pageTag = isWeb ? "Web Source" : `Page ${cite.page_number}`;
      const qLines = wrapText(`"${cite.quote}"`, 82);
      const citeCardH = Math.max(28, 16 + qLines.length * 10);

      if (y < bottomMargin + citeCardH + 6) newPage();

      const citeY = y - citeCardH;
      addRect(margin, citeY, contentWidth, citeCardH, [0.99, 0.99, 0.985], [0.9, 0.9, 0.88], 0.4);
      addRect(margin, citeY, 2.5, citeCardH, isWeb ? [0.2, 0.5, 0.8] : [0.85, 0.35, 0.12]);

      addTextAt(margin + 8, y - 10, `[${idx + 1}]  ${cite.doc_name}`, "F2", 8, [0.15, 0.3, 0.55]);
      addTextAt(pageWidth - margin - 60, y - 10, pageTag, "F1", 7.5, [0.5, 0.5, 0.5]);
      for (let qL = 0; qL < qLines.length; qL++) {
        addTextAt(margin + 14, y - 20 - qL * 10, qLines[qL], "F1", 7.5, [0.3, 0.3, 0.3]);
      }
      y = citeY - 6;
    });
  }

  // 7. Section: Epistemic Factors & Caveats
  if (result.uncertainty_reasons && result.uncertainty_reasons.length > 0) {
    addSectionHeader("4. Epistemic Factors & Audit Caveats");
    for (const reason of result.uncertainty_reasons) {
      if (y < bottomMargin + 16) newPage();
      const rLines = wrapText(reason, 82);
      for (let rIdx = 0; rIdx < rLines.length; rIdx++) {
        if (rIdx === 0) {
          addText(`•  ${rLines[rIdx]}`, "F1", 8.5, 11, [0.35, 0.35, 0.35], 6);
        } else {
          addText(rLines[rIdx], "F1", 8.5, 11, [0.35, 0.35, 0.35], 15);
        }
      }
    }
  }

  if (currentCommands.length > 0) {
    pages.push(currentCommands.join("\n"));
  }

  // Assemble PDF document objects
  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  objects.push("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");
  objects.push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj");

  const pageObjStart = 5;
  const pageRefs: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = pageObjStart + i * 2;
    pageRefs.push(`${pageObjId} 0 R`);
  }

  objects.splice(1, 0, `2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>\nendobj`);

  for (let i = 0; i < pages.length; i++) {
    const pageObjId = pageObjStart + i * 2;
    const contentObjId = pageObjId + 1;
    let contentStream = pages[i];
    const pageNum = i + 1;
    const totalPages = pages.length;

    // Running footer with page count
    const footerCommands = [
      "0.85 0.85 0.83 RG 0.5 w",
      `${margin} 36 m ${pageWidth - margin} 36 l S`,
      "BT",
      "/F1 7.5 Tf 0.5 0.5 0.5 rg",
      `1 0 0 1 ${margin} 24 Tm`,
      "(CONFIDENTIAL  |  Generated by docV.ai Intelligent Document Investigator) Tj",
      `1 0 0 1 ${pageWidth - margin - 52} 24 Tm`,
      `(${escapePdfText(`Page ${pageNum} of ${totalPages}`)}) Tj`,
      "ET"
    ].join("\n");
    contentStream = contentStream + "\n" + footerCommands;

    const streamLen = contentStream.length;
    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj`
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${streamLen} >>\nstream\n${contentStream}\nendstream\nendobj`
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += objects[i] + "\n";
  }

  const startXref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += ("" + off).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;

  return stringToUint8Array(pdf);
}

  // Export report as PDF (Only PDF)
  const handleExportReport = () => {
    if (!activeResult) return;
    const pdfBytes = generateReportPdf(activeResult);
    const blob = new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `docV_Investigation_${Date.now()}.pdf`;
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
                  className="p-2.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] transition flex items-center justify-between text-sm group"
                >
                  <div className="flex items-center gap-2 overflow-hidden min-w-0 pr-1">
                    <FileText className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                    <div className="overflow-hidden">
                      <p className="text-sm text-[var(--text)] truncate font-medium">{doc.filename}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {doc.total_pages} {doc.total_pages === 1 ? "page" : "pages"} • {doc.file_type.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveDocument(doc.id);
                    }}
                    className="p-1 text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--surface)] rounded transition cursor-pointer flex-shrink-0"
                    title={`Remove ${doc.filename}`}
                    aria-label={`Remove ${doc.filename}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
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

          <div className="flex items-center gap-2 sm:gap-2.5">
            <a
              href="https://github.com/anshk1234/docV-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--surface-raised)] border border-[var(--border)] hover:bg-[#20201d] hover:border-[var(--border-subtle)] text-[var(--text)] transition cursor-pointer group"
              title="Star docV-ai on GitHub"
            >
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20 group-hover:scale-110 transition-transform" />
              <span>Star<span className="hidden sm:inline"> on GitHub</span></span>
            </a>

            <button
              onClick={() => setInfoOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--surface-raised)] border border-[var(--border)] hover:bg-[#20201d] hover:border-[var(--border-subtle)] text-[var(--text)] transition cursor-pointer"
              title="ALGOTHON'26 Problem Statement & Project Info"
            >
              <Info className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Info</span>
            </button>

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
                                  {cite.doc_name.toLowerCase().includes("web") ? (
                                    <Globe className="w-3.5 h-3.5 text-[var(--accent)]" />
                                  ) : (
                                    <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                                  )}
                                  <span className="truncate max-w-[220px]">{cite.doc_name}</span>
                                  {!cite.doc_name.toLowerCase().includes("web") && (
                                    <span className="text-[var(--text-muted)]/70">p.{cite.page_number}</span>
                                  )}
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

              {/* Row 2: Plus button, textarea, web search toggle, circular send button */}
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
                      if (!loading && inputQuery.trim() && (documents.length > 0 || webSearchEnabled)) {
                        executeInvestigation();
                      }
                    }
                  }}
                  placeholder={
                    webSearchEnabled
                      ? "Search the live web or cross-reference documents with live web..."
                      : documents.length === 0
                        ? "Load demo case or add documents to start investigating..."
                        : "Ask docV.ai to audit, compare, or uncover conflicts..."
                  }
                  className="flex-1 bg-transparent border-0 text-[15px] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none resize-none max-h-36 min-h-[36px] py-1.5 px-1 leading-relaxed"
                />

                {/* Web Search Toggle Button */}
                <button
                  type="button"
                  onClick={() => setWebSearchEnabled((prev) => !prev)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition flex-shrink-0 mb-0.5 cursor-pointer ${
                    webSearchEnabled
                      ? "bg-[var(--accent)] text-white shadow-sm ring-2 ring-[var(--accent)]/30"
                      : "bg-[var(--surface)] hover:bg-[#20201d] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)]"
                  }`}
                  title={webSearchEnabled ? "Web Search: ON (Click to disable)" : "Web Search: OFF (Click to enable)"}
                  aria-label="Toggle web search"
                >
                  <Globe className="w-4 h-4" />
                </button>

                {/* Circular Send Button */}
                <button
                  onClick={() => executeInvestigation()}
                  disabled={loading || !inputQuery.trim() || (documents.length === 0 && !webSearchEnabled)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition flex-shrink-0 mb-0.5 ${
                    !loading && inputQuery.trim() && (documents.length > 0 || webSearchEnabled)
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
                title="Download PDF Report"
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
                          {cite.doc_name.toLowerCase().includes("web") ? "Web Source" : `Page ${cite.page_number}`}
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

      {/* 4. Info Modal Overlay for ALGOTHON'26 Problem Statement */}
      {infoOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm transition-opacity"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="max-w-2xl w-full max-h-[88vh] flex flex-col rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-raised)]/70">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)]">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded-full border border-[var(--accent)]/20">
                      ALGOTHON'26 • AI / ML
                    </span>
                    <span className="text-xs font-mono text-[var(--text-muted)]">PSID: ALG-AI-02</span>
                  </div>
                  <h2 className="text-base sm:text-lg font-semibold text-[var(--text)] mt-0.5">
                    Intelligent Document Investigator
                  </h2>
                </div>
              </div>
              <button
                onClick={() => setInfoOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text)] p-1.5 rounded-lg hover:bg-[var(--surface-raised)] transition cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
              {/* Problem Statement Excerpt */}
              <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Official Problem Statement</span>
                </div>
                <p className="text-[14px] italic text-[var(--text)] leading-relaxed">
                  "Information is often scattered across PDFs, images and text documents. Users need answers without manually reading every document. Build a document investigation platform that accepts multiple documents and answers natural-language questions with supporting sources."
                </p>
              </div>

              {/* Innovation / Bonus Challenge */}
              <div className="p-4 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Innovation & Bonus Challenge (Judging Focus)</span>
                </div>
                <p className="text-[13.5px] text-[var(--text)] font-medium leading-relaxed">
                  "Identify conflicting documents and communicate uncertainty instead of confidently returning one unsupported answer."
                </p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  docV.ai implements a dedicated cross-document contradiction matrix that detects contradictory claims across distinct files and communicates uncertainty transparently.
                </p>
              </div>

              {/* Problem Requirements & Solution Checklist */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Participant Requirements & Compliance
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-lg bg-[var(--surface-raised)]/60 border border-[var(--border-subtle)] space-y-1">
                    <div className="flex items-center gap-2 font-medium text-[var(--text)] text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>Multiple Document Formats</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] pl-6">
                      Ingests multi-page PDFs, OCR scanned images, markdown, and text files.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-[var(--surface-raised)]/60 border border-[var(--border-subtle)] space-y-1">
                    <div className="flex items-center gap-2 font-medium text-[var(--text)] text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>Extraction & Indexing</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] pl-6">
                      Hybrid BM25 keyword + semantic chunking for sub-second context retrieval.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-[var(--surface-raised)]/60 border border-[var(--border-subtle)] space-y-1">
                    <div className="flex items-center gap-2 font-medium text-[var(--text)] text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>Natural-Language Q&A</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] pl-6">
                      Strictly grounded answers with zero hallucinations and conversational small-talk handling.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-[var(--surface-raised)]/60 border border-[var(--border-subtle)] space-y-1">
                    <div className="flex items-center gap-2 font-medium text-[var(--text)] text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>Conflict & Uncertainty Matrix</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] pl-6">
                      Pinpoints cross-document discrepancies and calculates confidence scores (0-100%).
                    </p>
                  </div>
                </div>
              </div>

              {/* Architecture & Tech Stack */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Architecture & Tech Stack
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Next.js 16 (App Router)",
                    "React 19",
                    "FastAPI (Python 3.11)",
                    "Gemini 2.5 Flash",
                    "PyMuPDF",
                    "Tesseract OCR",
                    "Tailwind CSS",
                    "Vercel Analytics"
                  ].map((tech) => (
                    <span
                      key={tech}
                      className="px-2.5 py-1 rounded-md text-xs bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text)]"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-[var(--border)] bg-[var(--surface-raised)]/70 flex items-center justify-between text-xs">
              <div className="text-[var(--text-muted)]">
                Built for <strong className="text-[var(--text)]">ALGOTHON'26</strong> by <strong className="text-[var(--text)]">anshk1234</strong>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href="https://github.com/anshk1234/docV-ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[var(--accent)] hover:underline font-medium"
                >
                  <span>GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={() => setInfoOpen(false)}
                  className="px-3.5 py-1.5 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] hover:bg-[#20201d] text-[var(--text)] transition cursor-pointer font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
