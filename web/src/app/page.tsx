"use client";

import { useState } from "react";
import { Terminal } from "lucide-react";
import SessionList from "@/components/SessionList";
import SessionDetail from "@/components/SessionDetail";

export default function Home() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // On mobile, show sidebar by default when no session is selected
  const [showSidebar, setShowSidebar] = useState(true);

  const handleSelectSession = (id: string) => {
    setSelectedSessionId(id || null);
    // On mobile, hide sidebar when session is selected
    if (id) {
      setShowSidebar(false);
    }
  };

  const handleBack = () => {
    setShowSidebar(true);
  };

  return (
    <div className="h-screen flex relative bg-background overflow-hidden">
      {/* Animated grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(57,255,20,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(57,255,20,0.03)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />

      {/* Mobile: Use conditional rendering for cleaner mobile experience */}
      {/* Desktop: Side-by-side layout */}

      {/* Sidebar */}
      <div
        className={`
          md:w-80 md:flex-shrink-0 md:relative md:block
          ${showSidebar ? "absolute inset-0 z-20 block" : "hidden md:block"}
        `}
      >
        <SessionList
          selectedId={selectedSessionId}
          onSelect={handleSelectSession}
        />
      </div>

      {/* Main Content */}
      <div
        className={`
          md:flex-1 md:min-w-0 md:relative md:block
          ${!showSidebar ? "absolute inset-0 z-20 block" : "hidden md:block"}
        `}
      >
        {selectedSessionId ? (
          <SessionDetail
            key={selectedSessionId}
            sessionId={selectedSessionId}
            onBack={handleBack}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 bg-background">
            <Terminal
              className="w-16 h-16 mb-6 text-primary/30"
              strokeWidth={1}
            />
            <h2 className="text-xl font-semibold mb-3 text-foreground">
              No Session Selected
            </h2>
            <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
              Select a session from the sidebar or create a new one to get started.
              Configure the API URL in settings to connect to a remote server.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
