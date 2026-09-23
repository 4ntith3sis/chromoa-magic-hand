"use client";

import dynamic from "next/dynamic";

// ssr:false requires a client component, hence this thin wrapper.
const WandStage = dynamic(() => import("@/components/WandStage"), { ssr: false });

export default function StageMount() {
  return <WandStage />;
}
