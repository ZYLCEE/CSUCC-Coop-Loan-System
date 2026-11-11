import ProfileWorkspace from "@/components/profile/ProfileWorkspace";
import PortalPageHeading from "@/components/shared/PortalPageHeading";
import {Card} from "@/components/ui/Card";
export default function ProfilePage() { return <Card padded={false} className="overflow-hidden"><PortalPageHeading section="profile" /><div className="ui-card-padding"><ProfileWorkspace /></div></Card>; }
