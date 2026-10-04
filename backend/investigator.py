import os
import re
import json
from typing import List, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from dotenv import load_dotenv

from indexer import TextChunk
from gemini_pool import POOL

# Explicitly search and load .env from current dir and parent dir
base_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(base_dir)
load_dotenv(os.path.join(base_dir, ".env"))
load_dotenv(os.path.join(parent_dir, ".env"))
load_dotenv()

class Citation(BaseModel):
    doc_name: str = Field(description="Name of the document cited")
    page_number: int = Field(description="Page number of the document where fact appears")
    quote: str = Field(description="Exact snippet or sentence from the document")

class ConflictItem(BaseModel):
    topic: str = Field(description="The specific subject where two DIFFERENT documents make contradictory claims about the exact same entity or milestone (e.g., 'Milestone 1 Payment Amount')")
    severity: str = Field(description="'HIGH', 'MEDIUM', or 'LOW' indicating impact of contradiction")
    document_a: str = Field(description="Filename and page of first document (e.g., 'Contract_v1.pdf, Page 4')")
    claim_a: str = Field(description="Exact claim or value in document A")
    document_b: str = Field(description="Filename and page of second DIFFERENT document (Must NOT be the same file as document A)")
    claim_b: str = Field(description="Contradictory claim or value in document B about the same entity")
    resolution_note: str = Field(description="Forensic synthesis explaining which document is more recent, which supersedes, or why they contradict")

class InvestigationResult(BaseModel):
    query: str
    synthesized_answer: str = Field(description="Grounded, investigative answer directly addressing the question")
    confidence_score: int = Field(description="Confidence percentage (0 to 100) based on source strength and lack of conflict")
    uncertainty_level: str = Field(description="'LOW', 'MODERATE', or 'HIGH' uncertainty")
    uncertainty_reasons: List[str] = Field(description="Bullet points explaining why uncertainty exists (e.g., missing sign-offs, conflicting dates)")
    conflicts_detected: List[ConflictItem] = Field(description="Any contradictions found between documents regarding this query")
    citations: List[Citation] = Field(description="Direct source citations backing the answer")

def get_client() -> Optional[genai.Client]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key.strip() == "" or api_key == "your_gemini_api_key_here":
        return None
    return genai.Client(api_key=api_key)

def check_conversational_query(query: str, has_documents: bool = True) -> Optional[InvestigationResult]:
    q = query.strip().lower()
    norm = re.sub(r'[^\w\s]', '', q)
    norm = re.sub(r'\s+', ' ', norm).strip()
    if not norm:
        return None

    gratitude_phrases = {
        "perfect", "thats perfect", "that is perfect", "it is perfect", "its perfect",
        "thanks", "thank you", "thank u", "thx", "ty", "thanks a lot", "thank you so much",
        "many thanks", "thanks docv", "thank you docv", "appreciate it", "much appreciated",
        "great", "thats great", "that is great", "awesome", "thats awesome", "that is awesome",
        "nice", "very nice", "nice job", "good job", "well done", "good work", "great work",
        "cool", "thats cool", "sounds good", "looks good", "wonderful", "amazing", "excellent",
        "super", "brilliant", "fantastic", "you are great", "you are awesome", "you rock",
        "perfect thanks", "perfect thank you", "great thanks", "great thank you"
    }

    greetings_phrases = {
        "hi", "hello", "hey", "hey there", "hello there", "hiya", "howdy", "yo", "sup", "greetings",
        "good morning", "good afternoon", "good evening", "hi docv", "hello docv", "hey docv",
        "hi docvai", "hello docvai", "hey docvai", "hello docv ai", "hi docv ai", "hey docv ai"
    }

    ack_phrases = {
        "ok", "okay", "got it", "understood", "sure", "alright", "k", "noted", "fine",
        "all right", "ok thanks", "okay thanks", "got it thanks", "noted thanks", "sure thanks",
        "sounds good thanks", "ok thank you", "okay thank you", "alright thanks"
    }

    farewell_phrases = {
        "bye", "goodbye", "see you", "cya", "take care", "good night", "have a nice day",
        "have a good day", "bye docv", "goodbye docv"
    }

    help_phrases = {
        "help", "who are you", "what can you do", "what are you", "what is docv", "what is docv ai",
        "what is docvai", "how do you work", "how does this work"
    }

    words = norm.split()
    investigative_keywords = {
        "contract", "document", "documents", "page", "pages", "price", "amount",
        "deadline", "date", "milestone", "milestones", "clause", "clauses", "conflict",
        "conflicts", "discrepancy", "discrepancies", "difference", "differences",
        "penalty", "penalties", "deliverable", "deliverables", "audit", "table"
    }

    has_investigative_topic = any(w in investigative_keywords for w in words)
    if has_investigative_topic:
        return None

    answer = None

    if norm in gratitude_phrases or (len(words) <= 4 and words[0] in ("thanks", "thank") and "you" in words):
        if has_documents:
            answer = "You're very welcome! I'm glad that was helpful. Do you have any other questions about your documents, or another topic you'd like me to investigate?"
        else:
            answer = "You're very welcome! Whenever you're ready, upload your documents or click **Load Demo Case** and I'll help you investigate them."

    elif norm in greetings_phrases or (
        words[0] in ("hi", "hello", "hey") and (
            "help" in words or "how are you" in norm or len(words) <= 4
        )
    ):
        if has_documents:
            answer = "Hello! How can I assist you with your document investigation today? Feel free to ask about deliverables, deadlines, prices, or cross-document discrepancies."
        else:
            answer = "Hello! I'm **docV.ai**, your intelligent document investigator. Upload contracts, reports, or invoices (or click **Load Demo Case** above) and I'll analyze and cross-reference them for you."

    elif norm in ack_phrases:
        answer = "Understood! Let me know whenever you'd like to investigate another topic, compare terms, or audit clauses."

    elif norm in farewell_phrases:
        answer = "Goodbye! Whenever you need deep document verification or contradiction analysis, I'll be here."

    elif norm in help_phrases:
        answer = (
            "I am **docV.ai**, an intelligent document investigator and analyst.\n\n"
            "Here is how I can help:\n"
            "- **Cross-Document Contradiction Analysis**: Compare multiple documents (contracts, addenda, proposals) and flag conflicting dates, amounts, or clauses.\n"
            "- **Precision Grounded QA**: Answer specific questions strictly backed by source text.\n"
            "- **Verifiable Citations**: Provide exact file names, page numbers, and direct quotes.\n\n"
            "To begin, simply ask an investigative question or upload files!"
        )

    if answer:
        return InvestigationResult(
            query=query,
            synthesized_answer=answer,
            confidence_score=100,
            uncertainty_level="LOW",
            uncertainty_reasons=[],
            conflicts_detected=[],
            citations=[]
        )

    return None

def investigate_query(query: str, relevant_chunks: List[TextChunk], all_doc_names: List[str]) -> InvestigationResult:
    # Quick check for conversational greetings / small-talk / gratitude
    conv_result = check_conversational_query(query, has_documents=bool(all_doc_names))
    if conv_result:
        return conv_result

    client = get_client()
    
    # Format retrieved document context
    context_blocks = []
    for idx, chunk in enumerate(relevant_chunks):
        context_blocks.append(
            f"[SOURCE {idx+1}] File: {chunk.doc_name} | Page: {chunk.page_number}\n"
            f"Content:\n{chunk.content}\n"
        )
    context_str = "\n".join(context_blocks)

    if not POOL.keys:
        POOL.reload_keys()

    if not POOL.keys:
        # Fallback offline simulation when API keys aren't provided yet
        return InvestigationResult(
            query=query,
            synthesized_answer=(
                "⚠️ API Key Not Configured: To run full AI analysis, set your GEMINI_API_KEYS in backend/.env.\n\n"
                f"Retrieved {len(relevant_chunks)} relevant passage(s) across {len(all_doc_names)} documents."
            ),
            confidence_score=50,
            uncertainty_level="MODERATE",
            uncertainty_reasons=["Gemini API key is not yet set in backend/.env"],
            conflicts_detected=[],
            citations=[
                Citation(
                    doc_name=c.doc_name,
                    page_number=c.page_number,
                    quote=c.content[:150] + "..."
                ) for c in relevant_chunks[:3]
            ]
        )

    system_instruction = (
        "You are 'docV.ai', an intelligent document investigator and analyst. "
        "Your duty is to answer questions using only the provided document sources with zero hallucinations. "
        "\nCRITICAL FORMATTING & STRUCTURE REQUIREMENTS:\n"
        "1. DO NOT prepend your response with 'Forensic Audit:' or any generic robotic labels. Start directly with the relevant topic heading or direct answer.\n"
        "2. RICH GITHUB-FLAVORED MARKDOWN: NEVER return an unstructured plain paragraph or wall of text! Structure your synthesized_answer elegantly:\n"
        "   - Use clean subheadings relevant to the content (e.g., '## 1. ALG-CYBER-01 ('Find the Intruder')')\n"
        "   - Use bold attribute labels for scannability (e.g., '**Focus:**', '**Key requirements:**', '**Technologies:**', '**Judging Focus:**')\n"
        "   - Use clean bulleted lists ('- item') for requirements, capabilities, or parameters\n"
        "   - Use Markdown comparison tables ('| Column 1 | Column 2 |') with clear headers whenever describing multiple items, problem statements, or options\n"
        "   - Use horizontal rules ('---') to divide distinct sections cleanly\n"
        "\nCRITICAL RULES FOR CONVERSATIONAL QUERIES & SMALL TALK:\n"
        "3. CONVERSATIONAL HANDLING: If the user query is a greeting, polite acknowledgement, gratitude, or conversational remark (such as 'perfect', 'thanks', 'thank you', 'hi', 'hello', 'good job', 'great', 'ok', etc.) rather than a specific factual inquiry about the documents:\n"
        "   - DO NOT search the document text for the literal word or report that 'the term does not appear in the text'!\n"
        "   - DO NOT conduct a formal audit on conversational greetings or praise!\n"
        "   - Respond warmly and conversationally as docV.ai (e.g., acknowledging their gratitude, asking if they have any further questions or specific clauses they want investigated).\n"
        "   - Return an EMPTY list for conflicts_detected and citations, with confidence_score=100 and uncertainty_level='LOW'.\n"
        "\nCRITICAL RULES FOR CONFLICTS & CONTRADICTIONS:\n"
        "4. STRICT CROSS-DOCUMENT REQUIREMENT: A conflict exists ONLY when two ENTIRELY DIFFERENT DOCUMENTS (e.g., Document A vs. Document B) make contradictory, incompatible claims about the EXACT SAME entity, price, date, or clause.\n"
        "5. FORBIDDEN: NEVER compare two different pages, sections, or paragraphs of the SAME document against each other as a conflict!\n"
        "6. DISTINCT TOPICS ARE NOT CONFLICTS: Comparing two different items (e.g. Milestone 1 vs. Milestone 2, or problem ALG-WEB-01 vs. ALG-WEB-02) is NOT a contradiction because they are separate entities!\n"
        "7. If no genuine cross-document contradiction exists on the same subject, return an EMPTY list for conflicts_detected.\n"
        "8. Accurately assign a confidence score (0-100) and list reasons for uncertainty.\n"
        "9. Provide exact verbatim quotes and page numbers for all citations."
    )

    user_prompt = f"""
DOCUMENTS UNDER INVESTIGATION:
{', '.join(all_doc_names)}

RELEVANT EXCERPTS WITH SOURCE CITATIONS:
{context_str}

USER INVESTIGATION QUERY:
"{query}"

Analyze the excerpts carefully. Detect any conflicts across distinct documents. Return your grounded analysis following the requested schema without adding any 'Forensic Audit:' prefix. If the query is a conversational greeting, thank-you, or feedback (such as 'perfect' or 'hi'), respond politely and conversationally instead of auditing the literal word.
"""

    try:
        raw_text = POOL.generate_resilient(
            contents=user_prompt,
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=InvestigationResult,
            temperature=0.1
        )
        parsed = json.loads(raw_text)
        result = InvestigationResult(**parsed)

        # Strip any generic robotic "Forensic Audit:" prefix if generated
        if result.synthesized_answer:
            result.synthesized_answer = re.sub(
                r'^(#+\s*|\*\*)?Forensic Audit:?\s*(\*\*)?\s*',
                '',
                result.synthesized_answer,
                flags=re.IGNORECASE
            ).strip()

        # Programmatic safeguard: Enforce that Document A and Document B MUST be two different files
        def clean_doc_name(d: str) -> str:
            for sep in [",", "·", "page", "Page", "p.", ":"]:
                d = d.split(sep)[0]
            return os.path.basename(d.strip()).lower()

        filtered_conflicts = []
        for conflict in result.conflicts_detected:
            name_a = clean_doc_name(conflict.document_a)
            name_b = clean_doc_name(conflict.document_b)
            # Discard any intra-document comparisons where document_a and document_b are the same file
            if name_a and name_b and name_a != name_b:
                filtered_conflicts.append(conflict)

        result.conflicts_detected = filtered_conflicts
        return result
    except Exception as e:
        # Fallback graceful error handling
        return InvestigationResult(
            query=query,
            synthesized_answer=f"Error during AI reasoning: {str(e)}",
            confidence_score=0,
            uncertainty_level="HIGH",
            uncertainty_reasons=[f"Exception occurred: {str(e)}"],
            conflicts_detected=[],
            citations=[]
        )
