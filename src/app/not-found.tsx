import Link from "next/link";
export default function NotFound() {
  return <div className="py-20 text-center"><h1 className="h1">Page not found</h1><p className="muted mt-2">The page you requested does not exist.</p><Link className="btn-primary mt-6" href="/">Go home</Link></div>;
}
