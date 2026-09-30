import type { SafetyContext, SafetyPolicyResult } from "./policy-types.js";

const HOMOGLYPH_MAP: Record<string, string> = {
  "\u0430": "a",
  "\u0410": "A", // Cyrillic а/А
  "\u0435": "e",
  "\u0415": "E", // Cyrillic е/Е
  "\u043E": "o",
  "\u041E": "O", // Cyrillic о/О
  "\u0440": "p",
  "\u0420": "P", // Cyrillic р/Р
  "\u0441": "c",
  "\u0421": "C", // Cyrillic с/С
  "\u0443": "y",
  "\u0423": "Y", // Cyrillic у/У
  "\u0445": "x",
  "\u0425": "X", // Cyrillic х/Х
  "\u0456": "i",
  "\u0406": "I", // Cyrillic і/І
  "\u03B1": "a",
  "\u0391": "A", // Greek α/Α
  "\u03BF": "o",
  "\u039F": "O", // Greek ο/Ο
  "\u03BD": "v",
  "\u039D": "N", // Greek ν/Ν
};

function normalizeText(input: string): string {
  // 1. Strip zero-width & invisible format characters
  let text = input.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/gu, "");
  // 2. Unicode NFKD normalization
  text = text.normalize("NFKD");
  // 3. Replace homoglyphs
  text = text.replace(/[\u0400-\u04FF\u0370-\u03FF]/gu, (char) => HOMOGLYPH_MAP[char] ?? char);
  return text;
}

function extractDecodedVariants(rawText: string): string[] {
  const normalized = normalizeText(rawText);
  const variants = [rawText, normalized];

  // URL decoding (supports single and multi-level / double URL encoding)
  if (rawText.includes("%")) {
    try {
      const decodedUrl = decodeURIComponent(rawText);
      if (decodedUrl !== rawText) {
        variants.push(decodedUrl);
        variants.push(normalizeText(decodedUrl));
        if (decodedUrl.includes("%")) {
          try {
            const doubleDecoded = decodeURIComponent(decodedUrl);
            if (doubleDecoded !== decodedUrl) {
              variants.push(doubleDecoded);
              variants.push(normalizeText(doubleDecoded));
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore malformed URL sequences
    }
  }

  // Hex escape decoding (\x61\x64...)
  if (/\\x[0-9a-fA-F]{2}/u.test(rawText)) {
    try {
      const hexDecoded = rawText.replace(/\\x([0-9a-fA-F]{2})/gu, (_match: string, hex: string) => {
        const code = parseInt(hex, 16);
        return String.fromCharCode(code);
      });
      variants.push(hexDecoded);
      variants.push(normalizeText(hexDecoded));
    } catch {
      // ignore
    }
  }

  // Base64 chunk extraction & decoding
  const base64Regex = /\b[A-Za-z0-9+/]{16,}={0,2}\b/gu;
  const matches = rawText.match(base64Regex);
  if (matches) {
    for (const chunk of matches) {
      try {
        const decoded = Buffer.from(chunk, "base64").toString("utf8");
        if (/^[\x20-\x7E\s]+$/u.test(decoded)) {
          variants.push(decoded);
          variants.push(normalizeText(decoded));
        }
      } catch {
        // ignore invalid base64
      }
    }
  }

  return variants;
}

const INJECTION_PATTERNS: ReadonlyArray<{ readonly regex: RegExp; readonly reason: string }> = [
  {
    regex:
      /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|directives|rules)/iu,
    reason: "PROMPT_INJECTION_OVERRIDE",
  },
  // Multilingual prompt injection (Vietnamese, Spanish, French, Russian)
  {
    regex:
      /(?:bỏ qua|hãy quên|không tuân theo|bỏ hết)\s+(?:tất cả\s+)?(?:hướng dẫn|chỉ thị|quy tắc|lời nhắc)\s+(?:trước|cũ|ban đầu)/iu,
    reason: "MULTILINGUAL_INJECTION_OVERRIDE",
  },
  {
    regex: /(?:ignora|olvida|desatiende)\s+(?:todas\s+las\s+)?(?:instrucciones|indicaciones|directivas)/iu,
    reason: "MULTILINGUAL_INJECTION_OVERRIDE",
  },
  {
    regex: /(?:ignore|oublie)\s+(?:toutes\s+les\s+)?(?:instructions|directives|consignes)/iu,
    reason: "MULTILINGUAL_INJECTION_OVERRIDE",
  },
  {
    regex: /(?:игнорируй|забудь)\s+(?:все\s+)?(?:предыдущие\s+)?(?:инструкции|команды|правила)/iu,
    reason: "MULTILINGUAL_INJECTION_OVERRIDE",
  },
  // Tool injection & RAG indirect prompt injection poisoning
  {
    regex:
      /(?:\[(?:TOOL_CALL|FUNCTION_CALL|TOOL_INVOKE)|<tool_call>|\{"(?:tool|function|action)":\s*"(?:execute|shell|bash|eval|sql))/iu,
    reason: "TOOL_INJECTION_ATTEMPT",
  },
  {
    regex: /(?:(?:INSTRUCTION|SYSTEM|DIRECTIVE)\s+(?:OVERRIDE|HIJACK)|INDIRECT_INJECTION):/iu,
    reason: "RAG_INDIRECT_INJECTION_DETECTED",
  },
  {
    regex:
      /(?:reveal|show|print|output|display|repeat)\s+(?:your\s+)?(?:system\s+prompt|developer\s+instructions|hidden\s+prompt|initial\s+prompt)/iu,
    reason: "SYSTEM_PROMPT_EXTRACTION",
  },
  {
    regex:
      /(?:service[_\s]*token|jwt[_\s]*secret|private[_\s]*key|database[_\s]*password|credentials|api[_-]?key|root[_\s]*secret)/iu,
    reason: "CREDENTIAL_EXFILTRATION_ATTEMPT",
  },
  {
    regex:
      /(?:act\s+as|pretend\s+(?:to\s+be)?|switch\s+to|enable)\s+(?:administrator|admin|system\s+admin|root|lecturer|super\s*user)/iu,
    reason: "ROLE_ESCALATION_ATTEMPT",
  },
  {
    regex: /(?:dan\s+mode|jailbreak|unfiltered\s+mode|developer\s+mode\s+output)/iu,
    reason: "JAILBREAK_PATTERN_DETECTED",
  },
];

export function evaluatePromptInjection(context: SafetyContext, now: Date): SafetyPolicyResult | null {
  const messageVariants = extractDecodedVariants(context.message);

  // 1. Evaluate single-turn message with all decoded and normalized variants
  for (const variant of messageVariants) {
    for (const { regex, reason } of INJECTION_PATTERNS) {
      if (regex.test(variant)) {
        return {
          allowed: false,
          policyId: "PROMPT_INJECTION_DEFENSE",
          decision: "REFUSE",
          reasonCode: reason,
          userSafeExplanation:
            "Yêu cầu của bạn vi phạm chính sách an toàn của AILSS. Trợ lý AI không thể thực hiện các chỉ thị cố gắng thay đổi quy tắc hệ thống hoặc truy xuất thông tin bảo mật.",
          internalAuditMetadata: {
            matchedRule: reason,
            promptSample: context.message.slice(0, 100),
            normalizedSample: variant.slice(0, 100),
          },
          affectedTools: [],
          timestamp: now,
        };
      }
    }
  }

  // 2. Evaluate multi-turn cumulative injection
  if (context.conversationHistory && context.conversationHistory.length > 0) {
    const combinedHistory = [...context.conversationHistory, context.message].join(" ");
    const historyVariants = extractDecodedVariants(combinedHistory);

    for (const variant of historyVariants) {
      for (const { regex, reason } of INJECTION_PATTERNS) {
        if (regex.test(variant)) {
          return {
            allowed: false,
            policyId: "MULTI_TURN_INJECTION_DEFENSE",
            decision: "REFUSE",
            reasonCode: `MULTI_TURN_${reason}`,
            userSafeExplanation:
              "Hành vi tương tác qua nhiều lượt câu hỏi vi phạm chính sách an toàn của AILSS.",
            internalAuditMetadata: {
              matchedRule: `MULTI_TURN_${reason}`,
              historyTurnsCount: context.conversationHistory.length,
            },
            affectedTools: [],
            timestamp: now,
          };
        }
      }
    }
  }

  return null;
}
