import type { ComponentPropsWithoutRef } from "react";
import { Search } from "lucide-react";
import { Input } from "./Fields";

export function FilterToolbar({ className = "", ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={`ui-toolbar ${className}`} />;
}

export function SearchInput({ wrapperClassName = "", ...props }: ComponentPropsWithoutRef<"input"> & { wrapperClassName?: string }) {
  return <Input {...props} type="search" size="default" leadingIcon={<Search />}
    wrapperClassName={`flex-[1_1_14rem] ${wrapperClassName}`} />;
}
