import os
import uuid
from datetime import datetime
from typing import List, Optional
import pypdf
from PIL import Image
from pydantic import BaseModel
from google import genai
from google.genai import types
from dotenv import load_dotenv
from gemini_pool import POOL

# Explicitly search and load .env from current dir and parent dir
base_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(base_dir)
load_dotenv(os.path.join(base_dir, ".env"))
load_dotenv(os.path.join(parent_dir, ".env"))
load_dotenv()

class DocumentPage(BaseModel):
    doc_id: str
    doc_name: str
    page_number: int
    content: str

class IngestedDocument(BaseModel):
    id: str
    filename: str
    file_type: str
    total_pages: int
    pages: List[DocumentPage]
    summary: Optional[str] = None
    created_at: str

def get_gemini_client() -> Optional[genai.Client]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key.strip() == "" or api_key == "your_gemini_api_key_here":
        return None
    return genai.Client(api_key=api_key)

def extract_text_from_pdf(file_path: str, filename: str, doc_id: str) -> List[DocumentPage]:
    pages = []
    reader = pypdf.PdfReader(file_path)
    for idx, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        pages.append(
            DocumentPage(
                doc_id=doc_id,
                doc_name=filename,
                page_number=idx + 1,
                content=text.strip()
            )
        )
    return pages

def extract_text_from_image(file_path: str, filename: str, doc_id: str) -> List[DocumentPage]:
    """
    Extracts text and structured layout from images using Gemini Multimodal Vision.
    Fallback to basic message if API key is not yet configured.
    """
    if not POOL.keys:
        POOL.reload_keys()

    if POOL.keys:
        try:
            with open(file_path, "rb") as f:
                image_bytes = f.read()
            
            prompt = (
                "You are an expert document OCR and forensics engine. "
                "Extract all text, headers, tables, numbers, and dates accurately from this document image. "
                "Preserve formatting, numbers, and line items exactly as they appear."
            )
            extracted_text = POOL.generate_resilient(
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                    prompt
                ],
                temperature=0.1
            )
        except Exception as e:
            extracted_text = f"[OCR Extraction Error: {str(e)}]"
    else:
        extracted_text = f"[Image uploaded: {filename}. Please configure GEMINI_API_KEYS in backend/.env to enable automated multimodal OCR extraction.]"

    return [
        DocumentPage(
            doc_id=doc_id,
            doc_name=filename,
            page_number=1,
            content=extracted_text.strip()
        )
    ]

def extract_text_from_plain(file_path: str, filename: str, doc_id: str) -> List[DocumentPage]:
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    return [
        DocumentPage(
            doc_id=doc_id,
            doc_name=filename,
            page_number=1,
            content=text.strip()
        )
    ]

def ingest_file(file_path: str, original_filename: str) -> IngestedDocument:
    doc_id = str(uuid.uuid4())[:8]
    ext = os.path.splitext(original_filename)[1].lower()
    
    if ext == ".pdf":
        file_type = "pdf"
        pages = extract_text_from_pdf(file_path, original_filename, doc_id)
    elif ext in [".png", ".jpg", ".jpeg", ".webp"]:
        file_type = "image"
        pages = extract_text_from_image(file_path, original_filename, doc_id)
    elif ext in [".txt", ".md", ".csv", ".json"]:
        file_type = "text"
        pages = extract_text_from_plain(file_path, original_filename, doc_id)
    else:
        file_type = "other"
        pages = extract_text_from_plain(file_path, original_filename, doc_id)

    return IngestedDocument(
        id=doc_id,
        filename=original_filename,
        file_type=file_type,
        total_pages=len(pages),
        pages=pages,
        created_at=datetime.now().isoformat()
    )
