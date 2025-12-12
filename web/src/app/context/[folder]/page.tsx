"use client";

import { useParams } from "next/navigation";
import ContextEditor from "@/components/ContextEditor";

export default function ContextPage() {
  const params = useParams();
  const folder = params.folder as string;

  // Decode the folder name from URL encoding
  const folderName = decodeURIComponent(folder);

  return <ContextEditor folderName={folderName} />;
}
