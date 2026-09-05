import { permanentRedirect } from "next/navigation";

/** The page moved to /projects. Kept so an old link or bookmark still lands. */
export default function TargetsPage(): never {
  permanentRedirect("/projects");
}
