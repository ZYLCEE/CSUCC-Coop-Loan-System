import {cooperativeBranding as brand} from "@/lib/cooperativeBranding";

export default function PortalFooter() {
  return <footer className="portal-footer" aria-label="Cooperative motto">
    <p>“{brand.motto}”</p>
  </footer>;
}
