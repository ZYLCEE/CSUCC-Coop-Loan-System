import Image from "next/image";
import type {ReactNode} from "react";
import {cooperativeBranding as brand} from "@/lib/cooperativeBranding";

export default function CooperativeLetterhead({children}:{children?:ReactNode}) {
  return <div className="coop-header-inner coop-letterhead" aria-label="Cooperative letterhead">
    <Image className="coop-letterhead-seal" src={brand.seal} width={88} height={88}
      alt="CSUCC Employees and Retirees Multi-Purpose Cooperative seal" unoptimized loading="eager" />
    <div className="coop-letterhead-copy">
      <p className="coop-letterhead-name">{brand.name}</p>
      <p className="coop-letterhead-contact"><span>{brand.address}</span><span>{brand.telephone}</span></p>
      <p className="coop-letterhead-registration">{brand.registration}</p>
      <div className="coop-letterhead-affiliations" aria-label="Cooperative affiliations">
        {brand.affiliations.map((affiliation,index)=><p key={affiliation}>{index===0?"Affiliates: ":""}{affiliation}</p>)}
      </div>
    </div>
    {children}
  </div>;
}
