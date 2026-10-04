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

def investigate_query(query: str, relevant_chunks: List[TextChunk], all_doc_names: List[str]) -> InvestigationResult:
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
        "\nCRITICAL RULES FOR CONFLICTS & CONTRADICTIONS:\n"
        "3. STRICT CROSS-DOCUMENT REQUIREMENT: A conflict exists ONLY when two ENTIRELY DIFFERENT DOCUMENTS (e.g., Document A vs. Document B) make contradictory, incompatible claims about the EXACT SAME entity, price, date, or clause.\n"
        "4. FORBIDDEN: NEVER compare two different pages, sections, or paragraphs of the SAME document against each other as a conflict!\n"
        "5. DISTINCT TOPICS ARE NOT CONFLICTS: Comparing two different items (e.g. Milestone 1 vs. Milestone 2, or problem ALG-WEB-01 vs. ALG-WEB-02) is NOT a contradiction because they are separate entities!\n"
        "6. If no genuine cross-document contradiction exists on the same subject, return an EMPTY list for conflicts_detected.\n"
        "7. Accurately assign a confidence score (0-100) and list reasons for uncertainty.\n"
        "8. Provide exact verbatim quotes and page numbers for all citations."
    )

    user_prompt = f"""
DOCUMENTS UNDER INVESTIGATION:
{', '.join(all_doc_names)}

RELEVANT EXCERPTS WITH SOURCE CITATIONS:
{context_str}

USER INVESTIGATION QUERY:
"{query}"

Analyze the excerpts carefully. Detect any conflicts across distinct documents. Return your grounded analysis following the requested schema without adding any 'Forensic Audit:' prefix.
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
