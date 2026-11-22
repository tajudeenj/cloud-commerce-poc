import { requireAdmin } from "@/lib/auth";
import { getContent } from "@/lib/services/admin";
import { ActionForm, Submit } from "@/components/form";
import { saveContentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Content() {
  await requireAdmin();
  const c = await getContent();
  return (
    <div className="max-w-2xl space-y-6"><h1 className="h1">Site content</h1>
      <p className="muted">Edit homepage messaging without a deployment. (Production: full block-based page builder via Payload CMS.)</p>
      <ActionForm action={saveContentAction} className="card space-y-4">
        <div><label className="label" htmlFor="b">Promo badge</label><input id="b" name="hero.badge" className="input" defaultValue={c["hero.badge"]} maxLength={80} /></div>
        <div><label className="label" htmlFor="t">Hero title</label><input id="t" name="hero.title" className="input" defaultValue={c["hero.title"]} required maxLength={120} /></div>
        <div><label className="label" htmlFor="s">Hero subtitle</label><textarea id="s" name="hero.subtitle" className="input" rows={3} defaultValue={c["hero.subtitle"]} maxLength={400} /></div>
        <Submit>Publish</Submit>
      </ActionForm>
    </div>
  );
}
