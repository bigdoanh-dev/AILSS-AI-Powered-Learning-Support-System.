export interface IndirectInjectionAnalysis {
  readonly safe: boolean;
  readonly reasonCode?: string | undefined;
  readonly sanitizedContent: string;
}

const INDIRECT_INJECTION_RULES: ReadonlyArray<{ readonly regex: RegExp; readonly reason: string }> = [
  {
    regex: /(?:---|===|\*\*\*)\s*(?:END\s+CONTEXT|SYSTEM\s+(?:NOTE|PROMPT|DIRECTIVE)|BEGIN\s+SYSTEM|ADMIN\s+OVERRIDE)\s*(?:---|===|\*\*\*)/iu,
    reason: "DELIMITER_HIJACKING_ATTEMPT",
  },
  {
    regex: /<\|(?:im_start|im_end|system|user|assistant)\|>/iu,
    reason: "CHATML_TOKEN_INJECTION",
  },
  {
    regex: /```(?:system|admin|override|secret)/iu,
    reason: "CODEBLOCK_ROLE_INJECTION",
  },
  {
    regex: /(?:ignore|disregard|bypass)\s+(?:all\s+)?(?:prior|previous|above)\s+(?:instructions|guidelines|system\s+prompts)/iu,
    reason: "INDIRECT_INSTRUCTION_OVERRIDE",
  },
  {
    regex: /!\[.*?\]\((?:https?:)?\/\/[^\s)]+(?:exfil|steal|leak|token|api_key|password)[^\s)]*\)/iu,
    reason: "MARKDOWN_IMAGE_EXFILTRATION",
  },
  {
    regex: /(?:print|reveal|output|exfiltrate)\s+(?:all\s+)?(?:user\s+data|api[_-]?keys?|system\s+instructions)/iu,
    reason: "INDIRECT_DATA_EXFILTRATION",
  },
];

/**
 * Enterprise Indirect Prompt Injection Detector & Sanitizer.
 * Inspects untrusted ingested chunks (from PDFs, web pages, forum posts, student comments)
 * before injecting them into RAG context or LLM prompt templates.
 */
export function evaluateIndirectPromptInjection(text: string): IndirectInjectionAnalysis {
  for (const { regex, reason } of INDIRECT_INJECTION_RULES) {
    if (regex.test(text)) {
      // Strip or neutralize the attack payload
      const sanitized = text
        .replace(regex, "[REDACTED_UNTRUSTED_INJECTION_PATTERN]")
        .replace(/[<|`]/gu, " ")
        .trim();

      return {
        safe: false,
        reasonCode: reason,
        sanitizedContent: sanitized,
      };
    }
  }

  // Remove zero-width characters (ZWSP, ZWNJ, ZWJ, etc.) often used to evade tokenizers
  const sanitized = text.replace(/[\u200B-\u200D\uFEFF]/gu, "").trim();

  return {
    safe: true,
    sanitizedContent: sanitized,
  };
}
