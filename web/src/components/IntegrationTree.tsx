"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Building2,
  Key,
  Box,
  Loader2,
  Search,
  X,
  FileText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getIntegrationHierarchy } from "@/lib/api";
import type {
  IntegrationHierarchy,
  ApplicationNode,
  OrganizationNode,
  CredentialNode,
} from "@/lib/credential-types";

interface IntegrationTreeProps {
  onSelectApp?: (app: ApplicationNode) => void;
  onSelectOrg?: (org: OrganizationNode) => void;
  onSelectCredential?: (cred: CredentialNode) => void;
  onShowDocs?: (markdown: string, title: string) => void;
}

export function IntegrationTree({
  onSelectApp,
  onSelectOrg,
  onSelectCredential,
  onShowDocs,
}: IntegrationTreeProps) {
  const [hierarchy, setHierarchy] = useState<IntegrationHierarchy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadHierarchy();
  }, []);

  const loadHierarchy = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getIntegrationHierarchy();
      setHierarchy(data);
      // Auto-expand all apps initially
      setExpandedApps(new Set(data.applications.map((a) => a.application.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hierarchy");
    } finally {
      setLoading(false);
    }
  };

  // Filter hierarchy by search
  const filteredHierarchy = useMemo(() => {
    if (!hierarchy || !searchQuery.trim()) return hierarchy;

    const query = searchQuery.toLowerCase();

    const filtered = hierarchy.applications
      .map((appItem) => {
        const appMatches = appItem.application.name.toLowerCase().includes(query);

        const filteredOrgs = appItem.organizations
          .map((orgItem) => {
            const orgMatches =
              orgItem.organization.name.toLowerCase().includes(query) ||
              orgItem.organization.display_name.toLowerCase().includes(query);

            const filteredCreds = orgItem.credentials.filter(
              (cred) =>
                cred.name.toLowerCase().includes(query) ||
                cred.service_name?.toLowerCase().includes(query)
            );

            // Keep org if it matches or has matching credentials
            if (orgMatches || filteredCreds.length > 0) {
              return {
                ...orgItem,
                credentials: orgMatches ? orgItem.credentials : filteredCreds,
              };
            }
            return null;
          })
          .filter(Boolean) as typeof appItem.organizations;

        // Keep app if it matches or has matching orgs
        if (appMatches || filteredOrgs.length > 0) {
          return {
            ...appItem,
            organizations: appMatches ? appItem.organizations : filteredOrgs,
          };
        }
        return null;
      })
      .filter(Boolean) as IntegrationHierarchy["applications"];

    return { applications: filtered };
  }, [hierarchy, searchQuery]);

  const toggleApp = (id: string) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleOrg = (id: string) => {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderAppIcon = (app: ApplicationNode) => {
    if (app.svg_logo) {
      // Unescape double-escaped quotes from database storage
      const unescapedSvg = app.svg_logo
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '')
        .replace(/\\r/g, '')
        .replace(/\\t/g, '');
      return (
        <div
          className="h-3 w-auto flex-shrink-0 [&_svg]:h-full [&_svg]:w-auto [&_svg]:fill-current text-zinc-300"
          dangerouslySetInnerHTML={{ __html: unescapedSvg }}
        />
      );
    }
    if (app.icon_url) {
      return (
        <img
          src={app.icon_url}
          alt={app.name}
          className="h-3 w-auto flex-shrink-0 rounded"
        />
      );
    }
    return <Box className="h-3 w-3 text-zinc-500 flex-shrink-0" />;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mb-3 text-zinc-600" />
        <p className="text-[12px]">Loading integrations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="p-2 rounded-full bg-red-500/10 mb-3">
          <X className="w-4 h-4 text-red-400" />
        </div>
        <p className="text-[12px] text-red-400 mb-3">{error}</p>
        <button
          onClick={loadHierarchy}
          className="text-[12px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!filteredHierarchy || filteredHierarchy.applications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
        {searchQuery ? (
          <>
            <p className="text-[12px] mb-1">No integrations match your search</p>
            <p className="text-[11px] text-zinc-600">Try a different query</p>
          </>
        ) : (
          <>
            <p className="text-[12px] mb-1">No integrations found</p>
            <p className="text-[11px] text-zinc-600">
              Run the migration script to populate the hierarchy
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {filteredHierarchy.applications.map((appItem) => {
            const app = appItem.application;
            const isAppExpanded = expandedApps.has(app.id);
            const orgCount = appItem.organizations.length;
            const credCount = appItem.organizations.reduce(
              (sum, org) => sum + org.credentials.length,
              0
            );

            return (
              <div
                key={app.id}
                className="rounded border border-zinc-800 bg-zinc-900/30 overflow-hidden"
              >
                {/* Application header */}
                <div className="flex items-center">
                  <button
                    onClick={() => toggleApp(app.id)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="text-zinc-500">
                      {isAppExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                    {renderAppIcon(app)}
                    <span
                      className="text-[12px] font-medium text-zinc-200 truncate cursor-pointer hover:text-zinc-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectApp?.(app);
                      }}
                    >
                      {app.name}
                    </span>
                    {app.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                        {app.category}
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-600 ml-auto">
                      {credCount} credential{credCount !== 1 ? "s" : ""}
                    </span>
                  </button>
                  {app.api_docs_md && (
                    <button
                      onClick={() => onShowDocs?.(app.api_docs_md!, app.name)}
                      className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
                      title="View API docs"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Organizations */}
                {isAppExpanded && orgCount > 0 && (
                  <div className="border-t border-zinc-800/50">
                    {appItem.organizations.map((orgItem) => {
                      const org = orgItem.organization;
                      const isOrgExpanded = expandedOrgs.has(org.id);
                      const credentials = orgItem.credentials;

                      return (
                        <div key={org.id} className="border-b border-zinc-800/30 last:border-b-0">
                          {/* Organization header */}
                          <button
                            onClick={() => toggleOrg(org.id)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/20 transition-colors pl-8"
                          >
                            <div className="text-zinc-600">
                              {isOrgExpanded ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </div>
                            <Building2 className="w-3.5 h-3.5 text-zinc-500" />
                            <span
                              className="text-[11px] text-zinc-400 truncate cursor-pointer hover:text-zinc-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectOrg?.(org);
                              }}
                            >
                              {org.display_name}
                            </span>
                            {org.vault_name && (
                              <span className="text-[10px] text-zinc-600">
                                ({org.vault_name})
                              </span>
                            )}
                            <span className="text-[10px] text-zinc-700 ml-auto">
                              {credentials.length}
                            </span>
                          </button>

                          {/* Credentials */}
                          {isOrgExpanded && credentials.length > 0 && (
                            <div className="pl-12 pb-1">
                              {credentials.map((cred) => (
                                <div
                                  key={cred.id}
                                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/30 transition-colors group"
                                >
                                  <Key className="w-3 h-3 text-zinc-600" />
                                  <span
                                    className="text-[11px] text-zinc-500 truncate flex-1 cursor-pointer hover:text-zinc-400"
                                    onClick={() => onSelectCredential?.(cred)}
                                  >
                                    {cred.name}
                                  </span>
                                  {cred.service_name && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800/50 text-zinc-600">
                                      {cred.service_name}
                                    </span>
                                  )}
                                  {cred.api_docs_md && (
                                    <button
                                      onClick={() =>
                                        onShowDocs?.(cred.api_docs_md!, cred.name)
                                      }
                                      className="p-1 text-zinc-600 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="View API docs"
                                    >
                                      <FileText className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
