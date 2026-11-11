import PortalSettings from "@/components/settings/PortalSettings";
import PortalPageHeading from "@/components/shared/PortalPageHeading";
import {Card} from "@/components/ui/Card";
export default function SettingsPage() { return <Card padded={false} className="overflow-hidden"><PortalPageHeading section="settings" /><div className="ui-card-padding"><PortalSettings /></div></Card>; }
