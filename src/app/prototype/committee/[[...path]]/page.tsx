import {redirect} from "next/navigation";
// Older preview bookmarks now use the system's shared sign-in page.
export default function PrototypePage(){redirect("/login");}
