import os
import sys
import unittest
import shutil

# Ensure backend directory is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from indexer import HybridDocumentIndex
from ingest import DocumentPage
from investigator import check_conversational_query, ConflictItem, Citation
import main


class TestDocVPipelineTest1(unittest.TestCase):
    """
    Test 1: Core Automated Pipeline Verification
    - BM25 Multi-Document Relevance & Ranking
    - Conversational Intent Gatekeeping
    - Path Traversal Security Hardening
    - Conflict & Citation Models Schema
    - Dynamic Sample Case Ingestion & Removal
    """

    def setUp(self):
        self.index = HybridDocumentIndex()

    def test_01_empty_index_search(self):
        results = self.index.search("nonexistent query", top_k=5)
        self.assertEqual(results, [])

    def test_02_bm25_multi_document_indexing_and_relevance(self):
        pages = [
            DocumentPage(
                doc_id="doc_1",
                doc_name="Master_Service_Agreement_v1.txt",
                page_number=1,
                content="The total contract value is $150,000 USD. Milestone 1 fixed price is $50,000 due upon completion by March 15, 2026. Late delivery penalty is 1.5 percent deduction per week."
            ),
            DocumentPage(
                doc_id="doc_2",
                doc_name="Email_Addendum_Scope_March.txt",
                page_number=1,
                content="Per executive alignment, Milestone 1 payment is increased from $50,000 to $72,500 USD with extended deadline April 10, 2026."
            ),
            DocumentPage(
                doc_id="doc_3",
                doc_name="Vendor_Invoice_INV-089.txt",
                page_number=1,
                content="Invoice #INV-2026-089 from Zenith Innovations. Billed amount is $85,000 USD for Milestone 1 Completion. Payment terms Net 15 Days."
            )
        ]
        self.index.add_document_pages(pages)
        self.assertEqual(len(self.index.chunks), 3)

        penalty_hits = self.index.search("penalty deduction per week", top_k=1)
        self.assertEqual(len(penalty_hits), 1)
        self.assertEqual(penalty_hits[0].doc_name, "Master_Service_Agreement_v1.txt")

        addendum_hits = self.index.search("executive alignment increased 72,500", top_k=1)
        self.assertEqual(len(addendum_hits), 1)
        self.assertEqual(addendum_hits[0].doc_name, "Email_Addendum_Scope_March.txt")

        invoice_hits = self.index.search("Invoice 089 Zenith 85,000 billed", top_k=1)
        self.assertEqual(len(invoice_hits), 1)
        self.assertEqual(invoice_hits[0].doc_name, "Vendor_Invoice_INV-089.txt")

    def test_03_conversational_query_gatekeeping(self):
        greetings = ["hi", "hello docV", "hey there", "good morning", "sup"]
        for g in greetings:
            res = check_conversational_query(g, has_documents=True)
            self.assertIsNotNone(res)
            self.assertEqual(res.confidence_score, 100)

        thanks_phrases = ["thanks", "thank you", "perfect", "good job", "looks good", "awesome"]
        for t in thanks_phrases:
            res = check_conversational_query(t, has_documents=True)
            self.assertIsNotNone(res)
            self.assertEqual(res.confidence_score, 100)

        res = check_conversational_query("What is the penalty clause for late delivery?", has_documents=True)
        self.assertIsNone(res)

    def test_04_path_traversal_hardening_and_sandbox(self):
        session = main.get_session("test_security_session")
        try:
            for invalid_name in [".", "..", "   ", ""]:
                with self.assertRaises(ValueError):
                    session._resolve_upload_file_path(invalid_name)

            base_dir = os.path.realpath(session.upload_dir)
            traversal_inputs = [
                "../../etc/passwd",
                "..\\..\\windows\\system32",
                "../secret.txt",
                "folder/subfolder/file.pdf"
            ]
            for bad_path in traversal_inputs:
                resolved = session._resolve_upload_file_path(bad_path)
                self.assertTrue(resolved.startswith(base_dir))
                self.assertEqual(os.path.dirname(resolved), base_dir)
        finally:
            session.reset()
            if os.path.exists(session.upload_dir):
                shutil.rmtree(session.upload_dir, ignore_errors=True)
            main.SESSIONS.pop("test_security_session", None)

    def test_05_conflict_and_citation_models(self):
        conflict = ConflictItem(
            topic="Milestone 1 Payment Amount",
            severity="HIGH",
            document_a="Master_Service_Agreement_v1.txt, Page 1",
            claim_a="$50,000 USD due upon completion",
            document_b="Vendor_Invoice_INV-089.txt, Page 1",
            claim_b="$85,000 USD billed",
            resolution_note="Addendum authorized $72,500; invoice reflects overbill."
        )
        self.assertEqual(conflict.severity, "HIGH")

        cite = Citation(
            doc_name="Master_Service_Agreement_v1.txt",
            page_number=1,
            quote="Payment Schedule: Milestone 1 is $50,000."
        )
        self.assertEqual(cite.page_number, 1)

    def test_06_sample_case_initialization_and_removal(self):
        session = main.get_session("test_sample_case_session")
        try:
            loaded_count = session.init_sample_case()
            self.assertEqual(loaded_count, 3)
            self.assertEqual(len(session.documents), 3)

            first_doc_id = list(session.documents.keys())[0]
            deleted = session.remove_document(first_doc_id)
            self.assertTrue(deleted)
            self.assertEqual(len(session.documents), 2)
        finally:
            session.reset()
            if os.path.exists(session.upload_dir):
                shutil.rmtree(session.upload_dir, ignore_errors=True)
            main.SESSIONS.pop("test_sample_case_session", None)


if __name__ == "__main__":
    unittest.main()
