import {Badge} from "@/components/ui/StatusBadge";
import {accountRoles,accountRoleTones,type AccountRole} from "@/lib/accountPresentation";
export default function AccountRoleBadge({role}:{role:AccountRole}){
 return <Badge tone={accountRoleTones[role]} className="whitespace-nowrap">{accountRoles[role]}</Badge>;
}
