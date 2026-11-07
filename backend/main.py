import os
import shutil
import json
import uuid
import time
import datetime
from typing import List, Dict, Optional
from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Header, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from ingest import ingest_file, IngestedDocument, DocumentPage
from indexer import HybridDocumentIndex
from investigator import investigate_query, InvestigationResult, check_conversational_query
from rate_limiter import RATE_LIMITER

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
    BASE_UPLOAD_DIR = "/tmp/uploads"
else:
    BASE_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(BASE_UPLOAD_DIR, exist_ok=True)

def get_sample_documents_dir() -> str:
    """
    Locates the sample_documents directory dynamically across local and deployed environments.
    """
    candidates = [
        os.path.join(os.path.dirname(__file__), "sample_documents"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sample_documents"),
        os.path.join(os.getcwd(), "sample_documents"),
        os.path.join(os.getcwd(), "backend", "sample_documents"),
    ]
    for c in candidates:
        if os.path.isdir(c):
            return c
    return candidates[0]


class SessionState:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.documents: Dict[str, IngestedDocument] = {}
        self.index = HybridDocumentIndex()
        self.last_active = time.time()
        self.upload_dir = os.path.join(BASE_UPLOAD_DIR, session_id)
        os.makedirs(self.upload_dir, exist_ok=True)
        self.store_file = os.path.join(self.upload_dir, "docv_store.json")

    def touch(self):
        self.last_active = time.time()

    def save_store(self):
        try:
            data = [doc.model_dump() for doc in self.documents.values()]
            with open(self.store_file, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except Exception as e:
            print(f"[STORE][{self.session_id}] Failed to save store: {e}")

    def load_store(self) -> bool:
        if os.path.exists(self.store_file):
            try:
                with open(self.store_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if data and isinstance(data, list) and len(data) > 0:
                    self.documents.clear()
                    self.index.clear()
                    for item in data:
                        doc = IngestedDocument.model_validate(item)
                        self.documents[doc.id] = doc
                        self.index.add_document_pages(doc.pages)
                    return True
            except Exception as e:
                print(f"[STORE][{self.session_id}] Failed to load store: {e}")
        return False

    def rehydrate(self, docs: List[IngestedDocument]) -> int:
        if not docs:
            return 0
        self.documents.clear()
        self.index.clear()
        for doc in docs:
            self.documents[doc.id] = doc
            self.index.add_document_pages(doc.pages)
        self.save_store()
        return len(self.documents)

    def init_sample_case(self) -> int:
        self.reset()
        sample_dir = get_sample_documents_dir()
        if not os.path.exists(sample_dir):
            return 0

        for fname in sorted(os.listdir(sample_dir)):
            if not fname.endswith((".txt", ".md", ".pdf", ".png", ".jpg", ".jpeg")):
                continue
            src_path = os.path.join(sample_dir, fname)
            if not os.path.isfile(src_path):
                continue

            dest_path = os.path.join(self.upload_dir, fname)
            shutil.copyfile(src_path, dest_path)
            doc = ingest_file(dest_path, fname)
            self.documents[doc.id] = doc
            self.index.add_document_pages(doc.pages)
        self.save_store()
        return len(self.documents)

    def reset(self):
        self.documents.clear()
        self.index.clear()
        if os.path.exists(self.store_file):
            try:
                os.remove(self.store_file)
            except Exception:
                pass
        if os.path.exists(self.upload_dir):
            for item in os.listdir(self.upload_dir):
                item_path = os.path.join(self.upload_dir, item)
                if os.path.isfile(item_path):
                    try:
                        os.remove(item_path)
                    except Exception:
                        pass
                elif os.path.isdir(item_path):
                    try:
                        shutil.rmtree(item_path, ignore_errors=True)
                    except Exception:
                        pass

    def _resolve_upload_file_path(self, filename: str) -> str:
        safe_name = os.path.basename((filename or "").strip())
        if not safe_name or safe_name in {".", ".."}:
            raise ValueError("Invalid filename.")

        base_dir = os.path.realpath(self.upload_dir)
        file_path = os.path.realpath(os.path.join(base_dir, safe_name))
        if os.path.commonpath([base_dir, file_path]) != base_dir:
            raise ValueError("Invalid file path.")

        return file_path

    def remove_document(self, doc_id: str) -> bool:
        if doc_id not in self.documents:
            return False
        doc = self.documents.pop(doc_id)
        self.index.clear()
        for remaining_doc in self.documents.values():
            self.index.add_document_pages(remaining_doc.pages)
        try:
            file_path = self._resolve_upload_file_path(doc.filename)
        except ValueError:
            file_path = ""

        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass
        self.save_store()
        return True

SESSIONS: Dict[str, SessionState] = {}
SESSION_TTL_SECONDS = 4 * 3600  # 4 hours TTL

def cleanup_stale_sessions():
    now = time.time()
    stale_keys = [
        sid for sid, s in SESSIONS.items()
        if sid != "default_session" and (now - s.last_active) > SESSION_TTL_SECONDS
    ]
    for sid in stale_keys:
        try:
            s = SESSIONS.pop(sid, None)
            if s and os.path.exists(s.upload_dir):
                shutil.rmtree(s.upload_dir, ignore_errors=True)
        except Exception as e:
            print(f"[SESSION_CLEANUP] Failed to evict {sid}: {e}")

def get_session(session_id: str) -> SessionState:
    cleanup_stale_sessions()
    if session_id not in SESSIONS:
        session = SessionState(session_id)
        session.load_store()
        SESSIONS[session_id] = session
    session = SESSIONS[session_id]
    session.touch()
    return session

def get_session_id(
    request: Request,
    x_session_id: Optional[str] = Header(None, alias="X-Session-ID")
) -> str:
    raw_id = (
        x_session_id
        or request.headers.get("x-session-id")
        or request.query_params.get("session_id")
    )
    if raw_id and raw_id.strip():
        clean_id = "".join(c for c in raw_id.strip() if c.isalnum() or c in "-_")
        if clean_id:
            return clean_id[:64]
    return "default_session"

def get_client_key(
    request: Request,
    x_device_id: Optional[str] = Header(None, alias="X-Device-ID")
) -> str:
    raw_device = (
        x_device_id
        or request.headers.get("x-device-id")
        or request.query_params.get("device_id")
    )
    if raw_device and raw_device.strip():
        clean_dev = "".join(c for c in raw_device.strip() if c.isalnum() or c in "-_")
        if clean_dev:
            return f"dev_{clean_dev[:64]}"

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown_client"
    clean_ip = "".join(c for c in client_ip if c.isalnum() or c in ".-_:")
    return f"ip_{clean_ip[:64]}"

def get_ratelimit_token(
    request: Request,
    x_ratelimit_token: Optional[str] = Header(None, alias="X-RateLimit-Token")
) -> Optional[str]:
    return x_ratelimit_token or request.headers.get("x-ratelimit-token")

# Backward-compatibility handles for external scripts
DEFAULT_SESSION = get_session("default_session")
DOCUMENTS = DEFAULT_SESSION.documents
INDEX = DEFAULT_SESSION.index

class QueryRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    web_search: Optional[bool] = False
    documents: Optional[List[IngestedDocument]] = None
    rate_limit_token: Optional[str] = None

class SyncDocumentsRequest(BaseModel):
    documents: List[IngestedDocument]

class QueryResponse(BaseModel):
    status: str
    result: InvestigationResult
    rate_limit: Optional[Dict] = None

router = APIRouter()

@router.get("/")
@router.get("/health")
def root(session_id: str = Depends(get_session_id)):
    session = get_session(session_id)
    return {
        "service": "docV.ai Document Investigator API",
        "status": "online",
        "active_documents": len(session.documents),
        "total_chunks_indexed": len(session.index.chunks),
        "session_id": session.session_id
    }

@router.get("/rate-limit")
def get_rate_limit(
    client_key: str = Depends(get_client_key),
    rate_token: Optional[str] = Depends(get_ratelimit_token)
):
    return RATE_LIMITER.get_status(client_key, token=rate_token)

@router.get("/documents")
def list_documents(session_id: str = Depends(get_session_id)):
    session = get_session(session_id)
    if not session.documents:
        session.load_store()
    return [
        {
            "id": doc.id,
            "filename": doc.filename,
            "file_type": doc.file_type,
            "total_pages": doc.total_pages,
            "created_at": doc.created_at
        }
        for doc in session.documents.values()
    ]

@router.delete("/documents/{doc_id}")
@router.post("/documents/{doc_id}/delete")
def delete_document(doc_id: str, session_id: str = Depends(get_session_id)):
    session = get_session(session_id)
    if not session.documents:
        session.load_store()
    success = session.remove_document(doc_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {
        "status": "success",
        "deleted_id": doc_id,
        "remaining_documents": len(session.documents)
    }

@router.post("/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    session_id: str = Depends(get_session_id)
):
    session = get_session(session_id)
    new_docs = []
    for file in files:
        try:
            temp_path = session._resolve_upload_file_path(file.filename)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid filename: {file.filename}")

        safe_filename = os.path.basename(temp_path)
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        try:
            doc = ingest_file(temp_path, safe_filename)
            session.documents[doc.id] = doc
            session.index.add_document_pages(doc.pages)
            new_docs.append({
                "id": doc.id,
                "filename": doc.filename,
                "file_type": doc.file_type,
                "total_pages": doc.total_pages
            })
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to ingest {file.filename}: {str(e)}")

    session.save_store()
    return {
        "status": "success",
        "uploaded_count": len(new_docs),
        "documents": new_docs,
        "total_documents": len(session.documents),
        "session_id": session.session_id,
        "full_documents": [doc.model_dump() for doc in session.documents.values()]
    }

@router.post("/documents/sync")
def sync_documents(
    req: SyncDocumentsRequest,
    session_id: str = Depends(get_session_id)
):
    session = get_session(session_id)
    count = session.rehydrate(req.documents)
    return {
        "status": "success",
        "synced_count": count,
        "total_documents": len(session.documents)
    }

@router.post("/query", response_model=QueryResponse)
async def run_investigation(
    req: QueryRequest,
    session_id: str = Depends(get_session_id),
    client_key: str = Depends(get_client_key),
    rate_token: Optional[str] = Depends(get_ratelimit_token)
):
    effective_session_id = req.session_id or session_id
    session = get_session(effective_session_id)
    effective_token = req.rate_limit_token or rate_token

    if not req.query or req.query.strip() == "":
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    if not session.documents:
        session.load_store()

    # Auto-rehydrate session if container lost state or client passed documents
    if req.documents and (not session.documents or len(session.documents) < len(req.documents)):
        session.rehydrate(req.documents)

    # Fast conversational check (only when web_search is not explicitly enabled)
    if not req.web_search:
        conv_result = check_conversational_query(req.query, has_documents=bool(session.documents))
        if conv_result:
            return QueryResponse(status="success", result=conv_result, rate_limit=RATE_LIMITER.get_status(client_key, token=effective_token))

    if not session.documents and not req.web_search:
        raise HTTPException(
            status_code=400,
            detail="No documents have been uploaded yet. Please upload documents first or load sample case files."
        )

    # Rate limiting enforcement for AI generations
    allowed, remaining, reset_in_sec, reset_human, signed_token = RATE_LIMITER.check_limit(client_key, token=effective_token)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "RATE_LIMIT_EXCEEDED",
                "message": f"Daily generation limit reached for this device (3/3 generations). You can generate again in {reset_human}.",
                "limit": RATE_LIMITER.max_generations,
                "used": RATE_LIMITER.max_generations,
                "remaining": 0,
                "reset_in_seconds": reset_in_sec,
                "reset_in_human": reset_human,
                "token": signed_token
            }
        )

    # Retrieve top relevant context chunks across documents in this session only
    top_chunks = session.index.search(req.query.strip(), top_k=8) if session.documents else []
    all_doc_names = [doc.filename for doc in session.documents.values()]

    result = await run_in_threadpool(
        investigate_query,
        req.query,
        top_chunks,
        all_doc_names,
        bool(req.web_search)
    )

    # Record 1 generation usage upon successful generation
    rem, r_sec, r_human, new_token = RATE_LIMITER.record_usage(client_key, token=effective_token)
    rate_info = {
        "limit": RATE_LIMITER.max_generations,
        "used": RATE_LIMITER.max_generations - rem,
        "remaining": rem,
        "reset_in_seconds": r_sec,
        "reset_in_human": r_human,
        "token": new_token
    }

    return QueryResponse(status="success", result=result, rate_limit=rate_info)

@router.post("/reset")
def reset_workspace(session_id: str = Depends(get_session_id)):
    session = get_session(session_id)
    session.reset()
    return {"status": "workspace cleared", "session_id": session.session_id}

@router.post("/sample-data")
def load_sample_case(session_id: str = Depends(get_session_id)):
    """
    Loads pre-configured sample documents with intentional cross-document contradictions
    for an immediate 1-click live demonstration for hackathon judges!
    """
    session = get_session(session_id)
    loaded_count = session.init_sample_case()
    if loaded_count == 0:
        raise HTTPException(
            status_code=500,
            detail="Sample documents are unavailable on the server. Please upload your own files."
        )
    return {
        "status": "sample data loaded successfully",
        "documents": [doc.filename for doc in session.documents.values()],
        "suggested_query": "What is the final approved amount and deadline for Milestone 1?",
        "session_id": session.session_id,
        "full_documents": [doc.model_dump() for doc in session.documents.values()]
    }

# Mount router for both /api prefix and root level
app.include_router(router, prefix="/api")
app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
