import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from rank_bm25 import BM25Okapi
from ingest import DocumentPage

class TextChunk(BaseModel):
    chunk_id: str
    doc_id: str
    doc_name: str
    page_number: int
    content: str

def tokenize(text: str) -> List[str]:
    return re.findall(r'\w+', text.lower())

class HybridDocumentIndex:
    def __init__(self):
        self.chunks: List[TextChunk] = []
        self.tokenized_corpus: List[List[str]] = []
        self.bm25: Optional[BM25Okapi] = None

    def add_document_pages(self, pages: List[DocumentPage], chunk_size: int = 400, overlap: int = 50):
        for page in pages:
            text = page.content
            if not text:
                continue
            
            words = text.split()
            if len(words) <= chunk_size:
                chunk = TextChunk(
                    chunk_id=f"{page.doc_id}-p{page.page_number}-c0",
                    doc_id=page.doc_id,
                    doc_name=page.doc_name,
                    page_number=page.page_number,
                    content=text
                )
                self.chunks.append(chunk)
                self.tokenized_corpus.append(tokenize(text))
            else:
                step = chunk_size - overlap
                for i in range(0, len(words), step):
                    chunk_words = words[i:i + chunk_size]
                    chunk_text = " ".join(chunk_words)
                    chunk = TextChunk(
                        chunk_id=f"{page.doc_id}-p{page.page_number}-c{i//step}",
                        doc_id=page.doc_id,
                        doc_name=page.doc_name,
                        page_number=page.page_number,
                        content=chunk_text
                    )
                    self.chunks.append(chunk)
                    self.tokenized_corpus.append(tokenize(chunk_text))

        if self.tokenized_corpus:
            self.bm25 = BM25Okapi(self.tokenized_corpus)

    def search(self, query: str, top_k: int = 6) -> List[TextChunk]:
        if not self.bm25 or not self.chunks:
            return []
        
        query_tokens = tokenize(query)
        if not query_tokens:
            return self.chunks[:top_k]

        scores = self.bm25.get_scores(query_tokens)
        scored_chunks = list(zip(self.chunks, scores))
        # Sort by highest relevance score
        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        
        # Return top_k chunks with score > 0, or top chunks if scores are uniform
        results = [chunk for chunk, score in scored_chunks[:top_k] if score > 0]
        if not results and self.chunks:
            results = self.chunks[:top_k]
        return results

    def clear(self):
        self.chunks = []
        self.tokenized_corpus = []
        self.bm25 = None
