import RecentApplications from "@/components/dashboard/RecentApplications";
import RecentActivity from "@/components/dashboard/RecentActivity";

export default function BottomSection() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[17fr_8fr] gap-3">
      <RecentApplications />
      <RecentActivity />
    </div>
  );
}
