import os
import shutil
import json
import uuid
import datetime
from typing import List, Dict
from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from ingest import ingest_file, IngestedDocument, DocumentPage
from indexer import HybridDocumentIndex
from investigator import investigate_query, InvestigationResult

load_dotenv()

app = FastAPI(
    title="docV.ai Backend",
    description="Intelligent Document Investigator & Cross-Document Conflict Detection Engine",
    version="1.0.0"
)

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.environ.get("VERCEL"):
    UPLOAD_DIR = "/tmp/uploads"
else:
    UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

STORE_FILE = os.path.join(UPLOAD_DIR, "docv_store.json")

# In-memory document storage and search index
DOCUMENTS: Dict[str, IngestedDocument] = {}
INDEX = HybridDocumentIndex()

SAMPLE_FILES = [
    (
        "Master_Service_Agreement_v1.txt",
        """MASTER SERVICE AGREEMENT (MSA) - PROJECT TITAN
Effective Date: January 15, 2026
Between: Acron Corp (Client) and Zenith Innovations (Vendor)

SECTION 4: FINANCIAL TERMS & MILESTONES
4.1 Total Contract Value: The total fixed price for deliverables is $150,000 USD.
4.2 Payment Schedule: 
    - Milestone 1 (Discovery & Architecture): $50,000 due upon completion by March 15, 2026.
    - Milestone 2 (Core Engine Implementation): $50,000 due by June 30, 2026.
    - Final Delivery & Sign-off: $50,000 due by August 30, 2026.
4.3 Late Delivery Penalty: 1.5% deduction per week of unexcused delay.
4.4 Governing Law: State of New York."""
    ),
    (
        "Email_Addendum_Scope_March.txt",
        """EMAIL ADDENDUM: PROJECT TITAN BUDGET & SCOPE ADJUSTMENT
From: Sarah Jenkins (VP Operations, Acron Corp)
To: Marcus Vance (Lead Partner, Zenith Innovations)
Date: February 28, 2026
Subject: Re: Project Titan - Additional Scope & Accelerated Timeline

Marcus,
Per our executive alignment call yesterday, we are officially expanding the scope of Milestone 1 to include automated compliance auditing.
In consideration of this additional deliverable:
1. Milestone 1 payment is increased from $50,000 to $72,500 USD.
2. The revised deadline for Milestone 1 delivery is extended to April 10, 2026.
3. Total contract cap remains unchanged, with deductions offset against Milestone 3.

Please consider this written email confirmation as legally binding amendment pending formal contract revision."""
    ),
    (
        "Vendor_Invoice_INV-089.txt",
        """INVOICE #INV-2026-089
Zenith Innovations Inc.
Date: April 12, 2026
Billed To: Acron Corp

DESCRIPTION OF DELIVERABLES:
Item 1: Milestone 1 Completion (Discovery, Architecture, & Compliance Engine)
Amount Billed: $85,000 USD
Payment Terms: Net 15 Days
Due Date: April 27, 2026

Notes: Invoice reflects extra consulting hours incurred during deployment."""
    )
]

def save_store():
    try:
        data = [doc.model_dump() for doc in DOCUMENTS.values()]
        with open(STORE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception as e:
        print(f"[STORE] Failed to save store: {e}")

def load_store() -> bool:
    if os.path.exists(STORE_FILE):
        try:
            with open(STORE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data and isinstance(data, list) and len(data) > 0:
                DOCUMENTS.clear()
                INDEX.clear()
                for item in data:
                    doc = IngestedDocument.model_validate(item)
                    DOCUMENTS[doc.id] = doc
                    INDEX.add_document_pages(doc.pages)
                return True
        except Exception as e:
            print(f"[STORE] Failed to load store: {e}")
    return False

def init_sample_case():
    DOCUMENTS.clear()
    INDEX.clear()
    for fname, content in SAMPLE_FILES:
        path = os.path.join(UPLOAD_DIR, fname)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content.strip())
            doc = ingest_file(path, fname)
        except Exception:
            doc_id = str(uuid.uuid4())
            pages = [
                DocumentPage(
                    doc_id=doc_id,
                    doc_name=fname,
                    page_number=1,
                    content=content.strip()
                )
            ]
            doc = IngestedDocument(
                id=doc_id,
                filename=fname,
                file_type="txt",
                total_pages=1,
                pages=pages,
                created_at=datetime.datetime.utcnow().isoformat()
            )
        DOCUMENTS[doc.id] = doc
        INDEX.add_document_pages(doc.pages)
    save_store()

# Auto-restore on module boot
if not load_store():
    init_sample_case()

class QueryRequest(BaseModel):
    query: str

class QueryResponse(BaseModel):
    status: str
    result: InvestigationResult

router = APIRouter()

@router.get("/")
@router.get("/health")
def root():
    if not DOCUMENTS:
        if not load_store():
            init_sample_case()
    return {
        "service": "docV.ai Document Investigator API",
        "status": "online",
        "active_documents": len(DOCUMENTS),
        "total_chunks_indexed": len(INDEX.chunks)
    }

@router.get("/documents")
def list_documents():
    if not DOCUMENTS:
        if not load_store():
            init_sample_case()
    return [
        {
            "id": doc.id,
            "filename": doc.filename,
            "file_type": doc.file_type,
            "total_pages": doc.total_pages,
            "created_at": doc.created_at
        }
        for doc in DOCUMENTS.values()
    ]

@router.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    new_docs = []
    for file in files:
        temp_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        try:
            doc = ingest_file(temp_path, file.filename)
            DOCUMENTS[doc.id] = doc
            INDEX.add_document_pages(doc.pages)
            new_docs.append({
                "id": doc.id,
                "filename": doc.filename,
                "file_type": doc.file_type,
                "total_pages": doc.total_pages
            })
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to ingest {file.filename}: {str(e)}")

    save_store()
    return {
        "status": "success",
        "uploaded_count": len(new_docs),
        "documents": new_docs,
        "total_documents": len(DOCUMENTS)
    }

@router.post("/query", response_model=QueryResponse)
async def run_investigation(req: QueryRequest):
    if not DOCUMENTS:
        if not load_store():
            init_sample_case()

    if not DOCUMENTS:
        raise HTTPException(
            status_code=400,
            detail="No documents have been uploaded yet. Please upload documents first or load sample case files."
        )
    
    if not req.query or req.query.strip() == "":
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Retrieve top relevant context chunks across all uploaded documents
    top_chunks = INDEX.search(req.query.strip(), top_k=8)
    all_doc_names = [doc.filename for doc in DOCUMENTS.values()]

    result = investigate_query(req.query, top_chunks, all_doc_names)
    return QueryResponse(status="success", result=result)

@router.post("/reset")
def reset_workspace():
    DOCUMENTS.clear()
    INDEX.clear()
    if os.path.exists(STORE_FILE):
        try:
            os.remove(STORE_FILE)
        except Exception:
            pass
    # Clean up uploads directory (preserving .gitkeep)
    if os.path.exists(UPLOAD_DIR):
        for item in os.listdir(UPLOAD_DIR):
            if item == ".gitkeep":
                continue
            item_path = os.path.join(UPLOAD_DIR, item)
            if os.path.isfile(item_path):
                try:
                    os.remove(item_path)
                except Exception:
                    pass
    return {"status": "workspace cleared"}

@router.post("/sample-data")
def load_sample_case():
    """
    Loads pre-configured sample documents with intentional cross-document contradictions
    for an immediate 1-click live demonstration for hackathon judges!
    """
    init_sample_case()
    return {
        "status": "sample data loaded successfully",
        "documents": [doc.filename for doc in DOCUMENTS.values()],
        "suggested_query": "What is the final approved amount and deadline for Milestone 1?"
    }

# Mount router for both /api prefix and root level
app.include_router(router, prefix="/api")
app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
