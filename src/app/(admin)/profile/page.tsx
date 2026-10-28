"use client";

import ProfileCard from "@/components/profile/ProfileCard";
import ProfileForm from "@/components/profile/ProfileForm";

export default function ProfilePage() {
  return (
    <div className="px-4 py-4">
      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column - Profile Card */}
        <div className="lg:col-span-4">
          <div className="h-full">
            <ProfileCard />
          </div>
        </div>

        {/* Right Column - Profile Form */}
        <div className="lg:col-span-8">
          <div className="h-full">
            <ProfileForm />
          </div>
        </div>
      </div>
    </div>
  );
}
