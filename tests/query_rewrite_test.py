import json
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "meeting-copilot/rag"))
from query_rewrite import QueryRewriter


def response(value):
    return SimpleNamespace(status_code=200, output={"choices": [{"message": {"content": json.dumps(value)}}]})


class QueryRewriteTests(unittest.TestCase):
    def setUp(self):
        self.rewriter = QueryRewriter({"rewrite_model": "qwen-flash", "base_address": "https://dashscope.aliyuncs.com/api/v1"})
        self.key = patch.dict("os.environ", {"DASHSCOPE_API_KEY": "unit-test"})
        self.key.start()
        self.addCleanup(self.key.stop)

    @patch("query_rewrite.Generation.call")
    def test_original_and_corrected_queries_are_both_retained(self, call):
        call.return_value = response({"status": "rewritten", "query": "Agent怎样调用工具？",
                                     "corrections": [{"original": "a件", "replacement": "Agent"}]})
        plan = self.rewriter.prepare("a件怎样调用工具？")
        self.assertEqual(plan["queries"], ["a件怎样调用工具？", "Agent怎样调用工具？"])
        self.assertEqual(plan["original_query"], "a件怎样调用工具？")

    @patch("query_rewrite.Generation.call")
    def test_ambiguous_output_keeps_original_context(self, call):
        call.return_value = response({"status": "ambiguous", "query": "模型调用工具？", "clarification": "是工具调用还是引用依据？"})
        plan = self.rewriter.prepare("模型调用根据？")
        self.assertEqual(plan["query"], "模型调用根据？")
        self.assertEqual(plan["status"], "ambiguous")

    @patch("query_rewrite.Generation.call")
    def test_unchanged_query_preserves_context_and_context_is_part_of_cache_key(self, call):
        call.return_value = response({"status": "unchanged", "query": "失败呢？"})
        one = self.rewriter.prepare("失败呢？", "工具调用失败呢？")
        two = self.rewriter.prepare("失败呢？", "HTTP请求失败呢？")
        self.assertNotEqual(one["query"], two["query"])
        self.rewriter.prepare("失败呢？", "工具调用失败呢？")
        self.assertEqual(call.call_count, 2)

    @patch("query_rewrite.Generation.call")
    def test_failure_or_unanchored_correction_falls_back(self, call):
        call.side_effect = TimeoutError()
        plan = self.rewriter.prepare("RAG是什么？")
        self.assertEqual(plan["status"], "fallback")
        self.assertEqual(plan["queries"], ["RAG是什么？"])
        call.side_effect = None
        call.return_value = response({"status": "rewritten", "query": "Redis是什么？",
                                     "corrections": [{"original": "不存在的词", "replacement": "Redis"}]})
        plan = self.rewriter.prepare("缓存是什么？")
        self.assertEqual(plan["status"], "fallback")
        self.assertEqual(plan["queries"], ["缓存是什么？"])

    @patch("query_rewrite.Generation.call")
    def test_followup_receives_draft_as_data_and_cache_varies_with_progress(self, call):
        call.return_value = response({"status": "rewritten", "query": "模型代理如何验证额度扣减？",
                                     "answer_focus": "验证重复请求的额度扣减", "already_explained": ["要点"] * 8})
        one = self.rewriter.prepare("然后呢？", "模型代理如何实现？", "已说明代理转发")
        self.rewriter.prepare("然后呢？", "模型代理如何实现？", "已说明错误处理")
        self.rewriter.prepare("然后呢？", "模型代理如何实现？", "已说明错误处理")
        self.assertEqual(call.call_count, 2)
        sent = json.loads(call.call_args.kwargs["messages"][1]["content"])
        self.assertEqual(sent["previous_assistant_draft"], "已说明错误处理")
        self.assertIn("然后呢？", one["queries"])
        self.assertEqual(one["answer_focus"], "验证重复请求的额度扣减")
        self.assertEqual(len(one["already_explained"]), 6)
        self.assertEqual(one["status"], "rewritten")

    @patch("query_rewrite.Generation.call")
    def test_ambiguous_followup_cannot_supply_answer_focus(self, call):
        call.return_value = response({"status": "ambiguous", "query": "支付如何实现？",
                                     "answer_focus": "引入支付系统"})
        plan = self.rewriter.prepare("然后呢？", "一个工具怎么做？", "方案对象尚未确认")
        self.assertEqual(plan["answer_focus"], "")

    @patch("query_rewrite.Generation.call")
    def test_progress_without_a_draft_is_discarded(self, call):
        call.return_value = response({"status": "unchanged", "query": "为什么一定要用后端？",
                                     "answer_focus": "必须引入后端", "already_explained": ["未经输入确认的草稿"]})
        plan = self.rewriter.prepare("为什么一定要用后端？")
        self.assertEqual(plan["answer_focus"], "")
        self.assertEqual(plan["already_explained"], [])


if __name__ == "__main__":
    unittest.main()
