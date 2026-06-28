// response-validator.ts — versão corrigida após code review (Ex 3.1)
// Correções aplicadas: .strict() no schema, normalização case/trim,
// suporte a source_document array, logger pino, range confidence_score,
// SAFE_DEFAULT_RESPONSE com source_document='SYSTEM' para evitar loop de validação.

import { z } from 'zod';
// logger será importado de src/shared/logger.ts quando o módulo estiver implementado.
// Por enquanto: stub compatível com a interface pino para não bloquear compilação.
const logger = {
  warn: (obj: Record<string, unknown>, msg: string) => {
    // Em produção: substituir por import { logger } from '../shared/logger.js'
    // pino estrutura o log como JSON com timestamp, level, e campos extras.
    // NUNCA usar console.log — ver AGENTS.md.
    void obj; void msg;
  },
};

// ── Schema de structured output ───────────────────────────────────────────────
//
// .strict() rejeita campos extras não declarados — se o modelo gerar um campo
// não esperado, a validação falha e a resposta é rejeitada. Sem .strict(),
// campos extras (incluindo injeções) seriam silenciosamente ignorados.
//
// confidence_score: .min(0).max(1) — o modelo pode gerar valores fora do range
// esperado; sem esta constraint, valores negativos ou > 1 passariam.
//
// source_document aceita string OU array de strings — o modelo pode citar
// múltiplas fontes. verifySourceDocument() normaliza internamente para array.
export const AssistantResponseSchema = z.object({
  answer: z.string().min(1),
  source_document: z.union([z.string(), z.array(z.string())]),
  confidence_score: z.number().min(0).max(1),
}).strict();

export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;

// ── Lista de documentos válidos ───────────────────────────────────────────────
// Identificadores curtos (não títulos completos). Stored uppercase para
// comparação normalizada. Atualizar quando novos documentos forem indexados.
const VALID_DOCUMENTS = new Set([
  'POL-001',
  'PROC-042',
  'PROC-042-V2',   // normalizado: PROC-042-v2 → uppercase
  'SLA-2024',
  'FAQ-ATENDIMENTO',
]);

export interface VerificationResult {
  isValid: boolean;
  isSuspect: boolean;
  reason: string;
}

/**
 * Verifica se o(s) source_document(s) citado(s) existem na lista de documentos
 * válidos da NovaTech. Aceita string ou array de strings.
 *
 * Normalização: trim + toUpperCase antes de comparar — evita falsos negativos
 * por variação de capitalização ou espaços nos outputs do modelo.
 *
 * LIMITE: verificação de existência ≠ verificação de adequação.
 * FAQ-Atendimento está na lista (está indexado), mas é documento informal.
 * Usar FAQ-Atendimento para responder sobre carga perigosa é inadequado mesmo
 * passando nesta verificação — isso é responsabilidade da camada de Guardrails.
 */
export function verifySourceDocument(
  sourceDocument: string | string[] | undefined | null
): VerificationResult {
  if (sourceDocument === undefined || sourceDocument === null) {
    logger.warn({ sourceDocument: null }, 'source_document_missing');
    return { isValid: false, isSuspect: true, reason: 'source_document ausente' };
  }

  // Normalizar para array independente do tipo recebido
  const docs = Array.isArray(sourceDocument) ? sourceDocument : [sourceDocument];

  if (docs.length === 0) {
    logger.warn({ sourceDocument: '[]' }, 'source_document_empty_array');
    return { isValid: false, isSuspect: true, reason: 'source_document ausente' };
  }

  // Verificar cada documento citado
  const unrecognized: string[] = [];
  for (const doc of docs) {
    const normalized = doc.trim().toUpperCase();
    if (normalized === '') {
      return { isValid: false, isSuspect: true, reason: 'source_document string vazia' };
    }
    if (!VALID_DOCUMENTS.has(normalized)) {
      unrecognized.push(doc.trim().substring(0, 50)); // truncar para evitar log bombing
    }
  }

  if (unrecognized.length > 0) {
    logger.warn({ unrecognized }, 'source_document_not_recognized');
    return {
      isValid: false,
      isSuspect: true,
      reason: `documento(s) não reconhecido(s): ${unrecognized.join(', ')}`,
    };
  }

  return { isValid: true, isSuspect: false, reason: 'documento(s) válido(s)' };
}

// ── Resposta padrão segura ────────────────────────────────────────────────────
// source_document='SYSTEM' evita o loop de validação: se usássemos '' (vazio),
// a resposta de fallback falharia na sua própria validação pelo schema.
// 'SYSTEM' não está na lista de docs válidos, mas verifySourceDocument() não é
// chamado sobre respostas de fallback — elas são geradas internamente, não pelo LLM.
export const SAFE_DEFAULT_RESPONSE = {
  answer: 'Não foi possível processar sua consulta com segurança. Por favor, consulte o supervisor ou tente novamente.',
  source_document: 'SYSTEM',
  confidence_score: 0,
} as const;
