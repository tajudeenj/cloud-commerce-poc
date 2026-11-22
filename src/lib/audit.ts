import "server-only";
import { db, schema, type Tx } from "@/lib/db";

export type AuditEntry = {
  actorId?: string | null;
  impersonatorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
  ip?: string | null;
};

const SENSITIVE = /pass(word)?|token|secret|card|cvv|pan/i;

/** Redacts sensitive keys so the audit trail never stores credentials or card data. */
function redact(data: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, SENSITIVE.test(k) ? "[redacted]" : v]));
}

export async function audit(e: AuditEntry, tx?: Tx) {
  await (tx ?? db()).insert(schema.auditLog).values({
    actorId: e.actorId ?? null,
    impersonatorId: e.impersonatorId ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    data: redact(e.data),
    ip: e.ip ?? null,
  });
}
