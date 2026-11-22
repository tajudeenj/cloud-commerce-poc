import Link from "next/link";
import { Alert } from "@/components/ui";

export const metadata = { title: "Payment result", robots: { index: false } };

export default async function Result({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const msg = status === "paid" ? ["success", "Payment received. Your service is being set up."]
    : status === "failed" ? ["error", "Your payment was declined or cancelled. No charge was made — please try again or use another card."]
    : status === "invalid" ? ["error", "We could not verify the payment response. If you were charged, please contact support."]
    : ["error", "Something went wrong while confirming your payment. Please check your account or contact support."];
  return (
    <div className="mx-auto max-w-lg space-y-4 py-12">
      <h1 className="h1">Payment status</h1>
      <Alert kind={msg[0] as "success" | "error"}>{msg[1]}</Alert>
      <div className="flex gap-3"><Link className="btn-primary" href="/portal">Go to my account</Link><Link className="btn-secondary" href="/">Continue shopping</Link></div>
    </div>
  );
}
