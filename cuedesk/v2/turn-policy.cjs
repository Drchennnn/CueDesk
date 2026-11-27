'use strict';
// Standalone: the installer embeds this same function in the renderer.
// This is a conservative local turn filter, not a semantic ASR confidence score.
function classifyTurn(text, meta = {}) {
  const q = String(text || '').trim();
  if (meta.isFinal === false || meta.final === false) return { action: 'wait', reason: 'partial_transcript' };
  const plain = q.replace(/[\s，,。.!！?？、…；;：:]/g, '').toLowerCase();
  const followupOnly = /^(?:(?:ok(?:ay)?|嗯|对|好|行))*(?:然后呢|接着呢|比如呢|为什么|具体呢|继续(?:说)?|再说一点|andthen|whatelse|anythingelse|why|how|howso|goon|continue|moredetails|canyouelaborate)$/.test(plain);
  if (!plain || /^(?:(?:ok(?:ay)?|嗯|恩|哦|噢|啊|哎|对的?|好的?|行|是的?|了解|明白|收到|可以|没错|y|うん|yeah|yep|uhhuh|gotit|isee|makessense|alright|sure|cool|great|thanks|thankyou))+$/.test(plain))
    return { action: 'ignore', reason: 'acknowledgement' };
  const openAlternative = /还是[。．.，,…\s]*$/.test(q) && /[?？]/.test(q);
  if (!openAlternative && /(?:或者说|比方说|比如说|比方|比如|例如|还是|因为|如果|以及|而且|但是|然后|(?:是|就){1,3}|把|让)[。．.，,、…\s]*$/.test(q) && !/[?？]\s*$/.test(q))
    return { action: 'wait', reason: 'unfinished_clause' };
  const correction = /不是(?:在问|问|这个意思)|不(?:算|像是)|我(?:想|其实想|现在|刚才)?问(?:的|是|这个)|换个角度|(?:为什么|为何).{0,8}(?:一定|必须).{0,4}(?:用|要)|为什么不能/.test(q);
  const explicit = /为什么|为何|怎么|如何|是否|能不能|可不可以|有没有|多少|多久|哪些|哪个|什么|[?？]|(?:吗|呢)[。.!！\s]*$|\b(?:why|how|what|which|where|when|who|explain|describe|introduce|tell\s+me|walk\s+me\s+through|talk\s+about|share|give\s+(?:me\s+)?an?\s+example|can\s+you|could\s+you|would\s+you|do\s+you|did\s+you|have\s+you|are\s+you)\b/i.test(q);
  const instruction = /(?:介绍|讲讲|说说|谈谈|举.{0,6}例子|举例|展开|继续说|接着说|描述|具体说)/.test(q);
  const feedback = /这也很正常|这就是.{0,8}目的|我(?:先|来)?(?:介绍|说明|解释)一下|我的意思是|只是在介绍|没有.{0,8}提问/.test(q);
  if (feedback && !correction && !/(?:你(?:们)?|请).{0,25}(?:怎么|如何|能不能|说说|讲讲|介绍)|为什么|[?？]\s*$/.test(q))
    return { action: 'update', reason: 'interviewer_explanation' };
  if (explicit || instruction || correction || /(?:然后|接着|比如)呢|你.{0,25}(?:吗|呢)|你觉得|你认为|最有信心|最擅长/.test(q))
    return { action: 'answer', reason: correction ? 'correction_or_reframing' : 'question_or_instruction', correction, open_alternative: openAlternative, followup_only: followupOnly };
  return { action: 'update', reason: 'statement_or_feedback' };
}
module.exports = { classifyTurn };
