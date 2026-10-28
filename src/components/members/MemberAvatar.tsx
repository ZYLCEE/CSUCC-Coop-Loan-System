"use client";

interface MemberAvatarProps {
  initials: string;
}

export default function MemberAvatar({ initials }: MemberAvatarProps) {
  return (
    <div className="w-8 h-8 rounded-full bg-[#155D3B] flex items-center justify-center flex-shrink-0">
      <span className="text-white font-medium text-[11px]">{initials}</span>
    </div>
  );
}
