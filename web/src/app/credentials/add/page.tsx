"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  Key,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  get1PasswordAccounts,
  get1PasswordAccountDetails,
  addTrackedCredentials,
} from "@/lib/api";
import type {
  AccountSummary,
  AccountDetails,
  TrackedCredentialInput,
} from "@/lib/credential-types";

export default function AddCredentialsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [accountDetails, setAccountDetails] = useState<AccountDetails | null>(null);
  const [selectedCredentials, setSelectedCredentials] = useState<Set<string>>(new Set());
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load accounts on mount
  useEffect(() => {
    loadAccounts();
  }, []);

  // Load account details when selection changes
  useEffect(() => {
    if (selectedAccount) {
      loadAccountDetails(selectedAccount);
    } else {
      setAccountDetails(null);
      setSelectedCredentials(new Set());
    }
  }, [selectedAccount]);

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const data = await get1PasswordAccounts();
      setAccounts(data.filter((a) => !a.error));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoadingAccounts(false);
    }
  };

  const loadAccountDetails = async (accountName: string) => {
    setLoadingDetails(true);
    setError(null);
    try {
      const details = await get1PasswordAccountDetails(accountName);
      setAccountDetails(details);
      // Pre-select untracked credentials
      const untracked = details.credentials
        .filter((c) => !c.tracked)
        .map((c) => c.name);
      setSelectedCredentials(new Set(untracked));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load account details");
    } finally {
      setLoadingDetails(false);
    }
  };

  const toggleCredential = (name: string, isTracked: boolean) => {
    if (isTracked) return; // Can't toggle already tracked credentials

    setSelectedCredentials((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!accountDetails) return;
    const untracked = accountDetails.credentials
      .filter((c) => !c.tracked)
      .map((c) => c.name);
    setSelectedCredentials(new Set(untracked));
  };

  const selectNone = () => {
    setSelectedCredentials(new Set());
  };

  const handleSubmit = async () => {
    if (!accountDetails || selectedCredentials.size === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      // Build credential inputs
      const credentials: TrackedCredentialInput[] = Array.from(selectedCredentials).map(
        (credName) => ({
          account_name: accountDetails.account,
          vault_id: accountDetails.vaultId,
          vault_name: accountDetails.vaultName,
          credential_name: credName,
          item_id: "", // Will be populated by backend
          field_label: "", // Will be populated by backend
        })
      );

      await addTrackedCredentials(credentials);
      router.push("/credentials");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add credentials");
    } finally {
      setSubmitting(false);
    }
  };

  const untrackedCount = accountDetails?.credentials.filter((c) => !c.tracked).length ?? 0;
  const selectedCount = selectedCredentials.size;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900/50 to-transparent">
        <div className="flex items-center gap-3">
          {/* Back button */}
          <button
            onClick={() => router.push("/credentials")}
            className="p-2 -ml-2 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Key className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
              Add Credentials
            </h1>
            <p className="text-xs text-zinc-500">
              Select credentials from 1Password to track
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Account selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Account
            </label>
            <Select
              value={selectedAccount}
              onValueChange={setSelectedAccount}
              disabled={loadingAccounts}
            >
              <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-200 focus:ring-emerald-500/20 focus:border-emerald-500/50">
                <SelectValue placeholder={loadingAccounts ? "Loading accounts..." : "Select account"} />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {accounts.map((account) => (
                  <SelectItem
                    key={account.name}
                    value={account.name}
                    className="text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-zinc-500" />
                      <span>{account.name}</span>
                      <span className="text-xs text-zinc-500 font-mono ml-auto">
                        ({account.credentialCount})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Credentials list */}
          {selectedAccount && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Credentials
                </label>
                {accountDetails && untrackedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAll}
                      className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      Select all
                    </button>
                    <span className="text-zinc-700">|</span>
                    <button
                      onClick={selectNone}
                      className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                {loadingDetails ? (
                  <div className="flex items-center justify-center py-12 text-zinc-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-sm">Loading credentials...</span>
                  </div>
                ) : accountDetails?.credentials.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                    <AlertCircle className="w-6 h-6 mb-2" />
                    <span className="text-sm">No credentials found</span>
                  </div>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <div className="divide-y divide-zinc-800/50">
                      {accountDetails?.credentials.map((cred) => {
                        const isSelected = selectedCredentials.has(cred.name);
                        const isTracked = cred.tracked;

                        return (
                          <button
                            key={cred.name}
                            onClick={() => toggleCredential(cred.name, isTracked)}
                            disabled={isTracked}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                              isTracked
                                ? "opacity-50 cursor-not-allowed bg-zinc-900/30"
                                : isSelected
                                ? "bg-emerald-500/10"
                                : "hover:bg-zinc-800/30"
                            }`}
                          >
                            <div
                              className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                                isTracked
                                  ? "bg-zinc-700 border-zinc-600"
                                  : isSelected
                                  ? "bg-emerald-500 border-emerald-500"
                                  : "border-zinc-600"
                              }`}
                            >
                              {(isSelected || isTracked) && (
                                <Check className="w-3.5 h-3.5 text-white" />
                              )}
                            </div>
                            <span
                              className={`font-mono text-sm flex-1 ${
                                isTracked
                                  ? "text-zinc-500"
                                  : isSelected
                                  ? "text-emerald-300"
                                  : "text-zinc-300"
                              }`}
                            >
                              {cred.name}
                            </span>
                            {isTracked && (
                              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                                Already tracked
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-zinc-800/50 bg-zinc-900/30">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => router.push("/credentials")}
            className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedCount === 0 || submitting}
            className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Adding...
              </>
            ) : (
              <>
                Add {selectedCount > 0 ? selectedCount : ""} Credential
                {selectedCount !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
