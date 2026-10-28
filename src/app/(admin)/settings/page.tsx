"use client";

import { useState } from "react";
import SettingsTabs from "@/components/settings/SettingsTabs";
import GeneralSettings from "@/components/settings/GeneralSettings";
import EmailConfiguration from "@/components/settings/EmailConfiguration";
import LoanPolicy from "@/components/settings/LoanPolicy";
import FeatureToggles from "@/components/settings/FeatureToggles";
import Security from "@/components/settings/Security";
import RolesPermissions from "@/components/settings/RolesPermissions";
import Backup from "@/components/settings/Backup";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("General");

  return (
    <div className="px-6 py-6">
      {/* Settings Tabs */}
      <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Settings Content */}
      {activeTab === "General" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GeneralSettings />
          <EmailConfiguration />
        </div>
      )}

      {activeTab === "Loan Policy" && (
        <LoanPolicy />
      )}

      {activeTab === "Feature Toggles" && (
        <FeatureToggles />
      )}

      {activeTab === "Security" && (
        <Security />
      )}

      {activeTab === "Roles & Permissions" && (
        <RolesPermissions />
      )}

      {activeTab === "Backup" && (
        <Backup />
      )}
    </div>
  );
}
