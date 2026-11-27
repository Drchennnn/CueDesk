'use strict';
// Topic vocabulary describes concepts, not answers or candidate experience.
const FACETS=[
 {id:'chunking',label:'切块',re:/切块|切割|分块|chunk(?:ing)?|split(?:ting)?|overlap|parent[\s-]?child/i,terms:['切块','切割','分块','chunking']},
 {id:'embedding',label:'向量表示',re:/向量化|向量表示|嵌入|embedding|dense|sparse|编码.{0,4}向量|\bvector\b|semantic\s+search/i,terms:['向量','dense','sparse','embedding']},
 {id:'retrieval',label:'检索与融合',re:/召回|混合检索|融合|rrf|精排|重排|rerank|hybrid\s+(?:search|retrieval)|retriev\w*|bm25|fts5/i,terms:['检索','召回','融合','rrf']},
 {id:'testing',label:'测试与验证',re:/验证|验收|测试|回归|检查|自动化测试|测试经验|测试实践|\b(?:test(?:ing|s|case)?|qa|sdet|verif\w*|validat\w*|regression|bug|defect|assert\w*|pytest|automation)\b/i,terms:['验证','测试','回归','用例','缺陷','测试开发','pytest']},
 {id:'evaluation',label:'效果评估',re:/评估|评测|准确率|正确率|效果|质量|检验|衡量|好坏|靠不靠谱|是否可靠|量化.{0,8}(?:效果|质量|表现)|\b(?:eval(?:uat\w*)?|accuracy|precision|recall|f1|metric|benchmark|rubric|quality|hallucination)\b/i,terms:['评估','评测','效果','质量','量化']},
 {id:'storage',label:'存储',re:/存储|数据库|sqlite|qdrant|mysql|redis|\b(?:storage|database|sql|table|schema)\b/i,terms:['存储','数据库']},
 {id:'frontend',label:'前端',re:/前端|页面|\bvue\b|\breact\b|组件|\bjsx\b|\bprops\b|\busestate\b|\b(?:frontend|front-end|dashboard|echarts)\b/i,terms:['前端','页面','组件']},
 {id:'agent_workflow',label:'智能体与工具循环',re:/codex|claude\s*code|智能体|\bagent\b|工具调用|工具循环|上下文管理|权限确认|\b(?:ai[\s-]?coding|ai[\s-]?assisted|ai[\s-]?generated|vibe\s*coding|tool\s*call|mcp|handoff|workflow)\b/i,terms:['agent','智能体','工具调用','上下文','ai','验证']},
 {id:'concurrency',label:'并发',re:/异步|线程|进程|并发|asyncio|\b(?:async(?:io)?|thread(?:ing)?|process(?:ing)?|multiprocess\w*|concurren\w*|gil|coroutine)\b/i,terms:['异步','线程','进程','并发']},
 {id:'api_web',label:'接口与Web',re:/接口|幂等|限流|鉴权|\b(?:rest(?:ful)?|api|idempoten\w*|rate\s*limit\w*|auth(?:entication|orization)?|jwt|oauth)\b/i,terms:['接口','api','rest']},
 {id:'open_source',label:'开源贡献',re:/开源|github|贡献|\b(?:open[\s-]?source|pr|pull\s*request|contributor|maintainer|merge)\b/i,terms:['开源','pr','github','贡献']}
];
function frontendText(text){return text.replace(/\bReAct\b/g,'智能体推理方法');}
function facets(q){return FACETS.filter(f=>matchesFacet(f,q));}
function matchesFacet(f,text){if(f.id==='frontend')return f.re.test(frontendText(text));if(f.id==='agent_workflow')return f.re.test(text)||/\bReAct\b/.test(text);return f.re.test(text)||f.id==='embedding'&&/向量/.test(text);}
function generalKnowledge(q){return !/项目|你们的|你的|当时|负责|做过|\b(?:your|you|project|did\s+you|role|experience)\b/i.test(q)&&(/(?:一般|通常|常见|常用).{0,12}(?:方法|策略|做法|区别|用途|流程)|(?:有哪些|有什么).{0,8}(?:方法|类型|策略)|什么是|是什么|原理|概念/.test(q)||/\b(?:what\s+is|what\s+are|difference\s+between|how\s+does\s+\w+\s+work|explain\s+(?:the\s+)?(?:concept|principle|difference))\b/i.test(q));}
function noise(t){return /^(?:方法|策略|怎么样|怎样|你的|我们|一般|常见|常用|哪些|什么|怎么|如何|说一|一下|有哪|有哪些|有什么|是什么|问题|项目|一个|这个|那个|自己|本人|进行|处理|系统|服务|工程|设计|方案|应该|觉得|认为|假设|如果|一套|注意|哪里|地方|时候|实际|落地|困难|难点|回答|介绍|能不能|怎么做|了解|解过|有了|每一|一版|都是|这样|样一|一次|次次|的点|次的|用过|主要|部分|现在|相关|大概|a|an|the|and|or|for|with|from|into|of|to|in|on|at|by|as|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|would|should|will|you|your|yourself|me|my|we|our|it|its|this|that|these|those|please|tell|about|how|what|why|when|where|which|who|one|two|minute|minutes|second|seconds|join|want|intern|internship)$/i.test(t);}
function expansions(q){return [...new Set(facets(q).flatMap(f=>f.terms))];}
module.exports={facets,matchesFacet,generalKnowledge,noise,expansions,frontendText};
