import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { DomainError } from "@/lib/services/catalog";
import { IntegrationError } from "@/lib/adapters/http";

export type FormState = { error?: string; ok?: string } | undefined;

/** Converts expected failures to user-facing messages; never leaks internals. Lets Next redirects pass through. */
export async function runAction(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof DomainError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Invalid input" };
    if (e instanceof IntegrationError) {
      console.error("[integration]", e.message);
      return { error: "A backend system is temporarily unavailable. Please try again shortly." };
    }
    console.error("[action] unexpected", e);
    return { error: "Something went wrong. Please try again." };
  }
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
export const uuid = z.string().uuid("Invalid identifier");
