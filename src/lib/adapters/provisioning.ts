import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { httpJson, IntegrationError } from "./http";

export type ProvisionRequest = {
  jobId: string;
  subscriptionId: string;
  type: string;
  planCode: string;
  addonCodes: string[];
  config: { region?: string; os?: string; hostname?: string };
};
export type ProvisionResult = { externalRef: string; details: Record<string, string> };

/** Contract with Umniah cloud provisioning backends (VPS / Email / DNS ...). Calls are idempotent on jobId. */
export interface ProvisioningAdapter {
  provision(r: ProvisionRequest): Promise<ProvisionResult>;
  modify(r: ProvisionRequest & { externalRef: string }): Promise<ProvisionResult>;
  deprovision(r: { jobId: string; externalRef: string; type: string }): Promise<void>;
}

class MockProvisioning implements ProvisioningAdapter {
  async provision(r: ProvisionRequest): Promise<ProvisionResult> {
    await delay(300);
    // Demo hook: hostnames containing "fail" simulate a permanent backend failure to show compensation.
    if (r.config.hostname?.includes("fail")) throw new IntegrationError("Backend rejected request (simulated)", 422, false);
    const ref = `${r.type.toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
    return { externalRef: ref, details: detailsFor(r, ref) };
  }
  async modify(r: ProvisionRequest & { externalRef: string }) {
    await delay(200);
    return { externalRef: r.externalRef, details: detailsFor(r, r.externalRef) };
  }
  async deprovision() {
    await delay(100);
  }
}

function detailsFor(r: ProvisionRequest, ref: string): Record<string, string> {
  const region = r.config.region ?? "Amman-1";
  if (r.type === "vps") {
    const o = randomBytes(2);
    return { "IPv4 address": `185.98.${o[0]}.${o[1]}`, Hostname: r.config.hostname || ref.toLowerCase(),
      Region: region, "Operating system": r.config.os ?? "Ubuntu 24.04 LTS", "SSH user": "root" };
  }
  if (r.type === "email") return { "Mail domain": r.config.hostname || "example.jo", "IMAP host": "imap.cloud.local", "SMTP host": "smtp.cloud.local", Region: region };
  if (r.type === "dns") return { Zone: r.config.hostname || "example.jo", Nameservers: "ns1.cloud.local, ns2.cloud.local" };
  return { Reference: ref };
}

class HttpProvisioning implements ProvisioningAdapter {
  private cfg() {
    const e = env();
    if (!e.PROVISIONING_BASE_URL) throw new IntegrationError("PROVISIONING_BASE_URL not configured", undefined, false);
    return { url: e.PROVISIONING_BASE_URL.replace(/\/$/, ""), headers: { Authorization: `Bearer ${e.PROVISIONING_API_KEY ?? ""}` } };
  }
  async provision(r: ProvisionRequest) {
    const { url, headers } = this.cfg();
    return httpJson<ProvisionResult>(`${url}/${encodeURIComponent(r.type)}/services`, {
      method: "POST", headers, body: r, idempotencyKey: r.jobId, timeoutMs: 30_000,
    });
  }
  async modify(r: ProvisionRequest & { externalRef: string }) {
    const { url, headers } = this.cfg();
    return httpJson<ProvisionResult>(`${url}/${encodeURIComponent(r.type)}/services/${encodeURIComponent(r.externalRef)}`, {
      method: "PUT", headers, body: r, idempotencyKey: r.jobId, timeoutMs: 30_000,
    });
  }
  async deprovision(r: { jobId: string; externalRef: string; type: string }) {
    const { url, headers } = this.cfg();
    await httpJson(`${url}/${encodeURIComponent(r.type)}/services/${encodeURIComponent(r.externalRef)}`, {
      method: "DELETE", headers, idempotencyKey: r.jobId,
    });
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const g = globalThis as unknown as { __prov?: ProvisioningAdapter };
export function provisioning(): ProvisioningAdapter {
  return (g.__prov ??= env().PROVISIONING_MODE === "http" ? new HttpProvisioning() : new MockProvisioning());
}
